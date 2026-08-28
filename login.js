// =============================================
//  LOGIN PAGE — login.js
// =============================================

// ── SUPABASE ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';

// Reuse the one shared client. utils.js creates a client under this same
// key when logActivity()/updateLastLogin() run. Two supabase-js clients in
// one page fight over the same navigator.locks entry for the auth token,
// and the second one can wait on that lock forever — no error, no
// rejection, just a button stuck on "Signing in...". One client, one lock.
const dbClient = window._sharedSupabase ||
  (window._sharedSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY));

// Nothing here should be able to hang the page. A slow backend and a dead
// one look identical to a user unless we put a clock on the request.
const SIGNIN_TIMEOUT_MS  = 20000;
const PROFILE_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

document.addEventListener('DOMContentLoaded', function () {

  // Note: the hero video/caption slideshow is handled by the inline
  // script at the bottom of login.html, not here — see that file.

  let signingIn = false;

  // ── TOGGLE PASSWORD ──
  window.togglePassword = function () {
    const input = document.getElementById('login-password');
    input.type = input.type === 'password' ? 'text' : 'password';
  };

  // ── FORGOT PASSWORD MODAL ──
  window.showForgotModal = function () {
    document.getElementById('forgot-overlay').classList.add('open');
  };

  window.hideForgotModal = function () {
    document.getElementById('forgot-overlay').classList.remove('open');
  };

  document.getElementById('forgot-overlay').addEventListener('click', function (e) {
    if (e.target === this) hideForgotModal();
  });

  // ── HELPERS ──
  function showError(el, message) {
    el.textContent = message;
    el.style.display = 'block';
  }

  function resetButton(btn) {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }

  // ── HANDLE LOGIN ──
  window.handleLogin = async function () {
    if (signingIn) return;

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn      = document.getElementById('login-btn');
    const errorEl  = document.getElementById('login-error');

    errorEl.style.display = 'none';

    if (!email || !password) {
      showError(errorEl, 'Please enter your email and password.');
      return;
    }

    signingIn = true;
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    // ── 1. Authenticate ──
    let data, error;
    try {
      ({ data, error } = await withTimeout(
        dbClient.auth.signInWithPassword({ email, password }),
        SIGNIN_TIMEOUT_MS,
        'Sign in'
      ));
    } catch (err) {
      console.error('[login] sign-in did not respond:', err);
      showError(errorEl, 'The server is not responding. Please check your connection and try again in a moment.');
      resetButton(btn);
      signingIn = false;
      return;
    }

    if (error) {
      console.warn('[login] sign-in rejected:', error.message);
      showError(errorEl, 'Invalid email or password. Please try again.');
      resetButton(btn);
      signingIn = false;
      return;
    }

    if (!data || !data.user) {
      showError(errorEl, 'Sign in did not complete. Please try again.');
      resetButton(btn);
      signingIn = false;
      return;
    }

    // ── 2. Suspension check ──
    // select('*') rather than naming columns: the previous version fetched
    // `status, role` and then tested `is_suspended`, a column it never
    // asked for, so the check was always undefined and suspended accounts
    // signed in normally. Selecting * means this keeps working whichever
    // column your schema actually uses.
    let profile = null;
    try {
      const res = await withTimeout(
        dbClient.from('profiles').select('*').eq('id', data.user.id).single(),
        PROFILE_TIMEOUT_MS,
        'Profile lookup'
      );
      if (res.error) console.warn('[login] profile lookup failed:', res.error.message);
      profile = res.data;
    } catch (err) {
      // Fail open, as the original did. A slow profile read should not lock
      // a legitimate user out — but it is logged so it does not stay silent.
      console.warn('[login] profile lookup did not respond:', err.message);
    }

    const suspended =
      profile?.is_suspended === true ||
      profile?.status === 'suspended' ||
      profile?.status === 'disabled';

    if (suspended) {
      await dbClient.auth.signOut();
      showError(errorEl, 'Your account has been suspended. Please contact your administrator.');
      resetButton(btn);
      signingIn = false;
      return;
    }

    // ── 3. Housekeeping, then in ──
    // Audit logging and last-login are bookkeeping. Neither should be able
    // to stand between a valid user and the app, so failures are swallowed
    // and the redirect happens either way.
    btn.textContent = 'Signing in...';
    try {
      await withTimeout(
        Promise.all([
          typeof logActivity === 'function'
            ? logActivity('login', 'auth', data.user.id, `User logged in: ${email}`)
            : Promise.resolve(),
          typeof updateLastLogin === 'function'
            ? updateLastLogin()
            : Promise.resolve()
        ]),
        PROFILE_TIMEOUT_MS,
        'Post-login housekeeping'
      );
    } catch (err) {
      console.warn('[login] post-login housekeeping skipped:', err.message);
    }

    window.location.href = 'home-logged-in.html';
  };

  // Enter submits, but not while a sign-in is already running and not
  // while the forgot-password modal is open.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (signingIn) return;
    if (document.getElementById('forgot-overlay').classList.contains('open')) return;
    handleLogin();
  });

});