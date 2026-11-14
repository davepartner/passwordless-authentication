# Architecture — Passwordless Email OTP

The complete flow, API contract, data model, and the edge cases the implementation must survive.
Platform-agnostic: map these onto your framework's routing, ORM/DB, and session primitives.

---

## Sequence

```
Client                          Server                          Mail provider
  │                                │                                │
  │  GET /login                    │                                │
  │ ─────────────────────────────▶ │  render single-email form      │
  │                                │  + pre-checked Terms/Privacy   │
  │                                │                                │
  │  POST /auth/otp/request        │                                │
  │  { email, acceptedTerms: true, │                                │
  │    acceptedPrivacy: true }     │                                │
  │ ─────────────────────────────▶ │  validate email (syntax)       │
  │                                │  validate consent (both true)  │
  │                                │  rate-limit (email + IP)       │
  │                                │  generate code (CSPRNG)        │
  │                                │  create challenge (id+consent) │
  │                                │ ──────────────────────────────▶ send code email
  │                                │  (NO user lookup)              │
  │ ◀───────────────────────────── │  200 { ok, requestId, resend_after }
  │                                │                                │
  │  render verify view            │                                │
  │  (code entry, countdown,       │                                │
  │   "check spam" banner)         │                                │
  │                                │                                │
  │  POST /auth/otp/verify         │                                │
  │  { requestId, code }           │                                │
  │ ─────────────────────────────▶ │  load challenge by requestId   │
  │                                │  constant-time compare          │
  │                                │  check expiry + attempts        │
  │                                │  find-or-create user            │
  │                                │  persist consent (version+time) │
  │                                │  establish session (regenerate) │
  │ ◀───────────────────────────── │  200 { ok, redirect }          │
  │  redirect → /dashboard         │                                │
```

---

## Challenge keying (the important decision)

Challenges are **keyed by `id` (the `requestId`), not by email**.

- `request` creates a new challenge with a fresh `id` and returns it as `requestId`.
- `verify` and `resend` address the challenge **by `requestId`**.

Why:

1. **No login-DoS.** If an attacker calls `request` for a victim's email, it creates a *new*
   challenge — it does not invalidate the victim's in-flight one. (The old "one active challenge per
   email, newest wins" rule was a denial-of-service vector.)
2. **Cleaner binding.** The code is tied to the exact request that issued it.
3. **Uniform with the biometric flow** (which is also challenge-based).

The number of co-existing challenges for an email is bounded by the send rate limits (per-email and
per-IP), so this does not enable unbounded code issuance.

---

## State transport: two supported patterns

1. **Opaque request token (primary, stateless/SPA/API).** The `requestId` *is* the token. The client
   sends it back with the code. Nothing else is stored server-side between steps. This is what the
   pseudocode and the Node example implement.

2. **Server session (classic server apps).** After `request`, store `pending_email` and
   `resend_available_at` in the server-side session; the verify/resend endpoints read the email from
   the session. The data model and security rules are identical — only the correlation mechanism
   differs.

---

## API contract detail

### `POST /auth/otp/request`

- **In:** `{ "email": string, "acceptedTerms": boolean, "acceptedPrivacy": boolean }`.
- **Server steps (in order):** normalize → validate syntax → **validate consent** → rate-limit (email
  then IP) → generate code (CSPRNG) → create challenge (id, email, code_hash, expires_at, ip,
  consent) → send email → respond.
- **Out (always identical):**
  `{ "ok": true, "requestId": "<id>", "resend_after": 30, "message": "If that address is registered, a code is on its way." }`
- **Errors:** invalid syntax → 422; consent missing/false → 422 with `field: "consent"` (no email is
  sent); rate-limited → 429 with `retry_after`. None reveals account existence.

### `POST /auth/otp/verify`

- **In:** `{ "requestId": string, "code": string }`.
- **Server steps:** load challenge by `requestId` → rate-limit (verify, failures only) → constant-time
  compare (dummy hash when absent) → check expiry, attempts → on success: find-or-create user, mark
  verified, **persist the acceptance carried by the challenge**, establish session, regenerate session
  id, clear state, consume the challenge.
- **Out success (2FA on):** `{ "ok": true, "requires2fa": true, "mfaToken": "<opaque>", "expiresIn": 300 }`
  — **no session is issued**; the client must complete `POST /auth/2fa/verify`, which mints a fresh
  token and writes the login audit event.
- **Out success:** `{ "ok": true, "redirect": "/dashboard", "sessionToken": "<token>", "sessionDays": 365, "isNewUser": false }`.
  The duration comes from `clamp(user preference ?? admin default, min, max)` — 365 days by default. For a
  **first-time** registration the server returns `redirect: "/profile"` plus a `flash` message
  ("Welcome! Complete your profile to get started.") so the email-only account can be completed.
  When the published document versions moved on, add `requiresConsent: true` (client re-presents the
  acceptance step) — or `reconsented: true` when this login supplied the newer acceptance.
