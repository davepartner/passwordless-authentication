# Passwordless Authentication — Platform-Agnostic Email OTP

> **This is an AI agent skill.** Designed to be pulled and used by AI agents — Claude Code, Codex,
> Cursor, OpenCode, and other coding assistants — as a ruleset for building secure, frictionless
> passwordless email-OTP authentication systems. The agent reads `SKILL.md` and `references/`, then
> implements the flow correctly in whatever stack you're using.

A **secure, frictionless, user-enumeration-resistant passwordless email OTP authentication system**,
specified as a reusable skill that works in **any stack** — Node/Express, Next.js, Django, Rails,
Go, PHP/Laravel, FastAPI, or a custom backend.

One email field in. An 8-digit code. Done. No password, no "does this account exist?" leak, no
dead-end UX. On top of that: optional **TOTP two-factor**, **one-year sessions** that users and admins
can shorten, a **device list you can revoke**, **verified login-email changes**, and an **admin console
with a full audit log**.

This is **not** tied to a framework. It defines the flow, the API contract, the data model, the
security invariants, and the UX behaviours — then tells you (or your agent) how to implement them in
whatever stack you already use. A language-neutral pseudocode reference is included.

---

## Who this is for

This is for teams building apps — and the **AI agents** they use to build them — that need **simple,
straightforward, high-fidelity authentication**: email + a one-time code, nothing more. The entire
system is engineered around one promise:

> **Authentication stays simple, and it never fails.**

That means a single field to sign in *or* sign up, a clear code step that tells the user exactly what
to do next, a **contact button** on every auth page when someone gets stuck, and **flash messages**
that confirm each action ("check your inbox and spam folder", "a new code has been sent"). No
passwords to forget, no confusing multi-page signup — just email in, code in, you're in.

---

## Why passwordless

Passwords are the single biggest source of account takeover, credential-stuffing, and support
tickets. Passwordless OTP auth removes the thing attackers steal (the password) while making login
*faster* for real users:

- **Fewer steps** — one field, one code, straight to the app.
- **No password resets** — nothing to forget, reset, or phish.
- **Email-verified by construction** — possessing the code proves the address.
- **Enumeration-resistant** — the server never reveals whether an email is registered.

---

## Features

| Area | What it specifies |
|------|-------------------|
| **Single email field** | One clean input for both login and registration (auto-register on first code). |
| **Email-only registration** | Sign-up is the same single email field — no name, no password; the account is created on the first successful code. |
| **Terms + Privacy acceptance** | Two separate, **pre-checked** boxes under the email field, each linking to a real, versioned, served page. Required server-side; accepted version + timestamp stored on the account. |
| **First-login profile completion** | Since registration collects only email, a first-time login is sent to the profile page with a "complete your profile" flash message. |
| **Anti-enumeration** | The request endpoint never queries the account store; identical response either way. |
| **Dynamic button** | Client-side email regex enables the submit button the moment the address is valid. |
| **Code entry** | Single `one-time-code` field (preferred) or an 8-box grid with auto-focus and paste-to-fill. |
| **Flash messages (action guidance)** | Persistent, non-dismissing messages that tell the user exactly what to do — "check your inbox and spam folder", "a new code has been sent". |
| **Server-synced resend** | 30-second countdown; server independently enforces the cooldown + rate limits. |
| **Immediate inline errors** | Wrong/expired code shows an inline message, no page reload. |
| **Hashed OTPs** | Codes stored as bcrypt/argon2id hashes, compared in constant time, auto-expiring. |
| **Hardened session** | Fresh token on every login/2FA/email change, tokens stored hashed, CSRF protection, transient state cleared. |
| **Contact button** | A "Trouble logging in? Contact admin" button on every auth page, so a user is never stuck. |
| **Two-factor authentication** | Optional TOTP from an authenticator app, + 10 single-use recovery codes. A login with 2FA on returns no session until the second step; replay of an accepted code is rejected. |
| **One-year sessions** | Default 365 days, driven by one policy: users pick their own inside an admin-set band; admins set the default, ceiling, and any individual user's duration. New sessions only. |
| **Device list & revocation** | Every session carries device, coarse location, IP and timestamps. Users see them and sign any device out; tokens are stored hashed. |
| **Verified login-email change** | Code to the new address, notice to the old, step-up auth if 2FA is on, all other sessions revoked, old address kept in history. |
| **Admin console** | Session policy, user directory, per-user devices/login history/email-change log/2FA state, device revocation, 2FA reset. Role-gated and audited. |
| **Audit log** | Append-only record of sign-ins, 2FA changes, revocations, duration changes, email changes and admin actions. Users see their own; admins see the account. |
| **Face ID / biometric login** | Optional mobile re-auth: a device-bound key (Secure Enclave / Android Keystore) signs a server challenge, with device limits and revocation. |
| **Social login** | "Continue with Google / GitHub / LinkedIn" via OAuth/OIDC — verified-email-only account linking, no takeover. |

