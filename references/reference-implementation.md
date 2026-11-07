# Reference Implementation — Language-Neutral Pseudocode

Translate each function into your stack. This is not a copy-paste library; it is the complete,
correct behaviour expressed so any framework can implement it. Keep the eight security rules
(`references/security-rules.md`) and the UX rules (`references/ux-rules.md`) intact as you port.

---

## Constants

```
OTP_LENGTH       = 6
OTP_LIFETIME     = 10 minutes
MAX_ATTEMPTS     = 5
RESEND_COOLDOWN  = 30 seconds
SEND_LIMIT_EMAIL = 10 per hour
SEND_LIMIT_IP    = 20 per hour
VERIFY_LIMIT     = 10 per 15 minutes
DUMMY_HASH       = <a valid bcrypt/argon2 hash of a fixed random string, precomputed>
```

---

## Code generation (CSPRNG)

```
function generate_code():
    # 6 digits, cryptographically secure, zero-padded
    n = secure_random_int(0, 10^OTP_LENGTH - 1)
    return left_pad(n, OTP_LENGTH, '0')
```

## Hashing

```
function hash_code(code):   return secure_hash(code)      # bcrypt cost>=10 or argon2id
function code_matches(code, hash):
    return constant_time_verify(code, hash)               # bcrypt.compare / timingSafeEqual / ...
```

---

## Request OTP

```
function request_otp(email, ip):
    email = normalize(email)            # lowercase + trim

    if not is_valid_email(email):
        return 422 { field_error: "email" }     # syntax only — no account check

    if rate_limited("send:email:" + email, SEND_LIMIT_EMAIL, 1_hour):
        return 429 { retry_after: remaining_seconds }
    if rate_limited("send:ip:" + ip, SEND_LIMIT_IP, 1_hour):
        return 429 { retry_after: remaining_seconds }
    if within_cooldown("cooldown:" + email, RESEND_COOLDOWN):
        return 429 { retry_after: remaining_seconds }

    # One active challenge per email.
    invalidate_existing_challenges(email)

    code = generate_code()
    store challenge {
        email:      email,
        code_hash:  hash_code(code),
        expires_at: now + OTP_LIFETIME,
        attempts:   0,
        ip_address: ip,
    }

    send_email(email, "Your one-time verification code", body_with(code))

    mark_rate_limit_hit("send:email:" + email, 1_hour)
    mark_rate_limit_hit("send:ip:" + ip, 1_hour)
    start_cooldown("cooldown:" + email, RESEND_COOLDOWN)

    # Identical response whether or not the account exists.
    return 200 { ok: true, resend_after: RESEND_COOLDOWN,
                 message: "If that address is registered, a code is on its way." }
```

---

## Verify OTP

```
function verify_otp(email, code, session_or_token):
    email = normalize(email)

    if rate_limited("verify:" + email, VERIFY_LIMIT, 15_minutes):
        return 429 { retry_after: remaining_seconds }
    mark_rate_limit_hit("verify:" + email, 15_minutes)

    challenge = find_active_challenge(email)     # null if none

    # CONSTANT-TIME: always run the compare, even when no challenge exists.
    hash_to_check = challenge ? challenge.code_hash : DUMMY_HASH
    matches = code_matches(code, hash_to_check)

    if challenge == null:
        return 422 { error: GENERIC_ERROR }

    if challenge.expires_at < now or challenge.consumed_at != null:
        delete challenge
        return 422 { error: GENERIC_ERROR }

    if challenge.attempts >= MAX_ATTEMPTS:
        delete challenge
        return 422 { error: GENERIC_ERROR }

    if not matches:
        challenge.attempts += 1
        if challenge.attempts >= MAX_ATTEMPTS: delete challenge
        return 422 { error: GENERIC_ERROR }

    # Success.
    challenge.consumed_at = now
    delete challenge                       # clear transient state

    user = find_user(email)
    if user == null:
        if not AUTO_REGISTER:              # still generic — no enumeration leak
            return 422 { error: GENERIC_ERROR }
        user = create_user(email)          # name derived from email; unusable random password

    user.email_verified_at = now
    save user

    establish_session(user)                # regenerate session id / issue short-lived token
    clear_transient_state(session_or_token)

    return 200 { ok: true, redirect: "/dashboard" }
```

Where `GENERIC_ERROR = "The code is invalid or has expired."`

---

## Resend OTP

```
function resend_otp(email, ip, session_or_token):
    email = normalize(email)

    if within_cooldown("cooldown:" + email, RESEND_COOLDOWN):
        return 429 { ok: false, retry_after: remaining_seconds }

    # Same guards as request_otp (rate limits), then re-issue.
    result = request_otp(email, ip)        # reuses the safe, uniform send path
    if result.ok:
        update resend_available_at = now + RESEND_COOLDOWN
        return 200 { ok: true, resend_after: RESEND_COOLDOWN, message: "A new code has been sent." }
    return result
```

---

## Logout

```
function logout(session_or_token):
    destroy_session(session_or_token)
    clear_transient_state(session_or_token)
    return 302 → "/login"
```

---

## Porting notes per stack

| Concern | Guidance |
|---------|----------|
| Routing | Map `request`, `verify`, `resend`, `logout` to your router/controller actions. |
| Store | One table/collection `otp_challenges`; index `email`; enforce single active row per email. |
| Hashing | bcrypt (cost ≥ 10) or argon2id. Use your platform's constant-time verify. |
| Rate limit | Redis `INCR`/`EXPIRE`, or the framework limiter; shared store across instances. |
| Session | Server session (regenerate id) **or** short-lived signed/opaque token for SPA/API. |
| Email | Use a transactional provider; handle send failure without leaking account state. |
| Frontend | Follow `references/ux-rules.md` for the 6-box grid, countdown, and inline errors. |

The security and UX rules are the contract. The code is just the translation.
