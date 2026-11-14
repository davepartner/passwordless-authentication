/**
 * The user profile page: account + login email, two-factor, session duration,
 * signed-in devices (with revocation), and login history.
 *
 * Server-rendered so it works without a build step; the small script only posts
 * JSON to the endpoints in `routes.ts`.
 */

import type { AuditEvent } from './audit.js';
import type { SessionPolicy } from './sessionPolicy.js';
import type { EmailChangeRequest, SessionRecord, User } from './store.js';
import { CLIENT_HELPERS, escapeHtml, layout } from './ui.js';

export interface ProfilePageData {
  user: User;
  sessions: SessionRecord[];
  currentSessionId: string;
  policy: SessionPolicy;
  effectiveDays: number;
  history: AuditEvent[];
  pendingChange?: EmailChangeRequest;
  recoveryCodesRemaining: number;
  flash?: string;
}

const DAY_OPTIONS = [1, 7, 30, 90, 180, 365];

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
  'admin.user_viewed': 'Admin viewed profile',
  'admin.user_session_revoked': 'Admin signed out a device',
  'admin.user_session_days_changed': 'Admin changed login duration',
  'admin.twofactor_reset': 'Admin reset two-factor',
};

function timeTag(ms: number): string {
  return `<time datetime="${new Date(ms).toISOString()}" data-ts="${ms}">${new Date(ms)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')} UTC</time>`;
}

function durationOptions(policy: SessionPolicy, current: number | null): string {
  const values = new Set<number>([...DAY_OPTIONS, policy.defaultDays, policy.minDays, policy.maxDays]);
  const options = [...values]
    .filter((d) => d >= policy.minDays && d <= policy.maxDays)
    .sort((a, b) => a - b)
    .map((d) => {
      const label =
        d === policy.defaultDays ? `${d} days (default)` : d === 365 ? '365 days (1 year)' : `${d} days`;
      const selected = current === d ? ' selected' : '';
      return `<option value="${d}"${selected}>${label}</option>`;
    });

  const follow = `<option value=""${current === null ? ' selected' : ''}>Use the default (${
    policy.defaultDays
  } days)</option>`;
  return follow + options.join('');
}

function sessionRows(data: ProfilePageData): string {
  if (data.sessions.length === 0) {
    return `<tr><td colspan="5" class="muted">No active devices.</td></tr>`;
  }

  return data.sessions
    .map((session) => {
      const current = session.id === data.currentSessionId;
      return `<tr>
        <td>
          ${escapeHtml(session.deviceLabel)}
          ${current ? '<span class="badge ok">this device</span>' : ''}
          <div class="muted">${escapeHtml(session.location ?? 'Unknown')}</div>
        </td>
        <td class="muted">${escapeHtml(session.ip ?? '—')}</td>
        <td class="muted">${timeTag(session.createdAt)}</td>
        <td class="muted">${timeTag(session.lastSeenAt)}</td>
        <td>${
          current
            ? '<span class="muted">—</span>'
            : `<button class="btn btn-danger btn-small" data-revoke="${escapeHtml(session.id)}">Sign out</button>`
        }</td>
      </tr>`;
    })
    .join('');
}

function historyRows(events: AuditEvent[]): string {
  if (events.length === 0) return `<tr><td colspan="4" class="muted">No activity yet.</td></tr>`;

  return events
    .map(
      (event) => `<tr>
        <td class="muted">${timeTag(event.at)}</td>
        <td>${escapeHtml(ACTION_LABELS[event.action] ?? event.action)}
          ${event.outcome === 'failure' ? '<span class="badge warn">failed</span>' : ''}</td>
        <td class="muted">${escapeHtml(event.deviceLabel ?? '—')}</td>
        <td class="muted">${escapeHtml(event.location ?? '—')}</td>
      </tr>`,
    )
    .join('');
}

