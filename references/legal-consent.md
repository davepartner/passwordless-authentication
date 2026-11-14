# Legal Acceptance — Terms of Service & Privacy Policy Checkboxes

Registration must capture agreement to the **Terms of Service** and **Privacy Policy**, and both
links must open documents a user can actually read. This reference specifies where acceptance is
captured in a passwordless flow, what the UI must do, what the server must enforce, how acceptance
is versioned and evidenced, and what the two documents have to contain.

---

## Where acceptance happens (and why it is not a second form)

Registration here is **implicit** — the account is created on the first successful code — and the
`request` step deliberately performs **no user lookup** (see `security-rules.md`, rule 1). So you
cannot ask "is this a new user?" before sending the code without leaking account existence.

That leaves one correct placement:

```
sign-in / sign-up screen
  email  +  [x] I agree to the Terms of Service
         +  [x] I have read and accept the Privacy Policy
        ↓
POST /auth/otp/request { email, acceptedTerms, acceptedPrivacy }
        ↓  consent validated, then stored ON THE CHALLENGE (not on a user)
        ↓
POST /auth/otp/verify  { requestId, code }
        ↓  account created → consent written to the user record
```

- The boxes are shown on the **single entry screen**, which is both sign-in and sign-up.
- Acceptance is **validated before any code is sent** — no email goes out without it.
- The accepted record rides on the challenge and is **only persisted when an account is created**
  (or when an existing user re-accepts a newer version). Returning users therefore do not
  accumulate duplicate consent rows.
- If your product genuinely has a separate **"Create account"** screen, put the boxes there and keep
  the same endpoint contract; both entry points still call `request`, so enumeration safety holds.

---

## UI rules (non-negotiable)

1. **Two separate checkboxes**, one per document. A single "I agree to the Terms and Privacy Policy"
   box conflates two different things (a contract and a data-protection notice) and is harder to
   evidence.
2. **Pre-checked by default.** Both boxes render `checked` on first paint. This is a deliberate
   product decision (fewer steps), and it is recorded here so it is not mistaken for an oversight.
   Read the caveat below before relying on it.
3. **Labels are links to the real documents.** The document name in each label is an anchor
   (`<a href="/terms">`, `<a href="/privacy">`), opened in a new tab so a half-typed form is not
   lost. Every page must return `200` — never a 404, a `#` placeholder, or an unrelated policy.
4. **Still required.** Unchecking either box disables submit **and** the server rejects the request.
   The pre-checked default is a UI affordance; the server-side requirement is what makes the record
   meaningful.
5. **Explain the refusal.** When a box is unchecked, say what is missing — "Please accept the Terms
   of Service and Privacy Policy to continue." Do not fail silently.
6. **Never pre-check optional consent.** Marketing email, analytics cookies, or "share my data with
   partners" must be separate, **unchecked**, and genuinely optional. Pre-ticking those is unlawful
   in the EU/UK and defeats the point of consent. Only the two acceptance boxes described here are
   pre-checked.
