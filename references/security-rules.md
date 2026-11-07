# Security Rules — Passwordless Email OTP

The invariants that make the system safe. Every rule maps to a concrete primitive you implement in
your stack. Do not weaken these.

---

## 1. No enumeration at request time

**Rule:** `POST /auth/otp/request` never queries the account/user store. It validates the email
syntax, rate-limits, issues a code, and returns a response whose *content, status, and timing* are
identical whether or not the address is registered.

**Why:** the single most common leak is returning "no account with that email" (or a visibly different
UI) on login. That lets attackers test which emails are valid.

**Implication:** account creation/lookup moves to `verify`. Auto-register on first successful code is
the cleanest way to keep the entry unified (and it removes the "sign in vs sign up" fork entirely).

---

## 2. Hash the OTP

**Rule:** store `bcrypt` (cost ≥ 10) or `argon2id`, never the raw code. The raw code must never appear
in logs, error messages, API responses, or analytics.

**Why:** if the `otp_challenges` store is read by an attacker, plaintext codes let them sign in as
anyone. Hashing is the defense-in-depth layer.

**Primitives:**
- Node: `bcrypt.hash` / `argon2.hash`
- PHP: `password_hash($code, PASSWORD_BCRYPT)`
- Python: `bcrypt.hashpw` / `argon2.PasswordHasher`
- Go: `golang.org/x/crypto/bcrypt`
- Django: `make_password` (PBKDF2 — acceptable; prefer argon2)

**Note on length:** the code is only 6 digits (a million possibilities). Hashing does not add entropy,
but combined with expiry + attempt limits + rate limiting it makes offline and online brute force
infeasible. Keep the attempt limit low (5) and the lifetime short (10 min).

---

## 3. Constant-time comparison (and no timing oracle)

**Rule:** the verification path always runs a constant-time hash compare, even when no challenge
exists. Use the platform's timing-safe primitive:

- Node: `bcrypt.compare` / `crypto.timingSafeEqual`
- PHP: `password_verify` / `hash_equals`
- Python: `hmac.compare_digest`
- Go: `bcrypt.CompareHashAndPassword` / `subtle.ConstantTimeCompare`

**Anti-timing trick:** when no active challenge exists for the email, still compare the submitted code
against a **precomputed dummy hash** (a valid bcrypt hash of a fixed random string). This makes the
response time the same whether or not an OTP was issued, closing the timing side channel.

**Also:** use the same error message for "invalid" and "expired", and avoid early returns that skip the
hash compare.

---

## 4. CSPRNG for code generation

**Rule:** generate the 6 digits with a cryptographically secure RNG, never a predictable PRNG.

- Node: `crypto.randomInt(0, 1_000_000)` and zero-pad
- PHP: `random_int(0, 999999)`
- Python: `secrets.randbelow(1_000_000)`
- Go: `crypto/rand`
- .NET: `RandomNumberGenerator.GetInt32`

---

## 5. Expiry

**Rule:** every challenge has an `expires_at` (default 10 minutes from issuance). Expired challenges
are rejected and deleted.

**Why:** limits the window an attacker has to brute-force or replay a code.

---

## 6. Attempt limit

**Rule:** a challenge tracks `attempts` and is invalidated after a small number of wrong guesses
(default 5). On the failed attempt that reaches the limit, delete the challenge.

**Why:** even with rate limiting on the endpoint, capping per-challenge guesses bounds the total
online brute-force budget per issued code.

---

## 7. Rate limiting (server-authoritative)

**Rule:** enforce on the server, independent of any client countdown:

| Scope | Limit (default) |
|-------|-----------------|
| Send, per email | 10 / hour |
| Send, per IP | 20 / hour |
| Verify, per email | 10 / 15 min |
| Resend cooldown | 30 s minimum between sends (per email) |

**Why:** prevents email bombing (someone enters a victim's address to flood it) and code brute force.
The client 30-second timer is pure UX — the server decides.

**Primitives:** Redis `INCR`+`EXPIRE`, or a framework rate limiter (Laravel `RateLimiter`, Django
cache, `express-rate-limit`, Go `golang.org/x/time/rate`, FastAPI slowapi). Return HTTP 429 with a
`Retry-After` (seconds).

**Trade-off to document:** because the entry is unified, it sends to any address (to avoid
enumeration). The send limits are what keep this from being abused — keep them strict.

---

## 8. Session hardening

**Rule:**

- On successful login, **regenerate the session identifier** (defeats session fixation).
- Cookies are `Secure` (HTTPS only), `HttpOnly`, and `SameSite=Lax` (or `Strict`). For API/SPA, issue a
  **short-lived** signed token (JWT with short expiry, or opaque token in a secure store) instead.
- Protect all state-changing routes against CSRF (double-submit cookie or synchronizer token).
- Clear transient challenge state (`pending_email`, `resend_available_at`) after success.
- Mark the account's email as verified once the code is proven (OTP possession == ownership).

---

## 9. Email verified on OTP

**Rule:** proving the code proves control of the inbox, so set the account's `email_verified_at`
timestamp on first successful verification. No separate confirmation step.

---

## Security checklist

- [ ] `request` never queries the user store; identical response either way.
- [ ] OTP stored hashed (bcrypt/argon2id); raw code never logged/returned.
- [ ] Constant-time compare, with a dummy-hash path when no challenge exists.
- [ ] Code generated with a CSPRNG.
- [ ] Expiry enforced (10 min); expired challenges deleted.
- [ ] Attempt limit enforced (5); challenge invalidated on exceed.
- [ ] Send + verify rate limits enforced server-side; 30s resend cooldown enforced.
- [ ] Session id regenerated on login; secure cookies / short-lived tokens; CSRF protected.
- [ ] Email marked verified on code proof.
