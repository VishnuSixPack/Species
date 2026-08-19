/* ============================================================
   SmarTuna concept — register.js
   Access request form. Creates NO auth user and NO profile.
   It writes a row to access_requests; an administrator reviews
   it and, on approval, the create-user function sends an invite.
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Addresses that make a request very likely to be junk. Not a security
// control — an administrator still approves every request by hand.
const DISPOSABLE = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'temp-mail.org', 'dispostable.com', 'maildrop.cc'
];

async function submitAccessRequest() {
  const firstName = document.getElementById('reqFirstName').value.trim();
  const lastName  = document.getElementById('reqLastName').value.trim();
  const email     = document.getElementById('reqEmail').value.trim().toLowerCase();
  const company   = document.getElementById('reqCompany').value.trim();
  const position  = document.getElementById('reqPosition').value.trim();
  const reason    = document.getElementById('reqReason').value.trim();
  const website   = document.getElementById('reqWebsite').value.trim(); // honeypot
  const terms     = document.getElementById('reqTerms').checked;

  hideError();

  // A real person never sees this field, so anything in it is a bot.
  // Show the success screen anyway — telling a bot it failed just
  // teaches whoever wrote it to try again.
  if (website) { showSuccess(email); return; }

  if (!firstName || !lastName) { showError('Please enter your full name.'); return; }
  if (!email) { showError('Please enter your work email.'); return; }
  if (!isValidEmail(email)) { showError('That does not look like a valid email address.'); return; }

  const domain = email.split('@')[1] || '';
  if (DISPOSABLE.includes(domain)) {
    showError('Please use your work email address. Temporary inboxes are not accepted.');
    return;
  }

  if (!company) { showError('Please tell us which company you represent.'); return; }
  if (reason.length < 15) { showError('Please say a little more about why you need access.'); return; }
  if (!terms) { showError('Please agree to the Terms of Service and Privacy Policy.'); return; }

  const btn = document.getElementById('btnRequestSubmit');
  btn.textContent = 'Sending...';
  btn.disabled = true;

  try {
    const { error } = await dbClient.from('access_requests').insert({
      first_name: firstName,
      last_name: lastName,
      email,
      company_name: company,
      position: position || null,
      reason,
      status: 'pending'
    });

    if (error) {
      // Unique constraint on email — already asked, don't say so in a way
      // that confirms who is in the system.
      if (error.code === '23505') { showSuccess(email); return; }
      throw error;
    }

    showSuccess(email);

  } catch (err) {
    console.error(err);
    showError('Could not send your request. Please try again, or email us directly.');
    btn.textContent = 'Send request';
    btn.disabled = false;
  }
}

function showSuccess(email) {
  document.getElementById('successEmail').textContent = email || 'your address';
  document.querySelectorAll('.register-step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('stepSuccess').classList.add('active');
}

// ── HELPERS ───────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function showError(message) {
  const el = document.getElementById('registerError');
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideError() {
  document.getElementById('registerError').classList.add('hidden');
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'success' ? '#22c55e' : '#e63946'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 200px;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Already signed in? No reason to be on this page.
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (session) window.location.href = 'home-logged-in.html';
});