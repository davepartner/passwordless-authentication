# Node + Express reference (email OTP + biometric server side)

A TypeScript/Express implementation of the email-OTP flow and the server half of biometric login.

## Run

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000
```

## Endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/auth/otp/request` | `{ email }` | issues + "emails" a code; uniform response (enumeration-safe) |
| POST | `/auth/otp/verify` | `{ requestId, code }` | verifies, find-or-create user |
| POST | `/auth/otp/resend` | `{ requestId }` | re-issues after the 30s cooldown |
| POST | `/auth/biometric/enroll` | `{ email, publicKey, deviceId }` | store a device public key (authenticated in real apps) |
| POST | `/auth/biometric/challenge` | `{ email }` | always returns a fresh challenge (enumeration-safe) |
| POST | `/auth/biometric/verify` | `{ email, challengeId, signature }` | verifies the signature → session |

## What is intentionally simplified

- **Stores are in-memory** (`store.ts`). Replace with Postgres/Redis; the shape of the records is what
  matters.
- **Rate limiter is a sliding window** (`rateLimit.ts`). Use Redis `INCR`+`EXPIRE` in production.
- **Mail is `console.log`** (in `routes.ts` → `issueAndSend`). Use your transactional provider.
- **Sessions are a placeholder token** in the response. Use secure cookies or signed JWTs.
- **Biometric signature verification** (`biometric.ts`) expects an SPKI PEM public key and a DER
  signature, matching Android's native output. iOS clients must convert (see `../ios-faceid/README.md`).
