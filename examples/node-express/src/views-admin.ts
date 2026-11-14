/**
 * Admin screens: session policy settings, the user directory, and a per-user
 * investigation view (devices, login history, email-change log, 2FA state).
 *
 * Admins are bootstrapped from `ADMIN_EMAILS`; every admin action and every
 * look at a user's record is written to the audit log.
 */

import type { AuditEvent } from './audit.js';
import type { SessionPolicy } from './sessionPolicy.js';
import { HARD_LIMITS } from './sessionPolicy.js';
import type { EmailChangeRequest, SessionRecord, User } from './store.js';
import { CLIENT_HELPERS, escapeHtml, layout } from './ui.js';

export interface AdminUserRow {
  user: User;
  activeSessions: number;
  lastSeenAt: number | null;
}

export interface AdminPageData {
  policy: SessionPolicy;
  users: AdminUserRow[];
  totals: { users: number; admins: number; twoFactor: number; sessions: number };
}

export interface AdminUserPageData {
  user: User;
  policy: SessionPolicy;
  effectiveDays: number;
  sessions: SessionRecord[];
  history: AuditEvent[];
  events: AuditEvent[];
  pendingChange?: EmailChangeRequest;
}

const ACTION_LABELS: Record<string, string> = {
  'login.succeeded': 'Signed in',
  'login.failed': 'Sign-in failed',
  'login.2fa_required': 'Two-factor requested',
  'login.2fa_failed': 'Two-factor failed',
  logout: 'Signed out',
  'session.revoked': 'Device signed out',
  'session.revoke_all': 'All other devices signed out',
  'session.duration_changed': 'Login duration changed',
  'twofactor.enroll_started': 'Two-factor setup started',
  'twofactor.enabled': 'Two-factor turned on',
  'twofactor.disabled': 'Two-factor turned off',
  'twofactor.recovery_regenerated': 'Recovery codes regenerated',
  'email.change_requested': 'Email change requested',
  'email.changed': 'Login email changed',
  'email.change_cancelled': 'Email change cancelled',
  'admin.policy_changed': 'Admin changed session policy',
  'admin.user_viewed': 'Admin viewed this profile',
  'admin.user_session_revoked': 'Admin signed out a device',
  'admin.user_session_days_changed': 'Admin changed login duration',
  'admin.twofactor_reset': 'Admin reset two-factor',
};

const time = (ms: number): string =>
  `<time datetime="${new Date(ms).toISOString()}" data-ts="${ms}">${new Date(ms)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')} UTC</time>`;

const timeOrDash = (ms: number | null): string => (ms === null ? '—' : time(ms));