---

## Structure

```
SKILL.md                              # The skill: flow, API contract, data model, rules, checklist
references/
├── architecture.md                   # Full flow, sequence diagram, API detail, edge cases
├── security-rules.md                 # Security invariants with exact algorithms + primitives
├── ux-rules.md                       # UX behaviours with accessibility notes
├── reference-implementation.md       # Language-neutral pseudocode to translate into any stack
├── biometric-login.md                # Face ID / Touch ID login architecture for mobile
├── social-login.md                   # OAuth/OIDC social login (Google, GitHub, LinkedIn)
├── legal-consent.md                  # Terms/Privacy acceptance: pre-checked boxes, versioning, pages
├── two-factor.md                     # TOTP enrollment, second step, replay guard, recovery codes
├── session-management.md             # Duration policy, hashed tokens, device list, revocation
├── email-change.md                   # Verified login-email change, dual notification, sessions
└── admin-and-audit.md                # Admin roles + console, audit schema, what to record
examples/
├── node-express/                     # TypeScript/Express backend + tests
│   ├── src/totp.ts                   # RFC 6238 TOTP, base32, recovery codes (no deps)
│   ├── src/sessionPolicy.ts          # 365-day default, admin band, user preference
│   ├── src/store.ts                  # hashed session tokens, devices, MFA, email-change requests
│   ├── src/twofactor.ts              # enrollment, verify, replay guard, recovery codes
│   ├── src/emailChange.ts            # double-verified address change
│   ├── src/audit.ts                  # append-only audit log
│   ├── src/legal-pages.ts            # the real /terms and /privacy documents, served
│   ├── src/views.ts                  # sign-in + second-factor screens
│   ├── src/views-profile.ts          # profile: 2FA, duration, devices, history, email change
│   └── src/views-admin.ts            # admin settings + user investigation
├── ios-faceid/                       # Swift Face ID client
└── android-biometric/                # Kotlin biometric client
CHANGELOG.md                          # version history — pin by tag/commit
LICENSE
```

---

## The flow (one minute)

```
POST /auth/otp/request  { email, acceptedTerms, acceptedPrivacy }
                                               → issue + email 8-digit code (hashed, expiring)
                                                 consent validated first — no mail without it
                                                 no user lookup — enumeration-safe
        ↓ (verify view: code entry, 30s countdown, "check spam" banner)
POST /auth/otp/verify   { requestId, code }    → constant-time check → find-or-create user
                                                 consent version + timestamp persisted on the account
        ↓ 2FA on?
POST /auth/2fa/verify   { mfaToken, code }     → TOTP or recovery code → only now a session is issued
        ↓
redirect → /dashboard (first login → /profile)
```

---

## Security measures

Every one of these is enforced by the spec and demonstrated in `examples/node-express/`:

