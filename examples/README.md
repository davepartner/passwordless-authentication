# Examples

Concrete reference implementations of the passwordless-authentication skill. These are **illustrative
translations** of the spec — the rules in `SKILL.md` and `references/` are the contract; this code
shows one way to implement them.

> These are not production libraries. In-memory stores and `console.log` mail are placeholders to keep
> the flow readable. Swap them for a database/Redis and a real mail provider before shipping.

## Contents

| Example | Stack | What it demonstrates |
|---------|-------|----------------------|
| `node-express/` | TypeScript + Express | The email-OTP backend (`request` / `verify` / `resend` / `logout`), the **Terms + Privacy acceptance** flow with real `/terms` and `/privacy` pages, **TOTP two-factor**, **one-year policy sessions** with a device list, **verified email changes**, the **admin console + audit log**, and the **server side** of biometric login. Includes unit tests for the OTP, rate-limiter, consent, TOTP, session-policy, and profile primitives, plus HTTP integration tests. |
| `ios-faceid/` | Swift | The **client side** of Face ID: generate a Secure-Enclave key, and sign a server challenge. |
| `android-biometric/` | Kotlin | The **client side** of biometric login: a Keystore key gated by biometrics, and signing via `BiometricPrompt`. |

The Node example implements the spec's key invariants: challenges **keyed by `requestId`** (no login
DoS), **constant-time compare with a dummy-hash path**, verify rate-limiting that counts **failures
only**, **authenticated** biometric enrollment, and an expiring/revocable session.

## How they map to the spec

- **Email OTP** → `node-express/src/{otp,rateLimit,store,routes}.ts` implements the rules in
  `references/security-rules.md` (hashing, constant-time compare, expiry, attempt limits, rate
  limiting, uniform responses).
- **Biometric** → `ios-faceid/` + `android-biometric/` implement the *device* half of
  `references/biometric-login.md`; `node-express/src/biometric.ts` implements the *server* half
  (challenge + signature verification against an enrolled public key).
- **Legal acceptance** → `node-express/src/consent.ts` (validation, versions, merge) and
  `node-express/src/legal-pages.ts` (the served `/terms` and `/privacy` documents) implement
  `references/legal-consent.md`; `node-express/src/views.ts` renders the pre-checked form.
- **Two-factor** → `src/totp.ts` (RFC 6238 on node:crypto) + `src/twofactor.ts` implement
  `references/two-factor.md`; the second step lives in `views.ts`, enrollment in `views-profile.ts`.
- **Sessions & devices** → `src/sessionPolicy.ts` (the one-year default and the admin band) and the
  `sessionStore` in `src/store.ts` implement `references/session-management.md`.
- **Email changes** → `src/emailChange.ts` implements `references/email-change.md`.
- **Admin & audit** → `src/{audit,roles}.ts` + `src/views-admin.ts` implement
  `references/admin-and-audit.md`.

## Interop notes (important)

The device and server must agree on two encodings:

1. **Public key** — the server parses an X.509 SubjectPublicKeyInfo (SPKI) PEM. Android's
   `getEncoded()` already returns SPKI; iOS's `SecKeyCopyExternalRepresentation` returns the raw EC
   point, so the iOS example wraps it in an SPKI header.
2. **Signature** — the Node server (`crypto.verify`) expects a DER-encoded ECDSA signature. Android
   produces DER natively; iOS produces raw `r ‖ s`, so it must be normalised to DER (see the iOS
   example README).

Both conversions are called out in the individual example READMEs.
