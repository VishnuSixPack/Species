// =============================================
//  LOGIN PAGE — login.js
// =============================================

// ── SUPABASE ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYmRhYWpjcm9teG1oZ2N2ZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjc4MTUsImV4cCI6MjA5MzcwMzgxNX0.wlVbN57eAwRmTROEEY3D6BIX3H5pI6MwZ5hM2BqpnEs';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', function() {

  // Note: the hero video/caption slideshow is handled by the inline
  // script at the bottom of login.html, not here — see that file.

  // ── TOGGLE PASSWORD ──
  window.togglePassword = function() {
    const input = document.getElementById('login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  // ── FORGOT PASSWORD MODAL ──
  window.showForgotModal = function() {
    document.getElementById('forgot-overlay').classList.add('open');
  }

  window.hideForgotModal = function() {
    document.getElementById('forgot-overlay').classList.remove('open');
  }

  document.getElementById('forgot-overlay').addEventListener('click', function(e) {
    if (e.target === this) hideForgotModal();
  });

  // ── HANDLE LOGIN ──
  window.handleLogin = async function() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const errorEl = document.getElementById('login-error');

    errorEl.style.display = 'none';

    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const { data, error } = await dbClient.auth.signInWithPassword({
      email,
      password
    });

if (error) {
      errorEl.textContent = 'Invalid email or password. Please try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

    // Check profile status
    const { data: profile } = await dbClient
      .from('profiles')
      .select('status, role')
      .eq('id', data.user.id)
      .single();

if (profile?.is_suspended) {
      await dbClient.auth.signOut();
      errorEl.textContent = 'Your account has been suspended. Please contact your administrator.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }

// Log login + update last login
    await logActivity('login', 'auth', data.user.id, `User logged in: ${email}`);
    await updateLastLogin();

    // Everyone goes to home
    window.location.href = 'home-logged-in.html';
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });

});