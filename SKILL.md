---
name: passwordless-authentication
description: >-
  Build a secure, enumeration-resistant passwordless email OTP sign-in — single email field, 8-digit
  code, resend cooldown — for any backend, plus optional Face ID / Touch ID biometric login for mobile
  (Secure Enclave / Android Keystore challenge-response). Use when adding email-OTP or one-time-code
  login, or mobile biometric re-auth. Triggers: "passwordless login", "email OTP", "one-time code
  login", "OTP authentication", "biometric login", "Face ID login", "magic link alternative".
---

# Passwordless Email OTP Authentication — Platform-Agnostic Skill

Add frictionless passwordless sign-in to any application. Users enter **one email**, receive an
**8-digit one-time code**, and are signed in (or auto-registered) with no password and no exposed
"does this email exist?" signal. For native mobile apps, add an optional **Face ID / Touch ID**
one-tap re-auth on top.

This skill is **framework- and language-agnostic**: it specifies the *what* and the *why* — the flow,
the API contract, the data model, the security invariants, and the UX behaviours — and leaves the
*how* to your stack. Concrete examples are provided for Node/Express, Swift (iOS), and Kotlin
(Android); the spec itself applies to any backend that can hash a value, send email, and issue a
session.

---

## Threat model

What this system defends against, and how:

| Threat | Defended by |
|--------|-------------|
| User enumeration (probing which emails exist) | No user lookup at `request`; uniform responses; constant-time compare |
| OTP brute force (online guessing) | 8-digit code + expiry + per-challenge attempt limit + per-email verify rate limit |
| OTP replay | Single-use challenge (consumed on success) |
| Timing side-channel | Constant-time compare against a dummy hash when no challenge exists |
| Email bombing / harassment | Per-email + per-IP send rate limits |
| Session fixation | Session-id regeneration on login |
| Biometric key extraction | Private key in Secure Enclave / Android Keystore, never exported |
| Biometric signature replay | Single-use, expiring challenge nonce |

**Explicit non-goal:** OTP codes are **phishable** (a real-time relay can proxy a code as easily as a
password). For high-assurance or high-value targets, use **WebAuthn / passkeys** instead. The
biometric layer here is the phishing-resistant *native* path; the email OTP is the universal
fallback.

---

## The flow

```
email ──▶ POST /auth/otp/request ──▶ issue code, create challenge (id = requestId), email it (NO user lookup)
                                        └─▶ verify view (code entry, countdown, "check spam" banner)
                                               └─▶ POST /auth/otp/verify { requestId, code } ──▶ verify → find-or-create user → login
```

1. **Request** — the user submits a single email. The backend validates format, rate-limits, generates
   a code, stores it **hashed**, emails it, and returns a `requestId` plus an **identical response
   whether or not the address is registered**.
2. **Verify** — the user enters the code. The backend looks up the challenge **by `requestId`**, checks
   it in **constant time**, enforces expiry + attempt limits, then signs the user in (or registers them).
3. **Success** — establish the session, clear transient state, redirect to the app.

---

## API contract (stack-agnostic)

Path names are illustrative — keep the shapes and semantics.

### `POST /auth/otp/request`
```jsonc
// request
{ "email": "user@example.com" }

// response — ALWAYS identical, whether or not the account exists
{ "ok": true, "requestId": "<opaque id>", "resend_after": 30,
  "message": "If that address is registered, a code is on its way." }
```

### `POST /auth/otp/verify`
```jsonc
// request — the requestId binds this attempt to the issued challenge
{ "requestId": "<opaque id>", "code": "12345678" }

// success
{ "ok": true, "redirect": "/dashboard" }

// failure — one generic message for invalid, expired, and unknown
{ "ok": false, "error": "The code is invalid or has expired." }
```

### `POST /auth/otp/resend`
```jsonc
// request — refreshes the code under the SAME requestId (does not issue a new challenge)
{ "requestId": "<opaque id>" }

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
  id            opaque id (uuid / random hex) — doubles as the requestId
  email         normalized, lowercase, indexed
  code_hash     bcrypt/argon2id hash — NEVER the raw code
  expires_at    timestamp
  attempts      integer (default 0)
  consumed_at   timestamp (nullable)
  ip_address    optional, for audit + limits (PII — see retention note)
  created_at    timestamp
```

**Keyed by `id` (requestId), not by email.** Requesting a code for an email the attacker does not
control **does not** invalidate that user's in-flight challenge (no login-DoS). The number of
co-existing challenges is bounded by the send rate limits. Purge expired/consumed rows on a schedule
(see security rules).

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
5. **Expiry** — codes expire (default 10 min); expired challenges are rejected and purged.
6. **Attempt limit** — invalidate after a few wrong guesses (default 5).
7. **Rate limiting** — server-side: send per-email/hour, per-IP/hour, verify per-email/15 min
   (**count failures only**), and a hard 30-second resend cooldown. The client timer is UX only; the
   server is authoritative.
8. **Session hardening** — regenerate the session id on login; `Secure` + `HttpOnly` + `SameSite`
   cookies (or short-lived signed tokens); CSRF protection; clear transient challenge state.
9. **Email verified on OTP** — proving the code marks the address verified.

**Operational rules (equally important):**

- **Sender auth + deliverability.** Configure SPF, DKIM, and DMARC, warm up the sending domain, and
  cap spend. A passwordless system lives or dies by mail deliverability.
