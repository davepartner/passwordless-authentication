---
name: passwordless-authentication
description: >-
  Build a secure, frictionless, enumeration-resistant passwordless email OTP authentication system
  in ANY stack or framework — Node/Express, Next.js, Django, Rails, Go, PHP/Laravel, FastAPI, or a
  custom backend. Use when adding "login without a password", "magic OTP login", "email OTP sign-in",
  "passwordless auth", or "one-time code login". Delivers a single email entry field, a 6-digit code
  grid with auto-focus, a server-synced resend countdown, persistent spam-folder guidance, immediate
  inline errors, and full anti-user-enumeration logic with hashed OTPs and rate limiting. Triggers:
  "passwordless login", "email OTP", "one-time passcode", "login with a code", "remove passwords",
  "OTP authentication", "user enumeration resistant login", "magic link alternative".
---

# Passwordless Email OTP Authentication — Platform-Agnostic Skill

Add frictionless passwordless sign-in to any application, in any stack. Users enter **one email**,
receive a **6-digit one-time code**, and are signed in (or auto-registered) with no password and no
exposed "does this email exist?" signal.

This skill is **framework- and language-agnostic**. It specifies the *what* and the *why* — the flow,
the API contract, the data model, the security invariants, and the UX behaviours — and leaves the
*how* to whatever stack you are building in. A reference implementation in neutral pseudocode is in
`references/reference-implementation.md`.

---

## The flow

```
email ──▶ POST /auth/otp/request ──▶ generate + email a 6-digit code (NO user lookup → enumeration-safe)
                                        └─▶ verify view (6-box grid, countdown, "check spam" banner)
                                               └─▶ POST /auth/otp/verify ──▶ verify code → find-or-create user → login
```

1. **Request** — the user submits a single email. The backend validates the format, rate-limits,
   generates a code, stores it **hashed**, emails it, and returns an **identical response whether or
   not the address is registered**.
2. **Verify** — the user enters the code into a 6-box grid. The backend checks it in **constant
   time**, enforces expiry + attempt limits, then signs the user in (or auto-registers them).
3. **Success** — establish the session, clear transient state, redirect to the app.

---

## API contract (stack-agnostic)

Path names are illustrative — keep the shapes and semantics.

### `POST /auth/otp/request`
```jsonc
// request
{ "email": "user@example.com" }

// response — ALWAYS identical, whether or not the account exists
{ "ok": true, "resend_after": 30, "message": "If that address is registered, a code is on its way." }
```

### `POST /auth/otp/verify`
```jsonc
// request — the code plus whatever correlates to the pending challenge
{ "email": "user@example.com", "code": "123456" }        // server-session style, OR
{ "token": "<opaque request token>", "code": "123456" }   // stateless/SPA style

// success
{ "ok": true, "redirect": "/dashboard" }

// failure — one generic message for invalid, expired, and unknown
{ "ok": false, "error": "The code is invalid or has expired." }
```

### `POST /auth/otp/resend`
```jsonc
// response — server enforces the cooldown independently of the client timer
{ "ok": true, "resend_after": 30, "message": "A new code has been sent." }
// too soon
{ "ok": false, "retry_after": 18, "error": "Please wait before requesting a new code." }  // HTTP 429
```

### `POST /auth/logout`

---

## Data model (one table / collection)

```
otp_challenges
  id           opaque id (uuid)
  email        normalized, lowercase, indexed
  code_hash    bcrypt/argon2id hash — NEVER the raw code
  expires_at   timestamp
  attempts     integer (default 0)
  consumed_at  timestamp (nullable)
  ip_address   optional, for audit + limits
  created_at   timestamp
```

One **active** challenge per email at a time. Issuing a new code invalidates the previous one.

---

## Security rules (non-negotiable)

1. **No enumeration at request time** — never query the user/account store in `request`; return the
   same response for registered and unregistered emails. Create/lookup the account only at `verify`.
2. **Hash the OTP** — store `bcrypt` (cost ≥ 10) or `argon2id`; never plaintext, never in logs or
   responses.
3. **Constant-time comparison** — use the platform's constant-time hash verify (bcrypt/argon2 verify,
   `hash_equals`, `crypto.timingSafeEqual`). Run it against a dummy hash even when no challenge
   exists, so timing cannot reveal whether a code was issued.
4. **CSPRNG only** — generate digits with a cryptographically secure RNG (`random_int`,
   `crypto.randomInt`, `secrets.randbelow`).
5. **Expiry** — codes expire (default 10 min); expired challenges are deleted/invalidated.
6. **Attempt limit** — invalidate after a few wrong guesses (default 5).
7. **Rate limiting** — server-side: send per-email/hour, per-IP/hour, verify per-email/15 min, and a
   hard 30-second resend cooldown. The client timer is UX only; the server is authoritative.
8. **Session hardening** — regenerate the session id on login; `Secure` + `HttpOnly` + `SameSite`
   cookies (or short-lived signed tokens); CSRF protection; clear transient challenge state.

> **Trade-off to document:** the unified entry sends to any address (to avoid enumeration). Cap this
> with the send rate limits to prevent it being abused for email bombing.

---

## UX rules (non-negotiable)

1. **Single email field** — one input for both login and registration; no password or name up front.
2. **Dynamic button** — client-side regex enables the submit button the instant the email is valid;
   show a visible hint while disabled (never a silent dead state).
3. **6-box code grid** — six side-by-side inputs, auto-focus cascade, paste-to-fill,
   `inputmode="numeric"`, `autocomplete="one-time-code"`.
4. **Persistent helper banner** — "Check your inbox **and** spam/junk folder" stays visible for the
   whole verification step.
5. **Server-synced resend** — 30-second countdown; resend disabled until zero; server independently
   enforces the cooldown.
6. **Immediate inline errors** — invalid/expired code shows an inline message with **no page reload**.
7. **Support link** — "Trouble logging in? Contact admin" at the base of both forms.
8. **Satisfying success** — direct redirect to the app, no intermediate screens.

---

## How to apply this skill

1. Map the **flow** and **API contract** onto your framework's routing/controllers.
2. Create the **`otp_challenges`** store (table/collection) exactly as specified.
3. Implement the **security rules** using your platform's crypto, hashing, and rate-limit primitives
   (see `references/security-rules.md` for the exact algorithms).
4. Build the two screens (request + verify) per the **UX rules**
   (see `references/ux-rules.md` for the component behaviours).
5. Walk the **verification checklist** before finishing.

Use `references/reference-implementation.md` as a language-neutral starting point and translate each
function into your stack.

**Never** relax any of the eight security rules or the "no early account disclosure" rule while
adapting — those are what make the system safe.

---

## Verification checklist

- [ ] `request` returns the same response for existing and non-existing emails.
- [ ] The code is stored hashed; the raw code never appears in logs, responses, or the database.
- [ ] Verification is constant-time; expired/over-attempted challenges are invalidated.
- [ ] Wrong code → inline error, no reload; attempts increment; challenge invalidated at the limit.
- [ ] Resend is blocked client-side for 30s **and** server-side until the cooldown elapses.
- [ ] Successful login regenerates the session and clears transient challenge state.
- [ ] The "check inbox and spam" banner and the support link are present on both forms.
- [ ] Email is marked verified when the code is proven.

---

## References

- `references/architecture.md` — full flow, sequence diagram, API contract detail, edge cases.
- `references/security-rules.md` — the security invariants with exact algorithms and primitives.
- `references/ux-rules.md` — the UX behaviours with accessibility notes.
- `references/reference-implementation.md` — neutral pseudocode to translate into any stack.
