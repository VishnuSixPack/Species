/* ============================================================
   PROJECT MANHATTAN — support.js
   Shared JS for contact.html, report.html, about.html
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentProfile = null;

// ── AUTH ──────────────────────────────────────────────────────
async function checkAuth() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session;
}

async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

function toggleNavDropdown() {
  document.getElementById('navDropdown').classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('navDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!e.target.closest('.nav-profile')) dropdown.classList.add('hidden');
  }
});

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const isReportPage = window.location.pathname.includes('report.html');
  
  const { data: { session } } = await dbClient.auth.getSession();

  if (isReportPage && !session) {
    window.location.href = 'login.html';
    return;
  }

  if (!session) {
    // Guest mode — hide nav profile and Report an Issue link
    const navProfile = document.getElementById('navProfile');
    if (navProfile) navProfile.style.display = 'none';

    // Hide Report an Issue from nav
    document.querySelectorAll('.nav-dropdown-menu a').forEach(link => {
      if (link.href.includes('report.html')) {
        link.parentElement.style.display = 'none';
      }
    });
    return;
  }

  currentUser = session.user;

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color')
    .eq('id', currentUser.id)
    .single();

  currentProfile = profile;

  const email = currentUser.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  const avatarColor = profile?.avatar_color || '#1a6fdb';
  const firstName = profile?.first_name || email.split('@')[0];

  document.getElementById('navAvatar').textContent = initials;
  document.getElementById('navAvatar').style.background = avatarColor;
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(firstName);
});

// ── SUBMIT CONTACT ────────────────────────────────────────────
async function submitContact() {
  const name = document.getElementById('contactName')?.value.trim();
  const email = document.getElementById('contactEmail')?.value.trim();
  const subject = document.getElementById('contactSubject')?.value.trim();
  const category = document.getElementById('contactCategory')?.value;
  const message = document.getElementById('contactMessage')?.value.trim();

  if (!name || !email || !subject || !message) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = document.querySelector('.btn-submit');
  btn.textContent = 'Sending...';
  btn.disabled = true;

   const { error } = await dbClient.from('support_tickets').insert({
    user_id: currentUser.id,
    user_email: email,
    user_name: name,
    type: 'contact',
    subject: category ? `[${category}] ${subject}` : subject,
    message,
    status: 'open'
  });
  btn.textContent = 'Send Message';
  btn.disabled = false;

  if (error) { showToast('Failed to send message. Please try again.', 'error'); return; }

  await logActivity('create', 'support_ticket', null, `Contact message: ${subject}`);

  // Show success state
  document.querySelector('.support-layout').classList.add('hidden');
  document.getElementById('successState').classList.remove('hidden');
}

// ── SUBMIT REPORT ─────────────────────────────────────────────
async function submitReport() {
  const subject = document.getElementById('reportSubject')?.value.trim();
  const severity = document.getElementById('reportSeverity')?.value;
  const module = document.getElementById('reportModule')?.value;
  const steps = document.getElementById('reportSteps')?.value.trim();
  const expected = document.getElementById('reportExpected')?.value.trim();
  const message = document.getElementById('reportMessage')?.value.trim();

  if (!subject || !message) {
    showToast('Please fill in the required fields.', 'error');
    return;
  }

  const btn = document.querySelector('.btn-submit');
  btn.textContent = 'Submitting...';
  btn.disabled = true;

  const fullMessage = `
Severity: ${severity}
Module: ${module || 'Not specified'}

Steps to Reproduce:
${steps || 'Not provided'}

Expected:
${expected || 'Not provided'}

What Happened:
${message}
  `.trim();

  const { error } = await dbClient.from('support_tickets').insert({
    user_id: currentUser.id,
    user_email: currentUser.email,
    user_name: [currentProfile?.first_name, currentProfile?.last_name].filter(Boolean).join(' ') || currentUser.email,
    type: 'report',
    subject: `[${severity}] ${subject}`,
    message: fullMessage,
    status: 'open'
  });

  btn.textContent = 'Submit Report';
  btn.disabled = false;

  if (error) { showToast('Failed to submit report. Please try again.', 'error'); return; }

  await logActivity('create', 'support_ticket', null, `Bug report: ${subject}`);

  // Show success state
  document.querySelector('.support-layout').classList.add('hidden');
  document.getElementById('successState').classList.remove('hidden');
}

// ── RESET FORM ────────────────────────────────────────────────
function resetForm(type) {
  document.querySelector('.support-layout').classList.remove('hidden');
  document.getElementById('successState').classList.add('hidden');

  if (type === 'contact') {
    document.getElementById('contactSubject').value = '';
    document.getElementById('contactCategory').value = '';
    document.getElementById('contactMessage').value = '';
  } else {
    document.getElementById('reportSubject').value = '';
    document.getElementById('reportSteps').value = '';
    document.getElementById('reportExpected').value = '';
    document.getElementById('reportMessage').value = '';
  }
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'success' ? '#22c55e' : '#e63946'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'Poppins', 'DM Sans', sans-serif; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); min-width: 200px;
  `;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}