/**
 * Real, served legal documents — Terms of Service and Privacy Policy.
 *
 * These are deliberately complete pages, not links to nowhere and not
 * placeholders: a registration checkbox may only point at a document a user can
 * actually open and read. Replace the operator details below with your own
 * entity before going to production, then have counsel review the text.
 *
 * Both documents describe *this* app's actual behaviour: a passwordless email
 * one-time-code sign-in service with optional social login and on-device
 * biometric unlock. If your app collects more than this, update the documents —
 * an inaccurate privacy policy is worse than none.
 */

import { PRIVACY_VERSION, TERMS_VERSION } from './consent.js';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const LEGAL_ENTITY = process.env.LEGAL_ENTITY ?? 'Passwordless Auth';
export const LEGAL_CONTACT_EMAIL = process.env.LEGAL_CONTACT_EMAIL ?? 'legal@example.com';
export const LEGAL_PRIVACY_EMAIL = process.env.LEGAL_PRIVACY_EMAIL ?? 'privacy@example.com';
export const LEGAL_ADDRESS = process.env.LEGAL_ADDRESS ?? '1 Example Street, Example City';
export const LEGAL_JURISDICTION = process.env.LEGAL_JURISDICTION ?? 'England and Wales';
export const LEGAL_EFFECTIVE_DATE = '14 November 2026';

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 2.5rem 1.25rem 6rem; max-width: 46rem;
    font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1a1a1a; background: #fff;
  }
  @media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #101014; } }
  header { border-bottom: 1px solid currentColor; opacity: .95; padding-bottom: 1rem; margin-bottom: 2rem; }
  h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 .35rem; }
  h2 { font-size: 1.15rem; margin: 2.25rem 0 .5rem; }
  h3 { font-size: 1rem; margin: 1.5rem 0 .35rem; }
  .meta { font-size: .85rem; opacity: .75; margin: 0; }
  .lede { font-size: 1.02rem; }
  ul, ol { padding-left: 1.35rem; }
  li { margin: .35rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: .93rem; }
  th, td { text-align: left; vertical-align: top; padding: .5rem .6rem; border-bottom: 1px solid rgba(128,128,128,.35); }
  th { font-weight: 600; }
  a { color: inherit; text-underline-offset: 3px; }
  nav a + a { margin-left: 1rem; }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid rgba(128,128,128,.4); font-size: .85rem; opacity: .8; }
  :focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} — ${escapeHtml(LEGAL_ENTITY)}</title>
  <style>${STYLES}</style>
</head>
<body>
<header>
  <nav><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/sign-in">Sign in</a></nav>
</header>
<main>
${body}
</main>
<footer>
  <p>${escapeHtml(LEGAL_ENTITY)} — ${escapeHtml(LEGAL_ADDRESS)}.
  Questions: <a href="mailto:${escapeHtml(LEGAL_CONTACT_EMAIL)}">${escapeHtml(LEGAL_CONTACT_EMAIL)}</a>.</p>
