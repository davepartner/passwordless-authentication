# Security Rules — Passwordless Email OTP

The invariants that make the system safe. Every rule maps to a concrete primitive you implement in
your stack. Do not weaken these.

---

## Threat model

Defending against, in priority order:

1. **User enumeration** — an attacker probing which email addresses have accounts.
2. **OTP brute force** — online guessing of the 8-digit code.
3. **OTP replay** — reusing a captured/intercepted code.
4. **Timing side-channels** — inferring whether a code/challenge exists from response time.
5. **Email bombing / harassment** — abusing the send flow to flood a target inbox.
6. **Session fixation / hijack** — stealing or pre-setting a session.
7. **Biometric key extraction / signature replay** (mobile) — extracting the device key or replaying a
   signature.

**Explicit non-goal:** phishing resistance for the OTP path. OTPs are relay-able. For phishing-resistant
authentication, use WebAuthn/passkeys (the biometric layer here is the native equivalent).

---

## 1. No enumeration at request time

**Rule:** `POST /auth/otp/request` never queries the account/user store. It validates email syntax,
rate-limits, issues a code, and returns a response whose *content, status, and timing* are identical
whether or not the address is registered.

**Implication:** account creation/lookup moves to `verify`. Auto-register on first successful code is
the cleanest way to keep the entry unified (and removes the "sign in vs sign up" fork).

**Bounce caveat:** a non-delivery report (NDR) for a non-existent address can leak existence. Configure
bounce handling so it does **not** produce a distinct "no such user" signal — e.g. don't log/alert on
bounces differently by reason, and don't tie bounce processing back into the auth UI.

---

## 2. Hash the OTP

**Rule:** store `bcrypt` (cost ≥ 10) or `argon2id`, never the raw code. The raw code must never appear
in logs, error messages, API responses, or analytics.

**Primitives:**
- Node: `bcrypt.hash` / `argon2.hash`
- PHP: `password_hash($code, PASSWORD_BCRYPT)`
- Python: `bcrypt.hashpw` / `argon2.PasswordHasher`
- Go: `golang.org/x/crypto/bcrypt`
- Django: `make_password` (PBKDF2 — acceptable; prefer argon2)

**Length vs entropy:** 8 digits = 10⁸ possibilities. Hashing adds no entropy; the security comes from
expiry + attempt limits + rate limiting. **8 digits is the default; raise to 10 for higher-assurance
contexts.** State the choice in config, not in code.

---

## 3. Constant-time comparison (and no timing oracle)

**Rule:** the verification path always runs a constant-time hash compare, even when no challenge
exists. Use the platform's timing-safe primitive:

- Node: `bcrypt.compare` / `crypto.timingSafeEqual`
- PHP: `password_verify` / `hash_equals`
- Python: `hmac.compare_digest`
- Go: `bcrypt.CompareHashAndPassword` / `subtle.ConstantTimeCompare`

**Anti-timing trick:** when no challenge exists for the `requestId`, still compare the submitted code
against a **precomputed dummy hash** (a valid bcrypt hash of a fixed random string). This makes the
response time the same whether or not an OTP was issued.

**Also:** one error message for invalid and expired; avoid early returns that skip the compare.

---

## 4. CSPRNG for code generation

**Rule:** generate the digits with a cryptographically secure RNG, never a predictable PRNG.

- Node: `crypto.randomInt(0, 100_000_000)` (zero-pad)
- PHP: `random_int(0, 99999999)`
- Python: `secrets.randbelow(100_000_000)`
- Go: `crypto/rand`
- .NET: `RandomNumberGenerator.GetInt32`

---

## 5. Expiry + retention

**Rule:** every challenge has an `expires_at` (default 10 minutes). Expired challenges are rejected and
**purged**.

**Retention:** schedule a job to delete rows where `expires_at < now` (and consumed rows if you keep
them). This bounds storage and PII (email + IP) retention — a GDPR/CCPA concern. Use a TTL index or a
cron/queue job, and run it frequently (e.g. every few minutes).

---

## 6. Attempt limit

**Rule:** a challenge tracks `attempts` and is invalidated after a small number of wrong guesses
(default 5). On the failed attempt that reaches the limit, delete the challenge.

**Why:** bounds the online brute-force budget per issued code.

---

## 7. Rate limiting (server-authoritative)

**Rule:** enforce on the server, independent of any client countdown:

| Scope | Limit (default) |
|-------|-----------------|
| Send, per email | 10 / hour |
| Send, per IP | 20 / hour |
| Verify, per email | 10 / 15 min — **count failed attempts only** |
| Resend cooldown | 30 s minimum between sends (per email) |

