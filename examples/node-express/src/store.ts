/**
 * In-memory stores. Replace with Postgres/Redis in production — the record
 * shapes are what matter, not the backing store. In production, also add a
 * scheduled purge for expired challenges and expired sessions (retention).
 *
 * Two deliberate security choices worth keeping when you port this:
 *
 * 1. **Session tokens are stored hashed** (SHA-256 of an opaque 256-bit token).
 *    A copy of the database therefore contains no live session token, exactly
 *    like a password store. Looking a session up requires the raw token.
 * 2. **Sessions are records, not just keys** — each one carries the device,
 *    coarse location, and timestamps the profile page shows and the user can
 *    revoke.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { ConsentRecord } from './consent.js';
import { isIdleExpired } from './sessionPolicy.js';

export type Role = 'user' | 'admin';

export interface RecoveryCode {
  /** SHA-256 of the normalized code — recovery codes are high-entropy. */
  hash: string;
  usedAt: number | null;
}

export interface OtpChallenge {
  id: string; // the requestId — the challenge is keyed by this, not by email
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  ip: string | null;
  /** Terms/Privacy acceptance captured at request time, persisted at verify. */
  consent: ConsentRecord | null;
}

export interface User {
  email: string;
  emailVerifiedAt: number | null;
  createdAt: number;
  role: Role;

  // Legal acceptance (see legal-consent.md)
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  privacyVersion: string | null;
  privacyAcceptedAt: number | null;

  /** Personal login-duration preference in days; null = follow the admin default. */
  sessionDays: number | null;

  // Two-factor (TOTP)
  twoFactorSecret: string | null;
  twoFactorEnabledAt: number | null;
  /** Last accepted TOTP time step — rejects replays of a captured code. */
  twoFactorLastStep: number | null;
  /** Unconfirmed secret while enrollment is in progress. */
  pendingTwoFactorSecret: string | null;
  pendingTwoFactorCreatedAt: number | null;
  recoveryCodes: RecoveryCode[];

  /** Audit trail of previous login addresses, newest first. */
  previousEmails: string[];
}

export interface DeviceCredential {
  userId: string;
  publicKeyPem: string;
  deviceId: string;
  label: string;
  lastUsedAt: number | null;
}

export interface SessionMeta {
  ip: string | null;
  location: string | null;
  userAgent: string | null;
  deviceLabel: string;
}

export interface SessionRecord extends SessionMeta {
  id: string;
  /** SHA-256 of the bearer token. The raw token is never stored. */
  tokenHash: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  /** How this session authenticated: email_otp, totp, recovery_code, biometric. */
  methods: string[];
  /** When step-up authentication last succeeded (for sensitive actions). */
  lastStrongAuthAt: number;
  revokedAt: number | null;
  revokedReason: string | null;
}

export interface MfaChallenge {
  id: string;
  tokenHash: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  ip: string | null;
  location: string | null;
  userAgent: string | null;
  deviceLabel: string;
}

export interface EmailChangeRequest {
  id: string;
  userEmail: string;
  newEmail: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  ip: string | null;
  location: string | null;
  userAgent: string | null;
}

const challenges = new Map<string, OtpChallenge>(); // id (requestId) -> challenge
const users = new Map<string, User>(); // email -> user
const devices = new Map<string, DeviceCredential[]>(); // email -> enrolled devices

const sessionsById = new Map<string, SessionRecord>();
const sessionsByTokenHash = new Map<string, string>(); // tokenHash -> session id

const mfaChallenges = new Map<string, MfaChallenge>();
const emailChangeRequests = new Map<string, EmailChangeRequest>();

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const challengeStore = {
  set(id: string, c: OtpChallenge): void {
    challenges.set(id, c);
  },
  get(id: string): OtpChallenge | undefined {
    return challenges.get(id);
  },
  delete(id: string): void {
    challenges.delete(id);
  },
};