export function renderAdminPage(data: AdminPageData): string {
  const { policy, users, totals } = data;

  const rows = users
    .map(
      ({ user, activeSessions, lastSeenAt }) => `<tr>
        <td><a href="/admin/users/${encodeURIComponent(user.email)}">${escapeHtml(user.email)}</a>
          ${user.role === 'admin' ? '<span class="badge">admin</span>' : ''}
          ${user.previousEmails.length ? `<div class="muted">was ${escapeHtml(user.previousEmails[0])}</div>` : ''}
        </td>
        <td>${user.twoFactorEnabledAt ? '<span class="badge ok">on</span>' : '<span class="badge warn">off</span>'}</td>
        <td>${activeSessions}</td>
        <td class="muted">${timeOrDash(lastSeenAt)}</td>
        <td class="muted">${time(user.createdAt)}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <h1>Administration</h1>
  <p class="muted">${totals.users} users · ${totals.admins} admins · ${totals.twoFactor} with two-factor ·
    ${totals.sessions} active sessions</p>

  <section class="card">
    <header>
      <div>
        <h2>Login duration</h2>
        <p class="muted">The default is 1 year. Applies to new sessions only — existing sessions keep
          the expiry they were issued with.</p>
      </div>
      <span class="badge">${policy.defaultDays} days default</span>
    </header>

    <div class="grid">
      <div>
        <label class="field" for="default-days">Default for everyone (days)</label>
        <input id="default-days" type="number" min="${HARD_LIMITS.minDays}" max="${HARD_LIMITS.maxDays}"
               value="${policy.defaultDays}">
      </div>
      <div>
        <label class="field" for="min-days">Minimum a user may pick (days)</label>
        <input id="min-days" type="number" min="${HARD_LIMITS.minDays}" max="${HARD_LIMITS.maxDays}"
               value="${policy.minDays}">
      </div>
      <div>
        <label class="field" for="max-days">Maximum a user may pick (days)</label>
        <input id="max-days" type="number" min="${HARD_LIMITS.minDays}" max="${HARD_LIMITS.maxDays}"
               value="${policy.maxDays}">
      </div>
      <div>
        <label class="field" for="idle-days">Sign out after inactivity (days, blank = never)</label>
        <input id="idle-days" type="number" min="1" max="${HARD_LIMITS.maxDays}"
               value="${policy.idleDays ?? ''}">
      </div>
    </div>

    <label class="row mt" style="font-size:.9rem">
      <input id="allow-override" type="checkbox" ${policy.allowUserOverride ? 'checked' : ''}>
      Let users choose their own login duration
    </label>

    <button id="save-policy" class="btn mt">Save settings</button>
    <p class="error" id="policy-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Users</h2>
        <p class="muted">Open a user to see devices, login history, email changes and two-factor state.</p>
      </div>
    </header>
    <table>
      <thead><tr><th>Email</th><th>2FA</th><th>Devices</th><th>Last active</th><th>Joined</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No users yet.</td></tr>'}</tbody>
    </table>
  </section>`;

  const script = `${CLIENT_HELPERS}
(() => {
  const q = (id) => document.getElementById(id);
  for (const el of document.querySelectorAll('time[data-ts]')) {
    el.textContent = fmtTime(Number(el.dataset.ts));
  }
  q('save-policy').addEventListener('click', async () => {
    const idle = q('idle-days').value.trim();
    const { data } = await api('PATCH', '/admin/settings', {
      defaultDays: Number(q('default-days').value),
      minDays: Number(q('min-days').value),
      maxDays: Number(q('max-days').value),
      allowUserOverride: q('allow-override').checked,
      idleDays: idle === '' ? null : Number(idle),
    });
    if (!data.ok) { q('policy-error').textContent = data.error; return; }
    location.reload();
  });
})();`;

  return layout({
    title: 'Administration',
    wide: true,
    nav: [
      { href: '/admin', label: 'Admin' },
      { href: '/profile', label: 'My profile' },
    ],
    body,
    script,
  });
}

export function renderAdminUserPage(data: AdminUserPageData): string {
  const { user, policy, effectiveDays, sessions, history, events, pendingChange } = data;

  const sessionRows = sessions
    .map(
      (session) => `<tr>
        <td>${escapeHtml(session.deviceLabel)}
          <div class="muted">${escapeHtml(session.location ?? 'Unknown')} · ${escapeHtml(session.ip ?? '—')}</div>
        </td>
        <td class="muted">${session.methods.map((m) => escapeHtml(m)).join(' + ')}</td>
        <td class="muted">${time(session.createdAt)}</td>
        <td class="muted">${time(session.lastSeenAt)}</td>
        <td class="muted">${session.expiresAt > Date.now() ? time(session.expiresAt) : 'expired'}</td>
        <td>${
          session.revokedAt
            ? `<span class="muted">revoked ${time(session.revokedAt)}</span>`
            : `<button class="btn btn-danger btn-small" data-revoke="${escapeHtml(session.id)}">Revoke</button>`
        }</td>
      </tr>`,
    )
    .join('');

  const historyRows = history
    .map(
      (event) => `<tr>
        <td class="muted">${time(event.at)}</td>
        <td>${escapeHtml(ACTION_LABELS[event.action] ?? event.action)}
          ${event.outcome === 'failure' ? '<span class="badge warn">failed</span>' : ''}</td>
        <td class="muted">${escapeHtml(event.deviceLabel ?? '—')}</td>
        <td class="muted">${escapeHtml(event.location ?? '—')}</td>
        <td class="muted">${escapeHtml(event.ip ?? '—')}</td>
      </tr>`,
    )
    .join('');

  const eventRows = events
    .map(
      (event) => `<tr>
        <td class="muted">${time(event.at)}</td>
        <td>${escapeHtml(ACTION_LABELS[event.action] ?? event.action)}</td>
        <td class="muted">${escapeHtml(event.actor)}</td>
        <td class="muted">${escapeHtml(event.location ?? '—')}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <p class="muted"><a href="/admin">← All users</a></p>
  <h1>${escapeHtml(user.email)}</h1>
  <p class="muted">Joined ${time(user.createdAt)} · role ${escapeHtml(user.role)} ·
    ${user.emailVerifiedAt ? 'email verified' : 'email unverified'}</p>

  <section class="card">
    <header>
      <div>
        <h2>Security</h2>
        <p class="muted">Two-factor is ${user.twoFactorEnabledAt ? 'enabled' : 'disabled'}.</p>
      </div>
      <span class="badge ${user.twoFactorEnabledAt ? 'ok' : 'warn'}">${
        user.twoFactorEnabledAt ? '2FA on' : '2FA off'
      }</span>
    </header>

    ${
      user.twoFactorEnabledAt
        ? `<p class="muted">Recovery codes remaining: ${user.recoveryCodes.filter((c) => c.usedAt === null).length}.
             Reset only after verifying the user's identity out of band.</p>
           <button id="reset-2fa" class="btn btn-danger">Reset two-factor</button>`
        : '<p class="muted">The user can turn on two-factor from their profile.</p>'
    }

    <p class="error" id="security-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Login duration</h2>
        <p class="muted">Preference: ${
          user.sessionDays === null ? 'follows the admin default' : `${user.sessionDays} days`
        } · effective ${effectiveDays} days · allowed ${policy.minDays}–${policy.maxDays}.</p>
      </div>
    </header>
    <div class="row">
      <input id="user-days" type="number" min="${policy.minDays}" max="${policy.maxDays}"
             value="${user.sessionDays ?? policy.defaultDays}" style="max-width:10rem">
      <button id="save-user-days" class="btn">Save override</button>
      <button id="clear-user-days" class="btn btn-secondary">Use default</button>
    </div>
    <p class="error" id="days-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Signed-in devices</h2>
        <p class="muted">${sessions.length} session${sessions.length === 1 ? '' : 's'} on record
          (revoked included).</p>
      </div>
    </header>
    <table>
      <thead><tr><th>Device</th><th>Method</th><th>Signed in</th><th>Last active</th><th>Expires</th><th></th></tr></thead>
      <tbody>${sessionRows || '<tr><td colspan="6" class="muted">No sessions.</td></tr>'}</tbody>
    </table>
    <p class="error" id="session-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Login history</h2>
        <p class="muted">Sign-ins, sign-outs and security changes.</p>
      </div>
    </header>
    <table>
      <thead><tr><th>When</th><th>Event</th><th>Device</th><th>Location</th><th>IP</th></tr></thead>
      <tbody>${historyRows || '<tr><td colspan="5" class="muted">No activity.</td></tr>'}</tbody>
    </table>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Email change log</h2>
        <p class="muted">Current: ${escapeHtml(user.email)}${
          user.previousEmails.length
            ? ` · previous: ${user.previousEmails.map((e) => escapeHtml(e)).join(', ')}`
            : ' · no changes'
        }</p>
      </div>
    </header>
    ${
      pendingChange
        ? `<p class="notice">Pending change to <strong>${escapeHtml(pendingChange.newEmail)}</strong>,
             requested ${time(pendingChange.createdAt)} from ${escapeHtml(pendingChange.location ?? 'unknown')}.</p>`
        : '<p class="muted">No pending change.</p>'
    }
    <table>
      <thead><tr><th>When</th><th>Event</th><th>Actor</th><th>Location</th></tr></thead>
      <tbody>${eventRows || '<tr><td colspan="4" class="muted">No records.</td></tr>'}</tbody>
    </table>
  </section>`;

  const script = `${CLIENT_HELPERS}
(() => {
  const q = (id) => document.getElementById(id);
  for (const el of document.querySelectorAll('time[data-ts]')) {
    el.textContent = fmtTime(Number(el.dataset.ts));
  }
  const user = decodeURIComponent(${JSON.stringify(user.email)});

  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revoke]');
    if (!button) return;
    button.disabled = true;
    const id = button.getAttribute('data-revoke');
    const { data } = await api('POST', '/admin/users/' + encodeURIComponent(user) + '/sessions/' + id + '/revoke');
    if (!data.ok) { q('session-error').textContent = data.error; button.disabled = false; return; }
    location.reload();
  });

  q('save-user-days').addEventListener('click', async () => {
    const { data } = await api('PATCH', '/admin/users/' + encodeURIComponent(user) + '/session-days',
      { days: Number(q('user-days').value) });
    if (!data.ok) { q('days-error').textContent = data.error; return; }
    location.reload();
  });

  q('clear-user-days').addEventListener('click', async () => {
    const { data } = await api('PATCH', '/admin/users/' + encodeURIComponent(user) + '/session-days',
      { days: null });
    if (!data.ok) { q('days-error').textContent = data.error; return; }
    location.reload();
  });

  if (q('reset-2fa')) {
    q('reset-2fa').addEventListener('click', async () => {
      if (!confirm('Reset two-factor for this user? Only after verifying their identity.')) return;
      const { data } = await api('POST', '/admin/users/' + encodeURIComponent(user) + '/2fa/reset');
      if (!data.ok) { q('security-error').textContent = data.error; return; }
      location.reload();
    });
  }
})();`;

  return layout({
    title: `Admin — ${user.email}`,
    wide: true,
    nav: [
      { href: '/admin', label: 'Admin' },
      { href: '/profile', label: 'My profile' },
    ],
    body,
    script,
  });
}
