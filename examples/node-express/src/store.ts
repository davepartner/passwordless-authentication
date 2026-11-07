/**
 * In-memory stores. Replace with Postgres/Redis in production — the record
 * shapes are what matter, not the backing store.
 */

export interface OtpChallenge {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  ip: string | null;
}

export interface PendingRequest {
  email: string;
  resendAvailableAt: number;
}

export interface User {
  email: string;
  emailVerifiedAt: number | null;
}

export interface DeviceCredential {
  userId: string; // the email, for simplicity
  publicKeyPem: string;
  deviceId: string;
}

const challenges = new Map<string, OtpChallenge>(); // email -> active challenge
const pending = new Map<string, PendingRequest>(); // requestId -> pending
const users = new Map<string, User>(); // email -> user
const devices = new Map<string, DeviceCredential>(); // email -> device credential

export const challengeStore = {
  set(email: string, c: OtpChallenge): void {
    challenges.set(email, c);
  },
  get(email: string): OtpChallenge | undefined {
    return challenges.get(email);
  },
  delete(email: string): void {
    challenges.delete(email);
  },
};

export const pendingStore = {
  set(id: string, p: PendingRequest): void {
    pending.set(id, p);
  },
  get(id: string): PendingRequest | undefined {
    return pending.get(id);
  },
  delete(id: string): void {
    pending.delete(id);
  },
};

export const userStore = {
  get(email: string): User | undefined {
    return users.get(email);
  },
  put(email: string, u: User): void {
    users.set(email, u);
  },
};

export const deviceStore = {
  get(email: string): DeviceCredential | undefined {
    return devices.get(email);
  },
  put(email: string, d: DeviceCredential): void {
    devices.set(email, d);
  },
};
