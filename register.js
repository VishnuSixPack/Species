/* ============================================================
   PROJECT MANHATTAN — register.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentStep = 1;

// ── STEP NAVIGATION ───────────────────────────────────────────
function goToStep(step) {
  // Hide all panels
  document.querySelectorAll('.register-step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`step${step}`).classList.add('active');

  // Update step indicators
  document.querySelectorAll('.register-step').forEach((el, i) => {
    el.classList.remove('active', 'completed');
    const stepNum = i + 1;
    if (stepNum < step) el.classList.add('completed');
    else if (stepNum === step) el.classList.add('active');
  });

  currentStep = step;
}

function goToStep1() { goToStep(1); }
function goToCompanyStep() {
  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;

  if (!firstName || !lastName) { showToast('Please enter your full name.', 'error'); return; }
  if (!email) { showToast('Please enter your email.', 'error'); return; }
  if (!isValidEmail(email)) { showToast('Please enter a valid email.', 'error'); return; }
  if (!password || password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (password !== confirmPassword) { showToast('Passwords do not match.', 'error'); return; }

  goToStep(2);
}

// ── PASSWORD TOGGLE ───────────────────────────────────────────
function toggleRegPassword() {
  const input = document.getElementById('regPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ── SUBMIT REGISTRATION ───────────────────────────────────────
async function submitRegistration() {
  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const companyCode = document.getElementById('regCompanyCode').value.trim().toUpperCase();
  const position = document.getElementById('regPosition').value.trim();
  const partnerCode = document.getElementById('regPartnerOf').value.trim().toUpperCase();
  const termsChecked = document.getElementById('regTerms').checked;

  if (!companyCode) {
    showError('Company code is required. Ask your Company Administrator for the code.');
    return;
  }

  if (!termsChecked) {
    showError('Please agree to the Terms of Service and Privacy Policy.');
    return;
  }

  const btn = document.getElementById('btnRegisterSubmit');
  btn.textContent = 'Verifying company...';
  btn.disabled = true;
  hideError();

  try {
    // Validate company code
    const { data: companies, error: codeError } = await dbClient
      .from('companies')
      .select('id, company_name, status')
      .eq('company_code', companyCode)
      .limit(1);

    if (codeError || !companies?.length) {
      showError('Invalid company code. Please check the code and try again.');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    const company = companies[0];

    if (company.status !== 'active') {
      showError('This company is not active. Please contact your administrator.');
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Validate partner code if partner role
    let partnerCompanyId = null;
    if (selectedRole === 'partner' && partnerCode) {
      const { data: partnerCompanies } = await dbClient
        .from('companies')
        .select('id, company_name')
        .eq('company_code', partnerCode)
        .limit(1);

      if (!partnerCompanies?.length) {
        showError('Invalid partner company code. Please check and try again.');
        btn.textContent = 'Create Account';
        btn.disabled = false;
        return;
      }
      partnerCompanyId = partnerCompanies[0].id;
    }

    btn.textContent = 'Creating account...';

    // Sign up with Supabase Auth
    const { data, error } = await dbClient.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName }
      }
    });

    if (error) throw error;

    const userId = data.user?.id;
    if (!userId) throw new Error('Failed to create account. Please try again.');

    // Create profile as PENDING
    await dbClient.from('profiles').upsert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      role: company.company_type || 'supplier',
      company_id: company.id,
      position: position || null,
      partner_of: partnerCompanyId,
      status: 'pending',
    });

    // Log activity
    await dbClient.from('activity_logs').insert({
      user_id: userId,
      user_email: email,
      action: 'register',
      resource: 'auth',
      resource_id: userId,
      metadata: {
        company: company.company_name,
        company_code: companyCode,
        status: 'pending'
      }
    });

    // Show success
    document.querySelectorAll('.register-step-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('stepSuccess').classList.add('active');
    document.querySelector('.register-steps').style.display = 'none';

  } catch (err) {
    showError(err.message || 'Registration failed. Please try again.');
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

// Check if already logged in
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (session) window.location.href = 'index.html';
});