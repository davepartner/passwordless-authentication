import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';

export type SocialProvider = 'google' | 'github' | 'linkedin';

export interface SocialIdentity {
  provider: SocialProvider;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export type AccountAction = 'link' | 'create' | 'require-verification';

export interface LinkDecision {
  action: AccountAction;
  email: string | null;
}

// ── Provider configuration ──────────────────────────────────────────────────

interface ProviderConfig {
  oidc: boolean;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUri?: string;
  issuer?: string;
  scopes: string;
}

const PROVIDERS: Record<SocialProvider, ProviderConfig> = {
  google: {
    oidc: true,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    scopes: 'openid email profile',
  },
  linkedin: {
    oidc: true,
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    jwksUri: 'https://www.linkedin.com/oauth/openid/jwks',
    issuer: 'https://www.linkedin.com',
    scopes: 'openid profile email',
  },
  github: {
    oidc: false,
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: 'read:user user:email',
  },
};

// ── Normalization ───────────────────────────────────────────────────────────

/** Map provider-specific raw claims to a normalized identity. */
export function normalizeIdentity(
  provider: SocialProvider,
  raw: Record<string, unknown>,
): SocialIdentity {
  if (provider === 'github') {
    return {
      provider,
      sub: String(raw.id),
      email: raw.email ? String(raw.email) : null,
      emailVerified: raw.verified === true,
      name: raw.name ? String(raw.name) : null,
      avatarUrl: raw.avatar_url ? String(raw.avatar_url) : null,
    };
  }
  // OIDC providers (google, linkedin, …): raw is the verified ID token claims.
  return {
    provider,
    sub: String(raw.sub),
    email: raw.email ? String(raw.email) : null,
    emailVerified: raw.email_verified === true,
    name: raw.name ? String(raw.name) : null,
    avatarUrl: raw.picture ? String(raw.picture) : null,
  };
}

// ── Account linking ─────────────────────────────────────────────────────────

/**
 * The security-critical decision. Email is only trusted for linking when the
 * provider marks it verified — otherwise an attacker could take over an
 * existing account by choosing an unverified email at the provider.
 */
export function decideAccountAction(
  identity: SocialIdentity,
  existsByEmail: boolean,
  existsByProviderSub: boolean,
): LinkDecision {
  if (existsByProviderSub) {
    return { action: 'link', email: identity.email };
  }
  if (identity.email && identity.emailVerified) {
    return existsByEmail
      ? { action: 'link', email: identity.email }
      : { action: 'create', email: identity.email };
  }
  return { action: 'require-verification', email: identity.email };
}

// ── PKCE + nonce ────────────────────────────────────────────────────────────

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

export function codeChallengeFromVerifier(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function generateNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function buildAuthorizeUrl(
  provider: SocialProvider,
  clientId: string,
  redirectUri: string,
  opts: { state: string; codeChallenge: string; nonce?: string },
): string {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scopes,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (cfg.oidc && opts.nonce) params.set('nonce', opts.nonce);
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

// ── Token exchange + ID token verification ──────────────────────────────────

export async function exchangeCode(
  tokenUrl: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function verifyIdToken(
  idToken: string,
  opts: { issuer: string; jwksUri: string; clientId: string; nonce?: string },
): Promise<Record<string, unknown>> {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUri));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: opts.issuer, audience: opts.clientId });
  if (opts.nonce !== undefined && payload.nonce !== opts.nonce) {
    throw new Error('nonce mismatch');
  }
  return payload as Record<string, unknown>;
}

// ── GitHub (OAuth2, no ID token) ────────────────────────────────────────────

export async function fetchGitHubIdentity(accessToken: string): Promise<SocialIdentity> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  const userRes = await fetch('https://api.github.com/user', { headers });
  const emailsRes = await fetch('https://api.github.com/user/emails', { headers });

  const user = (await userRes.json()) as {
    id: number;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
  };
  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;

  const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified) ?? null;

  return normalizeIdentity('github', {
    id: user.id,
    name: user.name,
    avatar_url: user.avatar_url,
    email: primary?.email ?? user.email ?? null,
    verified: primary?.verified ?? false,
  });
}

// ── End-to-end callback resolution ──────────────────────────────────────────

export interface SocialCallbackContext {
  provider: SocialProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  nonce?: string;
  codeVerifier: string;
}

/** Exchange the code, verify the ID token (or fetch the GitHub profile). */
export async function resolveSocialCallback(
  code: string,
  ctx: SocialCallbackContext,
): Promise<SocialIdentity> {
  const cfg = PROVIDERS[ctx.provider];

  const tokenRes = await exchangeCode(cfg.tokenUrl, {
    client_id: ctx.clientId,
    client_secret: ctx.clientSecret,
    code,
    redirect_uri: ctx.redirectUri,
    grant_type: 'authorization_code',
    ...(ctx.codeVerifier ? { code_verifier: ctx.codeVerifier } : {}),
  });

  if (cfg.oidc) {
    const idToken = String(tokenRes.id_token);
    const claims = await verifyIdToken(idToken, {
      issuer: cfg.issuer!,
      jwksUri: cfg.jwksUri!,
      clientId: ctx.clientId,
      nonce: ctx.nonce,
    });
    return normalizeIdentity(ctx.provider, claims);
  }

  return fetchGitHubIdentity(String(tokenRes.access_token));
}

// ── Transient social state (nonce/verifier per state) ───────────────────────

interface PendingSocialAuth {
  provider: SocialProvider;
  nonce?: string;
  codeVerifier: string;
  createdAt: number;
}

const pending = new Map<string, PendingSocialAuth>();

export const socialStateStore = {
  set(state: string, value: PendingSocialAuth): void {
    pending.set(state, value);
  },
  get(state: string): PendingSocialAuth | undefined {
    return pending.get(state);
  },
  delete(state: string): void {
    pending.delete(state);
  },
};
