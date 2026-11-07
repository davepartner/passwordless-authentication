# Android biometric reference

Kotlin client for the biometric half of `references/biometric-login.md`.

## Usage (illustrative)

```kotlin
val auth = BiometricAuthManager(activity)

// 1. Enroll (once, after an OTP login)
if (auth.canAuthenticate()) {
    val spkiDer = auth.enroll()                       // X.509 SPKI DER
    POST /auth/biometric/enroll { email, publicKey = pemify(spkiDer), deviceId }
}

// 2. Login (subsequent)
POST /auth/biometric/challenge { email }              // → { challengeId, challenge }
auth.sign(challengeBytes, onSuccess = { sigB64 ->
    POST /auth/biometric/verify { email, challengeId, signature = sigB64 }
}, onError = { /* fall back to OTP */ })
```

`sign` shows the **system biometric prompt** (`BiometricPrompt`); you don't build your own UI.

## Interop (simpler than iOS)

- **Public key:** `getEncoded()` already returns SPKI DER → base64 → PEM. No conversion needed.
- **Signature:** `SHA256withECDSA` produces a DER-encoded signature, matching Node's `crypto.verify`.

## Key security notes

- `setUserAuthenticationRequired(true)` — the Keystore refuses to use the key without a successful
  biometric (or equivalent) authentication.
- `setInvalidatedByBiometricEnrollment(true)` — the key is invalidated if the user's biometrics change,
  forcing re-enrollment.
- The private key stays in the Keystore (hardware-backed where available); only the public key and
  signatures leave the device.
- Check `canAuthenticate()` (BIOMETRIC_STRONG) first and gracefully fall back to the email OTP.
