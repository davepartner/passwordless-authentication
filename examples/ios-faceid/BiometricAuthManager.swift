import Foundation
import LocalAuthentication
import Security

/// Face ID / Touch ID backed device credential.
///
/// The private key lives in the Secure Enclave and never leaves it; the server
/// only ever sees the public key and a signature over a fresh challenge.
final class BiometricAuthManager {

    private enum Constants {
        static let keyTag = "com.example.app.biometric.key"
        static let service = "com.example.app.biometric"
    }

    enum BiometricError: Error {
        case unavailable
        case keyNotFound
        case cancelled
        case exportFailed
    }

    // MARK: - Availability

    func canAuthenticate() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    // MARK: - Enrollment

    /// Generate an ECDSA P-256 key in the Secure Enclave, gated by biometrics.
    /// Returns the public key as an X.509 SubjectPublicKeyInfo (SPKI) DER blob,
    /// ready to be base64-encoded into a PEM the server can parse.
    func enroll() throws -> Data {
        let context = LAContext()
        var policyError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &policyError) else {
            throw BiometricError.unavailable
        }

        // Biometric-gated access; invalidated if the user's biometrics change.
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.biometryCurrentSet, .privateKeyUsage],
            nil
        ) else {
            throw BiometricError.unavailable
        }

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Data(Constants.keyTag.utf8),
                kSecAttrAccessControl as String: access,
            ],
        ]

        var creationError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &creationError),
              let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw creationError?.takeRetainedValue() as Error? ?? BiometricError.unavailable
        }

        var exportError: Unmanaged<CFError>?
        guard let publicPoint = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
            throw exportError?.takeRetainedValue() as Error? ?? BiometricError.exportFailed
        }

        // Wrap the raw X9.63 EC point in an SPKI header so the server can parse
        // it as a standard PEM public key (matches Android's getEncoded()).
        return Self.spkiPrefix + publicPoint
    }

    /// Sign a server challenge with the Secure Enclave key.
    /// Triggers the system Face ID / Touch ID prompt via the keychain access control.
    /// Returns the signature as raw `r ‖ s` (64 bytes for P-256).
    func sign(challenge: Data) throws -> Data {
        guard let privateKey = loadPrivateKey() else {
            throw BiometricError.keyNotFound
        }

        var signError: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            challenge as CFData,
            &signError
        ) as Data? else {
            if let err = signError?.takeRetainedValue() {
                // LAError / auth failures surface here (e.g. user cancelled).
                throw err
            }
            throw BiometricError.cancelled
        }

        return signature
    }

    // MARK: - Helpers

    private func loadPrivateKey() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag as String: Data(Constants.keyTag.utf8),
            kSecReturnRef as String: true,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else { return nil }
        return (item as! SecKey)
    }

    /// Fixed 26-byte ASN.1 SPKI prefix for a P-256 uncompressed point.
    /// SEC1: 30 59 30 13 06 07 2a 86 48 ce 3d 02 01 06 08 2a 86 48 ce 3d 03 01 07 03 42 00
    private static let spkiPrefix = Data([
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ])
}
