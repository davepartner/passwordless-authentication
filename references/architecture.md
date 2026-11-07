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
  │                                │  store hash + expiry           │
  │                                │ ──────────────────────────────▶ send code email
  │                                │  (NO user lookup)              │
  │ ◀───────────────────────────── │  200 { ok, resend_after }      │
  │                                │                                │
  │  render verify view            │                                │
  │  (6-box grid, countdown,       │                                │
  │   "check spam" banner)         │                                │
  │                                │                                │
  │  POST /auth/otp/verify         │                                │
  │  { email|token, code }         │                                │
  │ ─────────────────────────────▶ │  rate-limit (verify)           │
  │                                │  load active challenge          │
  │                                │  constant-time compare          │
  │                                │  check expiry + attempts        │
  │                                │  find-or-create user            │
  │                                │  establish session (regenerate) │
  │ ◀───────────────────────────── │  200 { ok, redirect }          │
  │  redirect → /dashboard         │                                │
```

---

## State transport: two supported patterns

The challenge state must correlate the "request" step with the "verify" step. Pick **one**:

1. **Server session (classic server apps).** After `request`, store `pending_email` and
   `resend_available_at` in the server-side session. The verify/resend endpoints read the email from
   the session. Pros: nothing extra to sign; simple. Cons: ties the flow to a session cookie.

2. **Opaque request token (stateless / SPA / API).** After `request`, return a short-lived, signed,
   random `token` (a random id pointing at the challenge, or a signed value). The client sends it back
   with the code. Pros: works across a decoupled frontend and API; stateless. Cons: must sign/encrypt
   or store the token safely.

The data model and security rules are identical in both cases.

---

## API contract detail

### `POST /auth/otp/request`

- **In:** `{ "email": string }`.
- **Server steps (in order):** normalize (lowercase, trim) → validate syntax → rate-limit (email
  then IP) → invalidate any previous active challenge for this email → generate code (CSPRNG) → store
  hash + `expires_at` → send email → record `resend_available_at` → respond.
- **Out (always identical):**
  ```json
  { "ok": true, "resend_after": 30, "message": "If that address is registered, a code is on its way." }
  ```
- **Errors:** invalid email syntax → 422 with a field message; rate-limited → 429 with `retry_after`.
  Neither reveals whether the address is registered.

### `POST /auth/otp/verify`

- **In:** `{ "email": string, "code": string }` (session style) or
  `{ "token": string, "code": string }` (token style).
- **Server steps:** rate-limit → load active challenge for the email → constant-time compare (against
  a dummy hash when absent) → check expiry, attempts → on success: find-or-create user, mark email
  verified, establish session, regenerate session id, clear transient state, invalidate the challenge.
- **Out success:** `{ "ok": true, "redirect": "/dashboard" }`.
- **Out failure (one generic message for invalid / expired / unknown):**
  `{ "ok": false, "error": "The code is invalid or has expired." }`.

### `POST /auth/otp/resend`

- **In:** nothing extra (email from session/token).
- **Server steps:** enforce cooldown (30s) → rate-limit → re-issue + re-send (new code invalidates the
  old) → update `resend_available_at`.
- **Out:** `{ "ok": true, "resend_after": 30 }`; too soon → 429 `{ "ok": false, "retry_after": N }`.

### `POST /auth/logout`

Invalidate the session/token and clear transient state.

---

## Data model

```
otp_challenges
  id           opaque (uuid / ulid)
  email        normalized lowercase, indexed
  code_hash    bcrypt (cost ≥ 10) or argon2id
  expires_at   timestamp
  attempts     integer (default 0)
  consumed_at  timestamp (nullable)
  ip_address   string (nullable, audit)
  created_at   timestamp
```

- **One active challenge per email.** Issuing a code deletes/marks-consumed the previous one.
- **Index on `email`** (lookup key). Index on `created_at` if you query "latest" without email.
- **Delete vs soft-invalidate:** deleting on consume/expire/over-attempt keeps the table small and
  removes the timing/state subtleties; soft-invalidating preserves an audit trail. Either is fine —
  the invariant is that only one *active* challenge exists per email.

---

## Edge cases the design must survive

| Case | Required behaviour |
|------|--------------------|
| Email not registered | `request` responds identically to a registered email. |
| Wrong code | Generic error; `attempts` increments; challenge invalidated at the limit. |
| Expired code | Generic error; challenge deleted. |
| Code guessed against no challenge | Constant-time compare against a dummy hash → generic error, no timing signal. |
| Resend spammed | 30s server cooldown + per-email/per-IP rate limits. |
| Session fixation | Regenerate session id on successful login. |
| Mail send fails | Never reveal account state; return a controlled error (and log server-side). |
| Concurrent requests | One active challenge per email; last write wins. |
