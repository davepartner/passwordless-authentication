<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Sign in')</title>
    <style>
        :root {
            --bg: #f4f4f5;
            --surface: #ffffff;
            --border: #e4e4e7;
            --text: #18181b;
            --text-muted: #71717a;
            --accent: #2563eb;
            --accent-hover: #1d4ed8;
            --accent-contrast: #ffffff;
            --danger: #dc2626;
            --danger-bg: #fef2f2;
            --danger-border: #fecaca;
            --info-bg: #eff6ff;
            --info-border: #bfdbfe;
            --info-text: #1e40af;
            --success-bg: #f0fdf4;
            --success-border: #bbf7d0;
            --success-text: #15803d;
            --radius: 12px;
            --radius-sm: 8px;
            --focus-ring: 0 0 0 3px rgba(37, 99, 235, 0.35);
            --shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
            --font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            line-height: 1.5;
            padding: 16px;
        }

        .auth-card {
            width: 100%;
            max-width: 400px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 32px;
        }

        .auth-card h1 {
            margin: 0 0 8px;
            font-size: 1.5rem;
            font-weight: 600;
            letter-spacing: -0.01em;
        }

        .auth-card .subtitle {
            margin: 0 0 24px;
            color: var(--text-muted);
            font-size: 0.9375rem;
        }

        label {
            display: block;
            font-weight: 500;
            font-size: 0.875rem;
            margin-bottom: 6px;
        }

        input[type="email"],
        input[type="text"],
        input[type="tel"] {
            width: 100%;
            min-height: 44px;
            padding: 10px 12px;
            font-size: 1rem;
            font-family: inherit;
            color: var(--text);
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            transition: border-color 0.15s ease;
        }

        input:focus-visible,
        button:focus-visible {
            outline: none;
            border-color: var(--accent);
            box-shadow: var(--focus-ring);
        }

        button {
            font-family: inherit;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 48px;
            padding: 12px 16px;
            font-size: 1rem;
            font-weight: 600;
            border-radius: var(--radius-sm);
            border: 1px solid transparent;
            cursor: pointer;
            transition: background-color 0.15s ease, opacity 0.15s ease;
        }

        .btn-primary {
            background: var(--accent);
            color: var(--accent-contrast);
        }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }

        .btn:disabled {
            opacity: 0.55;
            cursor: not-allowed;
        }

        .hint {
            font-size: 0.8125rem;
            color: var(--text-muted);
            margin: 8px 0 20px;
        }
        .hint.is-valid { color: var(--success-text); }

        .banner {
            display: flex;
            gap: 10px;
            align-items: flex-start;
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            font-size: 0.875rem;
            background: var(--info-bg);
            border: 1px solid var(--info-border);
            color: var(--info-text);
            margin-bottom: 24px;
        }

        .error-box {
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            font-size: 0.875rem;
            background: var(--danger-bg);
            border: 1px solid var(--danger-border);
            color: var(--danger);
            margin-bottom: 16px;
        }

        .success-box {
            padding: 12px 14px;
            border-radius: var(--radius-sm);
            font-size: 0.875rem;
            background: var(--success-bg);
            border: 1px solid var(--success-border);
            color: var(--success-text);
            margin-bottom: 16px;
        }

        .otp-grid {
            display: flex;
            gap: 8px;
            justify-content: space-between;
            margin-bottom: 16px;
        }

        .otp-box {
            width: 44px;
            height: 56px;
            text-align: center;
            font-size: 1.5rem;
            font-weight: 600;
            font-family: inherit;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
        }
        .otp-box:focus-visible {
            outline: none;
            border-color: var(--accent);
            box-shadow: var(--focus-ring);
        }

        .resend-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin: 8px 0 20px;
            font-size: 0.875rem;
        }
        .resend-row .countdown { color: var(--text-muted); }

        .btn-link {
            background: none;
            border: none;
            padding: 0;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--accent);
            cursor: pointer;
            text-decoration: underline;
        }
        .btn-link:disabled { color: var(--text-muted); cursor: not-allowed; text-decoration: none; }

        .footer {
            margin-top: 24px;
            text-align: center;
            font-size: 0.875rem;
            color: var(--text-muted);
        }
        .footer a { color: var(--accent); text-decoration: none; }
        .footer a:hover { text-decoration: underline; }

        .email-label {
            font-weight: 600;
            word-break: break-all;
        }

        .back-link {
            display: inline-block;
            margin-bottom: 20px;
            font-size: 0.875rem;
            color: var(--accent);
            text-decoration: none;
        }
        .back-link:hover { text-decoration: underline; }

        [hidden] { display: none !important; }
    </style>
</head>
<body>
    <main class="auth-card">
        @yield('content')
    </main>
    @stack('scripts')
</body>
</html>