| Measure | What it stops |
|---------|---------------|
| **No early account disclosure** | User enumeration — the server never reveals whether an email is registered. |
| **Hashed OTPs** (bcrypt/argon2id, CSPRNG) | Database theft — the raw code is never stored or logged. |
| **Constant-time comparison** | Timing side-channels that reveal whether a code was issued. |
| **Expiry + attempt limits** | Brute force — codes expire (10 min) and lock after 5 wrong guesses. |
| **Rate limiting** (per-email, per-IP, 30s resend cooldown) | Email bombing and code guessing. |
| **Session regeneration + CSRF** | Session fixation and cross-site request forgery. |
| **Email-verified on OTP** | Unverified accounts — proving the code proves the inbox. |
| **Server-enforced consent** | Registration without an explicit Terms + Privacy acceptance — 422, no code sent. |
| **No session before the second factor** | 2FA bypass — the OTP step returns only a single-use `mfaToken`. |
| **TOTP replay guard** | Reusing a captured code for the rest of its 30-second window. |
| **Hashed session tokens** | Session theft from a database dump — a dump yields no usable tokens. |
| **Policy-capped sessions** | Unbounded session lifetime; per-device revocation is instant. |
| **Double-verified email change** | Silent takeover — the new address must confirm, the old one is told. |
| **Role-gated, audited admin** | Insider misuse; every look at a user record is logged. |
| **Authenticated biometric enrollment** | Key injection — only a signed-in user can enroll a device. |
| **Sender auth (SPF/DKIM/DMARC) + bounce safety** | Deliverability failure and bounce-based enumeration. |
| **Retention & PII controls** | Stale data growth and GDPR/CCPA exposure. |

A full **threat model** — what each control defends against and why — is in
`references/security-rules.md`.

> **Production notes:** serve over HTTPS, use a queue-capable mail provider, and back the rate
> limiter with a shared store (Redis, etc.) so limits hold across instances.

---

## Strengths & limitations

**Strengths**

- **Zero friction** — one field, one code, straight in. Nothing to remember or reset.
- **Enumeration-resistant** — the server never reveals whether an email is registered.
- **No password surface** — nothing to store, steal, or reset; no credential-stuffing target.
- **Email-verified by construction** — possessing the code proves the inbox.
- **Defense in depth** — hashed OTPs, constant-time comparison, expiry, attempt limits, and
  server-authoritative rate limiting.
- **Portable** — one spec, any backend, with concrete Node/Swift/Kotlin examples.
- **Recoverable** — optional TOTP with single-use recovery codes and an audited admin reset, so a lost
  phone never means a lost account.
- **Controllable** — one-year sessions by default, user-adjustable inside an admin band, with a device
  list that can revoke any session instantly.
- **Accountable** — every sign-in, security change and admin look at a user record is in the audit log.
- **Optional biometric layer** — a phishing-resistant, device-bound one-tap unlock on mobile.

**Limitations**

- **OTP is still phishable.** A real-time relay can proxy a code as easily as a password. For
  high-value targets, prefer WebAuthn/passkeys.
- **8-digit codes (10⁸ ≈ 100M combinations) are effectively unguessable online** once expiry, attempt
  limits, and rate limiting apply — but remain far weaker than a password against offline cracking of
  a leaked hash (bcrypt/argon2id mitigates this). Raise to 10 digits for extra margin on high-value
  accounts.
- **Depends on email deliverability.** "Never fails" assumes SPF/DKIM/DMARC and a healthy sending
  domain. If the code lands in spam, the flow stalls.
- **Unified entry trades off email bombing.** It must send to any address to avoid enumeration; the
  send rate limits are the guardrail.
- **Not a full identity provider.** Social login (Google/GitHub/LinkedIn) and TOTP are included, but
  there is no SAML/enterprise SSO, no WebAuthn/passkey registration, and no team/tenant model — compose
  those in when you need them.
- **The admin console is deliberately small.** Policy + per-user investigation, not a general CRM; add
  endpoints only with the same role guard and audit trail.
- **Examples are illustrative**, not production drop-ins (in-memory stores, `console.log` mail).

---

## Face ID / biometric login (mobile)

For native iOS/Android apps, add a one-tap unlock on top of the email OTP:

