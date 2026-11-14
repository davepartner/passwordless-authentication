import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TERMS_VERSION,
  PRIVACY_VERSION,
  consentFromInput,
  needsReconsent,
  mergeConsent,
  CONSENT_REQUIRED_ERROR,
} from './consent.js';
import { renderTermsPage, renderPrivacyPage } from './legal-pages.js';
import { renderSignInPage } from './views.js';

test('consent requires both boxes to be explicitly accepted', () => {
  assert.equal(consentFromInput({ acceptedTerms: true, acceptedPrivacy: true }).ok, true);

  const missingPrivacy = consentFromInput({ acceptedTerms: true });
  assert.equal(missingPrivacy.ok, false);
  if (!missingPrivacy.ok) assert.equal(missingPrivacy.error, CONSENT_REQUIRED_ERROR);

  const unchecked = consentFromInput({ acceptedTerms: true, acceptedPrivacy: false });
  assert.equal(unchecked.ok, false);

  // Strings other than the HTML form values are not acceptance.
  assert.equal(consentFromInput({ acceptedTerms: 'yes', acceptedPrivacy: 'yes' }).ok, false);
});

test('consent accepts HTML form values ("on" / "true")', () => {
  const result = consentFromInput({ acceptedTerms: 'on', acceptedPrivacy: 'true' });
  assert.equal(result.ok, true);
});

test('consent stamps the version that was actually accepted', () => {
  const result = consentFromInput({ acceptedTerms: true, acceptedPrivacy: true }, 1_700_000_000_000);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.consent.termsVersion, TERMS_VERSION);
  assert.equal(result.consent.privacyVersion, PRIVACY_VERSION);
  assert.equal(result.consent.termsAcceptedAt, 1_700_000_000_000);
  assert.equal(result.consent.privacyAcceptedAt, 1_700_000_000_000);
});

test('needsReconsent is true when the stored versions are stale or absent', () => {
  assert.equal(needsReconsent({}), true);
  assert.equal(needsReconsent({ termsVersion: '0.9.0', privacyVersion: PRIVACY_VERSION }), true);
  assert.equal(
    needsReconsent({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION }),
    false,
  );
});

test('re-accepting the same version preserves the original accept time', () => {
  const original = {
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: 1000,
    privacyVersion: PRIVACY_VERSION,
    privacyAcceptedAt: 1000,
  };
  const merged = mergeConsent(original, {
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: 9999,
    privacyVersion: PRIVACY_VERSION,
    privacyAcceptedAt: 9999,
  });
  assert.equal(merged.termsAcceptedAt, 1000);
  assert.equal(merged.privacyAcceptedAt, 1000);
  assert.notEqual(merged, original); // immutable update
});

test('accepting a newer version stamps the new accept time', () => {
  const merged = mergeConsent(
    { termsVersion: '0.9.0', termsAcceptedAt: 1000, privacyVersion: '0.9.0', privacyAcceptedAt: 1000 },
    { termsVersion: TERMS_VERSION, termsAcceptedAt: 5000, privacyVersion: PRIVACY_VERSION, privacyAcceptedAt: 5000 },
  );
  assert.equal(merged.termsAcceptedAt, 5000);
  assert.equal(merged.privacyAcceptedAt, 5000);
});

test('the legal pages are real documents served at the paths the boxes point to', () => {
  const terms = renderTermsPage();
  const privacy = renderPrivacyPage();

  assert.match(terms, /<title>Terms of Service/);
  assert.ok(terms.includes('href="/privacy"'));
  assert.match(terms, /limitation of liability/i);

  assert.match(privacy, /<title>Privacy Policy/);
  assert.ok(privacy.includes('href="/terms"'));
  assert.match(privacy, /one-time code/i);

  // Both carry a version + effective date so acceptance can be tied to a text.
  assert.ok(terms.includes(`Version ${TERMS_VERSION}`));
  assert.ok(privacy.includes(`Version ${PRIVACY_VERSION}`));
});

test('the sign-in form renders both boxes checked by default and required', () => {
  const html = renderSignInPage();

  const termsBox = html.match(/<input[^>]*id="accepted-terms"[^>]*>/)?.[0] ?? '';
  const privacyBox = html.match(/<input[^>]*id="accepted-privacy"[^>]*>/)?.[0] ?? '';

  assert.ok(termsBox.includes('type="checkbox"'));
  assert.ok(termsBox.includes('checked'));
  assert.ok(termsBox.includes('required'));
  assert.ok(privacyBox.includes('type="checkbox"'));
  assert.ok(privacyBox.includes('checked'));
  assert.ok(privacyBox.includes('required'));

  // The labels link to the real, served pages.
  assert.ok(html.includes('href="/terms"'));
  assert.ok(html.includes('href="/privacy"'));
});
