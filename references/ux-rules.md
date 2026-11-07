# UX Rules — Passwordless Email OTP

The behaviours that make the flow frictionless. Applies to any rendering approach (server templates,
React/Vue/Svelte, native mobile). Accessibility notes included.

---

## Screen 1 — Request (single email field)

- **One input** for both sign-in and sign-up. Label "Email address". `type="email"`,
  `autocomplete="email"`, `inputmode="email"`, autofocus.
- **No password field, no name field** up front — nothing else to decide or type.
- **Dynamic button state:**
  - Validate the email syntax client-side with a regex (permissive; the server is authoritative).
  - Enable the submit button **instantly** when the address is syntactically valid.
  - While disabled, show a **visible hint** ("Enter a valid email to continue") — never a silent,
    unexplained dead state.
- **Support link** at the base: "Trouble logging in? Contact admin" → `mailto:` (or a support route).
- **Server errors** (rate-limited, invalid) render inline on the form; input value is preserved.

### Accessibility
- The hint and button state are announced to screen readers (`aria-live="polite"` on the hint).
- The input has an associated `<label>`; the button has a clear text label.

---

## Screen 2 — Verify (code entry)

- **Context line:** "Enter the 8-digit code we sent to **{email}**."

- **Code entry — two acceptable patterns:**

  **Preferred:** a **single** field with `inputmode="numeric"` and `autocomplete="one-time-code"`.
  This is the most accessible and works with OS/browser OTP autofill.

  **Alternative (8-box grid):** eight side-by-side single-character inputs. If you choose this:
  - `inputmode="numeric"`, `maxlength="1"`, `pattern="[0-9]"`, `autocomplete="one-time-code"`.
  - **Auto-focus cascade:** typing a digit moves focus to the next box; backspace on an empty box
    moves focus back.
  - **Paste-to-fill:** pasting an 8-digit string fills all boxes and focuses the last.
  - One hidden combined input holds the full code for submission.
  - Each box has an `aria-label` ("Digit 1" … "Digit 8") and the grid is grouped with a label.

- **Persistent helper banner:** non-dismissing, info-styled: "Please check your inbox **and your
  spam/junk folder**." Visible for the entire verification step. Add: "Still nothing after ~60
  seconds? You can request a new code."

- **Resend + countdown:**
  - Show a 30-second countdown ("Resend code in 18s") with the resend button **disabled**.
  - At zero, activate "Resend code". The 30s is a **floor** — a slow mailbox is not the user's fault.
  - The server enforces the cooldown independently; if the client is out of sync, the server's
    `retry_after` resets the countdown.

- **Inline error:** an invalid/expired code shows an immediate inline message **without a page reload**
  (fetch/XHR and render the response, or client-side state update).

- **Support link** at the base (same as Screen 1).
- **Optional back link:** "Use a different email" returns to Screen 1.

### Accessibility
- The countdown uses `aria-live="polite"`; the error container has `role="alert"`.
- The banner uses `role="status"` so it is announced once without interrupting typing.
- Target sizes are ≥ 44px for inputs and buttons.

---

## Success

- **Direct redirect** to the app (dashboard/home) — no intermediate "you're logged in" interstitial.
- If a welcome/celebration is shown, keep it brief and non-blocking (the goal is *into the app fast*).

---

## Cross-screen consistency

- Same layout, typography, and button styles on both screens.
- Same support link on both forms.
- Submit buttons are ≥ 44px tall, primary colour, with clear `:focus-visible` rings.

---

## Error message copy (keep generic)

Use one message for every verification failure to avoid leaking whether a code/email was valid:

> "The code is invalid or has expired. Please request a new code."

Do **not** distinguish "wrong code" vs "expired" vs "unknown email" to the user.