- **Biometrics authenticate the user to the device, never the server.** The device proves possession
  of a device-bound private key (Secure Enclave / Android Keystore) by signing a server challenge; the
  server verifies against a stored public key.
- **First OTP login enrolls the device**; after that, login is a Face ID prompt — no code, no typing.
- The private key never leaves secure hardware, and a leaked database contains only public keys.

See `references/biometric-login.md` for the full architecture, and `examples/` for concrete Swift
(iOS) and Kotlin (Android) code plus the server-side verification.

---

## Social login (Google, GitHub, LinkedIn, …)

Add "Continue with Google / GitHub / LinkedIn" alongside email OTP and Face ID:

- **OAuth 2.0 / OpenID Connect** with Authorization Code + PKCE — the provider authenticates, your app
  verifies server-side, then maps the identity to a local account.
- **Verified-email-only linking** — never link an account on an unverified email (account-takeover guard).
- First-time social accounts reuse the **profile-completion** flow.
- Provider matrix (Google, LinkedIn, Apple, Microsoft = OIDC; GitHub = OAuth2 + `/user/emails`) and the
  account-linking decision are in `references/social-login.md`, with code + tests in
  `examples/node-express/src/social.ts`.

---

## Terms of Service & Privacy Policy acceptance

Registration captures agreement to both documents — with boxes that **point at pages a user can
actually read**:

- **Two separate checkboxes** under the email field, **checked by default**, each label linking to
  the real `/terms` and `/privacy` page (opened in a new tab so a half-typed form is not lost).
- **The server still requires an explicit acceptance.** Pre-checked is a UI affordance, not consent:
  `POST /auth/otp/request` returns `422` and sends no email unless both flags are true.
- **Stored as version + timestamp**, not a boolean — so you can answer "what did they agree to?".
  Re-accepting the same version keeps the original timestamp; a version bump raises
  `requiresConsent` on the next login.
- **Optional consent stays separate and unchecked** — marketing and analytics never inherit the
  pre-ticked state.
- **Real documents, not links to nowhere.** If the app has no policy pages, write them from what the
  app actually collects and does. The example ships both, served and versioned, written for exactly
  this system: `examples/node-express/src/legal-pages.ts` → `GET /terms`, `GET /privacy`.

The full pattern — placement in an enumeration-safe flow, the pre-ticked-consent caveat, data model,
versioning, and a contents checklist for each document — is in `references/legal-consent.md`.

---

## Two-factor authentication (optional)

A user turns it on in their profile; the next login asks for a code from their authenticator app.

- **TOTP (RFC 6238), no dependencies** — a 160-bit secret, `otpauth://` URI for any authenticator app,
  6-digit codes with ±1 step of clock drift.
- **Enrollment is two-phase** — the secret is only activated after the user proves the app works, and
  that moment issues **10 single-use recovery codes** so a lost phone is never a locked account.
- **No session before the second factor** — `/auth/otp/verify` returns `requires2fa` + a 5-minute
  single-use `mfaToken`; only `/auth/2fa/verify` mints a session, with a fresh token.
- **Replay is rejected** — the last accepted time step is stored, and a code from an already-used step
  is refused for the rest of its window.
- **Brute force is budgeted** — attempts per challenge plus one shared per-email failure budget across
  login, disable, regeneration, and email-change step-up.

`references/two-factor.md` · `examples/node-express/src/{totp,twofactor}.ts`

---

## Sessions, devices & login duration

**A sign-in lasts one year by default** — and it is a policy, not a hardcoded number.

```
effective days = clamp(user preference ?? admin default, admin min, admin max)
```

| Who | What they control |
|-----|-------------------|
| Admin | Default (365), minimum, maximum, whether users may choose, optional idle timeout |
| User | Their own duration inside that band, from the profile |
| Admin | Any individual user's duration |

- **New sessions only.** Lowering the default never logs anyone out mid-session, and raising it never
  extends a session that already exists.
