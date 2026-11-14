# Two-Factor Authentication (TOTP)

Optional, user-controlled second factor for a passwordless email-OTP system.

The primary factor is **something you can read in your inbox**. A second factor must therefore be
*independent* of that inbox — otherwise it is the same factor twice. This spec uses **TOTP**
(RFC 6238) from an authenticator app: offline, universal, no SMS provider, no per-message cost.

> **Never use email as the second factor** in this flow. If an attacker has the inbox, they have both
> codes. SMS is acceptable only as a last-resort fallback and is itself phishable and SIM-swappable.

---

## State machine

```
off ──POST /profile/2fa/start──▶ pending (secret issued, nothing active)
pending ──confirm with a valid code──▶ on (recovery codes issued)
pending ──15 min──▶ off (secret discarded)
on ──disable with a valid code──▶ off
on ──admin reset (verified out of band)──▶ off
```

- **Nothing is enforced until the user proves the app works.** An unconfirmed secret must never gate a
  login; otherwise a bad QR scan locks the user out of their own account.
- The pending secret expires (15 minutes) and is generated fresh on every start.
- Enrollment, disable, and recovery-code regeneration are **authenticated** endpoints — never reachable
  anonymously.

---

## Login flow

```
POST /auth/otp/verify { requestId, code }
  ├─ code valid, 2FA off → session created, done
  └─ code valid, 2FA on  → 200 { ok, requires2fa: true, mfaToken, expiresIn: 300 }
                             NO session is created yet
POST /auth/2fa/verify { mfaToken, code }
  ├─ TOTP valid (or unused recovery code) → session created
  └─ invalid → 422, generic message, attempt counted
```

Rules:

1. **No session before the second factor.** Returning a valid session token and a `requires2fa` flag is
   a bypass; the client would simply ignore the flag.
2. **`mfaToken` is opaque, single-use, short-lived (5 min), and bound to one email.** It is stored
   hashed, carries the device metadata so the eventual session keeps its IP/device record, and is
   deleted on success or on the attempt limit.
3. **Attempt limit** (default 5) **plus** a per-email failure budget (10 per 15 minutes) shared across
   every place a second factor can be typed. A 6-digit code is only 1,000,000 possibilities — without
   a budget, a scripted attacker gets through.
4. **One generic error** for wrong code, expired window, unknown recovery code, and missing challenge.
5. The second-factor success **must create a fresh session** (regenerate the token), never upgrade an
   unauthenticated token in place.

---

## Replay prevention (the one people forget)

A TOTP code is valid for its whole 30-second step, plus the ±1 step drift window. If you accept it
once, an attacker who observed it (shoulder-surf, screen share, proxy log, phished in real time) can
reuse it until the step rolls over.

**Store the last accepted time step on the user and reject any step `<=` that value.** The verifier
returns the matched step for exactly this purpose:

```
verdict = verifyTotp(secret, code)          # → { ok, step }
if (verdict.ok && user.lastStep !== null && verdict.step <= user.lastStep):
    reject
user.lastStep = verdict.step
```

The enrollment code must also burn its step, or the confirming code can be replayed at the next login.

---

## Recovery codes

Ten codes, issued **once** at enrollment and shown **once**:

- 60 bits of entropy each (12 base32 characters), single-use, stored as SHA-256 hashes
  (high-entropy secrets do not need a slow KDF; unlike a password).
- Display as `xxxx-xxxx-xxxx`; normalize case and separators on input.
- On use: mark `used_at`, never delete — the profile shows how many remain, and the audit log keeps the
  event.
- "Regenerate" requires a current TOTP code and invalidates every unused code.
- **The account must never be unrecoverable**: recovery codes are the user's escape hatch, and an
  admin reset (after out-of-band identity verification) is the last resort.

---

## Disabling

Disabling is a security downgrade, so it requires proof of the second factor (TOTP or recovery code).
It also requires an authenticated session. If someone has stolen a session but not the device, they
must not be able to turn 2FA off.

After disabling, keep the session (the user just proved themselves) but audit the event. Consider
signing other devices out if the account looked compromised.

---

## Data model

```
users
  two_factor_secret          base32, nullable      ← never returned after enrollment
  two_factor_enabled_at      timestamp, nullable   ← the source of truth for "is it on"
  two_factor_last_step       integer, nullable     ← replay guard
  pending_two_factor_secret  base32, nullable      ← enrollment in progress
  pending_two_factor_created_at
  recovery_codes             [{ hash, used_at }]

mfa_challenges
  id, token_hash, email, created_at, expires_at, attempts, consumed_at,
  ip, location, user_agent, device_label
```

`two_factor_enabled_at != null` — not the presence of a secret — decides whether a login is challenged.

---

## UX rules

- Enrollment shows the secret **and** the `otpauth://` URI (or a QR rendered from it). QR generation is
  a client concern; the URI is the contract.
- Tell the user to save recovery codes before leaving the page, and make them copyable in one action.
- On the login screen, keep the same shell as the code step: one input, "enter the 6-digit code from
  your authenticator app", and a visible hint that a recovery code also works.
- Errors are inline and generic; never say "that code expired 4 seconds ago".
- Show 2FA state clearly in the profile with a recovery-codes-remaining count.

---

## Checklist

- [ ] 2FA is opt-in from the profile and only activates after a code proves the app works.
- [ ] A login with 2FA on returns **no session**, only a short-lived single-use `mfaToken`.
- [ ] TOTP verification rejects a step that was already accepted (replay guard stored on the user).
- [ ] Attempt limit per challenge **and** a per-email failure budget across all code-entry endpoints.
- [ ] Recovery codes are hashed, single-use, countable, and regenerable only with a current code.
- [ ] Disabling requires a valid current factor and an authenticated session.
- [ ] Every enable/disable/regenerate/login event is written to the audit log.
- [ ] An admin reset path exists, is audited, and revokes the user's sessions.
