<?php

namespace App\Services;

use App\Mail\OtpMail;
use App\Models\OtpChallenge;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * Core logic for the passwordless flow: generating, issuing, and verifying
 * one-time codes, and resolving (or creating) the user that owns the email.
 *
 * Security invariants (see SKILL.md):
 *  - OTPs are stored as bcrypt hashes and never returned in responses or logs.
 *  - Comparison is constant-time even when no challenge exists.
 *  - No user lookup happens at send time; accounts are created/looked up only
 *    once a valid code has been presented.
 */
class PasswordlessAuthService
{
    /**
     * A valid bcrypt hash used only to keep verification timing constant when
     * no challenge exists for the submitted email.
     */
    private const DUMMY_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

    /**
     * Generate a random numeric code of the configured length.
     */
    public function generateCode(): string
    {
        $length = (int) config('passwordless.otp.length', 6);
        $max = (int) str_repeat('9', $length);

        return str_pad((string) random_int(0, $max), $length, '0', STR_PAD_LEFT);
    }

    /**
     * Issue a fresh challenge for the email and send the code.
     *
     * Enumeration-safe: this does NOT query the users table and behaves
     * identically whether or not an account exists.
     */
    public function issueAndSend(string $email, ?string $ip = null): OtpChallenge
    {
        $email = strtolower(trim($email));

        // One active challenge per email at a time.
        OtpChallenge::where('email', $email)->whereNull('consumed_at')->delete();

        $code = $this->generateCode();

        $challenge = OtpChallenge::create([
            'email' => $email,
            'code_hash' => Hash::make($code),
            'expires_at' => now()->addMinutes((int) config('passwordless.otp.lifetime_minutes', 10)),
            'ip_address' => $ip,
        ]);

        Mail::to($email)->send(new OtpMail(
            $code,
            (int) config('passwordless.otp.lifetime_minutes', 10)
        ));

        return $challenge;
    }

    /**
     * Verify a submitted code against the active challenge for the email.
     *
     * Returns true only when the code matches a valid, unexpired, unconsumed
     * challenge that has not exceeded its attempt limit. On success the
     * challenge is consumed; on failure the attempt counter is incremented and
     * the challenge invalidated when the limit is reached.
     */
    public function verify(string $email, string $code): bool
    {
        $email = strtolower(trim($email));

        $challenge = OtpChallenge::where('email', $email)
            ->whereNull('consumed_at')
            ->latest('created_at')
            ->first();

        // Always perform the bcrypt comparison so response timing is uniform
        // whether or not a challenge exists (anti-enumeration / anti-timing).
        $hash = $challenge ? $challenge->code_hash : self::DUMMY_HASH;
        $matches = Hash::check($code, $hash);

        if (! $challenge) {
            return false;
        }

        if ($challenge->isExpired() || $challenge->isConsumed()) {
            $challenge->delete();

            return false;
        }

        $maxAttempts = (int) config('passwordless.otp.max_attempts', 5);

        if ($challenge->attempts >= $maxAttempts) {
            $challenge->delete();

            return false;
        }

        if (! $matches) {
            $challenge->increment('attempts');

            // The failed guess pushed us to the limit — invalidate.
            if ($challenge->attempts + 1 >= $maxAttempts) {
                $challenge->delete();
            }

            return false;
        }

        $challenge->update(['consumed_at' => now()]);
        $challenge->delete(); // clear transient state; nothing sensitive remains

        return true;
    }

    /**
     * Resolve the account for a verified email, creating it when auto-register
     * is enabled. Proving the code also proves ownership of the address, so the
     * account is marked email-verified.
     *
     * Returns null when auto-register is disabled and no account exists — the
     * caller should then return the same generic "invalid code" response to
     * avoid revealing whether an address is registered.
     */
    public function resolveUser(string $email): ?User
    {
        $email = strtolower(trim($email));

        $user = User::where('email', $email)->first();

        if ($user) {
            $this->markVerified($user);

            return $user;
        }

        if (! config('passwordless.auto_register', true)) {
            return null;
        }

        $user = User::create([
            'name' => $this->nameFromEmail($email),
            'email' => $email,
            // A random, unusable placeholder — this account never uses a password.
            'password' => Hash::make(Str::random(40)),
        ]);

        $this->markVerified($user);

        return $user;
    }

    private function markVerified(User $user): void
    {
        if ($user->email_verified_at === null) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }
    }

    private function nameFromEmail(string $email): string
    {
        $local = explode('@', $email, 2)[0];

        return Str::title(str_replace(['.', '_', '-', '+'], ' ', $local));
    }
}
