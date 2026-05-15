// =============================================
//  LOGIN PAGE — login.js
// =============================================

// ── SUPABASE ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', function() {

  // ── SLIDE SHOW ──
  let currentSlide = 0;
  const totalSlides = 3;

  function goToSlide(index) {
    document.querySelectorAll('.login-slide').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.login-slide-text').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.login-dot').forEach(d => d.classList.remove('active'));
    document.querySelectorAll('.login-slide')[index].classList.add('active');
    document.getElementById(`slide-text-${index}`).classList.add('active');
    document.querySelectorAll('.login-dot')[index].classList.add('active');
    currentSlide = index;
  }

  window.goToSlide = goToSlide;

  setInterval(() => {
    const next = (currentSlide + 1) % totalSlides;
    goToSlide(next);
  }, 4000);

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

    // Log login + update last login
    await logActivity('login', 'auth', data.user.id, `User logged in: ${email}`);
    await updateLastLogin();

    window.location.href = 'index.html';
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });

});