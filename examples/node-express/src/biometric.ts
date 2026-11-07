import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

/**
 * Server half of biometric (Face ID / Touch ID) login.
 *
 * The device signs a fresh challenge with a device-bound private key; we verify
 * against the public key enrolled during a prior OTP login. We never see
 * biometric data, and we store only public keys.
 */

interface ChallengeEntry {
  challenge: string; // base64
  expiresAt: number;
}

const challenges = new Map<string, ChallengeEntry>();

/** Issue a single-use challenge (short TTL) that the device must sign. */
export function issueChallenge(): { challengeId: string; challenge: string } {
  const challengeId = randomBytes(16).toString('hex');
  const challenge = randomBytes(32).toString('base64');
  challenges.set(challengeId, { challenge, expiresAt: Date.now() + 60_000 });
  return { challengeId, challenge };
}

/**
 * Verify an ECDSA signature (DER-encoded) over a challenge against an SPKI PEM
 * public key. Returns false for unknown/expired challenges — no distinction, so
 * no enumeration signal.
 */
export function verifySignature(
  challengeId: string,
  publicKeyPem: string,
  signatureB64: string,
): boolean {
  const entry = challenges.get(challengeId);
  if (!entry || entry.expiresAt < Date.now()) return false;
  challenges.delete(challengeId); // single use

  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(
      'sha256',
      Buffer.from(entry.challenge, 'base64'),
      key,
      Buffer.from(signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
