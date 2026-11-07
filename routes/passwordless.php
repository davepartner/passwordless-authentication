<?php

use App\Http\Controllers\PasswordlessLoginController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Passwordless email OTP routes
|--------------------------------------------------------------------------
| Load this file from routes/web.php:
|     require __DIR__.'/passwordless.php';
*/

Route::middleware('guest')->group(function () {
    // Named "login" so Laravel's `auth` middleware redirects here for guests.
    Route::get('/login', [PasswordlessLoginController::class, 'showRequestForm'])->name('login');
    Route::post('/login', [PasswordlessLoginController::class, 'send'])->name('passwordless.send');
    Route::get('/login/verify', [PasswordlessLoginController::class, 'showVerifyForm'])->name('passwordless.verify');
    Route::post('/login/verify', [PasswordlessLoginController::class, 'verify'])->name('passwordless.verify.submit');
    Route::post('/login/resend', [PasswordlessLoginController::class, 'resend'])->name('passwordless.resend');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [PasswordlessLoginController::class, 'logout'])->name('passwordless.logout');

    // Example post-login destination referenced by config('passwordless.post_login_redirect').
    Route::get('/dashboard', fn () => view('dashboard'))->name('dashboard');
});
