---
name: passwordless-authentication
description: >-
  Build a secure, frictionless, enumeration-resistant passwordless email OTP authentication system
  in Laravel. Use when adding "login without a password", "magic OTP login", "email OTP sign-in",
  "passwordless auth", "one-time code login", or an "OTP verification flow" to a Laravel app.
  Delivers a single email entry field, a 6-digit code grid with auto-focus cascading, a
  server-synced resend countdown, persistent "check spam" guidance, immediate inline errors, and
  full anti-user-enumeration logic with hashed OTPs and rate limiting. Triggers: "passwordless
  login", "email OTP", "one-time passcode", "login with a code", "remove passwords", "magic link
  alternative", "OTP authentication", "user enumeration resistant login".
---

# Passwordless Email OTP Authentication — Laravel Skill

Add frictionless, passwordless sign-in to any Laravel application. Users enter **one email**, receive
a **6-digit one-time code**, and are signed in (or auto-registered) with no password and no exposed
"does this email exist?" signal.

This skill ships the **complete, production-ready implementation**: models, migrations, controllers,
service layer, mail, routes, Blade views, and client-side behaviour — plus the security and UX rules
an agent must preserve when adapting it.

---

## Architecture at a glance

```
email ──▶ POST /login ──▶ issue + email OTP (no user lookup → enumeration-safe)
                              └─▶ GET /login/verify  (6-box grid, countdown, banner)
                                       └─▶ POST /login/verify ──▶ verify code → find-or-create user → login
```

- **Entry** (`GET/POST /login`): a single email field. The backend never queries `users` to alter
  the UI or reveal whether the address exists.
- **Verify** (`GET /login/verify`, `POST /login/verify`): six single-digit boxes, auto-focus cascade,
  a persistent "check inbox *and* spam" banner, a 30-second server-synced resend countdown, and
  inline (no-reload) error feedback.
- **Success**: authenticate, regenerate the session, clear transient state, redirect to the dashboard.

---

## Security rules (non-negotiable)

1. **No enumeration at send time.** `POST /login` issues an OTP and returns an identical response
   whether or not the account exists. Account creation/lookup happens only at verification.
2. **Hash the OTP.** Never store the code in plaintext. Store `Hash::make($code)` (bcrypt) and verify
   with `Hash::check`.
3. **Constant-time comparison.** Always run `Hash::check` — even when no challenge exists — against a
   dummy hash, so response timing cannot reveal whether an OTP was issued.
4. **Expiry.** OTPs expire (default 10 minutes). Expired challenges are deleted.
5. **Attempt limits.** A challenge is invalidated after a small number of wrong guesses (default 5).
6. **Rate limiting.** Server-side limits on send (per email + per IP) and on verify (per email), plus
   a hard 30-second resend cooldown. Never trust the client timer alone.
7. **Session hardening.** `Auth::login()` + `$request->session()->regenerate()` on success; CSRF via
   `@csrf`; transient challenge state cleared after login.
8. **Email verified on OTP.** Proving possession of the code marks `email_verified_at` — no separate
   verification step.

---

## UX rules (non-negotiable)

1. **Single field entry** — one clean email input, no password field, no name field up front.
2. **Dynamic button** — client-side regex validation enables the submit button the instant the email
   is syntactically valid. No dead disabled state without a visible hint.
3. **6-box code grid** — six side-by-side inputs with auto-focus cascading and paste-to-fill.
4. **Persistent helper banner** — "Check your inbox and spam/junk folder" stays visible for the whole
   verification step.
5. **Server-synced resend** — a 30-second countdown; the resend button is disabled until zero, and the
   server independently enforces the cooldown.
6. **Inline errors** — invalid/expired code shows an immediate inline message, no page reload.
7. **Support link** — "Trouble logging in? Contact admin" at the base of both forms.
8. **Satisfying success** — direct redirect to the dashboard, no intermediate screens.

---

## File map

```
config/passwordless.php                                  # OTP length/expiry/attempts, cooldown, limits, support email
database/migrations/2026_11_07_000000_create_otp_challenges_table.php
app/Models/OtpChallenge.php                              # Eloquent model (hashed code, expiry, attempts)
app/Services/PasswordlessAuthService.php                 # generate / issue / verify / resolve-user
app/Http/Controllers/PasswordlessLoginController.php     # routes → actions, rate limiting, JSON responses
app/Mail/OtpMail.php                                     # mailable (subject + shared code)
routes/passwordless.php                                  # named routes (guest + auth groups)
resources/views/layouts/auth.blade.php                   # shared auth layout + stylesheet + csrf meta
resources/views/auth/login.blade.php                     # single-field entry
resources/views/auth/verify.blade.php                    # 6-box grid + countdown + banner + inline errors
resources/views/emails/otp.blade.php                     # the code email
resources/views/dashboard.blade.php                      # example post-login target
```

---

## Install (drop into a Laravel 11/12 app)

1. Copy the files into their matching paths (`app/`, `config/`, `database/migrations/`,
   `resources/views/`, `routes/`).
2. Run `php artisan migrate` to create the `otp_challenges` table.
3. Load the routes: add this line to the top of `routes/web.php`:
   ```php
   require __DIR__.'/passwordless.php';
   ```
4. Configure your mail driver in `.env` (`MAIL_MAILER=...`), and set the support email:
   ```env
   PASSWORDLESS_SUPPORT_EMAIL=admin@example.com
   ```
5. Ensure `App\Models\User` allows `email_verified_at` to be written (the service uses `forceFill`,
   so no `$fillable` change is required) and that your `users` table has an `email_verified_at`
   column (Laravel's default migration includes it).

> **Rate limiter cache:** the built-in `RateLimiter` uses the default cache driver. Ensure your cache
> store (e.g. `database`/`redis`) is configured for accurate, shared limits in production.

---

## Adapting the skill

- **Change OTP length / expiry / attempts / cooldown:** edit `config/passwordless.php`.
- **Disable auto-registration** (require pre-existing accounts): set `auto_register => false`.
- **Change the post-login destination:** set `post_login_redirect`.
- **Use a notification instead of a mailable:** swap `OtpMail` for an `OtpNotification` — keep the
  same "hash the code, never log it" rules.

**Never** revert any of the eight security rules or the "no early database disclosure" rule while
adapting — those are what make the system safe.

---

## Verification checklist (before you finish)

- [ ] `POST /login` returns the same response for existing and non-existing emails.
- [ ] OTP is stored hashed; the raw code never appears in logs, responses, or the database.
- [ ] Wrong code → inline error, no reload; attempts increment; challenge invalidated at the limit.
- [ ] Resend is blocked client-side for 30s **and** server-side until the cooldown elapses.
- [ ] Successful login regenerates the session and clears transient challenge state.
- [ ] The "check inbox and spam" banner and the support link are present on both forms.
