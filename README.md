# Passwordless Authentication — Platform-Agnostic Email OTP

A **secure, frictionless, user-enumeration-resistant passwordless email OTP authentication system**,
specified as a reusable skill that works in **any stack** — Node/Express, Next.js, Django, Rails,
Go, PHP/Laravel, FastAPI, or a custom backend.

One email field in. A 6-digit code. Done. No password, no "does this account exist?" leak, no
dead-end UX.

This is **not** tied to a framework. It defines the flow, the API contract, the data model, the
security invariants, and the UX behaviours — then tells you (or your agent) how to implement them in
whatever stack you already use. A language-neutral pseudocode reference is included.

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
| **Anti-enumeration** | The request endpoint never queries the account store; identical response either way. |
| **Dynamic button** | Client-side email regex enables the submit button the moment the address is valid. |
| **Code entry** | Single `one-time-code` field (preferred) or a 6-box grid with auto-focus and paste-to-fill. |
| **Persistent helper banner** | "Check your inbox and spam/junk folder" stays visible throughout verification. |
| **Server-synced resend** | 30-second countdown; server independently enforces the cooldown + rate limits. |
| **Immediate inline errors** | Wrong/expired code shows an inline message, no page reload. |
| **Hashed OTPs** | Codes stored as bcrypt/argon2id hashes, compared in constant time, auto-expiring. |
| **Hardened session** | Session regeneration on login, CSRF protection, transient state cleared. |
| **Support link** | "Trouble logging in? Contact admin" on both forms. |
| **Face ID / biometric login** | Optional mobile re-auth: a device-bound key (Secure Enclave / Android Keystore) signs a server challenge, with device limits and revocation. |

---

## Structure

```
SKILL.md                              # The skill: flow, API contract, data model, rules, checklist
references/
├── architecture.md                   # Full flow, sequence diagram, API detail, edge cases
├── security-rules.md                 # Security invariants with exact algorithms + primitives
├── ux-rules.md                       # UX behaviours with accessibility notes
├── reference-implementation.md       # Language-neutral pseudocode to translate into any stack
└── biometric-login.md                # Face ID / Touch ID login architecture for mobile
examples/
├── node-express/                     # TypeScript/Express backend (OTP + biometric server side) + unit tests
├── ios-faceid/                       # Swift Face ID client
└── android-biometric/                # Kotlin biometric client
CHANGELOG.md                          # version history — pin by tag/commit
LICENSE
```

---

## The flow (one minute)

```
POST /auth/otp/request  { email }              → issue + email 6-digit code (hashed, expiring)
                                                 no user lookup — enumeration-safe
        ↓ (verify view: code entry, 30s countdown, "check spam" banner)
POST /auth/otp/verify   { requestId, code }    → constant-time check → find-or-create user → login
        ↓
redirect → /dashboard
```

---

## Security model

- **No early disclosure** — `request` returns the identical response for registered and unregistered
  emails. Account creation/lookup happens only at code verification.
- **Hashed codes** — OTPs stored as `bcrypt` (cost ≥ 10) or `argon2id`, generated with a CSPRNG.
- **Constant-time compare** — the hash verify runs even when no challenge exists (dummy hash), so
  timing can't reveal whether an OTP was issued.
- **Rate limiting** — send limited per-email and per-IP; verify limited per-email (**failures only**);
  hard 30s resend cooldown. The client timer is UX only; the server is authoritative.
- **Session hardening** — session-id regeneration on login, `Secure`+`HttpOnly`+`SameSite` cookies or
  short-lived signed tokens, CSRF everywhere, transient state cleared.
- **Email-verified on OTP** — proving the code marks the address verified.

A full **threat model** — what each control defends against — is in `references/security-rules.md`,
along with sender-auth (SPF/DKIM/DMARC), bounce-handling, retention/PII, and email-canonicalization
guidance.

> **Production notes:** serve over HTTPS, use a queue-capable mail provider, and back the rate
> limiter with a shared store (Redis, etc.) so limits hold across instances.

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

## Versioning

This skill may evolve. **Pin it by commit hash or tag** when you pull it into a project, and re-run the
verification checklist after updating. See `CHANGELOG.md`.

## License

MIT — see [LICENSE](./LICENSE).

---

## Search index — keywords

*Findable by AI agents and humans searching for passwordless authentication and OTP login:*

Passwordless authentication, passwordless login, passwordless auth, email OTP, OTP authentication,
email OTP login, one-time password, one-time passcode, one-time code, 6-digit code, magic link
alternative, login without password, sign in without password, remove passwords, passwordless design,
platform agnostic authentication, framework agnostic auth, OTP verification flow, OTP verification
UI, six digit input, OTP input grid, auto focus OTP, resend OTP countdown, resend cooldown, OTP
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
