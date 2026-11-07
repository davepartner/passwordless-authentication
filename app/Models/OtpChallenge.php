<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single one-time-password challenge.
 *
 * Stores the OTP as a bcrypt hash (never plaintext) together with its expiry
 * and guess counter. A challenge is "active" until it is consumed, expires, or
 * exceeds its attempt limit.
 */
class OtpChallenge extends Model
{
    protected $fillable = [
        'email',
        'code_hash',
        'expires_at',
        'attempts',
        'consumed_at',
        'ip_address',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'consumed_at' => 'datetime',
        'attempts' => 'integer',
    ];

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    public function isConsumed(): bool
    {
        return $this->consumed_at !== null;
    }
}