</footer>
</body>
</html>`;
}

export function renderTermsPage(): string {
  const entity = escapeHtml(LEGAL_ENTITY);
  const jurisdiction = escapeHtml(LEGAL_JURISDICTION);
  const contact = escapeHtml(LEGAL_CONTACT_EMAIL);

  return page('Terms of Service', `
  <h1>Terms of Service</h1>
  <p class="meta">Version ${escapeHtml(TERMS_VERSION)} · Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p>
  <p class="lede">These Terms of Service ("Terms") are an agreement between you and ${entity}
  ("we", "us") and govern your use of the ${entity} application and any related services
  (the "Service"). By creating an account or using the Service you agree to these Terms.
  If you do not agree, do not use the Service.</p>

  <h2>1. Who may use the Service</h2>
  <p>You must be at least 16 years old and legally able to enter into a contract. If you use the
  Service on behalf of an organisation, you confirm you have authority to bind that organisation
  to these Terms.</p>

  <h2>2. How the Service works</h2>
  <p>${entity} provides passwordless sign-in. You enter an email address, we send a one-time code
  to that address, and entering the code signs you in or creates your account. There is no
  password. Optional features include signing in with a third-party identity provider (for
  example Google, GitHub or LinkedIn) and unlocking the app on a mobile device with the device's
  own biometric authentication.</p>
  <p>One-time codes are single-use, expire after a short period, and are stored only as salted
  hashes. See the <a href="/privacy">Privacy Policy</a> for what we retain.</p>

  <h2>3. Your account</h2>
  <ul>
    <li>You are responsible for the email address you register and for keeping access to that
    inbox secure. Anyone who can read the code sent to your address can sign in as you.</li>
    <li>Provide accurate information and keep it current.</li>
    <li>Do not share your account or let another person use it as their own.</li>
    <li>Tell us promptly at <a href="mailto:${contact}">${contact}</a> if you believe your account
    or inbox has been compromised, so we can revoke sessions and enrolled devices.</li>
    <li>You may delete your account at any time (see the Privacy Policy for how, and for what
    happens to your data).</li>
  </ul>
  <p>We may suspend or end access if these Terms are broken, if required by law, or to protect the
  Service or other users.</p>

  <h2>4. Acceptable use</h2>
  <p>You agree not to:</p>
  <ul>
    <li>request codes for email addresses you do not control, or use the Service to harass,
    spam or flood anyone's inbox;</li>
    <li>attempt to access another person's account, or probe, scan or test the security of the
    Service without our written permission;</li>
    <li>automate sign-in attempts, brute-force codes, or work around rate limits and other
    technical controls;</li>
    <li>interfere with the Service, reverse engineer it except where the law says you may, or use
    it to break any law;</li>
    <li>use the Service to send unlawful, infringing or harmful content through any feature we
    provide.</li>
  </ul>

  <h2>5. Third-party sign-in</h2>
  <p>If you choose to sign in with Google, GitHub, LinkedIn or another provider, that provider's
  own terms and privacy policy apply to your use of their service. We receive only the identity
  information needed to sign you in, and we link it to your account only when the provider
  confirms the email address is verified.</p>

  <h2>6. Biometric unlock</h2>
  <p>Biometric unlock is optional. It works by storing a cryptographic key pair on your device,
  protected by your device's secure hardware and unlocked by your Face ID, Touch ID or fingerprint.
  Your biometric data never leaves your device and is never sent to us — we store only the public
  half of the key pair, which cannot be used to impersonate you. You can revoke any enrolled device
  from your account settings, and revoking it removes the stored public key on our side.</p>

  <h2>7. Our intellectual property</h2>
  <p>The Service, including its software, design and content we create, is owned by ${entity} or
  its licensors and is protected by intellectual-property law. We grant you a limited,
  non-exclusive, non-transferable right to use the Service under these Terms. You keep ownership
  of anything you submit, and grant us the licence needed to operate the Service for you.</p>

  <h2>8. Availability and changes</h2>
  <p>The Service is provided on an "as available" basis. We may add, change or remove features,
  and we may interrupt the Service for maintenance or security work. The Service depends on email
  delivery; if a code does not arrive, you can request another after the cooldown and contact
  support. We do not promise uninterrupted or error-free operation.</p>

  <h2>9. Disclaimers and limitation of liability</h2>
  <p>To the fullest extent permitted by law, the Service is provided without warranties of any
  kind, express or implied, including fitness for a particular purpose and non-infringement.
  Nothing in these Terms excludes liability that cannot lawfully be excluded, including for death
  or personal injury caused by negligence, or for fraud.</p>
  <p>Subject to that, we are not liable for indirect or consequential loss, loss of profit,
  goodwill or data, or for loss caused by your failure to keep your email account secure. Our
  total liability arising out of or relating to the Service is limited to the greater of the amount
  you paid us in the twelve months before the event and the minimum amount required by applicable
  law.</p>

  <h2>10. Ending the agreement</h2>
  <p>You may stop using the Service and delete your account at any time. We may suspend or
  terminate access as described in section 3. Sections that by their nature survive termination —
  including intellectual property, disclaimers, liability and governing law — continue to apply.</p>

  <h2>11. Governing law and disputes</h2>
  <p>These Terms are governed by the laws of ${jurisdiction}, and the courts of ${jurisdiction}
  have exclusive jurisdiction, except where consumer law gives you the right to bring a claim in
  your country of residence. Before starting formal proceedings, please contact us at
  <a href="mailto:${contact}">${contact}</a> so we can try to resolve the issue.</p>

  <h2>12. Changes to these Terms</h2>
  <p>We may update these Terms. If a change is material we will tell you before it takes effect
  and, where required, ask you to accept the new version the next time you sign in; until you do,
  you may export your data and close your account. The version number and effective date at the
  top of this page always identify the text you agreed to, and we keep a record of the version you
  accepted.</p>

  <h2>13. Contact</h2>
  <p>${entity}, ${escapeHtml(LEGAL_ADDRESS)}. Email
  <a href="mailto:${contact}">${contact}</a>.</p>
  `);
}

export function renderPrivacyPage(): string {
  const entity = escapeHtml(LEGAL_ENTITY);
  const contact = escapeHtml(LEGAL_PRIVACY_EMAIL);
  const jurisdiction = escapeHtml(LEGAL_JURISDICTION);

  return page('Privacy Policy', `
  <h1>Privacy Policy</h1>
  <p class="meta">Version ${escapeHtml(PRIVACY_VERSION)} · Effective ${escapeHtml(LEGAL_EFFECTIVE_DATE)}</p>
  <p class="lede">This policy explains what ${entity} collects when you use passwordless
  sign-in, why, how long we keep it, and the choices you have. It covers the app, the sign-in
  screens and any email we send you. It is written to be read — the short version is that we
  collect the minimum an email-code sign-in needs, and we do not sell your data or run
  advertising trackers.</p>

  <h2>1. Who is responsible</h2>
  <p>${entity}, ${escapeHtml(LEGAL_ADDRESS)}, is the controller of the personal data described
  here. For any privacy question or request, contact
  <a href="mailto:${contact}">${contact}</a>.</p>

  <h2>2. What we collect</h2>
  <table>
    <thead><tr><th>Data</th><th>When</th><th>Why</th></tr></thead>
    <tbody>
      <tr><td>Email address</td><td>When you sign in or register</td>
        <td>To send your one-time code and to identify your account</td></tr>
      <tr><td>One-time code (stored only as a salted hash)</td><td>Each sign-in attempt</td>
        <td>To verify the code you enter and to expire it</td></tr>
      <tr><td>Sign-in metadata: IP address, timestamps, attempt counts, delivery status</td>
        <td>Each sign-in attempt</td>
        <td>Rate limiting, abuse prevention, deliverability and security auditing</td></tr>
      <tr><td>Session records: token identifier and expiry</td><td>Each session</td>
        <td>To keep you signed in and to let you revoke access</td></tr>
      <tr><td>Device public keys and device labels (biometric unlock)</td>
        <td>Only if you enable it</td>
        <td>To verify a signed challenge from your device</td></tr>
      <tr><td>Third-party identity: provider name, provider user ID, verified email</td>
        <td>Only if you use social sign-in</td>
        <td>To sign you in and link your account safely</td></tr>
      <tr><td>Consent record: which version of the Terms and this policy you accepted, and when</td>
        <td>At registration and on re-acceptance</td>
        <td>To evidence your agreement and to know when to show you a new version</td></tr>
    </tbody>
  </table>

  <h3>What we do not collect</h3>
  <ul>
    <li><strong>No passwords.</strong> There is nothing to store, because there is no password.</li>
    <li><strong>No raw one-time codes.</strong> Codes are hashed before storage and never written
    to logs or returned to the browser.</li>
    <li><strong>No biometric data.</strong> Face ID, Touch ID and fingerprint matching happen
    entirely on your device. We never see or receive your face, fingerprint or biometric template.</li>
    <li><strong>No advertising or cross-site tracking.</strong> We do not embed ad networks or
    third-party analytics that profile you across other sites.</li>
  </ul>

  <h2>3. Why we process it, and our legal basis</h2>
  <ul>
    <li><strong>To provide the Service</strong> (sending codes, signing you in, keeping your
    account) — necessary to perform our contract with you.</li>
    <li><strong>To keep the Service safe</strong> (rate limiting, abuse prevention, fraud and
    enumeration defence, security logs) — our legitimate interests, and in some cases legal
    obligations.</li>
    <li><strong>To meet the law</strong> (record-keeping, responding to lawful requests) — legal
    obligation.</li>
    <li><strong>To send you service email</strong> (codes, security notices) — necessary to perform
    the contract. These are not marketing messages. We do not send marketing without a separate,
    specific opt-in that you can withdraw at any time.</li>
  </ul>

  <h2>4. How long we keep it</h2>
  <table>
    <thead><tr><th>Data</th><th>Retention</th></tr></thead>
    <tbody>
      <tr><td>One-time code challenges (code hash, attempt count)</td>
        <td>Deleted on success, or purged shortly after expiry (10 minutes by default), maximum 24 hours</td></tr>
      <tr><td>IP address and sign-in attempt logs</td><td>Up to 90 days, then deleted or aggregated</td></tr>
      <tr><td>Session records</td><td>Until the session expires or you sign out or revoke it</td></tr>
      <tr><td>Account and consent record</td><td>While your account exists; the consent record is kept for as long as we need to evidence it, then deleted with the account, except where law requires longer</td></tr>
      <tr><td>Device public keys</td><td>Until you revoke the device or delete your account</td></tr>
    </tbody>
  </table>

  <h2>5. Who we share it with</h2>
  <p>We do not sell your personal data. We share it only with:</p>
  <ul>
    <li><strong>Email delivery providers</strong> — they transmit your one-time code to your address.</li>
    <li><strong>Hosting and infrastructure providers</strong> — they store data on our behalf under contract.</li>
    <li><strong>Identity providers you choose</strong> — Google, GitHub, LinkedIn and similar, only when you use social sign-in.</li>
    <li><strong>Authorities</strong> — where we are legally required to disclose, or to protect rights and safety.</li>
    <li><strong>A successor</strong> — if the Service is merged or acquired, data may transfer as part of that transaction, under this policy.</li>
  </ul>
  <p>All processors act on our instructions under written terms and are bound to confidentiality
  and security obligations.</p>

  <h2>6. International transfers</h2>
  <p>Some providers may process data outside your country. Where that happens we rely on an
  approved transfer mechanism (for example the UK or EU Standard Contractual Clauses) and apply
  appropriate safeguards. You can ask us for details of the mechanism used.</p>

  <h2>7. How we protect it</h2>
  <ul>
    <li>Transport encryption (HTTPS) for the app and every page, including this one.</li>
    <li>One-time codes stored as salted hashes and compared in constant time, so a database copy
    does not reveal usable codes.</li>
    <li>Strict expiry, attempt limits and server-side rate limiting on sign-in and code delivery.</li>
    <li>Single-use challenges and session regeneration on sign-in to prevent replay and fixation.</li>
    <li>Sessions and device keys you can revoke at any time.</li>
    <li>Access to production data limited to staff who need it, with logging.</li>
  </ul>
  <p>No system is perfectly secure. If a breach affects your data we will notify you and the
  relevant regulator as required by law.</p>

  <h2>8. Your rights</h2>
  <p>Depending on where you live, you may have the right to access, correct, delete, restrict or
  object to processing of your data, to data portability, and to withdraw consent (without
  affecting processing already carried out). You also have the right not to be subject to solely
  automated decisions that significantly affect you — we do not make any.</p>
  <p>To exercise a right, email <a href="mailto:${contact}">${contact}</a> from the address on
  your account. We respond within one month (or the period your local law allows) and may ask you
  to verify control of the address first — which is the same proof we use to sign you in. If you
  are in the UK or EU you may also complain to your local data-protection authority; we would
  appreciate the chance to resolve it first.</p>
  <p><strong>California residents:</strong> we do not sell or share personal information for
  cross-context behavioural advertising, and we do not discriminate against you for exercising
  these rights.</p>

  <h2>9. Cookies and local storage</h2>
  <p>We use a strictly necessary session cookie or token to keep you signed in. We do not use
  advertising cookies or third-party tracking cookies, so there is no consent banner to dismiss.
  If we ever add non-essential cookies, we will ask first.</p>

  <h2>10. Children</h2>
  <p>The Service is not directed at children under 16 and we do not knowingly collect their data.
  If you believe a child has created an account, contact us and we will delete it.</p>

  <h2>11. Automated email</h2>
  <p>The only email we send for sign-in is a one-time code. We may also send essential security
  notices (for example, a new device was enrolled). You cannot opt out of essential service
  messages while you hold an account, but you can close your account at any time.</p>

  <h2>12. Changes to this policy</h2>
  <p>We may update this policy. The version number and effective date at the top always identify
  the text in force, and we keep a record of the version you accepted. If a change materially
  affects how we use your data, we will tell you before it applies and, where the law requires,
  ask you to accept the updated policy before you continue.</p>

  <h2>13. Contact</h2>
  <p>${entity}, ${escapeHtml(LEGAL_ADDRESS)} — privacy questions:
  <a href="mailto:${contact}">${contact}</a>.</p>
  <p class="meta">This policy is governed by the laws of ${jurisdiction}. See also our
  <a href="/terms">Terms of Service</a>.</p>
  `);
}