- **Tokens are stored hashed** — a leaked database contains no usable sessions.
- **Every device is visible**: device label, coarse location, IP, signed in, last active, whether it is
  the current one. Sign any device out, or every other device in one click.
- **Revocation is immediate** and keeps the record, so the history still shows what happened.

`references/session-management.md` · `examples/node-express/src/{sessionPolicy,store}.ts`

---

## Changing the login email

In a passwordless system the address *is* the credential, so the change is verified twice:

1. Signed in, the user submits the new address — with a current 2FA code if 2FA is on.
2. A code goes to the **new** address; a security notice goes to the **old** one.
3. Confirming moves the account, keeps the old address in history, **signs out every other device**,
   rotates the current session token, and writes audit events at request and confirm.

Refusals stay generic ("That address cannot be used for this account") so the endpoint cannot be used
to enumerate accounts. One pending change per account, rate-limited per hour.

`references/email-change.md` · `examples/node-express/src/emailChange.ts`

---

## Admin console & audit log

Administrators get a small, deliberate console: session policy, the user directory, and one account at
a time — devices (including revoked), login history, email-change log, 2FA state, per-user duration,
device revocation, and a 2FA reset for lockout.

- **Roles are stored** and bootstrapped from `ADMIN_EMAILS`; no endpoint grants a role.
- **Admins never see secrets** — not tokens, TOTP secrets, or recovery codes.
- **Every action is audited**, including `admin.user_viewed` — looking at someone's history is itself a
  privacy-relevant event.
- **The log is append-only**; retention is a scheduled job aligned with the Privacy Policy.
- **Users see their own slice** on their profile: sign-ins and the security changes they made,
  including every login-email change.

`references/admin-and-audit.md` · `examples/node-express/src/{audit,roles,views-admin}.ts`

---

## Pull it & start using

Copy this prompt into your agent (Claude Code, Codex, Cursor, OpenCode, …) to install the skill and
build the flow in your stack:

```
Pull the passwordless-authentication skill from
https://github.com/davepartner/passwordless-authentication (pin it by tag or commit), read SKILL.md,
and implement email-OTP login for this project following its spec exactly:

- One email field for both login and signup (auto-register on first code) — no password, no name field.
- An 8-digit code step with a persistent "check your inbox and spam folder" flash message and a 30s
  server-synced resend countdown.
- A "Trouble logging in? Contact admin" button on every auth page, and inline errors with no reload.
- Two separate Terms of Service and Privacy Policy checkboxes, pre-checked, each linking to a real
  served page; require an explicit acceptance server-side and store the accepted version + timestamp.
- Optional TOTP two-factor with recovery codes, a replay guard, and no session issued before the second
  step; one-year sessions with a user-selectable duration inside an admin-set band; a device list with
  revocation; a verified login-email change; an admin console; and an append-only audit log.
- The full security rules: hashed OTPs (bcrypt/argon2id), constant-time compare, expiry + attempt
  limits, per-email/per-IP rate limiting, session regeneration, and zero account enumeration.

Then run the skill's verification checklist before you consider the work done.
```

---

## Versioning

This skill may evolve. **Pin it by commit hash or tag** when you pull it into a project, and re-run the
verification checklist after updating. See `CHANGELOG.md`.

## License

MIT — see [LICENSE](./LICENSE).

---

## Search index — keywords

*Findable by AI agents and humans searching for passwordless authentication and OTP login:*

Passwordless authentication, passwordless login, passwordless auth, email OTP, OTP authentication,
email OTP login, one-time password, one-time passcode, one-time code, 8-digit code, magic link
alternative, login without password, sign in without password, remove passwords, passwordless design,
platform agnostic authentication, framework agnostic auth, OTP verification flow, OTP verification
UI, eight digit input, OTP input grid, auto focus OTP, resend OTP countdown, resend cooldown, OTP
expiry, OTP rate limiting, email rate limiting, anti enumeration, user enumeration, enumeration
resistant, enumeration attack, prevent user enumeration, account enumeration, secure login, secure
authentication, hashed OTP, bcrypt OTP, argon2id OTP, constant time comparison, timing safe compare,
timingSafeEqual, hash_equals, CSPRNG, session regeneration, session fixation, CSRF, auth security,
two factor alternative, 2FA alternative, passwordless 2FA, frictionless login, one click login,
single field login, magic link vs OTP, authentication API, auth API contract, auth data model,
OtpChallenge, Node.js auth, Express auth, Next.js auth, Django auth, Rails auth, Go auth, FastAPI
auth, PHP auth, Laravel auth.

