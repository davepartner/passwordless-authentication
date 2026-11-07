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
  │                                │                                │
  │  POST /auth/otp/request        │                                │
  │  { email }                     │                                │
  │ ─────────────────────────────▶ │  validate email (syntax)       │
  │                                │  rate-limit (email + IP)       │
  │                                │  generate code (CSPRNG)        │
  │                                │  create challenge (id)         │
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

- **In:** `{ "email": string }`.
- **Server steps (in order):** normalize → validate syntax → rate-limit (email then IP) → generate
  code (CSPRNG) → create challenge (id, email, code_hash, expires_at, ip) → send email → respond.
- **Out (always identical):**
  `{ "ok": true, "requestId": "<id>", "resend_after": 30, "message": "If that address is registered, a code is on its way." }`
- **Errors:** invalid syntax → 422; rate-limited → 429 with `retry_after`. Neither reveals account
  existence.

### `POST /auth/otp/verify`

- **In:** `{ "requestId": string, "code": string }`.
- **Server steps:** load challenge by `requestId` → rate-limit (verify, failures only) → constant-time
  compare (dummy hash when absent) → check expiry, attempts → on success: find-or-create user, mark
  verified, establish session, regenerate session id, clear state, consume the challenge.
- **Out success:** `{ "ok": true, "redirect": "/dashboard", "isNewUser": false }`. For a
  **first-time** registration the server returns `redirect: "/profile/edit"` plus a `flash` message
  ("Welcome! Complete your profile to get started.") so the email-only account can be completed.
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
  created_at    timestamp
```

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
