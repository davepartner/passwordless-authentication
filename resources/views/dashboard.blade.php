@extends('layouts.auth')

@section('title', 'Dashboard')

@section('content')
    <h1>Welcome back</h1>
    <p class="subtitle">You are signed in as <span class="email-label">{{ auth()->user()->email }}</span>.</p>

    <p style="margin: 0 0 24px; color: var(--text-muted);">
        This is the post-login destination referenced by
        <code>config('passwordless.post_login_redirect')</code>. Replace it with your own dashboard.
    </p>

    <form method="POST" action="{{ route('passwordless.logout') }}">
        @csrf
        <button type="submit" class="btn btn-primary">Sign out</button>
    </form>
@endsection
