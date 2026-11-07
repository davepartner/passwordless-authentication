@extends('layouts.auth')

@section('title', 'Sign in')

@section('content')
    <h1>Sign in</h1>
    <p class="subtitle">Enter your email and we&rsquo;ll send you a one-time 6-digit code. No password needed.</p>

    @if ($errors->any())
        <div class="error-box" role="alert">
            {{ $errors->first() }}
        </div>
    @endif

    <form method="POST" action="{{ route('passwordless.send') }}" id="login-form" novalidate>
        @csrf

        <label for="email">Email address</label>
        <input
            type="email"
            id="email"
            name="email"
            value="{{ old('email') }}"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
            autofocus
            required
        >

        <p class="hint" id="email-hint">Enter a valid email to continue.</p>

        <button type="submit" class="btn btn-primary" id="submit-btn" disabled>Continue</button>
    </form>

    <p class="footer">
        Trouble logging in?
        <a href="mailto:{{ config('passwordless.support_email', 'admin@example.com') }}">Contact admin</a>
    </p>
@endsection

@push('scripts')
<script>
    (function () {
        const emailInput = document.getElementById('email');
        const submitBtn = document.getElementById('submit-btn');
        const hint = document.getElementById('email-hint');

        // Permissive client-side check; the server remains authoritative.
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

        function updateState() {
            const valid = EMAIL_RE.test(emailInput.value.trim());
            submitBtn.disabled = !valid;
            hint.textContent = valid
                ? 'We\u2019ll email you a 6-digit code.'
                : 'Enter a valid email to continue.';
            hint.classList.toggle('is-valid', valid);
        }

        emailInput.addEventListener('input', updateState);
        updateState();
    })();
</script>
@endpush
