@extends('layouts.auth')

@section('title', 'Verify your code')

@section('content')
    <a class="back-link" href="{{ route('login') }}">&larr; Use a different email</a>

    <h1>Check your email</h1>
    <p class="subtitle">Enter the 6-digit code we sent to <span class="email-label">{{ $email }}</span>.</p>

    {{-- Persistent helper banner — visible for the entire verification step. --}}
    <div class="banner" role="status">
        <span aria-hidden="true">&#9432;</span>
        <span>Please check your inbox <strong>and your spam/junk folder</strong>. The email may take a moment to arrive.</span>
    </div>

    <div class="error-box" id="verify-error" role="alert" hidden></div>
    <div class="success-box" id="verify-success" role="status" hidden></div>

    <form method="POST" action="{{ route('passwordless.verify.submit') }}" id="verify-form" novalidate>
        @csrf

        <label for="otp-0">One-time code</label>
        <div class="otp-grid" id="otp-grid">
            @for ($i = 0; $i < 6; $i++)
                <input
                    type="tel"
                    class="otp-box"
                    id="otp-{{ $i }}"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="1"
                    pattern="[0-9]"
                    aria-label="Digit {{ $i + 1 }}"
                    {{ $i === 0 ? 'autofocus' : '' }}
                >
            @endfor
        </div>

        <input type="hidden" id="code" name="code">
        <input type="hidden" id="retry-after" value="{{ $retryAfter }}">

        <button type="submit" class="btn btn-primary" id="verify-btn">Verify code</button>
    </form>

    <div class="resend-row">
        <span class="countdown" id="countdown" aria-live="polite"></span>
        <button type="button" class="btn-link" id="resend-btn" disabled>Resend code</button>
    </div>

    <p class="footer">
        Trouble logging in?
        <a href="mailto:{{ config('passwordless.support_email', 'admin@example.com') }}">Contact admin</a>
    </p>
@endsection

@push('scripts')
<script>
    (function () {
        const inputs = Array.from(document.querySelectorAll('.otp-box'));
        const codeInput = document.getElementById('code');
        const form = document.getElementById('verify-form');
        const verifyBtn = document.getElementById('verify-btn');
        const errorEl = document.getElementById('verify-error');
        const successEl = document.getElementById('verify-success');
        const resendBtn = document.getElementById('resend-btn');
        const countdownEl = document.getElementById('countdown');

        const CSRF = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const RESEND_URL = @json(route('passwordless.resend'));

        let retryAfter = parseInt(document.getElementById('retry-after').value, 10) || 0;
        let timer = null;

        function combine() {
            codeInput.value = inputs.map(function (i) { return i.value; }).join('');
        }

        function showError(message) {
            successEl.hidden = true;
            errorEl.textContent = message;
            errorEl.hidden = false;
            verifyBtn.disabled = false;
        }

        function showSuccess(message) {
            errorEl.hidden = true;
            successEl.textContent = message;
            successEl.hidden = false;
        }

        // Auto-focus cascade + paste-to-fill.
        inputs.forEach(function (input, idx) {
            input.addEventListener('input', function () {
                if (input.value.length === 1 && idx < inputs.length - 1) {
                    inputs[idx + 1].focus();
                }
                combine();
            });

            input.addEventListener('keydown', function (e) {
                if (e.key === 'Backspace' && !input.value && idx > 0) {
                    inputs[idx - 1].focus();
                }
            });

            input.addEventListener('paste', function (e) {
                e.preventDefault();
                const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
                digits.split('').forEach(function (d, i) {
                    if (inputs[i]) inputs[i].value = d;
                });
                (inputs[Math.min(digits.length, inputs.length - 1)] || inputs[inputs.length - 1]).focus();
                combine();
            });
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            combine();

            if (codeInput.value.length !== 6) {
                showError('Enter the full 6-digit code.');
                return;
            }

            verifyBtn.disabled = true;
            errorEl.hidden = true;
            successEl.hidden = true;

            try {
                const res = await fetch(form.action, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-TOKEN': CSRF,
                    },
                    body: JSON.stringify({ code: codeInput.value }),
                });

                const data = await res.json();

                if (data.success) {
                    window.location.href = data.redirect;
                    return;
                }

                showError(data.message || 'Something went wrong. Please try again.');
            } catch (err) {
                showError('Network error. Please try again.');
            }
        });

        function startCountdown() {
            const tick = function () {
                if (retryAfter <= 0) {
                    clearInterval(timer);
                    countdownEl.textContent = '';
                    resendBtn.disabled = false;
                    return;
                }
                countdownEl.textContent = 'Resend code in ' + retryAfter + 's';
                resendBtn.disabled = true;
                retryAfter--;
            };
            tick();
            timer = setInterval(tick, 1000);
        }

        resendBtn.addEventListener('click', async function () {
            resendBtn.disabled = true;

            try {
                const res = await fetch(RESEND_URL, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'X-CSRF-TOKEN': CSRF,
                    },
                });

                const data = await res.json();

                retryAfter = data.retry_after || 30;
                startCountdown();

                if (data.success) {
                    showSuccess(data.message || 'A new code has been sent.');
                } else {
                    showError(data.message || 'Please wait before requesting a new code.');
                }
            } catch (err) {
                resendBtn.disabled = false;
                showError('Network error. Please try again.');
            }
        });

        if (retryAfter > 0) {
            startCountdown();
        } else {
            resendBtn.disabled = false;
        }
    })();
</script>
@endpush
