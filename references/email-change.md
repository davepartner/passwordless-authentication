# Changing the Login Email

In a passwordless system the login email **is the credential**. Changing it is closer to changing a
password than to editing a profile field, and must be treated that way.

---

## The rule

> The account address only changes when the user proves control of the **new** address, and the
> **old** address is told it happened.

Both halves matter. Verifying only the new address lets someone with a stolen session silently move an
account to an inbox they own. Verifying only the old address means a typo can strand an account on an
address nobody reads. So: a code to the **new** address, a notice to the **old** one.

---

## Flow

```
1. User (signed in) submits the new address
     POST /profile/email/request { newEmail, code? }
       - step-up: if 2FA is on, a current TOTP/recovery code is required
       - the new address must be valid, different, and not already registered
       - one pending request per account (a new request replaces the old one)
       - code → NEW address (8 digits, hashed, 10 min, 5 attempts)
       - notice → OLD address: "a change was requested, if this wasn't you …"
2. User enters the code
     POST /profile/email/confirm { code }
       - constant-time compare, expiry, attempt limit
       - re-check the new address is still free (a race is possible and must be handled)
       - rename the account, keep the old address in history
       - revoke every session except the current one, then rotate the current token
       - audit `email.changed`, notice → OLD address
```

Cancel at any time with `POST /profile/email/cancel`.

---

## Why each step exists

| Control | Stops |
|---------|-------|
| Code to the **new** address | Moving an account to an inbox the requester does not control (typo, stolen session) |
| Notice to the **old** address | Silent takeover — the real owner gets an out-of-band signal |
| Step-up (TOTP when enabled) | A stolen session alone being enough to redirect the account |
| Session revocation + token rotation | The thief's session surviving the change |
| Re-check at confirm | Registering the address in the gap between request and confirm |
| Attempt limit + cooldown | Guessing the code; using the endpoint as a mail cannon |
| Generic "cannot be used" message | Turning an authenticated endpoint into an account-enumeration oracle |

---

## Enumeration

The endpoint is authenticated, so a probe already has an account — but that account can still be used
to test whether other addresses are registered. Do **not** answer "that email is already registered".
Use one message: **"That address cannot be used for this account."** It covers "taken", "blocked",
"reserved" and "internal" without confirming anything.

The same rule applies to the confirm step: if the address was taken in the meantime, return the same
message, not a different one.

---

## Session handling

An email change invalidates the old credential. Treat it exactly like that:

1. Move the session records to the new address (they belong to the same account).
2. **Revoke every other session** — a device the user forgot about must not keep access through an
   identity change.
3. **Rotate the current session token** and return the new one, so any copy of the old token is dead.
4. Never leave a session whose `email` still points at the old address.

---

## Data model

```
users
  email                current login address
  email_verified_at    set when the code is proven
  previous_emails      newest first, capped (e.g. 20) — shown to the user and to admins

email_change_requests
  id, user_email, new_email, code_hash, created_at, expires_at,
  attempts, consumed_at, ip, location, user_agent
```

Keep `previous_emails` on the account and write **two** audit events (`email.change_requested`,
`email.changed`) with `actor = old`, `target = new`, and a `meta` block carrying both. That way the
change appears in the user's own history *and* in the admin's investigation view without duplicating
rows.

---

## API

```jsonc
POST /profile/email/request { "newEmail": "new@example.com", "code": "123456" }  // code only if 2FA is on
// 200 { ok: true, pending: "new@example.com", expiresAt: 1700000000000 }
// 422 { ok: false, error: "That address cannot be used for this account." }
// 429 rate limited

POST /profile/email/confirm { "code": "12345678" }
// 200 { ok: true, email: "new@example.com", sessionToken: "<rotated>", sessionDays: 365 }
// 422 { ok: false, error: "The code is invalid or has expired." }

POST /profile/email/cancel    // 200 { ok: true }
```

Rate limit the **request** endpoint per account (e.g. 5 per hour) — it sends mail to an address the
requester chooses, which is exactly the shape of a mail-bombing primitive.

---

## UX

- Put the current address and its verified state at the top of the profile, not buried in a form.
- Show the pending change explicitly: *"Waiting for confirmation: new@example.com — a code was sent
  there, expires in 10 minutes"*, with Confirm and Cancel next to it.
- Warn before sending: "all other devices will be signed out when this completes."
- Never echo a partial address of *another* account.
- After the change, keep the session working (the rotated token) so the user is not bounced to sign-in
  for a normal profile action.

---

## Checklist

- [ ] A code goes to the new address; a notice goes to the old one.
- [ ] The request endpoint is authenticated, rate-limited, and step-up protected when 2FA is on.
- [ ] One pending request per account; a new request supersedes the previous one.
- [ ] Confirmation re-checks that the new address is still available.
- [ ] Old address kept in `previous_emails`; the change is audited at request and confirm.
- [ ] Other sessions are revoked and the current token is rotated.
- [ ] "Already registered" is never distinguished from other refusals.
