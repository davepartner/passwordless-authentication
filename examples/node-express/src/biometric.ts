import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

/**
 * Server half of biometric (Face ID / Touch ID) login.
 *
 * The device signs a fresh challenge with a device-bound private key; we verify
 * against the public keys enrolled during a prior OTP login. We never see
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
 * public key. Pure check — does NOT consume the challenge, so a caller can try
 * multiple enrolled keys for the same challenge.
 */
export function verifySignature(
  challengeId: string,
  publicKeyPem: string,
  signatureB64: string,
): boolean {
  const entry = challenges.get(challengeId);
  if (!entry || entry.expiresAt < Date.now()) return false;

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

/** Consume (delete) a challenge after it has been used, pass or fail. */
export function consumeChallenge(challengeId: string): void {
  challenges.delete(challengeId);
}
