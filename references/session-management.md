# Sessions, Devices & Login Duration

How long a sign-in lasts, what the user can see about it, and how it is revoked.

**Default: one year (365 days).** It is a policy value, not a constant scattered through the code.

---

## The precedence rule

```
effective days = clamp(user preference ?? admin default, admin min, admin max)
```

| Actor | Can do | Where |
|-------|--------|-------|
| Admin | Set the default, the minimum, and the maximum for the whole deployment | `PATCH /admin/settings` |
| Admin | Set one user's duration, overriding their preference | `PATCH /admin/users/:email/session-days` |
| User | Choose their own duration inside the band | `PATCH /profile/session-days` |
| Admin | Turn per-user choice off entirely (`allowUserOverride: false`) | `PATCH /admin/settings` |

Defaults: `defaultDays = 365`, `minDays = 1`, `maxDays = 365`, `allowUserOverride = true`,
`idleDays = null`.

**Changes apply to new sessions only.** A live session keeps the expiry it was issued with. This is the
predictable behaviour: an admin lowering the default must not silently log out a million people, and a
user raising it must not extend a session that was already compromised.

Validation is strict and server-side: whole days inside the hard limits, and `min ≤ default ≤ max`.
A policy that cannot be satisfied (default above max) is rejected instead of silently clamped.

Optional **idle timeout**: when `idleDays` is set, a session that has not been used for that many days
stops resolving. Off by default because it surprises users; recommended for admin accounts.

---

## The session record

```
sessions
  id                 public identifier (used by the UI to revoke)
  token_hash         sha256 of the opaque bearer token   ← the token itself is never stored
  email              account
  created_at         when it was issued
  expires_at         created_at + effective days
  last_seen_at       updated on use (throttle writes in a real store)
  ip, location       coarse, from the request
  user_agent, device_label
  methods            ["email_otp"], ["email_otp","totp"], ["biometric"]
  last_strong_auth_at  for step-up checks
  revoked_at, revoked_reason
```

Why hash the token: a database dump otherwise hands the attacker live sessions for every user. With a
hash, the attacker has nothing usable — the same reasoning as password hashing. Lookup hashes the
presented token and compares.

Revoked rows are **kept**, not deleted: the device list and the admin investigation view need the
history ("this device was signed out on 3 March").

---

## Device list and revocation

The profile shows every live session — device, coarse location, IP, signed in, last active — and marks
the current one. Each row can be signed out individually; one button signs out every other device.

- Revoking deletes the token index so the token stops resolving immediately (no waiting for expiry).
- Revoking the current session is allowed and behaves as logout.
- A user may not revoke a session belonging to another account — check ownership on the record, not
  only on the route (returns 404, not 403, so it does not confirm the session exists).
- `revokeAll` is called automatically on **email change** and on **admin 2FA reset**, keeping the actor's
  own session only in the first case.

---

## Interaction with the other auth paths

- **Email OTP** — a session is created only after the code (and the second factor, if enabled).
- **TOTP** — verified in a separate step; the session is created then, with `methods` recording both.
- **Biometric (Secure Enclave / Keystore)** — possession of the device key plus the biometric match is
  already two factors, so a biometric login satisfies MFA by itself. This is a deliberate, documented
  decision: forcing TOTP afterwards would remove the one-tap unlock the device key exists for. If your
  threat model disagrees, gate it in `finishLogin` like every other path — the code has a single place
  to do that.
- **Social login** — the callback must call the same session-issuing function. A social login is *not*
  a reason to skip the second factor; otherwise the weakest login path sets the account's security.

**Centralise issuance.** One function that (a) checks 2FA, (b) computes the duration, (c) creates the
session, and (d) writes the audit event. Every path calls it. This is the difference between a spec and
a system with one forgotten endpoint.

---

## Metadata and privacy

- IP and coarse location are **personal data**. Say so in the privacy policy, give a retention period
  (90 days is a common default for security logs), and show the user their own record.
- Location is coarse on purpose: a country code from a CDN header, or a city from a local GeoIP
  database. Do **not** silently send every user's IP to a third-party geolocation API from a helper
  function — that is an undisclosed data transfer. Make it a configured, documented provider.
- Behind a proxy, set `trust proxy` correctly or every session will show the load balancer's IP and
  rate limits will be shared by all users.

---

## Storage and transport

- **Native/SPA:** opaque bearer token over TLS, stored in memory; if you must persist it, use the
  platform keychain, not `localStorage` (XSS steals it).
- **Server-rendered web:** `HttpOnly; Secure; SameSite=Lax` cookie. Never expose the token to JavaScript.
- **The example** returns the token in JSON and keeps it in `sessionStorage` for simplicity — acceptable
  for a reference, not the recommendation for production.
- Session id regeneration on login is mandatory (fixation). With opaque tokens this means: always mint
  a new token, never reuse one.

---

## API

```jsonc
// user preference (null = follow the admin default)
PATCH /profile/session-days   { "days": 30 }          // 200 { ok, days, effectiveDays }
PATCH /profile/session-days   { "days": null }        // back to the default
                              // 403 when the admin disabled user choice
                              // 422 outside min..max

POST  /profile/sessions/:id/revoke                    // 200 { ok }
POST  /profile/sessions/revoke-others                 // 200 { ok, count }

// admin
PATCH  /admin/settings { "defaultDays": 365, "minDays": 1, "maxDays": 730,
                         "allowUserOverride": true, "idleDays": null }
PATCH  /admin/users/:email/session-days { "days": 90 } // or null
POST   /admin/users/:email/sessions/:id/revoke
```

Every mutation is audited with before/after values where it matters (policy changes) and with the
device that made the request.

---

## Checklist

- [ ] The default session is 365 days and comes from one policy object.
- [ ] Precedence is `user ?? admin default`, clamped to `min..max`, and validated server-side.
- [ ] Users can set their own duration; admins can set the default, the band, and any user's value.
- [ ] Policy changes affect new sessions only — no silent logouts or extensions.
- [ ] Session tokens are stored hashed; the raw token never touches the database.
- [ ] The profile lists live sessions with device, location, IP and timestamps, and can revoke any of them.
- [ ] Revocation invalidates the token immediately and keeps the row for history.
- [ ] Every login path (OTP, TOTP, biometric, social) issues sessions through one function.
- [ ] Email change and admin resets revoke the right sessions.
- [ ] IP/location collection is disclosed, coarse, and retention-limited.
