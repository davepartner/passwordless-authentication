/**
 * The sign-in / registration screen — the one place the acceptance checkboxes
 * appear, plus the optional second-factor step.
 *
 * Plain server-rendered HTML + a little fetch(), no framework, so the behaviour
 * is readable regardless of your stack.
 *
 * Both consent boxes are rendered **checked by default**, the labels link to the
 * real served documents in new tabs (so a half-completed form is not lost), and
 * both are still required: unchecking either blocks submission client-side *and*
 * the server rejects the request without an explicit acceptance.
 */

import { PRIVACY_PATH, TERMS_PATH } from './consent.js';
import { CLIENT_HELPERS, layout } from './ui.js';

const FORM_CSS = `
  .auth { max-width: 26rem; margin: 0 auto; }
  .auth .card { padding: 1.5rem; }
  .helper { font-size: .82rem; color: var(--muted); margin: .35rem 0 0; min-height: 1.2em; }
  .consent { display: flex; gap: .6rem; align-items: flex-start; font-size: .88rem; margin: .6rem 0; }
  .consent input { margin-top: .18rem; flex: none; }
  .banner { border: 1px solid var(--line); border-radius: 10px; padding: .7rem .8rem; font-size: .86rem; margin: 0 0 1rem; }
  .mt { margin-top: 1rem; }
  .foot { margin: 1.5rem 0 0; font-size: .8rem; color: var(--muted); text-align: center; }
`;

