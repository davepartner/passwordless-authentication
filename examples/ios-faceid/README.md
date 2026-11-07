# iOS Face ID reference

Swift client for the biometric half of `references/biometric-login.md`.

## Usage (illustrative)

```swift
let auth = BiometricAuthManager()

// 1. Enroll (once, after an OTP login)
let spkiDer = try auth.enroll()                     // X.509 SPKI DER
let publicKeyPem = pemify(spkiDer)                  // base64 + PEM header/footer
POST /auth/biometric/enroll { email, publicKey, deviceId }

// 2. Login (subsequent)
POST /auth/biometric/challenge { email }            // → { challengeId, challenge }
let signature = try auth.sign(challenge: Data(base64Encoded: challenge)!)
POST /auth/biometric/verify { email, challengeId, signature }
```

The `sign` call triggers the **system Face ID prompt** automatically via the Keychain access control —
you do not build your own UI for it.

## Two interop conversions (required)

The iOS default outputs differ from what a Node/OpenSSL server expects. The example handles the first;
do the second on the client or server:

1. **Public key:** `SecKeyCopyExternalRepresentation` returns the raw X9.63 EC point (65 bytes).
   The server parses an SPKI PEM, so `enroll()` prepends the fixed P-256 SPKI header
   (`30 59 … 03 42 00`). Base64-encode the result and wrap in `-----BEGIN PUBLIC KEY-----`.
2. **Signature:** `SecKeyCreateSignature` returns raw `r ‖ s` (64 bytes). Node's `crypto.verify`
   expects a DER-encoded ECDSA signature. Wrap `r ‖ s` into DER:
   `0x30 || len || 0x02 || len(r) || r || 0x02 || len(s) || s` (trim leading zero bytes, or use a
   helper like `jose` / `@noble/curves` on the server to accept raw).

## Key security notes

- The key is created with `kSecAttrTokenIDSecureEnclave` — the private key never leaves the enclave.
- Access control `.biometryCurrentSet` means the key is **invalidated if the user's face/fingerprint
  set changes**, forcing re-enrollment (correct).
- `LAContext.canEvaluatePolicy` gates availability; handle `.unavailable`/`.cancelled` gracefully and
  fall back to the email OTP.
