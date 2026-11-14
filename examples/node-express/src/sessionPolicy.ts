/**
 * Login-session duration policy.
 *
 * One rule, applied everywhere: a session lives for
 * `clamp(userPreference ?? adminDefault, adminMin, adminMax)` days.
 *
 * - Default is **365 days (1 year)** — the product requirement.
 * - A user may choose their own duration on their profile (unless the admin
 *   turns `allowUserOverride` off).
 * - An admin can change the default, the ceiling, and any individual user's
 *   duration.
 * - Changing the policy affects **new sessions only**; live sessions keep the
 *   expiry they were issued with, so nobody is silently kicked out or extended.
 */

export interface SessionPolicy {
  defaultDays: number;
  minDays: number;
  maxDays: number;
  allowUserOverride: boolean;
  /** Optional inactivity timeout in days (null = disabled). */
  idleDays: number | null;
}

export const HARD_LIMITS = {
  minDays: 1,
  maxDays: 3650,
} as const;

const DEFAULTS: SessionPolicy = {
  defaultDays: 365,
  minDays: HARD_LIMITS.minDays,
  maxDays: 365,
  allowUserOverride: true,
  idleDays: null,
};

let policy: SessionPolicy = { ...DEFAULTS };

export function getPolicy(): SessionPolicy {
  return { ...policy };
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export type PolicyPatch = Partial<SessionPolicy>;

export type PolicyResult =
  | { ok: true; policy: SessionPolicy }
  | { ok: false; error: string; field?: string };

/** Validate and apply a partial update. Returns the new policy (immutable). */
export function updatePolicy(patch: PolicyPatch): PolicyResult {
  const next: SessionPolicy = { ...policy };

  for (const key of ['defaultDays', 'minDays', 'maxDays'] as const) {
    if (patch[key] === undefined) continue;
    if (!isInt(patch[key]) || patch[key] < HARD_LIMITS.minDays || patch[key] > HARD_LIMITS.maxDays) {
      return {
        ok: false,
        field: key,
        error: `${key} must be a whole number between ${HARD_LIMITS.minDays} and ${HARD_LIMITS.maxDays}.`,
      };
    }
    next[key] = patch[key];
  }

  if (patch.allowUserOverride !== undefined) {
    if (typeof patch.allowUserOverride !== 'boolean') {
      return { ok: false, field: 'allowUserOverride', error: 'allowUserOverride must be a boolean.' };
    }
    next.allowUserOverride = patch.allowUserOverride;
  }

  if (patch.idleDays !== undefined) {
    if (patch.idleDays !== null && (!isInt(patch.idleDays) || patch.idleDays < 1)) {
      return { ok: false, field: 'idleDays', error: 'idleDays must be null or a positive integer.' };
    }
    next.idleDays = patch.idleDays;
  }

  if (next.minDays > next.defaultDays) {
    return { ok: false, field: 'defaultDays', error: 'defaultDays must be at least minDays.' };
  }
  if (next.defaultDays > next.maxDays) {
    return { ok: false, field: 'maxDays', error: 'maxDays must be at least defaultDays.' };
  }

  policy = next;
  return { ok: true, policy: getPolicy() };
}

/** Reset to defaults (used by tests). */
export function resetPolicy(): void {
  policy = { ...DEFAULTS };
}

/** Coerce any requested duration into the policy's allowed band. */
export function clampDays(days: number): number {
  const { minDays, maxDays } = policy;
  if (!Number.isFinite(days)) return policy.defaultDays;
  return Math.min(maxDays, Math.max(minDays, Math.round(days)));
}

/**
 * The duration this user's next session should get.
 * `sessionDays: null` means "follow the admin default".
 */
export function effectiveDays(user: { sessionDays?: number | null }): number {
  const requested = policy.allowUserOverride ? user.sessionDays ?? policy.defaultDays : policy.defaultDays;
  return clampDays(requested);
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a live session has idled past the policy limit. */
export function isIdleExpired(lastSeenAt: number, now = Date.now()): boolean {
  if (policy.idleDays === null) return false;
  return now - lastSeenAt > policy.idleDays * DAY_MS;
}
