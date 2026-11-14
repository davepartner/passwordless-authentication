/** Admin bootstrap: `ADMIN_EMAILS=ops@example.com,security@example.com`. */

import type { Role, User } from './store.js';

function adminList(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminList().includes(email.toLowerCase());
}

/** Role assigned at account creation. Admins are bootstrapped from env only. */
export function roleFor(email: string): Role {
  return isAdminEmail(email) ? 'admin' : 'user';
}

export function isAdmin(user: Pick<User, 'email' | 'role'> | undefined | null): boolean {
  if (!user) return false;
  return user.role === 'admin' || isAdminEmail(user.email);
}
