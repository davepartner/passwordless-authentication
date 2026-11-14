---
name: passwordless-authentication
description: >-
  Build a secure, enumeration-resistant passwordless email OTP sign-in — single email field, 8-digit
  code, resend cooldown — for any backend, with optional TOTP two-factor authentication, one-year
  sessions with admin/user-selectable duration, a device and login history the user can revoke,
  verified login-email changes, an admin console, a full audit log, and Terms of Service + Privacy
  Policy acceptance. Use when adding email-OTP or one-time-code login, social/OAuth sign-in, mobile
  biometric re-auth, 2FA, session/device management, or legal consent checkboxes with real policy
  pages. Triggers: "passwordless login", "email OTP", "one-time code login", "OTP authentication",
  "social login", "OAuth login", "OpenID Connect", "sign in with Google", "GitHub login", "biometric
  login", "Face ID login", "two-factor authentication", "2FA", "TOTP", "authenticator app", "recovery
  codes", "stay signed in", "session duration", "remember me for a year", "logged in devices", "logout
  all devices", "login history", "change login email", "admin panel", "audit log", "terms of service
  checkbox", "privacy policy checkbox", "consent at signup".
---

# Passwordless Email OTP Authentication — Platform-Agnostic Skill

Add frictionless passwordless sign-in to any application. Users enter **one email**, accept the
**Terms of Service** and **Privacy Policy**, receive an **8-digit one-time code**, and are signed in
(or auto-registered) with no password and no exposed "does this email exist?" signal. Add optional
**TOTP two-factor authentication**, **one-year sessions** (user- and admin-configurable), a **device
list with revocation**, **verified login-email changes**, an **admin console**, and a **full audit
log**. On mobile, layer **Face ID / Touch ID** one-tap re-auth on top.

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
| Social ID-token forgery | Server-side ID-token verification (JWKS, iss/aud/exp/nonce) |
| Social account takeover via linking | Link only on provider `sub` or a *verified* email — never an unverified email |
| Unconsented registration | Server-side validation of explicit Terms/Privacy acceptance; version + timestamp recorded |
| Stolen password (inbox) — second-factor bypass | Optional TOTP with a single-use second-step challenge; no session before it |
| TOTP code replay within its window | Last accepted time step stored per user; `step <= last` rejected |
| Session theft from a database dump | Bearer tokens stored only as SHA-256 hashes |
| Session fixation | A fresh token on every login, 2FA step, and email change |
| Silent account takeover via email change | Code to the *new* address, notice to the *old*, step-up auth, session revocation |
| Insider/admin misuse | Role-gated console, no secrets exposed, every look at a user recorded |
| Unbounded session lifetime | Policy-capped duration (default 1 year), optional idle timeout, per-device revocation |

**Explicit non-goal:** OTP codes are **phishable** (a real-time relay can proxy a code as easily as a
password). For high-assurance or high-value targets, use **WebAuthn / passkeys** instead. The
biometric layer here is the phishing-resistant *native* path; the email OTP is the universal
fallback.

---

## The flow

```
email + accept Terms/Privacy ──▶ POST /auth/otp/request ──▶ issue code, create challenge (id = requestId), email it
                                                             (NO user lookup)
                                        └─▶ verify view (code entry, countdown, "check spam" banner)
                                               └─▶ POST /auth/otp/verify { requestId, code } ──▶ verify → find-or-create user
                                                                                                (persist consent)
                                                                                                │
                                                    ┌───────────────────────────────────────────┴──────────────┐
                                          2FA off │                                                     2FA on │
                                                  ▼                                                            ▼
                                     create session (policy duration)              { requires2fa: true, mfaToken } — NO session
                                     audit login, redirect                          └─▶ POST /auth/2fa/verify { mfaToken, code }
                                                                                          └─▶ create session (fresh token), audit
```

1. **Request** — the user submits a single email and the two acceptance checkboxes (both rendered
   **pre-checked**). The backend validates format and consent, rate-limits, generates a code, stores
   it **hashed**, emails it, and returns a `requestId` plus an **identical response whether or not the
   address is registered**. No code is sent unless both boxes were accepted.
