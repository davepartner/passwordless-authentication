<?php

namespace App\Http\Controllers;

use App\Services\PasswordlessAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class PasswordlessLoginController extends Controller
{
    public function __construct(private PasswordlessAuthService $auth)
    {
    }

    /**
     * GET /login — the single-field entry form.
     */
    public function showRequestForm(): View
    {
        return view('auth.login');
    }

    /**
     * POST /login — validate email, issue + send the OTP, move to verification.
     *
     * Enumeration-safe: no user lookup, identical response for any email.
     */
    public function send(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'email', 'max:255'],
        ]);

        $email = strtolower(trim($data['email']));
        $ip = $request->ip();

        if ($error = $this->sendGuard($email, $ip)) {
            throw ValidationException::withMessages(['email' => $error]);
        }

        $this->auth->issueAndSend($email, $ip);

        $request->session()->put('passwordless.email', $email);
        $request->session()->put(
            'passwordless.resend_available_at',
            now()->addSeconds((int) config('passwordless.resend_cooldown_seconds', 30))->timestamp
        );

        return redirect()->route('passwordless.verify');
    }

    /**
     * GET /login/verify — the 6-box verification form.
     */
    public function showVerifyForm(Request $request): RedirectResponse|View
    {
        if (! $request->session()->has('passwordless.email')) {
            return redirect()->route('login');
        }

        $email = $request->session()->get('passwordless.email');
        $resendAvailableAt = (int) $request->session()->get('passwordless.resend_available_at', 0);
        $retryAfter = max(0, $resendAvailableAt - now()->timestamp);

        return view('auth.verify', compact('email', 'retryAfter'));
    }

    /**
     * POST /login/verify — verify the code and sign the user in (JSON).
     */
    public function verify(Request $request): JsonResponse
    {
        $email = $request->session()->get('passwordless.email');

        if (! $email) {
            return $this->jsonError('Your session has expired. Please start again.');
        }

        $request->validate([
            'code' => ['required', 'string', 'size:'.(int) config('passwordless.otp.length', 6)],
        ]);

        if ($error = $this->verifyGuard($email)) {
            return $this->jsonError($error);
        }

        if (! $this->auth->verify($email, $request->input('code'))) {
            return $this->jsonError('The code is invalid or has expired. Please request a new code.');
        }

        $user = $this->auth->resolveUser($email);

        if (! $user) {
            // Enumeration-safe: identical message to an invalid/expired code.
            return $this->jsonError('The code is invalid or has expired. Please request a new code.');
        }

        Auth::login($user, true);

        // Prevent session fixation.
        $request->session()->regenerate();

        // Clear transient challenge state.
        $request->session()->forget(['passwordless.email', 'passwordless.resend_available_at']);

        return response()->json([
            'success' => true,
            'redirect' => config('passwordless.post_login_redirect', '/dashboard'),
        ]);
    }

    /**
     * POST /login/resend — re-issue the code after the server-enforced cooldown.
     */
    public function resend(Request $request): JsonResponse
    {
        $email = $request->session()->get('passwordless.email');

        if (! $email) {
            return response()->json(['success' => false, 'message' => 'Session expired.'], 422);
        }

        $resendAvailableAt = (int) $request->session()->get('passwordless.resend_available_at', 0);
        $retryAfter = max(0, $resendAvailableAt - now()->timestamp);

        if ($retryAfter > 0) {
            return response()->json([
                'success' => false,
                'message' => 'Please wait before requesting a new code.',
                'retry_after' => $retryAfter,
            ], 429);
        }

        $ip = $request->ip();

        if ($error = $this->sendGuard($email, $ip)) {
            return response()->json(['success' => false, 'message' => $error], 429);
        }

        $this->auth->issueAndSend($email, $ip);

        $request->session()->put(
            'passwordless.resend_available_at',
            now()->addSeconds((int) config('passwordless.resend_cooldown_seconds', 30))->timestamp
        );

        return response()->json([
            'success' => true,
            'message' => 'A new code has been sent.',
            'retry_after' => (int) config('passwordless.resend_cooldown_seconds', 30),
        ]);
    }

    /**
     * POST /logout — terminate the session.
     */
    public function logout(Request $request): RedirectResponse
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }

    /**
     * Server-side limits on sending: per-email, per-IP, and a hard cooldown.
     * Returns an error message when sending is not allowed, or null otherwise.
     */
    private function sendGuard(string $email, string $ip): ?string
    {
        $emailKey = 'otp-send-email:'.strtolower($email);
        $ipKey = 'otp-send-ip:'.$ip;
        $cooldownKey = 'otp-cooldown:'.strtolower($email);

        if (RateLimiter::tooManyAttempts($emailKey, (int) config('passwordless.send_rate_limit.per_email_per_hour', 10))) {
            return 'Too many requests for this email. Try again in '.$this->humanize(RateLimiter::availableIn($emailKey)).'.';
        }

        if (RateLimiter::tooManyAttempts($ipKey, (int) config('passwordless.send_rate_limit.per_ip_per_hour', 20))) {
            return 'Too many requests from this device. Try again in '.$this->humanize(RateLimiter::availableIn($ipKey)).'.';
        }

        if (RateLimiter::tooManyAttempts($cooldownKey, 1)) {
            return 'Please wait '.$this->humanize(RateLimiter::availableIn($cooldownKey)).' before requesting another code.';
        }

        RateLimiter::hit($emailKey, 3600);
        RateLimiter::hit($ipKey, 3600);
        RateLimiter::hit($cooldownKey, (int) config('passwordless.resend_cooldown_seconds', 30));

        return null;
    }

    /**
     * Server-side limit on code verification attempts per email.
     */
    private function verifyGuard(string $email): ?string
    {
        $key = 'otp-verify:'.strtolower($email);

        if (RateLimiter::tooManyAttempts($key, (int) config('passwordless.verify_rate_limit.per_email_per_15_min', 10))) {
            return 'Too many attempts. Try again in '.$this->humanize(RateLimiter::availableIn($key)).'.';
        }

        RateLimiter::hit($key, 900);

        return null;
    }

    private function jsonError(string $message): JsonResponse
    {
        return response()->json(['success' => false, 'message' => $message], 422);
    }

    private function humanize(int $seconds): string
    {
        if ($seconds < 60) {
            return $seconds.'s';
        }

        $minutes = (int) ceil($seconds / 60);

        return $minutes.' minute'.($minutes > 1 ? 's' : '');
    }
}
