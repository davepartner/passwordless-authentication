package com.example.app.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.util.Base64

/**
 * Face ID / fingerprint backed device credential.
 *
 * The private key lives in the Android Keystore (hardware-backed when available)
 * and is gated by biometric authentication; only the public key and a signature
 * over a fresh challenge ever leave the device.
 */
class BiometricAuthManager(private val activity: FragmentActivity) {

    companion object {
        private const val KEY_ALIAS = "com.example.app.biometric_key"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    }

    fun canAuthenticate(): Boolean {
        return BiometricManager.from(activity).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG,
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Generate a biometric-gated ECDSA P-256 key pair in the Keystore.
     * Returns the public key as an X.509 SPKI DER (base64 → PEM for the server).
     */
    fun enroll(): ByteArray {
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
        generator.initialize(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
                .setKeySize(256)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true)
                .build(),
        )
        return generator.generateKeyPair().public.encoded
    }

    /**
     * Prompt biometrics and sign the server challenge.
     * [onSuccess] receives the DER-encoded signature (base64 for the server).
     */
    fun sign(challenge: ByteArray, onSuccess: (String) -> Unit, onError: (String) -> Unit) {
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Sign in with biometrics")
            .setSubtitle("Confirm it's you to continue")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .setNegativeButtonText("Cancel")
            .build()

        val crypto = initSignature()
        if (crypto == null) {
            onError("Biometric key unavailable. Re-enroll on this device.")
            return
        }

        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val signature = result.cryptoObject?.signature
                    if (signature != null) {
                        signature.update(challenge)
                        onSuccess(Base64.getEncoder().encodeToString(signature.sign()))
                    } else {
                        onError("Signature unavailable")
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onError(errString.toString())
                }
            },
        )

        prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(crypto))
    }

    private fun initSignature(): Signature? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val privateKey = keyStore.getKey(KEY_ALIAS, null) as? java.security.PrivateKey ?: return null
        return Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey) }
    }
}