2. **Verify** — the user enters the code. The backend looks up the challenge **by `requestId`**, checks
   it in **constant time**, enforces expiry + attempt limits, then signs the user in (or registers
   them), persisting the accepted Terms/Privacy versions onto the new account.
3. **Second factor** — if the account has 2FA enabled, step 2 returns **no session**, only a short-lived
   single-use `mfaToken`. The client posts that plus a TOTP or recovery code to `/auth/2fa/verify`, and
   the session is created only then. Every login path goes through one session-issuing function, so no
   endpoint can skip this gate.
4. **Session** — a session lasts the policy duration (**default 365 days**), is stored hashed, carries
   the device/IP/location shown on the profile, and can be revoked per device. **Returning** users go
   to the dashboard; a **first-time** registration (email-only) goes to the profile page with a flash
   message so the account can be completed. If the published Terms or Privacy version has changed since
   the user last agreed, the response flags `requiresConsent` and the client re-presents the acceptance
   step.

---

## API contract (stack-agnostic)

Path names are illustrative — keep the shapes and semantics.

### `POST /auth/otp/request`
```jsonc
// request
{ "email": "user@example.com",
  "acceptedTerms": true,      // required — explicit true (or form value "on"/"true")
  "acceptedPrivacy": true }   // required — explicit true

// rejected, before any mail is sent
{ "ok": false, "error": "Please accept the Terms of Service and Privacy Policy to continue.",
  "field": "consent" }        // HTTP 422

// response — ALWAYS identical, whether or not the account exists
{ "ok": true, "requestId": "<opaque id>", "resend_after": 30,
  "message": "If that address is registered, a code is on its way." }
```

### `POST /auth/otp/verify`
```jsonc
// request — the requestId binds this attempt to the issued challenge
{ "requestId": "<opaque id>", "code": "12345678" }

// success — consent was just persisted onto the account
{ "ok": true, "redirect": "/dashboard", "sessionToken": "<token>", "sessionDays": 365 }
// success, when the account has 2FA — NO session is issued
{ "ok": true, "requires2fa": true, "mfaToken": "<opaque>", "expiresIn": 300 }
// success, when the published versions moved on since the user last agreed
{ "ok": true, "redirect": "/dashboard", "requiresConsent": true }

// failure — one generic message for invalid, expired, and unknown
{ "ok": false, "error": "The code is invalid or has expired." }
```

### `POST /auth/2fa/verify`
```jsonc
// request — the mfaToken binds this attempt to the email OTP that preceded it
{ "mfaToken": "<opaque>", "code": "123456" }     // or a recovery code

// success — a NEW session token, never an upgraded one
{ "ok": true, "redirect": "/profile", "sessionToken": "<token>", "sessionDays": 365 }

// failure — generic for wrong code, expired window, reused recovery code
{ "ok": false, "error": "That code is invalid or has expired." }
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

## Data model

```
otp_challenges
  id            opaque id (uuid / random hex) — doubles as the requestId
  email         normalized, lowercase, indexed
  code_hash     bcrypt/argon2id hash — NEVER the raw code
  expires_at    timestamp
  attempts      integer (default 0)
  consumed_at   timestamp (nullable)
  ip_address    optional, for audit + limits (PII — see retention note)
  terms_version / terms_accepted_at         acceptance captured at request time
  privacy_version / privacy_accepted_at
  created_at    timestamp

users
  email, email_verified_at, created_at, role ('user' | 'admin')
  terms_version / terms_accepted_at         persisted when the account is created
  privacy_version / privacy_accepted_at
  session_days                              personal duration preference (null = admin default)
  two_factor_secret / two_factor_enabled_at / two_factor_last_step
  pending_two_factor_secret / pending_two_factor_created_at
  recovery_codes [{ hash, used_at }]
  previous_emails []                        login-address history

sessions
  id, token_hash (sha256 — the raw token is never stored), email
  created_at, expires_at, last_seen_at, last_strong_auth_at
  ip, location, user_agent, device_label, methods []
  revoked_at, revoked_reason                kept after revocation for the device history

mfa_challenges
  id, token_hash, email, created_at, expires_at, attempts, consumed_at, device metadata