AI agent skill, Claude Code skill, Claude skill, Cursor rules, AI coding rules, agent prompt, system
prompt, LLM rules, agentic development, developer skill, engineering skill, auth boilerplate, login
boilerplate, secure auth template, reusable component, platform agnostic skill, framework agnostic
skill.

Face ID, FaceID, Touch ID, biometric login, biometric authentication, biometric auth, passkey,
passkeys, device credential, device-bound key, WebAuthn, FIDO2, secure enclave, Apple Secure Enclave,
LocalAuthentication, LAContext, Android Keystore, BiometricPrompt, BiometricManager,
KeyGenParameterSpec, ECDSA signature, challenge response, key pair enrollment, mobile authentication,
iOS authentication, Android authentication, Swift Face ID, Kotlin biometric, sign in with Face ID,
sign in with fingerprint, sign in with biometrics, fingerprint login, device revocation, device
lifecycle, phishing resistant, phishing resistance, OTP phishing, threat model, threat modeling,
SPF DKIM DMARC, sender authentication, email deliverability, bounce handling, email canonicalization,
data retention, GDPR, PII, opaque token, signed token, JWT session, requestId, challenge id.

Social login, social sign in, sign in with Google, sign in with GitHub, sign in with LinkedIn, Google
OAuth, GitHub OAuth, LinkedIn OAuth, OAuth 2.0, OpenID Connect, OIDC, OAuth login, social
authentication, continue with Google, continue with GitHub, authorization code flow, PKCE, code
challenge, ID token, JWKS, jwtVerify, jose, account linking, account takeover prevention, verified
email, email_verified, provider user id, OAuth callback, social identity.

Simple authentication, straightforward authentication, high-fidelity authentication, reliable
authentication, authentication that never fails, email-only signup, email-only registration, no
password signup, contact button, contact admin, flash message, action guidance, frictionless login,
simple login, quick sign in, onboarding without a password, low-friction auth.

Terms of Service, ToS, terms and conditions, privacy policy, legal pages, consent checkbox, terms
acceptance, privacy acceptance, pre-checked checkbox, checked by default, GDPR consent record,
consent versioning, re-acceptance, requiresConsent, policy versioning, effective date, data retention
policy, cookie notice, account deletion, DPA, CCPA notice at collection, website legal pages.

Two-factor authentication, 2FA, MFA, TOTP, time-based one-time password, RFC 6238, RFC 4226, HOTP,
authenticator app, Google Authenticator, Authy, 1Password, otpauth URI, QR code, recovery codes,
backup codes, second factor, step-up authentication, replay attack, TOTP replay, enrollment, disable
2FA, admin reset 2FA, second-factor bypass.

Session management, session duration, remember me, stay signed in, one year session, 365 days, session
policy, idle timeout, session expiry, session token, hashed session token, opaque token, device list,
signed-in devices, logout all devices, revoke session, session fixation, token rotation, last seen,
login history, sign-in history, active sessions, user agent, IP address, geolocation, coarse location,
device label, session audit.

Change email, change login email, email change verification, verify new email, double opt-in, account
recovery, credential change, account takeover prevention, previous emails, email history.

Admin panel, admin dashboard, admin console, role-based access control, RBAC, ADMIN_EMAILS, user
management, user investigation, audit log, audit trail, append-only log, security log, event log,
compliance audit, user viewed, GDPR access log, SOC 2 audit trail, tamper evidence, retention policy.
