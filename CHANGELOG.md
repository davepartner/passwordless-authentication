# Changelog

All notable changes to this skill. Pin by tag/commit when consuming.

## [Unreleased]

### Changes
- **Terms of Service + Privacy Policy acceptance at registration.** Two separate, pre-checked
  checkboxes on the entry screen, each linking to a real, served, versioned document. Acceptance is
  validated server-side (422 + no email when missing), carried on the challenge, and persisted to the
  account as **version + timestamp**. New `references/legal-consent.md`, plus real `/terms` and
  `/privacy` pages and a `/sign-in` form in the Node example, with tests.
- **OTP length raised to 8 digits** (default) for higher assurance.
- **First-login profile completion** — a brand-new registration is redirected to profile edit with a
  welcome flash message (registration only collects email).
- **Social login (OAuth/OIDC)** — Google, GitHub, LinkedIn with Authorization Code + PKCE, server-side
  ID-token verification, and verified-email-only account linking.

### Security fixes (from the initial review)
- **Challenges are now keyed by `requestId` (not email).** Requesting a code for an email no longer
  invalidates that email's in-flight challenge — removes the login-DoS vector.
- **Biometric enrollment now requires an authenticated session** (spec *and* example).
- **Sessions are real expiring/revocable opaque tokens** in the example (were bare random hex in JSON).
- **Verify rate limiting counts failures only** — successful logins no longer consume the budget.
- **OTP logging removed** from the example (`issueAndSend` no longer logs the code).
- **Memory leaks fixed** in the example rate limiter (empty-bucket eviction).
- **Example added input validation** (6-digit code) and security headers.

### Documentation / spec additions
- Added a **threat model** (what each control defends against).
- Added **sender auth (SPF/DKIM/DMARC)**, **bounce-handling enumeration**, **retention/PII (GDPR)**,
  and **email canonicalization** guidance.
- Added **OTP length-by-assurance** guidance and an **explicit phishing non-goal** (use WebAuthn/passkeys).
- Added **device lifecycle & revocation** and **identifier discovery** to the biometric guide.
- Softened the 6-box input mandate to "single `one-time-code` field preferred".
- Added a **"When NOT to use"** section and a **versioning** note.

## [0.1.0] — initial release
- Platform-agnostic email OTP spec + references + Node/Swift/Kotlin examples.
