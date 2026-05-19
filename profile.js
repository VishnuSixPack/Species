/* ============================================================
   PROJECT MANHATTAN — profile.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentProfile = null;
let selectedAvatarColor = '#1a6fdb';
let selectedTheme = 'light';

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

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await checkAuth();
  if (!session) return;

currentUser = session.user;
  await loadCountryDropdown();
  await loadProfile();
});

// ── LOAD COUNTRY DROPDOWN ─────────────────────────────────────
async function loadCountryDropdown() {
  const { data } = await dbClient
    .from('countries')
    .select('country, alpha2')
    .order('country');

  const select = document.getElementById('companyCountry');
  if (!select || !data) return;

  select.innerHTML = '<option value="">Select country</option>';
  data.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.country;
    opt.textContent = `${c.country} (${c.alpha2})`;
    select.appendChild(opt);
  });
}

// ── LOAD PROFILE ──────────────────────────────────────────────
async function loadProfile() {
  const { data: profile, error } = await dbClient
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error) {
    console.error('Error loading profile:', error);
    // Create profile if doesn't exist
    await dbClient.from('profiles').insert({ id: currentUser.id });
    currentProfile = { role: 'supplier' };
  } else {
    currentProfile = profile;
  }

  populateUI();
}

// ── POPULATE UI ───────────────────────────────────────────────
function populateUI() {
  const p = currentProfile;
  const email = currentUser.email || '';
  const firstName = p.first_name || '';
  const lastName = p.last_name || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];
  const initials = (firstName.charAt(0) + (lastName.charAt(0) || '')).toUpperCase() || email.substring(0, 2).toUpperCase();
  const avatarColor = p.avatar_color || '#1a6fdb';

  // Sidebar
  document.getElementById('sidebarAvatar').textContent = initials;
  document.getElementById('sidebarAvatar').style.background = avatarColor;
  document.getElementById('sidebarName').textContent = fullName;
  document.getElementById('sidebarEmail').textContent = email;

  // General tab
  document.getElementById('firstName').value = firstName;
  document.getElementById('lastName').value = lastName;
  document.getElementById('userEmail').textContent = email;
  document.getElementById('userRole').textContent = capitalize(p.role || 'supplier');
  document.getElementById('userPhone').textContent = p.phone || 'No phone number';

  // Photo
  const photoAvatar = document.getElementById('photoAvatar');
  if (p.photo_url) {
    photoAvatar.innerHTML = `<img src="${p.photo_url}" alt="Profile photo" />`;
  } else {
    photoAvatar.textContent = initials;
    photoAvatar.style.background = avatarColor;
  }

  // Role badge
  const roleBadge = document.getElementById('roleBadge');
  roleBadge.textContent = capitalize(p.role || 'supplier');
  roleBadge.className = `role-badge ${p.role || 'supplier'}`;

  // Company tab
  if (p.company_name) document.getElementById('companyName').value = p.company_name;
  if (p.company_position) document.getElementById('companyPosition').value = p.company_position;
  if (p.company_website) document.getElementById('companyWebsite').value = p.company_website;
  if (p.company_address) document.getElementById('companyAddress').value = p.company_address;
  if (p.company_country) document.getElementById('companyCountry').value = p.company_country;
  if (p.company_industry) document.getElementById('companyIndustry').value = p.company_industry;

  // Preferences
  selectedAvatarColor = avatarColor;
  document.getElementById('avatarColorPreview').style.background = avatarColor;
  document.getElementById('avatarColorPreview').textContent = initials;

  // Set active color swatch
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.classList.toggle('active', swatch.dataset.color === avatarColor);
  });

  // Theme
  selectedTheme = p.theme || 'light';
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === selectedTheme);
  });

  // Language & Region
  if (p.language) document.getElementById('prefLanguage').value = p.language;
  if (p.date_format) document.getElementById('prefDateFormat').value = p.date_format;
  if (p.timezone) document.getElementById('prefTimezone').value = p.timezone;
}

// ── SECTION SWITCHER ──────────────────────────────────────────
function switchSection(name) {
  document.querySelectorAll('.profile-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));

  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(`'${name}'`)) {
      btn.classList.add('active');
    }
  });

  if (name === 'company') loadCompanyInfo();
}

// ── SAVE GENERAL ──────────────────────────────────────────────
async function saveGeneral() {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();

  const { error } = await dbClient
    .from('profiles')
    .update({ first_name: firstName, last_name: lastName, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) { showToast('Failed to save.', 'error'); return; }

  showToast('Profile updated!', 'success');
  await loadProfile();
}

// ── LOAD COMPANY INFO ─────────────────────────────────────────
async function loadCompanyInfo() {
  const companyId = currentProfile?.company_id;

  if (!companyId) {
    document.getElementById('noCompanyCard').style.display = 'block';
    document.getElementById('companyInfoCard').style.display = 'none';
    return;
  }

  const { data: company } = await dbClient
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (!company) {
    document.getElementById('noCompanyCard').style.display = 'block';
    document.getElementById('companyInfoCard').style.display = 'none';
    return;
  }

  document.getElementById('noCompanyCard').style.display = 'none';
  document.getElementById('companyInfoCard').style.display = 'block';

  document.getElementById('companyCodeDisplay').textContent = company.company_code || '—';
  document.getElementById('companyName').value = company.company_name || '';
  document.getElementById('companyIndustry').value = company.industry || '';
  document.getElementById('companyCountry').value = company.country || '';
  document.getElementById('companyGln').value = company.gln || '';
  document.getElementById('companyWebsite').value = company.website || '';
  document.getElementById('companyAddress').value = company.address || '';
  document.getElementById('companyPosition').value = currentProfile?.position || '';
}

// ── SAVE POSITION ─────────────────────────────────────────────
async function savePosition() {
  const position = document.getElementById('companyPosition').value.trim();
  const { error } = await dbClient
    .from('profiles')
    .update({ position, updated_at: new Date().toISOString() })
    .eq('id', currentUser.id);

  if (error) { showToast('Failed to save.', 'error'); return; }
  showToast('Position updated!', 'success');
  currentProfile.position = position;
}

// ── SAVE PREFERENCE ───────────────────────────────────────────
async function savePreference() {
  const { error } = await dbClient
    .from('profiles')
    .update({
      avatar_color: selectedAvatarColor,
      theme: selectedTheme,
      language: document.getElementById('prefLanguage').value,
      date_format: document.getElementById('prefDateFormat').value,
      timezone: document.getElementById('prefTimezone').value,
      updated_at: new Date().toISOString()
    })
    .eq('id', currentUser.id);

  if (error) { showToast('Failed to save.', 'error'); return; }
  showToast('Preferences saved!', 'success');
  await loadProfile();
}

// ── AVATAR COLOR ──────────────────────────────────────────────
function selectAvatarColor(el) {
  selectedAvatarColor = el.dataset.color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('avatarColorPreview').style.background = selectedAvatarColor;
}

// ── THEME ─────────────────────────────────────────────────────
function selectTheme(el) {
  selectedTheme = el.dataset.theme;
  document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
}

// ── PHOTO UPLOAD ──────────────────────────────────────────────
async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop();
  const fileName = `${currentUser.id}/avatar.${ext}`;

  const { error: uploadError } = await dbClient.storage
    .from('product-photos')
    .upload(fileName, file, { upsert: true });

  if (uploadError) { showToast('Photo upload failed.', 'error'); return; }

  const { data: urlData } = dbClient.storage.from('product-photos').getPublicUrl(fileName);
  const photoUrl = urlData.publicUrl;

  await dbClient.from('profiles').update({ photo_url: photoUrl }).eq('id', currentUser.id);

  const photoAvatar = document.getElementById('photoAvatar');
  photoAvatar.innerHTML = `<img src="${photoUrl}" alt="Profile photo" />`;

  showToast('Photo updated!', 'success');
}

// ── CHANGE PASSWORD ───────────────────────────────────────────
async function changePassword() {
  const current = document.getElementById('currentPassword').value;
  const newPass = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;

  if (!newPass || !confirm) { showToast('Please fill all fields.', 'error'); return; }
  if (newPass !== confirm) { showToast('Passwords do not match.', 'error'); return; }
  if (newPass.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }

  const { error } = await dbClient.auth.updateUser({ password: newPass });
  if (error) { showToast('Failed to update password.', 'error'); return; }

  showToast('Password updated!', 'success');
  document.getElementById('currentPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
}

// ── EMAIL ─────────────────────────────────────────────────────
function openVerifyModal() {
  document.getElementById('verifyModal').classList.remove('hidden');
}

function openUpdateEmailModal() {
  document.getElementById('updateEmailModal').classList.remove('hidden');
}

async function updateEmail() {
  const newEmail = document.getElementById('newEmail').value.trim();
  if (!newEmail) { showToast('Please enter a new email.', 'error'); return; }

  const { error } = await dbClient.auth.updateUser({ email: newEmail });
  if (error) { showToast('Failed to update email.', 'error'); return; }

  showToast('Verification sent to new email!', 'success');
  document.getElementById('updateEmailModal').classList.add('hidden');
}

// ── PHONE ─────────────────────────────────────────────────────
function openPhoneModal() {
  document.getElementById('phoneModal').classList.remove('hidden');
}

async function savePhone() {
  const phone = document.getElementById('newPhone').value.trim();
  if (!phone) { showToast('Please enter a phone number.', 'error'); return; }

  const { error } = await dbClient.from('profiles').update({ phone }).eq('id', currentUser.id);
  if (error) { showToast('Failed to save phone.', 'error'); return; }

  document.getElementById('userPhone').textContent = phone;
  document.getElementById('phoneModal').classList.add('hidden');
  showToast('Phone number saved!', 'success');
}

// ── DEACTIVATE ────────────────────────────────────────────────
function openDeactivateModal() {
  document.getElementById('deactivateModal').classList.remove('hidden');
}

// ── API KEY ───────────────────────────────────────────────────
function toggleApiKey() {
  const input = document.getElementById('apiKeyInput');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function copyApiKey() {
  const input = document.getElementById('apiKeyInput');
  navigator.clipboard.writeText(input.value);
  showToast('API key copied!', 'success');
}

// ── SUPPORT ───────────────────────────────────────────────────
function sendSupport() {
  const subject = document.getElementById('supportSubject').value.trim();
  const message = document.getElementById('supportMessage').value.trim();
  if (!subject || !message) { showToast('Please fill all fields.', 'error'); return; }
  showToast('Message sent! We\'ll get back to you soon.', 'success');
  document.getElementById('supportSubject').value = '';
  document.getElementById('supportMessage').value = '';
}

// ── HELPERS ───────────────────────────────────────────────────
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${type === 'success' ? '#22c55e' : '#e63946'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'Poppins', 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  `;
  toast.textContent = message;
  document.getElementById('toastContainer').appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}