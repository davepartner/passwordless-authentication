import { randomBytes } from 'node:crypto';

/**
 * In-memory stores. Replace with Postgres/Redis in production — the record
 * shapes are what matter, not the backing store. In production, also add a
 * scheduled purge for expired challenges and expired sessions (retention).
 */

export interface OtpChallenge {
  id: string; // the requestId — the challenge is keyed by this, not by email
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  ip: string | null;
}

export interface User {
  email: string;
  emailVerifiedAt: number | null;
}

export interface DeviceCredential {
  userId: string;
  publicKeyPem: string;
  deviceId: string;
  label: string;
  lastUsedAt: number | null;
}

interface Session {
  email: string;
  expiresAt: number;
}

const challenges = new Map<string, OtpChallenge>(); // id (requestId) -> challenge
const users = new Map<string, User>(); // email -> user
const devices = new Map<string, DeviceCredential[]>(); // email -> enrolled devices
const sessions = new Map<string, Session>(); // token -> session

const SESSION_TTL_MS = 30 * 24 * 3600_000; // 30 days

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

// Server-side opaque session tokens (expiring, revocable). In production use an
// HttpOnly cookie (server-rendered) or a short-lived signed JWT (API).
export const sessionStore = {
  create(email: string): string {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  },
  emailFor(token: string): string | null {
    const s = sessions.get(token);
    if (!s || s.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return s.email;
  },
  destroy(token: string): void {
    sessions.delete(token);
  },
};
