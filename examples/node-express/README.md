# Node + Express reference (email OTP + biometric server side)

A TypeScript/Express implementation of the email-OTP flow and the server half of biometric login.

## Run

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000
npm test           # unit tests (otp + rate limiter)
```

## Endpoints

| Method | Path | Body | Auth | Notes |
|--------|------|------|------|-------|
| POST | `/auth/otp/request` | `{ email }` | — | issues + "emails" a code; uniform response (enumeration-safe) |
| POST | `/auth/otp/verify` | `{ requestId, code }` | — | verifies, find-or-create user, returns a session token + redirect (new users → `/profile/edit` with a welcome flash) |
| POST | `/auth/otp/resend` | `{ requestId }` | — | refreshes the same challenge after the 30s cooldown |
| POST | `/auth/logout` | — | Bearer | destroys the session |
| POST | `/auth/biometric/enroll` | `{ publicKey, deviceId, label }` | **Bearer** | store a device public key (authenticated) |
| POST | `/auth/biometric/revoke` | `{ deviceId }` | **Bearer** | remove a device public key |
| POST | `/auth/biometric/challenge` | `{ email }` | — | always returns a fresh challenge (enumeration-safe) |
| POST | `/auth/biometric/verify` | `{ email, challengeId, signature }` | — | verifies the signature → session |
| GET | `/auth/social/:provider` | — | — | starts OAuth (Google/GitHub/LinkedIn); redirects to the provider |
| GET | `/auth/social/:provider/callback` | `?code&state` | — | verifies the ID token / fetches profile, then reconciles via `decideAccountAction` |

## What is intentionally simplified

- **Stores are in-memory** (`store.ts`). Replace with Postgres/Redis; add a scheduled purge for expired
  challenges and sessions (retention). The record shapes are what matter.
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