export function renderSignInPage(): string {
  const body = `<div class="auth">
  <div class="card">
    <h1>Sign in or create an account</h1>
    <p class="muted">One email. One code. No password.</p>

    <form id="request-form" novalidate>
      <label class="field" for="email">Email address</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email"
             required autofocus aria-describedby="email-hint">
      <p class="helper" id="email-hint" aria-live="polite">Enter a valid email to continue.</p>

      <fieldset style="border:0;padding:0;margin:1.1rem 0 .25rem">
        <legend class="field">Before you continue</legend>

        <div class="consent">
          <input id="accepted-terms" name="acceptedTerms" type="checkbox" checked required>
          <label for="accepted-terms">I agree to the
            <a href="${TERMS_PATH}" target="_blank" rel="noopener">Terms of Service</a>.</label>
        </div>

        <div class="consent">
          <input id="accepted-privacy" name="acceptedPrivacy" type="checkbox" checked required>
          <label for="accepted-privacy">I have read and accept the
            <a href="${PRIVACY_PATH}" target="_blank" rel="noopener">Privacy Policy</a>.</label>
        </div>
      </fieldset>

      <button id="request-submit" class="btn mt" type="submit" style="width:100%">Continue</button>
      <p class="error" id="request-error" role="alert"></p>
    </form>

    <form id="verify-form" class="hidden" novalidate>
      <p class="banner" role="status">Please check your inbox <strong>and your spam/junk
        folder</strong>. Still nothing after about a minute? Request a new code.</p>

      <label class="field" for="code">Enter the 8-digit code we sent to <span id="sent-to"></span></label>
      <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
             pattern="[0-9]*" maxlength="8" required>

      <button id="verify-submit" class="btn mt" type="submit" style="width:100%">Sign in</button>
      <button id="resend" class="btn btn-secondary mt" type="button" style="width:100%" disabled>
        Resend code in 30s</button>
      <p class="error" id="verify-error" role="alert"></p>
      <p class="helper"><a href="#" id="restart">Use a different email</a></p>
    </form>

    <form id="totp-form" class="hidden" novalidate>
      <p class="banner" role="status">Two-factor authentication is on for this account. Enter the
        6-digit code from your authenticator app — or one of your recovery codes.</p>

      <label class="field" for="totp-code">Authentication code</label>
      <input id="totp-code" name="code" type="text" inputmode="numeric"
             autocomplete="one-time-code" maxlength="14" required>

      <button id="totp-submit" class="btn mt" type="submit" style="width:100%">Verify and sign in</button>
      <p class="error" id="totp-error" role="alert"></p>
      <p class="helper">Lost your device? Use a recovery code, or ask your administrator to reset
        two-factor authentication.</p>
    </form>

    <p class="foot">Trouble signing in? <a href="mailto:support@example.com">Contact support</a>.</p>
  </div>
</div>`;

  const script = `${CLIENT_HELPERS}
(() => {
  const q = (id) => document.getElementById(id);
  const requestForm = q('request-form');
  const verifyForm = q('verify-form');
  const totpForm = q('totp-form');
  const emailInput = q('email');
  const submit = q('request-submit');
  const hint = q('email-hint');
  const requestError = q('request-error');
  const verifyError = q('verify-error');
  const totpError = q('totp-error');
  const codeInput = q('code');
  const totpInput = q('totp-code');
  const resend = q('resend');
  const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
  const CONSENT_ERROR = 'Please accept the Terms of Service and Privacy Policy to continue.';
  let requestId = null;
  let mfaToken = null;
  let timer = null;

  const consentGiven = () => q('accepted-terms').checked && q('accepted-privacy').checked;

  function refresh() {
    const emailOk = EMAIL_RE.test(emailInput.value.trim());
    const consentOk = consentGiven();
    submit.disabled = !(emailOk && consentOk);
    hint.textContent = consentOk
      ? (emailOk ? '' : 'Enter a valid email to continue.')
      : CONSENT_ERROR;
  }
  emailInput.addEventListener('input', refresh);
  q('accepted-terms').addEventListener('change', refresh);
  q('accepted-privacy').addEventListener('change', refresh);
  refresh();

  function startCountdown(seconds) {
    clearInterval(timer);
    let left = seconds;
    resend.disabled = true;
    const tick = () => {
      resend.textContent = left > 0 ? 'Resend code in ' + left + 's' : 'Resend code';
      if (left === 0) { resend.disabled = false; clearInterval(timer); }
      left -= 1;
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function showPanel(name) {
    requestForm.classList.toggle('hidden', name !== 'request');
    verifyForm.classList.toggle('hidden', name !== 'verify');
    totpForm.classList.toggle('hidden', name !== 'totp');
  }

  function finish(data) {
    if (data.sessionToken) sessionStorage.setItem('sessionToken', data.sessionToken);
    window.location.assign(data.redirect || '/dashboard');
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    requestError.textContent = '';
    if (!consentGiven()) { requestError.textContent = CONSENT_ERROR; return; }

    submit.disabled = true;
    const { data } = await api('POST', '/auth/otp/request', {
      email: emailInput.value.trim(),
      acceptedTerms: q('accepted-terms').checked,
      acceptedPrivacy: q('accepted-privacy').checked,
    });

    if (!data.ok) {
      requestError.textContent = data.error || 'Something went wrong. Please try again.';
      submit.disabled = false;
      return;
    }

    requestId = data.requestId;
    q('sent-to').textContent = emailInput.value.trim();
    showPanel('verify');
    codeInput.focus();
    startCountdown(data.resendAfter ?? 30);
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    verifyError.textContent = '';
    const { data } = await api('POST', '/auth/otp/verify', { requestId, code: codeInput.value.trim() });

    if (!data.ok) {
      verifyError.textContent = data.error || 'The code is invalid or has expired.';
      return;
    }
    if (data.requires2fa) {
      mfaToken = data.mfaToken;
      showPanel('totp');
      totpInput.value = '';
      totpInput.focus();
      return;
    }
    finish(data);
  });

  totpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    totpError.textContent = '';
    const { data } = await api('POST', '/auth/2fa/verify', { mfaToken, code: totpInput.value.trim() });
    if (!data.ok) {
      totpError.textContent = data.error || 'That code is invalid or has expired.';
      return;
    }
    finish(data);
  });

  resend.addEventListener('click', async () => {
    const { data } = await api('POST', '/auth/otp/resend', { requestId });
    if (!data.ok) { verifyError.textContent = data.error || 'Please wait before requesting a new code.'; return; }
    startCountdown(data.resendAfter ?? 30);
  });

  q('restart').addEventListener('click', (event) => {
    event.preventDefault();
    requestId = null;
    mfaToken = null;
    verifyError.textContent = '';
    showPanel('request');
    submit.disabled = false;
    refresh();
  });
})();`;

  return layout({
    title: 'Sign in',
    nav: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
    body: `<style>${FORM_CSS}</style>${body}`,
    script,
  });
}