email_change_requests
  id, user_email, new_email, code_hash, created_at, expires_at, attempts, consumed_at, metadata

audit_events
  id, at, actor, target, action, outcome, ip, location, user_agent, device_label, meta
```

**Keyed by `id` (requestId), not by email.** Requesting a code for an email the attacker does not
control **does not** invalidate that user's in-flight challenge (no login-DoS). The number of
co-existing challenges is bounded by the send rate limits. Purge expired/consumed rows on a schedule
(see security rules) — but **not** the consent record, which is evidence and follows account
retention instead.

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
10. **Consent is validated server-side** — never trust the client's pre-checked default. Reject the
    request unless both acceptance flags are explicitly true, and store the accepted **version** and
    **timestamp**, not a boolean. Never send a code for a request that did not accept them.
11. **No session before the second factor.** With 2FA on, `/auth/otp/verify` returns a short-lived
    single-use `mfaToken`, never a session token. Reject a TOTP step `<=` the last accepted step
    (replay), and rate-limit every code-entry endpoint on failures.
12. **Sessions are records, not bare keys.** Store the token as a hash, mint a new token on every
    login/2FA/email change, respect the policy duration, and revoke on demand.
13. **Email changes require proof of the new address** — plus a notice to the old one, step-up auth
    when 2FA is on, and revocation of every other session.
14. **Admin actions are role-gated and audited.** No endpoint grants a role; admins never see tokens,
    TOTP secrets, or recovery codes; every view of a user record is logged.

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
9. **Terms + Privacy checkboxes** — two separate, **pre-checked** boxes under the email field, each
   label linking to the real served document (new tab). Unchecking either blocks submit with a clear
   message; the server independently requires an explicit acceptance. Never pre-check *optional*
   consent (marketing, analytics).
10. **Profile page** — the account's control room, in this order: login email (+ verified state, pending
    change), 2FA state, login duration, signed-in devices (current one marked, each revocable), login
    history. Counts and states, not raw JSON. Every dangerous action states its consequence
    ("all other devices will be signed out") and confirms before acting.
11. **Second-factor step** — same shell as the code step: one input, "enter the 6-digit code from your
    authenticator app", a visible hint that a recovery code also works, inline generic errors, and a
    way back to the email step.

---

## Legal acceptance (Terms of Service + Privacy Policy)

Registration captures agreement to both documents. Because registration is implicit and `request`
must not look up the account, the boxes live on the **single entry screen**, are validated before any
code is sent, and are stored on the challenge until the account is created at `verify`.

- **Two boxes, not one** — the Terms are a contract; the Privacy Policy is a data-protection notice.
- **Pre-checked by default**, and still explicitly required by the server. Read
  `references/legal-consent.md` for the caveat on pre-ticked consent — it is a product decision to
  document, not a detail to leave implicit.
- **Real pages.** If the app has no `/terms` and `/privacy`, write them by describing what the app
  actually does (what it collects, why, how long, who receives it, who operates it, which law
  applies) *before* shipping the boxes. Never link to a 404 or to an unrelated third-party policy.
- **Versioned.** Each document carries a version + effective date; the record stores which version the
  user accepted. A version bump drives `requiresConsent` / `reconsented` on the next login.
- **Optional consent is separate and unchecked** — marketing email and analytics never inherit the
  pre-checked state.

Full pattern, API additions, data model, versioning, and a contents checklist:
`references/legal-consent.md`. Working pages and the pre-checked form:
`examples/node-express/src/legal-pages.ts` (`GET /terms`, `GET /privacy`) and
`examples/node-express/src/views.ts` (`GET /sign-in`).

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

## Social login (Google, GitHub, LinkedIn, …)

Add **"Continue with Google / GitHub / LinkedIn"** to the same system:

- **Principle:** the provider authenticates the user; your app verifies the assertion **server-side**
  (ID token via JWKS, or the profile via the provider's API) and then creates or links a local account.
- **Authorization Code + PKCE** — never implicit flow, never trust a client-forwarded token.
- **Only link on a *verified* email** (or the provider's `sub`) — an unverified email must never take
  over an existing account.
- A first-time social account reuses the same **profile-completion** flow as email OTP.

Full architecture, provider matrix, and account-linking rules: `references/social-login.md`. Reference
code: `examples/node-express/src/social.ts` (+ `social.test.ts`).

---

## Two-factor authentication (optional, TOTP)

A user turns 2FA on from their profile; from then on, their email code is followed by a code from an
authenticator app. Email is **not** a valid second factor here — if the attacker has the inbox they
already have both codes.

- **Enrollment is two-phase:** generate a secret → user proves the app works → activate and issue **ten
  single-use recovery codes**. An unconfirmed secret never gates a login.
- **No session before the second factor.** Step 2 of the OTP flow returns `requires2fa: true` plus a
  5-minute single-use `mfaToken`; only `/auth/2fa/verify` creates a session, and it always mints a fresh
  token.
- **Replay guard:** store the last accepted TOTP time step on the user and reject `step <= last`.
- **Rate limit both layers:** attempts per challenge and a per-email failure budget shared by login,
  disable, regeneration, and email-change step-up.
- **Disabling requires a valid current code** and an authenticated session. An admin reset exists for
  lockout, requires out-of-band identity verification, is audited, and revokes the user's sessions.

Full design: `references/two-factor.md`. Reference code: `examples/node-express/src/totp.ts`,
`twofactor.ts`, plus the profile page in `views-profile.ts`.

---

## Sessions, devices & login duration

**Default: one year.** One policy object drives every session:

```
effective days = clamp(user preference ?? admin default, admin min, admin max)
```

- The user picks their own duration on the profile; an admin sets the default, the band, and any
  individual user's value, and can switch per-user choice off.
- **Policy changes apply to new sessions only** — live sessions keep the expiry they were issued with,
  so nobody is silently logged out or extended.
- **Tokens are stored hashed** (SHA-256). A database dump yields no usable sessions.
- Every session carries `device_label`, IP, coarse location, timestamps, and the methods used.
- The profile lists live sessions and revokes any of them; "sign out other devices" is one action.
  Revocation kills the token immediately and keeps the row for history.
- Optional idle timeout (`idleDays`) for deployments that want it; off by default.
- **One function issues every session.** OTP, TOTP, biometric, and social all call it, so no path can
  skip the 2FA gate. A biometric login (device key + biometric) already satisfies MFA; document that
  decision or gate it in the same function.

Full design: `references/session-management.md`. Reference code: `sessionPolicy.ts`, `store.ts`
(`sessionStore`), `views-profile.ts`.

---

## Changing the login email

The address is the credential, so changing it is treated like a credential change:

1. Signed-in user submits the new address — **step-up** with a current TOTP/recovery code if 2FA is on.
2. A code goes to the **new** address; a security notice goes to the **old** one.
3. Confirming the code moves the account, keeps the old address in history, **revokes every other
   session**, rotates the current token, and writes audit events at request *and* confirm time.

Refusals are generic ("That address cannot be used for this account") so an authenticated probe cannot
use the endpoint to enumerate accounts. One pending request per account; rate-limited per hour.

Full design: `references/email-change.md`. Reference code: `emailChange.ts` + the profile endpoints.

---

## Admin console & audit log

Admins can set the session policy, browse users, open a single account (sessions including revoked,
login history, email-change log, 2FA state), revoke a device, set a per-user duration, and reset 2FA
after out-of-band verification.

- **Roles are stored and bootstrapped from `ADMIN_EMAILS`**; no endpoint grants a role. One
  `requireAdmin` guard distinguishes `401` from `403`.
- **Admins never see secrets** — no tokens, TOTP secrets, or recovery codes.
- **Everything is audited:** sign-ins (success/failure), 2FA changes, session revocations, duration
  changes, email changes, and admin actions — including `admin.user_viewed`, because reading a user's
  history is itself a privacy-relevant event.
- Records are **append-only**: handlers add, never edit or delete; retention is a scheduled job aligned
  with the Privacy Policy.
- The user sees their own slice on the profile (sign-ins + security changes); the admin sees the full
  account view for investigation.

Full design: `references/admin-and-audit.md`. Reference code: `audit.ts`, `roles.ts`, `views-admin.ts`.

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
2. Create the **`otp_challenges`** store keyed by `id`, with an index on `email`, plus consent fields.
3. Implement the **security rules** using your platform's crypto, hashing, and rate-limit primitives
   (see `references/security-rules.md` for the exact algorithms).
4. Build the two screens (request + verify) per the **UX rules**, including the two pre-checked
   Terms/Privacy boxes.
5. Build the two screens (request + verify) per the **UX rules**, including the two pre-checked
   Terms/Privacy boxes, then the **second-factor step**.
6. **Publish real Terms and Privacy pages** at the URLs the boxes point to — write them from what the
   app actually collects and does (see `references/legal-consent.md`), versioned and dated.
7. Implement **sessions** as records: hashed token, policy-driven duration (default 365 days), device
   metadata, revocation. Add the **profile page** (email, 2FA, duration, devices, history).
8. Add **TOTP 2FA** enrollment + the second step, with the replay guard and recovery codes.
9. Add the **email-change** flow with dual verification, session revocation, and audit events.
10. Add the **admin console** (policy + user investigation) behind a stored role, and wire every
    security event into the **append-only audit log**.
11. Add the scheduled **retention** purge (challenges, sessions, audit) and the mail **sender-auth** setup.
12. Walk the **verification checklist** before finishing.

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
- [ ] Terms + Privacy boxes are separate, pre-checked, and required; each links to a live page.
- [ ] `request` returns 422 and sends no mail unless both acceptance flags are explicitly true.
- [ ] The user record stores the accepted **version + timestamp** for each document.
- [ ] Re-accepting the same version does not overwrite the original timestamp.
- [ ] A version bump produces `requiresConsent` (or `reconsented`) on the next login.
- [ ] Optional consent (marketing, analytics) is separate and **not** pre-checked.
- [ ] With 2FA on, `/auth/otp/verify` returns no session — only a single-use `mfaToken`.
- [ ] A TOTP step that was already accepted is rejected (replay guard stored on the user).
- [ ] Recovery codes are hashed, single-use, countable, and regenerable only with a current code.
- [ ] Every code-entry endpoint is rate-limited on failures (shared per-email budget).
- [ ] Sessions default to 365 days, come from the policy object, and are capped by the admin band.
- [ ] User and admin duration changes affect new sessions only.
- [ ] Session tokens are stored hashed; login, 2FA, and email change mint a fresh token.
- [ ] The profile lists devices with location and timestamps, and can revoke any of them.
- [ ] Email change verifies the **new** address, notifies the **old**, and revokes other sessions.
- [ ] Admin routes require a stored role; `401` and `403` are distinguished.
- [ ] Admins cannot read tokens, TOTP secrets, or recovery codes.
- [ ] `admin.user_viewed` is recorded when an admin opens a user record.
- [ ] The audit log is append-only and its retention matches the Privacy Policy.
- [ ] Social login uses Authorization Code + PKCE; ID token verified server-side (JWKS, iss/aud/exp/nonce).
- [ ] Social account linking only on provider `sub` or a *verified* email — never an unverified email.

---

## References

- `references/architecture.md` — full flow, sequence diagram, API contract detail, edge cases.
- `references/security-rules.md` — threat model, security invariants, and operational rules.
- `references/ux-rules.md` — the UX behaviours with accessibility notes.
- `references/reference-implementation.md` — neutral pseudocode to translate into any stack.
- `references/biometric-login.md` — Face ID / Touch ID architecture, flows, device lifecycle.
- `references/social-login.md` — OAuth/OIDC social login (Google, GitHub, LinkedIn), account linking.
- `references/legal-consent.md` — Terms/Privacy acceptance: placement, pre-checked boxes, versioning,
  audit trail, and how to write the two documents for your app.
- `references/two-factor.md` — optional TOTP: enrollment, second step, replay guard, recovery codes.
- `references/session-management.md` — session duration policy, hashed tokens, device list, revocation.
- `references/email-change.md` — verified login-email changes, dual notification, session handling.
- `references/admin-and-audit.md` — admin roles and console, audit log schema, what to record.
- `examples/` — concrete reference implementations (Node/Express, iOS, Android).
