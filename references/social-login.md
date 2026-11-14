# Social Login (OAuth 2.0 / OpenID Connect)

Add **"Continue with Google / GitHub / LinkedIn / …"** to the same auth system. Social login delegates
authentication to an identity provider (IdP); your app verifies what it receives **server-side** and
then creates or links its own local account.

This is the third entry method, alongside email OTP (universal fallback) and Face ID (mobile re-auth).

---

## Principle

> **The provider authenticates the user; your app verifies the assertion, then maps it to a local account.**

The app never sees the user's social password. It receives either:

- an **ID token** (OpenID Connect — Google, LinkedIn, Apple, Microsoft), a signed JWT you verify, or
- an **access token** (plain OAuth 2.0 — GitHub), which you use to fetch the profile over the provider's
  API.

In both cases the app must **verify claims server-side** (never trust the client) and then
find-or-create the local user, linking the social identity to it.

---

## The flow (Authorization Code + PKCE)

```
Browser/App                       Your server                        Provider (Google/GitHub/LinkedIn)
  │  "Continue with Google"          │                                    │
  │ ───────────────────────────────▶ │ build authorize URL               │
  │ ◀── 302 to provider ──────────── │  (state, nonce, code_challenge)   │
  │ ───────────────────────────────────────────────────────────────────▶ │ user authenticates + consents
  │ ◀── 302 back ?code&state ──────────────────────────────────────────── │
  │  GET /callback?code&state        │                                    │
  │ ───────────────────────────────▶ │ verify state                       │
  │                                  │ exchange code + code_verifier → tokens
  │                                  │ verify ID token (or fetch profile) │
  │                                  │ normalize → find-or-create → link  │
  │                                  │ establish session                  │
  │ ◀── 302 to dashboard/profile ─── │                                    │
```

1. **Start** — the user clicks a provider button. Your server builds the provider's authorize URL with
   `client_id`, `redirect_uri`, `scope`, a random **`state`** (CSRF), a **`nonce`** (OIDC, replay), and a
   **`code_challenge`** (PKCE), then redirects.
2. **Authenticate** — the user signs in and consents at the provider.
3. **Callback** — the provider redirects back with `code` + `state`. Your server **verifies `state`**,
   exchanges `code` + `code_verifier` for tokens, then verifies the **ID token** (OIDC) or fetches the
   profile (OAuth2).
4. **Reconcile** — normalize to a `SocialIdentity`, then find-or-create the local account and establish
   the session. First-time accounts go through the same profile-completion flow.

---

## Security rules (non-negotiable)

1. **Authorization Code + PKCE only.** No implicit flow, no client secret in the browser, and never
   trust an ID token or profile the client forwards without server-side verification.
2. **Verify the ID token server-side:** signature (JWKS), `iss` (provider), `aud` (your client id),
   `exp`/`nbf`, and `nonce`. Verify `state` on the callback to bind it to the originating request.
3. **Only trust a *verified* email.** Link on email only when the provider asserts `email_verified`
   (OIDC) or `verified` (GitHub). An unverified email must **never** link to an existing account.
4. **Account linking is an account-takeover surface.** A provider that lets a user choose an arbitrary
   email must not be able to hijack an existing account through it. Link by the provider's `sub`
   (unique user id) first; link by verified email only when it matches an existing account; never link
   by unverified email.
5. **Store only what you need.** Persist `provider` + `sub` (+ verified email, name, avatar). Encrypt
   any access/refresh token you keep, and only if you act on the user's behalf. Never log tokens.
6. **Same session hardening** as the rest of the system — regenerate session id, secure cookies or
   short-lived signed tokens, CSRF protection.
7. **Keep responses uniform** — avoid revealing whether a social email already has an account.

---

## Provider matrix

| Provider | Protocol | Discovery | Verified email source |
|----------|----------|-----------|-----------------------|
| **Google** | OIDC | `https://accounts.google.com/.well-known/openid-configuration` | ID token `email` + `email_verified` |
| **LinkedIn** | OIDC | `https://www.linkedin.com/oauth/.well-known/openid-configuration` | ID token `email` + `email_verified` (scope `openid profile email`) |
| **GitHub** | OAuth 2.0 (no ID token) | fixed endpoints | `GET /user` + `GET /user/emails`, pick a `primary` + `verified` email |
| **Apple** | OIDC | `https://appleid.apple.com/.well-known/openid-configuration` | ID token `email` + `email_verified` |
| **Microsoft (Entra)** | OIDC | tenant or `common` discovery | ID token `email`/`preferred_username` + `email_verified` |

**Generic rule:** OIDC provider → use discovery + verify the ID token. OAuth2-only provider (GitHub) →
exchange the code, fetch the profile **and** the emails list, and require the `verified` flag.

---

## Data model

```
social_identities
  id
  user_id            (FK → local user; null until linked)
  provider           (google | github | linkedin | …)
  provider_user_id   (the provider's sub / numeric id)
  email              (as asserted by the provider)
  email_verified     (bool)
  name
  avatar_url
  access_token       (encrypted, optional — only if acting on the user's behalf)
  refresh_token      (encrypted, optional)
  created_at
```

Unique index on `(provider, provider_user_id)`. Optionally a non-unique index on `email` for
verified-email linking.

---

## Account linking decision (the critical logic)

Given a normalized identity, reconcile against the local store:

1. `provider_user_id` already linked → **log in** to that account (no duplicate).
2. Email is **verified** and matches an existing account → **link** the identity to it.
3. Email is **verified** and matches nothing → **create** a new account (→ profile completion).
4. Email is **missing or unverified** → **do not link**; require email verification (via the email OTP
   path) before proceeding.

Never fall through to linking on an unverified email.

---

## API endpoints (illustrative)

- `GET /auth/social/:provider` — build + redirect to the authorize URL (`state`, `nonce`, PKCE).
- `GET /auth/social/:provider/callback` — handle `code` + `state`, verify, reconcile, establish session,
  redirect (`/dashboard`, or `/profile` for a first-time account).

---

## Edge cases

| Case | Behaviour |
|------|-----------|
| Provider email unverified | Do not link; require verification (email OTP) before creating/linking. |
| Same verified email, different provider | Link both identities to the same local account. |
| `provider_user_id` already linked | Log into the linked account — no duplicate. |
| `state` or `nonce` mismatch | Abort (CSRF / replay). |
| ID token expired / wrong `iss` / wrong `aud` | Abort. |
| Provider returns no email | Require the user to supply + verify one (email OTP). |

---

## When to use / not

- **Use** for consumer apps that want one-tap onboarding alongside email OTP.
- **Do not** rely on it as the only method — some users have no social account (or don't trust one);
  keep email OTP as the fallback, and keep WebAuthn/passkeys for high-assurance contexts.