**Count failures only for verify.** Successful verifications must not consume the budget (otherwise
legitimate multi-device or repeated logins get locked out). Increment the verify counter only when the
code is wrong.

**Primitives:** Redis `INCR`+`EXPIRE`, or a framework rate limiter (Laravel `RateLimiter`, Django
cache, `express-rate-limit`, Go `golang.org/x/time/rate`, FastAPI slowapi). Return HTTP 429 with
`Retry-After` (seconds).

**Trade-off to document:** the unified entry sends to any address (to avoid enumeration). The send
limits are what keep this from being abused — keep them strict.

---

## 8. Session hardening

**Rule:**

- On successful login, **regenerate the session identifier** (defeats session fixation).
- Cookies are `Secure` (HTTPS only), `HttpOnly`, and `SameSite=Lax` (or `Strict`). For API/SPA, issue a
  **short-lived signed token** (JWT with short expiry, or opaque token in a secure store) instead.
- Protect state-changing routes against CSRF (double-submit cookie or synchronizer token).
- Clear transient challenge state after success.
- **Enrollment is authenticated.** Any endpoint that stores a device public key (biometric enroll)
  must require an established session — never accept an unsigned public key from an anonymous caller.

---

## 9. Email verified on OTP

**Rule:** proving the code proves control of the inbox, so set the account's `email_verified_at`
timestamp on first successful verification. No separate confirmation step.

---

## 10. Consent integrity (Terms + Privacy)

**Rule:** a registration is only valid when the user has accepted both documents, and the record must
show *what* they accepted.

- **Server-authoritative.** The boxes are pre-checked in the UI; the server still requires an explicit
  `true` on `request` and returns `422` otherwise. Never infer acceptance from the absence of a value,
  and never accept `"false"`, `0`, `"yes"`, or a missing key.
- **Before delivery.** Consent is validated *before* rate limiting and code generation, so a rejected
  request sends no mail and consumes no send budget.
- **Implicit registration, explicit record.** Because `request` cannot look up the account, acceptance
  rides on the challenge and is persisted only when the account is created at `verify`. Do not create
  user rows at request time to store it.
- **Version + timestamp, not a boolean.** Store `terms_version` / `terms_accepted_at` and
  `privacy_version` / `privacy_accepted_at`. A boolean cannot survive a text change.
- **Preserve history.** Re-accepting the same version must not overwrite the original timestamp; only
  a version change stamps a new one. Keep an append-only consent log if you need to evidence older
  acceptances.
- **Retention exception.** Consent records are evidence — exclude them from the OTP purge job and tie
  them to account retention instead.
- **Do not confuse the two consents.** Contract acceptance (these boxes) is not the same as consent
  for optional processing (marketing, analytics, cookies). The latter must be separate, unchecked, and
  withdrawable.

See `legal-consent.md` for the UI placement, versioning flow, and document contents.

---

## Operational rules (not optional)

### Sender auth & deliverability
- Configure **SPF**, **DKIM**, and **DMARC** for the sending domain. Without them, codes land in spam
  and the whole flow fails.
- Warm up the domain/IP and monitor **deliverability** and **reputation**.
- Cap mail **spend** to bound the cost of abuse.

### Email canonicalization
- Normalize **case** and **whitespace**.
- Decide a policy for **`+`-tags** (`foo+tag@example.com`), **provider dot-stripping** (Gmail ignores
  dots in the local part), and **IDN/punycode** — so the same mailbox maps to exactly one key and
  per-email rate limits can't be bypassed by syntactic variants.

---

## Security checklist

- [ ] `request` never queries the user store; identical response either way.
- [ ] OTP stored hashed (bcrypt/argon2id); raw code never logged/returned.
- [ ] Constant-time compare, with a dummy-hash path when no challenge exists.
- [ ] Code generated with a CSPRNG.
- [ ] Expiry enforced (10 min); expired challenges purged on a schedule.
- [ ] Attempt limit enforced (5); challenge invalidated on exceed.
- [ ] Send + verify rate limits enforced server-side; verify counts **failures only**; 30s cooldown.
- [ ] Session id regenerated on login; secure cookies / short-lived tokens; CSRF protected.
- [ ] Biometric enrollment requires authentication.
- [ ] SPF/DKIM/DMARC configured; bounce handling does not leak existence; retention scheduled.
- [ ] Email marked verified on code proof.
- [ ] Consent required server-side; 422 and no mail when either acceptance is missing.
- [ ] Accepted document versions + timestamps stored; original accept time preserved across logins.