export const userStore = {
  get(email: string): User | undefined {
    return users.get(email);
  },
  put(email: string, u: User): void {
    users.set(email, u);
  },
  all(): User[] {
    return [...users.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
  /**
   * Move an account to a new login address, keeping the record (and its
   * consent, 2FA, and preference fields) intact.
   */
  rename(oldEmail: string, newEmail: string): User | undefined {
    const existing = users.get(oldEmail);
    if (!existing) return undefined;

    const updated: User = {
      ...existing,
      email: newEmail,
      previousEmails: [oldEmail, ...existing.previousEmails].slice(0, 20),
    };
    users.delete(oldEmail);
    users.set(newEmail, updated);

    const creds = devices.get(oldEmail);
    if (creds) {
      devices.delete(oldEmail);
      devices.set(newEmail, creds);
    }
    return updated;
  },
  remove(email: string): void {
    users.delete(email);
  },
};

export const deviceStore = {
  list(email: string): DeviceCredential[] {
    return devices.get(email) ?? [];
  },
  add(email: string, d: DeviceCredential): void {
    const list = devices.get(email) ?? [];
    list.push(d);
    devices.set(email, list);
  },
  remove(email: string, deviceId: string): void {
    devices.set(
      email,
      (devices.get(email) ?? []).filter((d) => d.deviceId !== deviceId),
    );
  },
};

// ── sessions ─────────────────────────────────────────────────────────────────

export interface CreateSessionResult {
  token: string;
  session: SessionRecord;
}

export function isLive(session: SessionRecord, now = Date.now()): boolean {
  return (
    session.revokedAt === null &&
    session.expiresAt > now &&
    !isIdleExpired(session.lastSeenAt, now)
  );
}

export const sessionStore = {
  create(
    email: string,
    meta: SessionMeta,
    ttlMs: number,
    methods: string[],
    now = Date.now(),
  ): CreateSessionResult {
    const token = randomBytes(32).toString('base64url');
    const session: SessionRecord = {
      id: randomBytes(12).toString('hex'),
      tokenHash: sha256(token),
      email,
      createdAt: now,
      expiresAt: now + ttlMs,
      lastSeenAt: now,
      lastStrongAuthAt: now,
      methods,
      revokedAt: null,
      revokedReason: null,
      ...meta,
    };
    sessionsById.set(session.id, session);
    sessionsByTokenHash.set(session.tokenHash, session.id);
    return { token, session };
  },

  byId(id: string): SessionRecord | undefined {
    return sessionsById.get(id);
  },

  /** Resolve a raw bearer token to a live session, touching last-seen. */
  sessionFor(token: string): SessionRecord | null {
    const id = sessionsByTokenHash.get(sha256(token));
    if (!id) return null;
    const session = sessionsById.get(id);
    if (!session) return null;
    if (!isLive(session)) return null;

    // Throttle writes in a real store (e.g. at most once a minute).
    session.lastSeenAt = Date.now();
    return session;
  },

  emailFor(token: string): string | null {
    return this.sessionFor(token)?.email ?? null;
  },

  /** All sessions for a user, newest first. Revoked ones for admin views. */
  list(email: string, options: { includeRevoked?: boolean } = {}): SessionRecord[] {
    const now = Date.now();
    return [...sessionsById.values()]
      .filter((s) => s.email === email)
      .filter((s) => (options.includeRevoked ? true : isLive(s, now)))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },

  revoke(sessionId: string, reason: string): boolean {
    const session = sessionsById.get(sessionId);
    if (!session || session.revokedAt !== null) return false;
    session.revokedAt = Date.now();
    session.revokedReason = reason;
    sessionsByTokenHash.delete(session.tokenHash);
    return true;
  },

  revokeByToken(token: string, reason: string): boolean {
    const id = sessionsByTokenHash.get(sha256(token));
    return id ? this.revoke(id, reason) : false;
  },

  /** Revoke every session for a user, optionally keeping the current one. */
  revokeAll(email: string, options: { exceptSessionId?: string; reason: string }): number {
    let count = 0;
    for (const session of [...sessionsById.values()]) {
      if (session.email !== email) continue;
      if (options.exceptSessionId && session.id === options.exceptSessionId) continue;
      if (this.revoke(session.id, options.reason)) count += 1;
    }
    return count;
  },

  /** Called after an email change so no stale session points at the old address. */
  moveEmail(oldEmail: string, newEmail: string): void {
    for (const session of sessionsById.values()) {
      if (session.email === oldEmail) session.email = newEmail;
    }
  },
};

// ── 2FA challenges ───────────────────────────────────────────────────────────

const MFA_TTL_MS = 5 * 60 * 1000;

export const mfaStore = {
  create(email: string, meta: SessionMeta, now = Date.now()): { token: string; challenge: MfaChallenge } {
    const token = randomBytes(32).toString('base64url');
    const challenge: MfaChallenge = {
      id: randomBytes(12).toString('hex'),
      tokenHash: sha256(token),
      email,
      createdAt: now,
      expiresAt: now + MFA_TTL_MS,
      attempts: 0,
      consumedAt: null,
      ...meta,
    };
    mfaChallenges.set(challenge.id, challenge);
    return { token, challenge };
  },

  byToken(token: string): MfaChallenge | undefined {
    const hash = sha256(token);
    return [...mfaChallenges.values()].find((c) => c.tokenHash === hash);
  },

  delete(id: string): void {
    mfaChallenges.delete(id);
  },

  ttlMs: MFA_TTL_MS,
};

// ── email change requests ────────────────────────────────────────────────────

const EMAIL_CHANGE_TTL_MS = 10 * 60 * 1000;

export const emailChangeStore = {
  /** Replace any in-flight request for this user — one change at a time. */
  create(input: Omit<EmailChangeRequest, 'id' | 'createdAt' | 'attempts' | 'consumedAt'>): EmailChangeRequest {
    for (const [id, request] of [...emailChangeRequests.entries()]) {
      if (request.userEmail === input.userEmail) emailChangeRequests.delete(id);
    }

    const request: EmailChangeRequest = {
      id: randomBytes(12).toString('hex'),
      createdAt: Date.now(),
      attempts: 0,
      consumedAt: null,
      ...input,
    };
    emailChangeRequests.set(request.id, request);
    return request;
  },

  get(id: string): EmailChangeRequest | undefined {
    return emailChangeRequests.get(id);
  },

  activeFor(userEmail: string): EmailChangeRequest | undefined {
    return [...emailChangeRequests.values()].find(
      (r) => r.userEmail === userEmail && r.consumedAt === null && r.expiresAt > Date.now(),
    );
  },

  delete(id: string): void {
    emailChangeRequests.delete(id);
  },

  ttlMs: EMAIL_CHANGE_TTL_MS,
};
