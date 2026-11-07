<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Passwordless Email OTP Authentication
    |--------------------------------------------------------------------------
    |
    | Configuration for the passwordless one-time-code login flow. All values
    | are read through config('passwordless.*') so the system degrades to
    | sensible defaults if this file is missing.
    |
    */

    // One-time passcode behaviour.
    'otp' => [

        // Number of digits in the code.
        'length' => 6,

        // How long (minutes) a code remains valid after it is issued.
        'lifetime_minutes' => 10,

        // Number of wrong guesses allowed before the challenge is invalidated.
        'max_attempts' => 5,
    ],

    // Minimum seconds a user must wait before requesting another code.
    // Enforced on the server; the client mirrors this as a countdown.
    'resend_cooldown_seconds' => 30,

    // Server-side rate limits. Keys are cache-prefixed and shared across nodes
    // when a distributed cache driver (redis/database) is configured.
    'send_rate_limit' => [
        'per_email_per_hour' => 10,
        'per_ip_per_hour' => 20,
    ],

    'verify_rate_limit' => [
        'per_email_per_15_min' => 10,
    ],

    // Shown on the "Trouble logging in? Contact admin" link.
    'support_email' => env('PASSWORDLESS_SUPPORT_EMAIL', 'admin@example.com'),

    // Where the user is sent after a successful login.
    'post_login_redirect' => '/dashboard',

    // When true, a first-time email is auto-registered on successful verification.
    'auto_register' => true,
];
