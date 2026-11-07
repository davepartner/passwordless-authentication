# Biometric (Face ID / Touch ID) Login for Mobile

An optional layer that makes login a **one-tap unlock** on a trusted device, on top of the email OTP
as the primary/universal method. Applies to iOS and Android native apps.

---

## The core principle

> **Biometrics authenticate the user to the *device*, never to the server.**

The device proves possession of a **device-bound private key** — stored in the Secure Enclave (iOS)
or the Android Keystore, and gated by biometric authentication — by signing a server challenge. The
server verifies the signature against the **public key** enrolled during a prior login.

Consequences:

- The server never sees a face scan or fingerprint. Face ID happens entirely on-device.
- The private key never leaves secure hardware (it cannot be extracted, even by a rooted/jailbroken
  process, in the common case).
- A stolen user database leaks only **public keys**, which are useless for impersonation.
- This is the same model as **FIDO2 / WebAuthn passkeys**, expressed natively.

---

## Why pair it with email OTP

| Method | Role |
|--------|------|
| **Email OTP** | Primary, universal sign-in. Works everywhere, first login, recovery. |
| **Biometric** | Frictionless re-auth on a device the user has already trusted. |

The first OTP login **enrolls the device**; every login after that is Face ID. If biometrics fail or
the device is new, fall back to the OTP.

---

## Enrollment (once, after an OTP login)

1. The app is already authenticated (via OTP).
2. Server issues an **enrollment challenge** (random nonce) — proves the request is fresh and bound to
   the authenticated session.
3. The app generates an **asymmetric keypair** (ECDSA P-256 recommended):
   - Private key → Secure Enclave / Android Keystore, with access control requiring biometric
     authentication (and invalidated if the user's biometrics change).
4. The app signs `challenge ‖ publicKey` with the private key (this triggers the biometric prompt).
5. The app sends `publicKey + signature + deviceId` to the server.
6. The server verifies the signature with the public key, then stores the public key bound to the
   user (and device). Enrollment complete.

```
App                          Server
 │  enroll(publicKey, sig)      │
 │ ───────────────────────────▶ │ verify sig over (challenge ‖ publicKey)
 │                              │ store publicKey ⟵ bound to user + device
```

---

## Login (subsequent)

1. The app sends the user identifier (email/user id) to the server.
2. Server returns a **fresh challenge** (random nonce, single-use, short TTL — e.g. 60s).
3. The app shows the **system biometric prompt** (Face ID / Touch ID / BiometricPrompt).
4. On success, secure hardware releases the private key to **sign the challenge**.
5. The app sends `signature + challengeId` to the server.
6. The server verifies the signature against the stored public key and establishes a session
   (cookie or short-lived token).

```
App                          Server
 │  requestChallenge(email)     │
 │ ◀─────────────────────────── │ issueChallenge() → { challengeId, challenge }
 │  [Face ID prompt]            │
 │  sign(challenge)             │
 │  verify(email, challengeId,  │
 │          signature)          │
 │ ───────────────────────────▶ │ verifySignature() → session
 │ ◀─────────────────────────── │ 200 { ok, redirect }
```

---

## Security properties

- **No biometric data leaves the device.**
- **Private key never leaves secure hardware.**
- **Fresh challenge prevents replay** (single-use, expiring nonce).
- **Invalidated on biometric change** — the key becomes unusable if the user adds/removes a face or
  fingerprint, forcing re-enrollment (correct behaviour).
- **No server-side secret to leak** — only public keys are stored.

---

## Device lifecycle & revocation

Enrollment is not "set once and forget". A complete implementation manages the device credential
lifecycle:

- **Cap devices per account** — allow a bounded number of enrolled devices (e.g. 5); reject or
  replace the oldest beyond that.
- **Track devices** — store `device_id`, a label ("Dave's iPhone"), `last_used_at`, and the public key
  together so the user can see and manage them.
- **Revoke a device** — deleting the server-side public key immediately disables that device; the
  private key on the device is now useless for login.
- **Re-enroll after revocation** — a revoked device must fall back to the email OTP and re-enroll.
- **Rotate on suspicious activity** — invalidate a device's keys if the account shows compromise.

These are the *account-security* half of biometric login; without revocation, a lost phone is a
permanent backdoor.

---

## Identifier discovery on a fresh install

Biometric login needs a user identifier before it can look up the public key, which reintroduces the
enumeration question on a **fresh install** (no cached identity). Resolve it explicitly:

- **Preferred:** the device is enrolled *during* an authenticated OTP session, and the app caches the
  user id in secure storage (Keychain / EncryptedSharedPreferences) for subsequent biometric logins.
- **If no cached id:** require the user to identify themselves first — re-enter the email (which goes
  through the enumeration-safe OTP `request`), or sign in with OTP once and re-enroll.
- **Never** build a "look up my account by Face ID alone" flow that the server answers with
  account-specific data before authentication.

---

## Success feedback

A biometric login that succeeds should feel like a win, not a silent state change. On success, briefly
show the authenticated identity (avatar/email) and transition into the app; on repeated cancellation,
offer the OTP fallback so the user is never trapped.

---

## Platform specifics

### iOS (Swift)

- **Prompt:** `LocalAuthentication` — `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`.
- **Key:** `SecKeyCreateRandomKey` with `kSecAttrTokenIDSecureEnclave`; access control
  `kSecAccessControlBiometryCurrentSet` + `.privateKeyUsage`.
- **Sign:** `SecKeyCreateSignature(_, .ecdsaSignatureMessageX962SHA256, challenge)` — triggers the
  Face ID prompt via the Keychain access control.
- **Public key export:** `SecKeyCopyExternalRepresentation` returns the raw X9.63 EC point; wrap it in
  a SubjectPublicKeyInfo (SPKI) header to produce a PEM/DER the server can parse (see the example).
- **Signature format:** raw `r ‖ s` (64 bytes). Normalise to DER for a Node/OpenSSL server (see the
  example README).

### Android (Kotlin)

- **Prompt:** `androidx.biometric` — `BiometricManager.canAuthenticate(BIOMETRIC_STRONG)` + `BiometricPrompt`.
- **Key:** `KeyGenParameterSpec` with `setUserAuthenticationRequired(true)` and
  `setInvalidatedByBiometricEnrollment(true)`.
- **Sign:** a `Signature` instance (`SHA256withECDSA`) that the `BiometricPrompt` unlocks via its
  `CryptoObject`.
- **Public key export:** `PublicKey.getEncoded()` already returns SPKI DER → base64 → PEM.
- **Signature format:** already DER-encoded (matches Node/OpenSSL).

---

## Enumeration note

The identifier-first step reintroduces an "does this user exist?" question. Keep it safe:

- The **challenge endpoint returns a challenge whether or not a device credential exists**, and the
  verify endpoint fails with one generic message — no signal either way.
- Prefer tying biometric login to a device the user has **already authenticated once**, so the
  identifier is known and the flow is a convenience, not an anonymous probe.

---

## When to use

- Native iOS/Android apps where login frequency is high and a password/OTP every time is friction.
- As a "fast unlock" on top of an existing OTP or password account (the device was trusted once).

## When not to use

- Web browsers (use WebAuthn/passkeys instead — the browser manages the platform authenticator).
- As the *only* method — always keep the email OTP as the fallback/recovery path.