export function renderProfilePage(data: ProfilePageData): string {
  const { user, policy, effectiveDays, pendingChange } = data;
  const twoFactorOn = user.twoFactorEnabledAt !== null;
  const canChange = policy.allowUserOverride;

  const body = `
  ${data.flash ? `<p class="notice" role="status">${escapeHtml(data.flash)}</p>` : ''}

  <h1>Your profile</h1>
  <p class="muted">Signed in as ${escapeHtml(user.email)}</p>

  <section class="card">
    <header>
      <div>
        <h2>Login email</h2>
        <p class="muted">This address is your only credential — keep the inbox secure.</p>
      </div>
      <span class="badge ok">${user.emailVerifiedAt ? 'verified' : 'unverified'}</span>
    </header>

    <p><strong>${escapeHtml(user.email)}</strong>
      <span class="muted">· member since ${timeTag(user.createdAt)}</span></p>

    ${
      pendingChange
        ? `<p class="notice">Waiting for confirmation: <strong>${escapeHtml(
            pendingChange.newEmail,
          )}</strong> — a code was sent there. It expires ${timeTag(pendingChange.expiresAt)}.</p>
           <div class="row">
             <input id="email-confirm-code" class="mono" inputmode="numeric" maxlength="8"
                    aria-label="Code sent to the new address" placeholder="8-digit code"
                    style="max-width:12rem">
             <button id="email-confirm" class="btn">Confirm change</button>
             <button id="email-cancel" class="btn btn-secondary">Cancel</button>
           </div>
           <p class="error" id="email-error" role="alert"></p>`
        : `<details>
             <summary>Change login email</summary>
             <p class="muted">We send a code to the new address and a notice to the current one.
               All other devices are signed out when the change completes.</p>
             <label class="field" for="new-email">New email address</label>
             <input id="new-email" type="email" autocomplete="email">
             ${
               twoFactorOn
                 ? `<label class="field" for="email-totp">Authenticator code</label>
                    <input id="email-totp" inputmode="numeric" maxlength="14" placeholder="123456 or a recovery code">`
                 : ''
             }
             <button id="email-request" class="btn mt">Send code to new address</button>
             <p class="error" id="email-error" role="alert"></p>
           </details>`
    }
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Two-factor authentication</h2>
        <p class="muted">A 6-digit code from an authenticator app, on top of your emailed code.</p>
      </div>
      <span class="badge ${twoFactorOn ? 'ok' : 'warn'}">${twoFactorOn ? 'on' : 'off'}</span>
    </header>

    ${
      twoFactorOn
        ? `<p class="muted">${data.recoveryCodesRemaining} recovery code${
            data.recoveryCodesRemaining === 1 ? '' : 's'
          } remaining.</p>
           <details>
             <summary>Turn off two-factor</summary>
             <p class="muted">Confirm with a current authenticator or recovery code.</p>
             <label class="field" for="disable-code">Code</label>
             <input id="disable-code" inputmode="numeric" maxlength="14">
             <button id="disable-2fa" class="btn btn-danger mt">Turn off two-factor</button>
           </details>
           <details>
             <summary>Regenerate recovery codes</summary>
             <p class="muted">Replaces every unused code. Requires a current authenticator code.</p>
             <label class="field" for="regen-code">Authenticator code</label>
             <input id="regen-code" inputmode="numeric" maxlength="6">
             <button id="regen-2fa" class="btn btn-secondary mt">Regenerate codes</button>
           </details>`
        : `<button id="start-2fa" class="btn">Set up two-factor</button>
           <div id="2fa-setup" class="hidden stack mt">
             <p class="notice">Scan or copy this secret into your authenticator app, then enter the
               code it shows. The setup expires in 15 minutes.</p>
             <p class="mono" id="2fa-secret"></p>
             <p class="mono muted" id="2fa-uri"></p>
             <label class="field" for="confirm-2fa-code">6-digit code from the app</label>
             <input id="confirm-2fa-code" inputmode="numeric" maxlength="6">
             <button id="confirm-2fa" class="btn">Turn on two-factor</button>
           </div>
           <div id="recovery-panel" class="hidden mt">
             <p class="notice"><strong>Save these recovery codes now.</strong> Each works once, and
               they are the only way in if you lose the app.</p>
             <pre class="mono" id="recovery-codes"></pre>
           </div>`
    }
    <p class="error" id="2fa-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Login session</h2>
        <p class="muted">How long a new sign-in stays valid on this account.</p>
      </div>
      <span class="badge">${effectiveDays} days</span>
    </header>

    ${
      canChange
        ? `<label class="field" for="session-days">Keep me signed in for</label>
           <div class="row">
             <select id="session-days" style="max-width:20rem">${durationOptions(policy, user.sessionDays)}</select>
             <button id="save-session-days" class="btn">Save</button>
           </div>
           <p class="muted">Applies to your next sign-in. Between ${policy.minDays} and ${policy.maxDays}
             days, set by your administrator.</p>`
        : `<p class="muted">Your administrator sets the login duration for all accounts
             (${policy.defaultDays} days).</p>`
    }
    <p class="error" id="duration-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Devices signed in</h2>
        <p class="muted">${data.sessions.length} active session${
          data.sessions.length === 1 ? '' : 's'
        }. Sign out anything you do not recognise.</p>
      </div>
      <button id="revoke-others" class="btn btn-secondary btn-small">Sign out other devices</button>
    </header>
    <table>
      <thead><tr><th>Device</th><th>IP</th><th>Signed in</th><th>Last active</th><th></th></tr></thead>
      <tbody>${sessionRows(data)}</tbody>
    </table>
    <p class="error" id="session-error" role="alert"></p>
  </section>

  <section class="card">
    <header>
      <div>
        <h2>Login history</h2>
        <p class="muted">Recent sign-ins, sign-outs and security changes on this account.</p>
      </div>
    </header>
    <table>
      <thead><tr><th>When</th><th>Event</th><th>Device</th><th>Location</th></tr></thead>
      <tbody>${historyRows(data.history)}</tbody>
    </table>
  </section>

  <p class="muted"><a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a></p>
  <p class="row"><a class="btn btn-secondary" href="/dashboard">Dashboard</a>
    <button id="logout" class="btn btn-secondary">Sign out</button></p>`;

  const script = `${CLIENT_HELPERS}
(() => {
  const q = (id) => document.getElementById(id);
  const show = (id, visible) => { const el = q(id); if (el) el.classList.toggle('hidden', !visible); };
  const fail = (id, message) => { const el = q(id); if (el) el.textContent = message || ''; };

  for (const el of document.querySelectorAll('time[data-ts]')) {
    el.textContent = fmtTime(Number(el.dataset.ts));
  }

  if (q('save-session-days')) {
    q('save-session-days').addEventListener('click', async () => {
      const raw = q('session-days').value;
      const days = raw === '' ? null : Number(raw);
      const { data } = await api('PATCH', '/profile/session-days', { days });
      if (!data.ok) { fail('duration-error', data.error); return; }
      fail('duration-error', '');
      location.reload();
    });
  }

  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-revoke]');
    if (!button) return;
    button.disabled = true;
    const id = button.getAttribute('data-revoke');
    const { data } = await api('POST', '/profile/sessions/' + id + '/revoke');
    if (!data.ok) { fail('session-error', data.error); button.disabled = false; return; }
    button.closest('tr').remove();
  });

  if (q('revoke-others')) {
    q('revoke-others').addEventListener('click', async () => {
      if (!confirm('Sign out every other device?')) return;
      const { data } = await api('POST', '/profile/sessions/revoke-others');
      if (!data.ok) { fail('session-error', data.error); return; }
      location.reload();
    });
  }

  if (q('start-2fa')) {
    q('start-2fa').addEventListener('click', async () => {
      const { data } = await api('POST', '/profile/2fa/start');
      if (!data.ok) { fail('2fa-error', data.error); return; }
      q('2fa-secret').textContent = data.secret;
      q('2fa-uri').textContent = data.uri;
      show('2fa-setup', true);
      q('start-2fa').disabled = true;
    });
  }

  if (q('confirm-2fa')) {
    q('confirm-2fa').addEventListener('click', async () => {
      const { data } = await api('POST', '/profile/2fa/confirm', { code: q('confirm-2fa-code').value.trim() });
      if (!data.ok) { fail('2fa-error', data.error); return; }
      fail('2fa-error', '');
      q('recovery-codes').textContent = data.recoveryCodes.join('\\n');
      show('recovery-panel', true);
      show('2fa-setup', false);
      const header = q('confirm-2fa').closest('.card').querySelector('.badge');
      if (header) { header.textContent = 'on'; header.className = 'badge ok'; }
    });
  }

  if (q('disable-2fa')) {
    q('disable-2fa').addEventListener('click', async () => {
      const { data } = await api('POST', '/profile/2fa/disable', { code: q('disable-code').value.trim() });
      if (!data.ok) { fail('2fa-error', data.error); return; }
      location.reload();
    });
  }

  if (q('regen-2fa')) {
    q('regen-2fa').addEventListener('click', async () => {
      const { data } = await api('POST', '/profile/2fa/recovery-codes', { code: q('regen-code').value.trim() });
      if (!data.ok) { fail('2fa-error', data.error); return; }
      show('recovery-panel', true);
      q('recovery-codes').textContent = data.recoveryCodes.join('\\n');
    });
  }

  if (q('email-request')) {
    q('email-request').addEventListener('click', async () => {
      const body = { newEmail: q('new-email').value.trim() };
      if (q('email-totp')) body.code = q('email-totp').value.trim();
      const { data } = await api('POST', '/profile/email/request', body);
      if (!data.ok) { fail('email-error', data.error); return; }
      location.reload();
    });
  }

  if (q('email-confirm')) {
    q('email-confirm').addEventListener('click', async () => {
      const { data } = await api('POST', '/profile/email/confirm', { code: q('email-confirm-code').value.trim() });
      if (!data.ok) { fail('email-error', data.error); return; }
      if (data.sessionToken) sessionStorage.setItem('sessionToken', data.sessionToken);
      location.reload();
    });
  }

  if (q('email-cancel')) {
    q('email-cancel').addEventListener('click', async () => {
      await api('POST', '/profile/email/cancel');
      location.reload();
    });
  }

  if (q('logout')) {
    q('logout').addEventListener('click', async () => {
      await api('POST', '/auth/logout');
      sessionStorage.removeItem('sessionToken');
      window.location.assign('/sign-in');
    });
  }
})();`;

  return layout({
    title: 'Your profile',
    nav: [
      { href: '/profile', label: 'Profile' },
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
    body,
    script,
  });
}
