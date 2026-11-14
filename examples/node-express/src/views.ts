/**
 * The sign-in / registration screen — the one place the acceptance checkboxes
 * appear. Plain server-rendered HTML + a little fetch(), no framework, so the
 * behaviour is readable regardless of your stack.
 *
 * Both boxes are rendered **checked by default**, the labels link to the real
 * served documents in new tabs (so a half-completed form is not lost), and both
 * are still required: unchecking either blocks submission client-side *and* the
 * server rejects the request without an explicit acceptance.
 */

import { PRIVACY_PATH, TERMS_PATH } from './consent.js';

const STYLES = `
  :root { color-scheme: light dark; --accent: #1f6feb; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 2rem 1.25rem;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #f6f7f9;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #101014; }
    .card { background: #17171d; border-color: #2a2a33; }
    input[type=email], input[type=text] { background: #101014; border-color: #3a3a45; color: inherit; }
  }
  .card { width: 100%; max-width: 26rem; background: #fff; border: 1px solid #e3e5e8; border-radius: 14px; padding: 1.75rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub { margin: 0 0 1.5rem; font-size: .92rem; opacity: .75; }
  label.field { display: block; font-weight: 600; font-size: .88rem; margin-bottom: .4rem; }
  input[type=email], input[type=text] {
    width: 100%; padding: .8rem .85rem; font: inherit; border: 1px solid #cfd3d8; border-radius: 10px;
  }
  input[type=email]:focus-visible, input[type=text]:focus-visible, button:focus-visible, input[type=checkbox]:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  .hint { font-size: .82rem; opacity: .7; margin: .35rem 0 0; min-height: 1.2em; }
  fieldset { border: 0; padding: 0; margin: 1.35rem 0 .25rem; }
  .consent { display: flex; gap: .6rem; align-items: flex-start; font-size: .88rem; margin: 0 0 .7rem; }
  .consent input { width: 1.15rem; height: 1.15rem; margin: .18rem 0 0; flex: none; accent-color: var(--accent); }
  .consent + .consent { margin-bottom: 0; }
  button {
    width: 100%; margin-top: 1.35rem; padding: .85rem 1rem; font: inherit; font-weight: 600;
    color: #fff; background: var(--accent); border: 0; border-radius: 10px; cursor: pointer; min-height: 48px;
  }
  button[disabled] { opacity: .5; cursor: not-allowed; }
  button.secondary { background: transparent; color: inherit; border: 1px solid currentColor; }
  .error { color: #b3261e; font-size: .88rem; margin: .9rem 0 0; min-height: 1.2em; }
  @media (prefers-color-scheme: dark) { .error { color: #ff8b82; } }
  .banner { border: 1px solid #cfd3d8; border-radius: 10px; padding: .75rem .85rem; font-size: .86rem; margin: 0 0 1.25rem; }
  .hidden { display: none !important; }
  .foot { margin: 1.5rem 0 0; font-size: .8rem; opacity: .7; text-align: center; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

export function renderSignInPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in</title>
  <style>${STYLES}</style>
</head>
<body>
<main class="card">
  <h1>Sign in or create an account</h1>
  <p class="sub">One email. One code. No password.</p>

  <!-- Step 1 — request -->
  <form id="request-form" novalidate>
    <label class="field" for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" inputmode="email"
           required autofocus aria-describedby="email-hint">
    <p class="hint" id="email-hint" aria-live="polite">Enter a valid email to continue.</p>

    <fieldset>
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

    <button id="request-submit" type="submit">Continue</button>
    <p class="error" id="request-error" role="alert"></p>
  </form>

  <!-- Step 2 — verify -->
  <form id="verify-form" class="hidden" novalidate>
    <p class="banner" role="status">Please check your inbox <strong>and your spam/junk
      folder</strong>. Still nothing after about a minute? Request a new code.</p>

    <label class="field" for="code">Enter the 8-digit code we sent to <span id="sent-to"></span></label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
           pattern="[0-9]*" maxlength="8" required aria-describedby="verify-error">

    <button id="verify-submit" type="submit">Sign in</button>
    <button id="resend" class="secondary" type="button" disabled>Resend code in 30s</button>
    <p class="error" id="verify-error" role="alert"></p>
  </form>

  <p class="foot">Trouble signing in? <a href="mailto:support@example.com">Contact support</a>.</p>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const requestForm = $('request-form');
  const verifyForm = $('verify-form');
  const emailInput = $('email');
  const submit = $('request-submit');
  const hint = $('email-hint');
  const requestError = $('request-error');
  const verifyError = $('verify-error');
  const codeInput = $('code');
  const resend = $('resend');
  const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;
  const CONSENT_ERROR = 'Please accept the Terms of Service and Privacy Policy to continue.';
  let requestId = null;
  let timer = null;

  const consentGiven = () =>
    $('accepted-terms').checked && $('accepted-privacy').checked;

  function refresh() {
    const emailOk = EMAIL_RE.test(emailInput.value.trim());
    const consentOk = consentGiven();
    submit.disabled = !(emailOk && consentOk);
    hint.textContent = consentOk
      ? (emailOk ? '' : 'Enter a valid email to continue.')
      : CONSENT_ERROR;
  }
  emailInput.addEventListener('input', refresh);
  $('accepted-terms').addEventListener('change', refresh);
  $('accepted-privacy').addEventListener('change', refresh);
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

  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    requestError.textContent = '';
    if (!consentGiven()) { requestError.textContent = CONSENT_ERROR; return; }

    submit.disabled = true;
    const { body } = await post('/auth/otp/request', {
      email: emailInput.value.trim(),
      acceptedTerms: $('accepted-terms').checked,
      acceptedPrivacy: $('accepted-privacy').checked,
    });

    if (!body.ok) {
      requestError.textContent = body.error || 'Something went wrong. Please try again.';
      submit.disabled = false;
      return;
    }

    requestId = body.requestId;
    $('sent-to').textContent = emailInput.value.trim();
    requestForm.classList.add('hidden');
    verifyForm.classList.remove('hidden');
    codeInput.focus();
    startCountdown(body.resendAfter ?? 30);
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    verifyError.textContent = '';
    const { body } = await post('/auth/otp/verify', { requestId, code: codeInput.value.trim() });

    if (!body.ok) {
      verifyError.textContent = body.error || 'The code is invalid or has expired.';
      return;
    }
    if (body.sessionToken) sessionStorage.setItem('sessionToken', body.sessionToken);
    window.location.assign(body.redirect || '/dashboard');
  });

  resend.addEventListener('click', async () => {
    const { body } = await post('/auth/otp/resend', { requestId });
    if (!body.ok) { verifyError.textContent = body.error || 'Please wait before requesting a new code.'; return; }
    startCountdown(body.resendAfter ?? 30);
  });
})();
</script>
</body>
</html>`;
}