- **Bounces are an enumeration leak.** Handle NDRs (bounce replies) carefully — never let a bounce
  path reveal whether an address exists (e.g. do not surface or log "no such user" distinctly).
- **Retention / PII.** Challenges store email + IP. Purge expired/consumed rows on a schedule (or use
  a TTL), and define a retention window for IP logs. This is a GDPR/CCPA concern, not just hygiene.
- **Email canonicalization.** Normalize case and whitespace; decide a policy for `+`-tags, provider
  dot-stripping (Gmail), and IDN/punycode so the same mailbox is always one key.
- **Code length by assurance.** 8 digits is the default (with the limits above). For higher-assurance
  contexts, raise to 10 digits.

> **Trade-off to document:** the unified entry sends to any address (to avoid enumeration). Cap this
> with the send rate limits to prevent email bombing; the limits are what keep this safe.

---

## UX rules (non-negotiable)

1. **Single email field** — one input for both login and registration; no password or name up front.
2. **Dynamic button** — client-side regex enables the submit button the instant the email is valid;
   show a visible hint while disabled (never a silent dead state).
3. **Code entry** — a single `inputmode="numeric"` `autocomplete="one-time-code"` field is
   **preferred** (best screen-reader and browser-autofill support). An 8-box grid is acceptable if
   each box has an `aria-label` and paste-to-fill is handled.
4. **Persistent helper banner** — "Check your inbox **and** spam/junk folder" stays visible for the
   whole verification step. Add "still nothing after ~60s? resend" guidance.
5. **Server-synced resend** — 30-second cooldown is a *floor*, not a ceiling; resend disabled until
   zero; server independently enforces the cooldown.
6. **Immediate inline errors** — invalid/expired code shows an inline message with **no page reload**.
7. **Support link** — "Trouble logging in? Contact admin" at the base of both forms.
8. **Satisfying success** — direct redirect to the app, no intermediate screens.

---

## Biometric (Face ID / Touch ID) login for mobile

For native mobile apps, layer a **frictionless biometric re-auth** on top of the email OTP:

- **Principle:** biometrics authenticate the user *to the device*, never to the server. The device
  proves possession of a device-bound private key (Secure Enclave on iOS / Android Keystore, gated by
  biometrics) by signing a server challenge. The server verifies the signature against a stored
  public key.
- **First login** (email OTP) **enrolls the device**; every login after that is a one-tap Face ID
  unlock.
- **Device lifecycle:** cap devices per account, allow revocation (a lost device's public key is
  deleted server-side), and list enrolled devices. See `references/biometric-login.md`.

Full architecture, flows, and platform specifics: `references/biometric-login.md`. Reference code:
`examples/ios-faceid/` (Swift), `examples/android-biometric/` (Kotlin), server side in
`examples/node-express/`.

---

## When NOT to use this

- **High-assurance / financial / enterprise SSO** where OTP is too phishable — use WebAuthn/passkeys.
- **User bases without reliable email** (or where SMS is the primary channel).
- **Offline-first / no-network apps** that can't depend on round-trip email.
- **Web biometric login** — in browsers use WebAuthn (the browser manages the platform authenticator),
  not the native Secure-Enclave flow.

---

## How to apply this skill

1. Map the **flow** and **API contract** onto your framework's routing/controllers.
2. Create the **`otp_challenges`** store keyed by `id`, with an index on `email`.
3. Implement the **security rules** using your platform's crypto, hashing, and rate-limit primitives
   (see `references/security-rules.md` for the exact algorithms).
4. Build the two screens (request + verify) per the **UX rules**.
5. Add the scheduled **retention** purge and the mail **sender-auth** setup.
6. Walk the **verification checklist** before finishing.

Use `references/reference-implementation.md` as a language-neutral starting point and translate each
function into your stack.

**Never** relax any of the security rules or the "no early account disclosure" rule while adapting —
those are what make the system safe.

---

## Versioning

This skill may evolve. **Pin it by commit hash or tag** when you pull it into a project, and re-run
the verification checklist after updating. See `CHANGELOG.md` for what changed between versions.

---

## Verification checklist

- [ ] `request` returns the same response for existing and non-existing emails; no user lookup.
- [ ] The code is stored hashed; the raw code never appears in logs, responses, or the database.
- [ ] Verification is constant-time; expired/over-attempted challenges are rejected and purged.
- [ ] Requesting a code for an email does **not** invalidate that email's other in-flight challenge.
- [ ] Wrong code → inline error, no reload; attempts increment (failures rate-limited, not successes).
- [ ] Resend is blocked client-side for 30s **and** server-side until the cooldown elapses.
- [ ] Successful login regenerates the session and clears transient challenge state.
- [ ] Enroll (biometric) requires an authenticated session.
- [ ] SPF/DKIM/DMARC configured; bounce handling does not leak existence; retention/GC scheduled.
- [ ] The "check inbox and spam" banner and the support link are present on both forms.
- [ ] Email is marked verified when the code is proven.

---

## References

- `references/architecture.md` — full flow, sequence diagram, API contract detail, edge cases.
- `references/security-rules.md` — threat model, security invariants, and operational rules.
- `references/ux-rules.md` — the UX behaviours with accessibility notes.
- `references/reference-implementation.md` — neutral pseudocode to translate into any stack.
- `references/biometric-login.md` — Face ID / Touch ID architecture, flows, device lifecycle.
- `examples/` — concrete reference implementations (Node/Express, iOS, Android).
