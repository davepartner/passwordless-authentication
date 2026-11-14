# Admin Console & Audit Log

Admins need to investigate an account — devices, sign-in history, email changes, 2FA state — and to set
the session policy. That access is powerful and must itself be controlled and recorded.

---

## Roles and bootstrap

- `users.role`: `'user'` | `'admin'`. Authorization reads the **stored role**, not a client claim.
- Bootstrap with an environment allowlist (`ADMIN_EMAILS=ops@example.com,security@example.com`) applied
  at account creation, so the first admin exists without a migration. An env-listed address is treated
  as admin even if the row predates the role column.
- **No endpoint grants a role.** Admin promotion is a deployment/database action, not an API call.
- Consider requiring 2FA for admin accounts (`require2faForAdmins`), and give them a shorter session
  duration than end users — an admin session is worth more to an attacker.

Every admin request goes through one guard:

```
requireAdmin(req):
  session = requireSession(req)          # 401 if not signed in
  user    = load(session.email)          # role OR env allowlist
  reject 403 unless admin
  return session
```

Return `403` for a signed-in non-admin and `401` for no session; do not reveal whether the *route*
exists to anonymous callers.

---

## What an admin can do

| Endpoint | Purpose |
|----------|---------|
| `GET /admin` | Policy settings + user directory (role, 2FA, live device count, last active, joined) |
| `GET /admin/users/:email` | One account: sessions (including revoked), login history, email-change log, 2FA state |
| `PATCH /admin/settings` | Default/min/max session days, per-user override, idle timeout |
| `PATCH /admin/users/:email/session-days` | Per-user duration override (or clear it) |
| `POST /admin/users/:email/sessions/:id/revoke` | Sign a specific device out |
| `POST /admin/users/:email/2fa/reset` | Emergency 2FA removal after out-of-band identity verification |

What an admin must **not** be able to do through the console: read a session token, read a TOTP secret
or recovery code, grant themselves a role, or change a login address directly. Those are either
secrets or actions that must go through the user's own verified flow.

Resetting 2FA **revokes that user's sessions**, because removing a factor changes who can get in.

---

## The audit log

Append-only. Request handlers only add; they never edit or delete. Retention is a scheduled job.

```
audit_events
  id, at
  actor          who did it (email, or 'anonymous')
  target         whose account it affects        ← what users and admins filter on
  action         enumerated string               ← never free text
  outcome        success | failure
  ip, location, user_agent, device_label
  meta           small JSON: versions, session ids, reason — never secrets or codes
```

### What must be recorded

- `login.succeeded` / `login.failed` / `login.2fa_required` / `login.2fa_failed`
- `logout`, `session.revoked`, `session.revoke_all`, `session.duration_changed`
- `twofactor.enabled` / `disabled` / `recovery_regenerated` / `enroll_started`
- `email.change_requested` / `email.changed` / `email.change_cancelled`
- `admin.policy_changed`, `admin.user_viewed`, `admin.user_session_revoked`,
  `admin.user_session_days_changed`, `admin.twofactor_reset`
- `admin.user_viewed` matters: reading a user's history is itself a privacy-relevant event.

Never log: raw OTP codes, TOTP secrets, recovery codes, session tokens, full request bodies.

### Who sees what

- **The user** sees their own slice: sign-ins (device, location, time) and the security changes they
  made — including login-email changes. Two filters over the same table, not two copies of the data.
- **The admin** sees the same rows for the account they opened, plus revoked sessions and the email
  change log. Listing *all* of a user's events is a legitimate investigation view, but it is audited.

### Tamper evidence

In production, ship events to append-only storage (Postgres with `REVOKE UPDATE, DELETE`, an object-lock
bucket, or a log pipeline) and include a monotonically increasing sequence per account so a deletion is
detectable. The in-memory array in the example is the shape, not the durability.

---

## UI conventions

- One page for policy, one table for users — the admin should not need to know routes.
- A user page is a **read view plus a small number of dangerous actions**, each behind an explicit
  confirmation ("Only after verifying their identity").
- Show counts and states, not raw JSON: `2FA on`, `3 devices`, `last active 2 hours ago`.
- On the user's own profile, the same device/history components, minus admin-only columns.
- Timezones: render machine times as `<time datetime data-ts>` and format locally in the browser.

---

## API surface

```
GET   /admin[?q=]                                  HTML
GET   /admin/users/:email                          HTML
PATCH /admin/settings                              JSON
PATCH /admin/users/:email/session-days             JSON
POST  /admin/users/:email/sessions/:id/revoke      JSON
POST  /admin/users/:email/2fa/reset                JSON
```

Do not build a JSON API for the admin console unless a separate admin client needs it — every added
endpoint is another authorization surface to get right.

---

## Checklist

- [ ] Roles live in the store; bootstrap from env; no endpoint grants a role.
- [ ] One `requireAdmin` guard; `401` vs `403` distinguished; no leakage to anonymous callers.
- [ ] Admin mutations are audited with actor, target, device and before/after values.
- [ ] Viewing a user's record is audited (`admin.user_viewed`).
- [ ] 2FA reset requires out-of-band verification and revokes the user's sessions.
- [ ] Admins cannot read tokens, TOTP secrets, or recovery codes.
- [ ] The user sees their own login history and email-change log on the profile.
- [ ] The log is append-only in production and has a retention policy that matches the Privacy Policy.
- [ ] Session policy changes state their scope ("new sessions only") in the UI.