- **Out failure:** one generic message: `{ "ok": false, "error": "The code is invalid or has expired." }`.

### `POST /auth/otp/resend`

- **In:** `{ "requestId": string }`.
- **Server steps:** load challenge by `requestId` → enforce cooldown (30s) → rate-limit → generate a
  new code → **update the same challenge** (new hash + expiry, reset attempts) → send.
- **Out:** `{ "ok": true, "resend_after": 30 }`; too soon → 429 `{ "ok": false, "retry_after": N }`.

### `POST /auth/logout`

Invalidate the session/token and clear transient state.

---

## Data model

```
otp_challenges
  id            opaque (uuid / random hex)  ← the requestId
  email         normalized lowercase, indexed
  code_hash     bcrypt (cost ≥ 10) or argon2id
  expires_at    timestamp
  attempts      integer (default 0)
  consumed_at   timestamp (nullable)
  ip_address    string (nullable, PII)
  terms_version / terms_accepted_at         consent captured at request time
  privacy_version / privacy_accepted_at
  created_at    timestamp

users
  email                     normalized lowercase, unique
  email_verified_at         timestamp
  role                      'user' | 'admin'
  terms_version             string   ← version accepted, not a boolean
  terms_accepted_at         timestamp
  privacy_version           string
  privacy_accepted_at       timestamp
  session_days              integer | null   ← null = follow the admin default
  two_factor_*              secret / enabled_at / last_step / pending_*
  recovery_codes            [{ hash, used_at }]
  previous_emails           []

sessions
  id, token_hash (sha256), email
  created_at, expires_at, last_seen_at, last_strong_auth_at
  ip, location, user_agent, device_label, methods []
  revoked_at, revoked_reason

mfa_challenges                 email_change_requests          audit_events
  id, token_hash, email          id, user_email, new_email      id, at, actor, target
  created_at, expires_at         code_hash, created_at          action, outcome
  attempts, consumed_at          expires_at, attempts           ip, location, ua, device
  device metadata                consumed_at, metadata          meta
```

Full detail for each store lives in `two-factor.md`, `session-management.md`, `email-change.md`, and
`admin-and-audit.md`.

- **Keyed by `id`.** Index `email` for retention/rate-limit queries.
- **Lifecycle:** created on `request` → updated on `resend` → consumed (or deleted) on successful
  `verify` → purged on expiry. **Delete on consume/expire** is the chosen policy (no soft-invalidate)
  for a single, unambiguous lifecycle. Purge expired rows on a schedule (see retention).
- **Retention:** schedule a job to delete rows where `expires_at < now` (and optionally `consumed_at`
  set). This bounds storage growth and limits PII retention.

---

## Edge cases the design must survive

| Case | Required behaviour |
|------|--------------------|
| Email not registered | `request` responds identically to a registered email. |
| Wrong code | Generic error; `attempts` increments; challenge invalidated at the limit. |
| Expired code | Generic error; challenge deleted. |
| Code guessed against no challenge | Constant-time compare against a dummy hash → generic error, no timing signal. |
| Attacker requests a code for a victim's email | Creates a *new* challenge; the victim's is untouched (no DoS). |
| Resend spammed | 30s server cooldown + per-email/per-IP rate limits. |
| Session fixation | Regenerate session id on successful login. |
| Mail send fails | Never reveal account state; return a controlled error (log server-side). |
| Mail bounces (NDR) | Handle bounces without surfacing/logging a distinct "no such user" (enumeration leak). |
| Concurrent requests | Each request gets its own challenge id; no cross-invalidation. |
| First-time login (new account) | Redirect to profile edit with a flash message; returning users go to the dashboard. |
| Consent unchecked or missing | `request` → 422 (`field: "consent"`); no code is generated or sent. |
| Consent accepted, code never used | Challenge expires and is purged; no account and no consent record are created. |
| Document version bumped | `verify` returns `requiresConsent: true` (or `reconsented: true` when accepted on this login); first accept time is preserved for unchanged versions. |
| Legal page missing at build time | Do not ship the checkbox — write and publish the documents first (see `legal-consent.md`). |
| 2FA enabled, no second step completed | No session, ever. Only `POST /auth/2fa/verify` creates one. |
| Second factor replayed within its step | Rejected: the last accepted TOTP step is stored on the user. |
| Admin lowers the session default | Live sessions keep their original expiry; only new sessions use the new policy. |
| Login email changed | Other devices are revoked, the current token is rotated, the old address gets a notice. |
| Admin opens a user record | `admin.user_viewed` is written before the page is rendered. |
