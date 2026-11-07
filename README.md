# Passwordless Authentication — Laravel Email OTP

A **secure, frictionless, user-enumeration-resistant passwordless email OTP authentication system**
for Laravel, packaged as a reusable skill.

One email field in. A 6-digit code. Done. No password, no "does this account exist?" leak, no
dead-end UX.

---

## Why passwordless

Passwords are the single biggest source of account takeover, credential-stuffing, and support
tickets. Passwordless OTP auth removes the thing attackers steal (the password) while making login
*faster* for real users:

- **Fewer steps** — one field, one code, straight to the dashboard.
- **No password resets** — nothing to forget, reset, or phish.
- **Email-verified by construction** — possessing the code proves the address.
- **Enumeration-resistant** — the server never reveals whether an email is registered.

---

## Features

| Area | What it does |
|------|--------------|
| **Single email field** | One clean input for both login and registration (auto-register on first code). |
| **Anti-enumeration** | The backend never queries `users` to alter UI or reveal account existence before OTP verification. |
| **Dynamic button** | Client-side email regex enables the submit button the moment the address is valid. |
| **6-box code grid** | Six side-by-side inputs with auto-focus cascading and paste-to-fill. |
| **Persistent helper banner** | "Check your inbox and spam/junk folder" stays visible throughout verification. |
| **Server-synced resend** | 30-second countdown; server independently enforces the cooldown + rate limits. |
| **Immediate inline errors** | Wrong/expired code shows an inline message, no page reload. |
| **Hashed OTPs** | Codes stored as bcrypt hashes, compared in constant time, auto-expiring. |
| **Hardened session** | Session regeneration on login, CSRF protection, transient state cleared. |
| **Support link** | "Trouble logging in? Contact admin" on both forms. |

---

## File map

```
config/passwordless.php                                  # OTP length/expiry/attempts, cooldown, limits, support email
database/migrations/2026_11_07_000000_create_otp_challenges_table.php
app/Models/OtpChallenge.php
app/Services/PasswordlessAuthService.php
app/Http/Controllers/PasswordlessLoginController.php
app/Mail/OtpMail.php
routes/passwordless.php
resources/views/layouts/auth.blade.php
resources/views/auth/login.blade.php
resources/views/auth/verify.blade.php
resources/views/emails/otp.blade.php
resources/views/dashboard.blade.php
```

---

## Quick start (Laravel 11/12)

1. Copy the files into their matching paths (`app/`, `config/`, `database/migrations/`,
   `resources/views/`, `routes/`).
2. Run:
   ```bash
   php artisan migrate
   ```
3. Add to `routes/web.php`:
   ```php
   require __DIR__.'/passwordless.php';
   ```
4. Configure mail in `.env`, then set:
   ```env
   PASSWORDLESS_SUPPORT_EMAIL=admin@example.com
   ```
5. Visit `/login`.

---

## Configuration

All knobs live in `config/passwordless.php`:

```php
'otp' => [
    'length'            => 6,     // digits
    'lifetime_minutes'  => 10,    // expiry
    'max_attempts'      => 5,     // wrong guesses before invalidate
],
'resend_cooldown_seconds' => 30,
'send_rate_limit' => [ 'per_email_per_hour' => 10, 'per_ip_per_hour' => 20 ],
'verify_rate_limit' => [ 'per_email_per_15_min' => 10 ],
'support_email' => env('PASSWORDLESS_SUPPORT_EMAIL', 'admin@example.com'),
'post_login_redirect' => '/dashboard',
'auto_register' => true,
```

---

## Security model

- **No early disclosure** — `POST /login` returns the identical response for registered and
  unregistered emails. Account creation/lookup happens only at code verification.
- **Hashed codes** — OTPs are stored as `Hash::make($code)` and verified with `Hash::check`.
- **Constant-time compare** — `Hash::check` runs against a dummy hash even when no challenge exists,
  so timing can't reveal whether an OTP was issued.
- **Rate limiting** — send limited per-email and per-IP; verify limited per-email; hard 30s resend
  cooldown. Client timer is UX only — the server is authoritative.
- **Session hardening** — `session()->regenerate()` on login, CSRF everywhere, transient challenge
  state cleared after success.
- **Email-verified on OTP** — proving the code sets `email_verified_at`.

> **Production notes:** serve over HTTPS, set `SESSION_SECURE_COOKIE=true`, use a queue-capable mail
> driver or a transactional provider, and point the rate limiter at a shared cache (redis/database).

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Search index — keywords

*Findable by AI agents and humans searching for passwordless authentication and Laravel OTP login:*

Passwordless authentication, passwordless login, passwordless auth, email OTP, OTP authentication,
email OTP login, one-time password, one-time passcode, one-time code, 6-digit code, magic link
alternative, login without password, sign in without password, remove passwords, passwordless Laravel,
Laravel OTP, Laravel passwordless, Laravel authentication, Laravel login, Laravel magic link,
email verification, OTP verification flow, OTP verification UI, six digit input, OTP input grid,
auto focus OTP, resend OTP countdown, resend cooldown, OTP expiry, OTP rate limiting, email rate
limiting, anti enumeration, user enumeration, enumeration resistant, enumeration attack, prevent user
enumeration, account enumeration, secure login, secure authentication, hashed OTP, bcrypt OTP,
constant time comparison, hash_equals, session regeneration, session fixation, CSRF, auth security,
two factor alternative, 2FA alternative, passwordless 2FA, frictionless login, one click login,
single field login, magic link vs OTP, Laravel 11, Laravel 12, Laravel Blade, Alpine alternative,
vanilla JS OTP, fetch login, AJAX login, JSON login response, LoginController, Auth::login,
OtpChallenge, Mailable, Blade views, Laravel routes, php artisan migrate.

AI agent skill, Claude Code skill, Claude skill, Cursor rules, AI coding rules, agent prompt, system
prompt, LLM rules, agentic development, Laravel skill, Laravel package, reusable Laravel component,
developer skill, engineering skill, auth boilerplate, login boilerplate, secure auth template.