7. **Accessibility.** Each checkbox has a real `<label for>`; the label text is the accessible name;
   the linked document names are part of that name (screen readers announce "I agree to the Terms of
   Service, link"). Hit target ≥ 44px, visible `:focus-visible` ring, and the error container uses
   `role="alert"`.
8. **Both documents stay reachable after sign-up** — footer links on every page, plus a dedicated
   legal section in account settings.

> ### Caveat on pre-checked boxes
> Pre-ticked boxes are **not valid consent** for optional processing under GDPR/UK GDPR (CJEU
> *Planet49*, C-673/17) and are treated as a dark pattern by the EDPB and by many consumer
> regulators. They are conventionally accepted for **contract acceptance** (agreeing to Terms), which
> is what these two boxes capture — but the record must show the user could see the boxes, the
> version they agreed to, and when. Two things keep this defensible:
> **the boxes are visible and uncheckable**, and **the server stores version + timestamp + the
> checkbox state** rather than assuming agreement. If your product targets consumers in the EU/UK and
> your legal team is uncomfortable, uncheck them by default — the rest of this spec is unchanged.

---

## API contract changes

### `POST /auth/otp/request`

```jsonc
// request
{
  "email": "user@example.com",
  "acceptedTerms": true,     // required, explicit true
  "acceptedPrivacy": true    // required, explicit true
}

// rejected — nothing is sent
{ "ok": false, "error": "Please accept the Terms of Service and Privacy Policy to continue.",
  "field": "consent" }        // HTTP 422

// accepted — identical response to today's contract (no enumeration signal)
{ "ok": true, "requestId": "<opaque id>", "resend_after": 30,
  "message": "If that address is registered, a code is on its way." }
```

- Accept `true` (or the HTML form values `"on"` / `"true"`). Reject everything else — including
  `"yes"`, `1`, and a missing key. Do not coerce falsy values.
- Validate consent **after** email syntax and **before** rate limiting and code issuance, so a
  rejected request never sends mail and never consumes a send budget.

### `POST /auth/otp/verify`

The success response gains two optional flags:

```jsonc
{ "ok": true, "redirect": "/dashboard", "isNewUser": true,
  "reconsented": true,       // this login re-accepted a newer version
  "requiresConsent": true    // (only when) the stored acceptance is stale — show the step again
}
```

`requiresConsent` is the version-bump hook: the user still gets a session for the code they proved,
but the client must present the acceptance step before continuing (and the server refuses writes
that require current acceptance until it is recorded).

---

## Data model

```
otp_challenges                        -- consent in flight, never the account store
  …
  terms_version        string (nullable)      -- version accepted at request time
  terms_accepted_at    timestamp (nullable)
  privacy_version      string (nullable)
  privacy_accepted_at  timestamp (nullable)

users
  …
  terms_version        string (nullable)
  terms_accepted_at    timestamp (nullable)
  privacy_version      string (nullable)
  privacy_accepted_at  timestamp (nullable)
  consent_source       string  -- "signup" | "login" | "settings" (optional but useful)
  consent_ip           inet    -- optional; keep within your stated retention window
```

Design notes:

- **Immutable facts, not a boolean.** Store *which version* was accepted and *when*. A single
  `accepted_terms = true` cannot answer "what did they agree to?" after the text changes.
- **Preserve the first accept time.** Re-accepting the *same* version must not overwrite
  `*_accepted_at` on every login, or the audit trail degrades into "last seen". Only a version change
  stamps a new time.
- **Keep an append-only consent log** (`consent_events`: email, document, version, accepted_at, ip,
  user agent) if you need to prove historical acceptance. The user row holds only the current state.
- **Retention.** Consent records are evidence — keep them for as long as the account exists plus the
  limitation period that applies to you, and say so in the Privacy Policy. Do not fold them into the
  OTP retention purge.

---

## Versioning and re-acceptance

1. Give each document a **version** (`MAJOR.MINOR.PATCH`) and an **effective date**, printed on the
   page. Bump `MAJOR` for changes that materially affect rights or data use.
2. The server is the source of truth for the current version; the UI must not hardcode it.
3. On `verify`, compare the user's stored versions with the current ones:
   - equal → nothing to do;
   - stale and a fresh acceptance arrived on this challenge → record it, return `reconsented: true`;
   - stale and no acceptance arrived → return `requiresConsent: true` and gate sensitive actions.
4. When you bump a version, **tell users before it takes effect** (email + in-app notice) and let
   them export their data and close the account if they decline.
5. Changing a typo = patch bump, no re-acceptance. Changing what data you collect or who you share
   it with = major bump, always re-accept.

---

## The documents themselves

**A checkbox may only point at a page that exists.** If the app has no Terms of Service or Privacy
Policy, write them before shipping the checkbox — not after. Do not link to a generic third-party
template you have not adopted, and never to `/privacy` returning a 404.

### How to write them for the app in front of you

1. **Read the app, then write down what it actually does**: what it collects, where it stores it, who
   receives it, how long it keeps it, who operates it, how a user deletes their data, and which law
   applies. The documents are a description of *this* system, not boilerplate.
2. **Fill in the operator block**: legal entity, address, contact email for legal and privacy, and
   governing law. One constant per value, in one place, so nothing is missed.
3. **Name the technology honestly**: for this skill's flow that means one-time codes, hashed code
   storage, IP + timestamps for rate limiting, session records, device public keys for biometric
   unlock, provider identity for social login, and the consent record itself.
4. **State what you do not collect** — no passwords, no raw codes, no biometric data, no ad trackers.
   It is the most reassuring part of the policy and it is true by construction here.
5. **Give a retention period per category** and align it with the purge job in `security-rules.md`.
6. **Have counsel review** before launch, and re-review whenever the data flow changes.

### Minimum contents

| Terms of Service | Privacy Policy |
|------------------|----------------|
| Parties, effective date, version | Controller identity + contact |
| Eligibility (age) | Categories of data, purpose, legal basis |
| What the service does, account responsibilities | Retention per category |
| Acceptable use (no enumeration, no brute force) | Processors / sharing / transfers |
| Third-party sign-in and who governs it | Security measures |
| Biometric unlock (device-local, revocable) | User rights + how to exercise them |
| IP ownership and licence | Cookies / local storage |
| Availability and changes | Children's data |
| Disclaimers and limitation of liability | Automated email, changes, complaints |
| Termination, governing law, contact | Effective date, version, contact |

A complete, working example of both documents — written for exactly this app, with the operator
details isolated at the top of the file — is `examples/node-express/src/legal-pages.ts`, served at
`GET /terms` and `GET /privacy`. The pre-checked form that links to them is
`examples/node-express/src/views.ts` at `GET /sign-in`. Adapt the text; keep the structure.

---

## Checklist

- [ ] Both checkboxes exist, are separate, and are **checked by default**.
- [ ] Both labels link to pages that return `200` and are the app's own documents.
- [ ] The documents name the real operator, an effective date, and a version.
- [ ] Unchecking either box disables submit and produces a clear message.
- [ ] `POST /auth/otp/request` rejects missing/false acceptance with `422` **before** sending mail.
- [ ] Acceptance is stored on the challenge and persisted only at account creation.
- [ ] The user record stores *version + timestamp* for each document, not a boolean.
- [ ] Re-accepting the same version does not overwrite the original timestamp.
- [ ] A version bump produces `requiresConsent` / `reconsented` on the next login.
- [ ] Optional consent (marketing, analytics) is separate and **not** pre-checked.
- [ ] Both links are reachable from the footer and from account settings after sign-up.
- [ ] The Privacy Policy's retention table matches the actual purge schedule.
