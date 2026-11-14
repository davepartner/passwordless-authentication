# Node + Express reference

A TypeScript/Express implementation of the whole skill: email OTP, Terms/Privacy consent, optional TOTP
two-factor, one-year policy sessions, the profile page (devices, history, email change), the admin
console + audit log, and the server half of biometric login.

## Run

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000
npm test           # 75 unit + HTTP integration tests
```

Then open <http://localhost:3000/sign-in>. The two acceptance boxes are pre-checked and link to the
real documents at `/terms` and `/privacy`. Sign in, and the profile at `/profile` gives you 2FA,
session duration, the device list and the login history.

Admin: start with `ADMIN_EMAILS=you@example.com npm run dev` and sign in with that address — `/admin`
opens the policy settings and the user directory.

## Endpoints

| Method | Path | Body | Auth | Notes |
|--------|------|------|------|-------|
| GET | `/sign-in` | — | — | the entry form: email + pre-checked Terms/Privacy boxes |
| GET | `/terms` | — | — | **real** Terms of Service (versioned, dated) |
| GET | `/privacy` | — | — | **real** Privacy Policy (versioned, dated) |
| POST | `/auth/otp/request` | `{ email, acceptedTerms, acceptedPrivacy }` | — | issues + "emails" a code; 422 and no mail without both acceptances; uniform response (enumeration-safe) |
| POST | `/auth/otp/verify` | `{ requestId, code }` | — | verifies, find-or-create user, persists the accepted versions, returns a session token + redirect (new users → `/profile` with a welcome flash) |
| POST | `/auth/otp/resend` | `{ requestId }` | — | refreshes the same challenge after the 30s cooldown |
| POST | `/auth/logout` | — | Bearer | destroys the session |
| POST | `/auth/biometric/enroll` | `{ publicKey, deviceId, label }` | **Bearer** | store a device public key (authenticated) |
| POST | `/auth/biometric/revoke` | `{ deviceId }` | **Bearer** | remove a device public key |
| POST | `/auth/biometric/challenge` | `{ email }` | — | always returns a fresh challenge (enumeration-safe) |
| POST | `/auth/biometric/verify` | `{ email, challengeId, signature }` | — | verifies the signature → session |
| GET | `/auth/social/:provider` | — | — | starts OAuth (Google/GitHub/LinkedIn); redirects to the provider |
| GET | `/auth/social/:provider/callback` | `?code&state` | — | verifies the ID token / fetches profile, then reconciles via `decideAccountAction` |
| POST | `/auth/2fa/verify` | `{ mfaToken, code }` | — | second factor (TOTP or recovery code) → session; the only way in when 2FA is on |
| GET | `/profile` | — | Session | profile page: email, 2FA, duration, devices, history |
| PATCH | `/profile/session-days` | `{ days }` | Session | own login duration (`null` = admin default) |
| POST | `/profile/sessions/:id/revoke` | — | Session | sign a device out |
| POST | `/profile/sessions/revoke-others` | — | Session | sign out every other device |
| POST | `/profile/2fa/start` | — | Session | issue a pending TOTP secret + `otpauth://` URI |
| POST | `/profile/2fa/confirm` | `{ code }` | Session | activate 2FA, return 10 recovery codes once |
| POST | `/profile/2fa/disable` | `{ code }` | Session | turn 2FA off (requires a current code) |
| POST | `/profile/2fa/recovery-codes` | `{ code }` | Session | regenerate recovery codes |
| POST | `/profile/email/request` | `{ newEmail, code? }` | Session | code to the new address, notice to the old |
| POST | `/profile/email/confirm` | `{ code }` | Session | move the account, revoke other devices, rotate token |
| POST | `/profile/email/cancel` | — | Session | discard the pending change |
| GET | `/admin` | — | **Admin** | session policy + user directory |
| GET | `/admin/users/:email` | — | **Admin** | devices, login history, email-change log, 2FA state |
| PATCH | `/admin/settings` | `{ defaultDays, minDays, maxDays, allowUserOverride, idleDays }` | **Admin** | deployment session policy |
| PATCH | `/admin/users/:email/session-days` | `{ days }` | **Admin** | per-user duration override |
| POST | `/admin/users/:email/sessions/:id/revoke` | — | **Admin** | revoke a user's device |
| POST | `/admin/users/:email/2fa/reset` | — | **Admin** | emergency 2FA reset (revokes their sessions) |

## What is intentionally simplified

- **Stores are in-memory** (`store.ts`). Replace with Postgres/Redis; add a scheduled purge for expired
  challenges and sessions (retention) and ship audit events to append-only storage. The record shapes
  are what matter.
- **The bearer token is kept in `sessionStorage`** by the pages to keep the example small. In production
  use an `HttpOnly; Secure; SameSite` cookie for server-rendered apps, or the platform keychain for
  native clients — never `localStorage`.
- **Rate limiter is a sliding window** (`rateLimit.ts`) with `tooMany`/`hit` split. Use Redis
  `INCR`+`EXPIRE` in production.
- **Sessions are opaque server-side tokens** (expiring, revocable) — the "opaque token in a secure
  store" option from the spec. In a server-rendered app use an `HttpOnly` cookie; in an API use a
  short-lived signed JWT.
- **Mail is `console.log`** — and it deliberately does **not** log the code (see `issueAndSend`). Use
  your transactional provider; configure SPF/DKIM/DMARC and handle bounces without leaking account
  existence.
- **Biometric signature verification** (`biometric.ts`) expects an SPKI PEM public key and a DER
  signature, matching Android's native output. iOS clients must convert (see `../ios-faceid/README.md`).
- **Legal pages are illustrative but complete.** `legal-pages.ts` describes exactly what this example
  collects, and the operator details are read from `LEGAL_ENTITY`, `LEGAL_ADDRESS`,
  `LEGAL_CONTACT_EMAIL`, `LEGAL_PRIVACY_EMAIL` and `LEGAL_JURISDICTION` at the top of the file. Replace
  them and have counsel review the text before production — an inaccurate policy is worse than none.
