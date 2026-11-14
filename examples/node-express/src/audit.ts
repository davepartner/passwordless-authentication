/**
 * Append-only audit log.
 *
 * Every security-relevant action is recorded here: sign-ins (success and
 * failure), 2FA changes, session revocations, email changes, admin actions.
 * Users see their own slice (login history); admins see everything for the user
 * they are investigating. Records are never updated or deleted by request
 * handlers — retention is a scheduled job, documented per action.
 */

import { randomBytes } from 'node:crypto';

export type AuditAction =
  | 'login.succeeded'
  | 'login.failed'
  | 'login.2fa_required'
  | 'login.2fa_failed'
  | 'logout'
  | 'session.revoked'
  | 'session.revoke_all'
  | 'session.duration_changed'
  | 'twofactor.enroll_started'
  | 'twofactor.enabled'
  | 'twofactor.disabled'
  | 'twofactor.recovery_regenerated'
  | 'email.change_requested'
  | 'email.changed'
  | 'email.change_cancelled'
  | 'admin.policy_changed'
  | 'admin.user_viewed'
  | 'admin.user_session_revoked'
  | 'admin.user_session_days_changed'
  | 'admin.twofactor_reset';

export interface AuditEvent {
  id: string;
  at: number;
  /** Who performed the action (email, or 'anonymous'). */
  actor: string;
  /** Whose account it affects — what users and admins filter on. */
  target: string;
  action: AuditAction;
  outcome: 'success' | 'failure';
  ip: string | null;
  location: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  /** Small, non-sensitive context (never secrets or codes). */
  meta?: Record<string, string | number | boolean>;
}

export interface AuditInput extends Omit<AuditEvent, 'id' | 'at' | 'outcome'> {
  at?: number;
  outcome?: AuditEvent['outcome'];
}

const MAX_EVENTS = 5000;
const events: AuditEvent[] = [];

export const audit = {
  record(input: AuditInput): AuditEvent {
    const event: AuditEvent = {
      id: randomBytes(8).toString('hex'),
      at: input.at ?? Date.now(),
      outcome: input.outcome ?? 'success',
      actor: input.actor,
      target: input.target,
      action: input.action,
      ip: input.ip ?? null,
      location: input.location ?? null,
      userAgent: input.userAgent ?? null,
      deviceLabel: input.deviceLabel ?? null,
      ...(input.meta ? { meta: input.meta } : {}),
    };

    events.unshift(event); // newest first
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    return event;
  },

  /** Everything that happened to (or was done by) this account. */
  forUser(email: string, limit = 100): AuditEvent[] {
    return events.filter((e) => e.target === email || e.actor === email).slice(0, limit);
  },

  /** Login + session events only — the profile "login history" list. */
  loginHistory(email: string, limit = 50): AuditEvent[] {
    const authActions = new Set<AuditAction>([
      'login.succeeded',
      'login.failed',
      'login.2fa_required',
      'login.2fa_failed',
      'logout',
      'session.revoked',
      'session.revoke_all',
    ]);
    return events
      .filter((e) => e.target === email && authActions.has(e.action))
      .slice(0, limit);
  },

  /**
   * What the account owner sees on their profile: sign-ins *and* the security
   * changes they made — including every login-email change.
   */
  securityHistory(email: string, limit = 50): AuditEvent[] {
    const relevant = new Set<AuditAction>([
      'login.succeeded',
      'login.failed',
      'login.2fa_required',
      'login.2fa_failed',
      'logout',
      'session.revoked',
      'session.revoke_all',
      'session.duration_changed',
      'twofactor.enabled',
      'twofactor.disabled',
      'twofactor.recovery_regenerated',
      'email.change_requested',
      'email.changed',
      'email.change_cancelled',
    ]);
    return events
      .filter((e) => (e.target === email || e.actor === email) && relevant.has(e.action))
      .slice(0, limit);
  },

  all(limit = 500): AuditEvent[] {
    return events.slice(0, limit);
  },

  clear(): void {
    events.length = 0;
  },
};
