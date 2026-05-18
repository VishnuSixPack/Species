/* ============================================================
   PROJECT MANHATTAN — organisation.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;
let currentProfile = null;
let allCompanies = [];
let selectedCompanyId = null;
let isEditMode = false;
let allCountries = [];

// All supported certifications
const CERT_TYPES = [
  { key: 'MSC_CoC', label: 'MSC CoC (Chain of Custody)' },
  { key: 'ASC_CoC', label: 'ASC CoC (Chain of Custody)' },
  { key: 'BRC', label: 'BRC (British Retail Consortium)' },
  { key: 'IFS', label: 'IFS (International Featured Standards)' },
  { key: 'EU_Approved', label: 'EU Approved' },
  { key: 'UK_Approved', label: 'UK Approved' },
  { key: 'BAP', label: 'BAP (Best Aquaculture Practices)' },
  { key: 'GLOBALG_AP', label: 'GLOBALG.A.P' },
  { key: 'Friend_of_Sea', label: 'Friend of the Sea' },
  { key: 'Halal', label: 'Halal Certified' },
  { key: 'Kosher', label: 'Kosher Certified' },
  { key: 'Organic_EU', label: 'Organic EU' },
  { key: 'Fairtrade', label: 'Fairtrade' },
];

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
  const session = await checkAuth();
  if (!session) return;

  currentUser = session.user;

  const { data: profile } = await dbClient
    .from('profiles')
    .select('*')
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

  const isAdminOrOperator = ['admin', 'operator'].includes(profile?.role);

  if (isAdminOrOperator) {
    document.getElementById('pageTitle').textContent = 'Organisation';
    document.getElementById('btnCreateCompany').classList.remove('hidden');
    document.getElementById('adminView').classList.remove('hidden');
    await loadCountries();
    await loadAllCompanies();
  } else {
    document.getElementById('pageTitle').textContent = 'Your Organisation';
    document.getElementById('userView').classList.remove('hidden');
    await loadCountries();
    await loadUserOrganisation(profile);
  }

  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('pageContent').classList.remove('hidden');

  // Init cert form list
  renderCertFormList();
});

// ── ADMIN VIEW ────────────────────────────────────────────────
async function loadAllCompanies() {
  const { data, error } = await dbClient
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { console.error(error); return; }

  allCompanies = data || [];
  document.getElementById('pageSubtitle').textContent = `${allCompanies.length} organisation${allCompanies.length !== 1 ? 's' : ''}`;
  renderCompaniesGrid(allCompanies);
}

function renderCompaniesGrid(companies) {
  const grid = document.getElementById('companiesGrid');
  if (!companies.length) {
    grid.innerHTML = '<p class="no-data">No organisations found. Add one to get started.</p>';
    return;
  }
  grid.innerHTML = companies.map(c => `
    <div class="company-card" onclick="openCompanyDetail('${c.id}')">
      <div class="company-card-header">
        ${c.photo_url
          ? `<img src="${c.photo_url}" style="width:44px; height:44px; border-radius:50%; object-fit:cover; border:2px solid #e8eaf0;" />`
          : `<div class="company-card-icon">${(c.company_name || 'O').charAt(0).toUpperCase()}</div>`
        }
        <span class="status-badge ${c.status || 'pending'}">${c.status || 'pending'}</span>
      </div>
      <div>
        <div class="company-card-name">${c.company_name || '—'}</div>
        <div class="company-card-industry">${c.industry || 'No industry specified'}</div>
      </div>
      <div class="company-card-meta">
        ${c.country ? `<span class="meta-chip">📍 ${c.country}</span>` : ''}
        ${c.gln ? `<span class="meta-chip">GLN: ${c.gln}</span>` : ''}
        ${c.email ? `<span class="meta-chip">✉ ${c.email}</span>` : ''}
      </div>
    </div>
  `).join('');
}

function filterCompanies(query) {
  const q = query.toLowerCase();
  renderCompaniesGrid(allCompanies.filter(c =>
    (c.company_name || '').toLowerCase().includes(q) ||
    (c.industry || '').toLowerCase().includes(q) ||
    (c.country || '').toLowerCase().includes(q) ||
    (c.gln || '').toLowerCase().includes(q)
  ));
}

function filterCompaniesByStatus(status) {
  renderCompaniesGrid(status ? allCompanies.filter(c => c.status === status) : allCompanies);
}

// ── COUNTRIES ─────────────────────────────────────────────────
async function loadCountries() {
  const { data } = await dbClient
    .from('countries')
    .select('country, alpha2, alpha3, numeric')
    .order('country');
  allCountries = data || [];
  buildCountryDropdown('fcCountry');
}

function buildCountryDropdown(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">Select country</option>';
  allCountries.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.alpha2;
    opt.textContent = `${c.country} (${c.alpha2})`;
    sel.appendChild(opt);
  });
}

// ── INDUSTRY OTHER TOGGLE ─────────────────────────────────────
function handleIndustryChange(selectEl) {
  const otherField = document.getElementById('fcIndustryOther');
  if (!otherField) return;
  if (selectEl.value === 'Other') {
    otherField.classList.remove('hidden');
    otherField.required = true;
  } else {
    otherField.classList.add('hidden');
    otherField.required = false;
    otherField.value = '';
  }
}

// ── COMPANY PHOTO UPLOAD ──────────────────────────────────────
async function handleCompanyPhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('companyPhotoPreview');
    if (preview) {
      preview.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`;
    }
  };
  reader.readAsDataURL(file);
}

async function uploadCompanyPhoto(companyId) {
  const input = document.getElementById('companyPhotoInput');
  console.log('Photo input files:', input?.files?.length, input?.files[0]?.name);
  if (!input?.files[0]) return null;

  const file = input.files[0];
  const ext = file.name.split('.').pop();
  const fileName = `${companyId}/logo.${ext}`;

const { error } = await dbClient.storage
    .from('company-photo')
    .upload(fileName, file, { upsert: true });

  if (error) { console.error('Photo upload failed:', error); return null; }

  const { data: urlData } = dbClient.storage
    .from('company-photo')
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

// ── FIRST USER ASSIGNMENT ─────────────────────────────────────
async function assignFirstUser(companyId) {
  const email = document.getElementById('firstUserEmail')?.value.trim();
  const role = document.getElementById('firstUserRole')?.value || 'company_admin';

  if (!email) return;

  // Check if user already exists
  const { data: existingProfiles } = await dbClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .limit(1);

  let userId = existingProfiles?.[0]?.id;

  if (!userId) {
    // Need password to create new user
    const password = document.getElementById('firstUserPassword')?.value.trim();
    if (!password || password.length < 6) {
      showToast('Please enter a password (min 6 characters) for the first user.', 'error');
      return;
    }

    const { data: { session } } = await dbClient.auth.getSession();
    const response = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email,
        password,
        role: 'supplier',
        company_id: companyId
      })
    });

    const result = await response.json();
    if (result.error) { showToast(`Failed to create first user: ${result.error}`, 'error'); return; }
    userId = result.user_id;
  }

  // Add to company_members as company_admin
  await dbClient.from('company_members').insert({
    company_id: companyId,
    user_id: userId,
    company_role: 'company_admin',
    status: 'active'
  });

  // Update profile company_id
  await dbClient.from('profiles').update({ company_id: companyId }).eq('id', userId);

  showToast(`First user ${email} added as Company Administrator!`, 'success');
}

// ── USER VIEW ─────────────────────────────────────────────────
async function loadUserOrganisation(profile) {
  if (!profile?.company_id) {
    document.getElementById('userOrgInfo').innerHTML = '<p class="no-data">You are not assigned to any organisation yet.<br/>Contact your administrator.</p>';
    return;
  }

  const { data: company } = await dbClient
    .from('companies')
    .select('*')
    .eq('id', profile.company_id)
    .single();

  if (!company) return;

  const { data: membership } = await dbClient
    .from('company_members')
    .select('company_role')
    .eq('company_id', profile.company_id)
    .eq('user_id', currentUser.id)
    .single();

  if (membership?.company_role === 'company_admin') {
    document.getElementById('btnInviteMember').classList.remove('hidden');
  }

  document.getElementById('userOrgInfo').innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
      <div class="company-card-icon" style="width:52px; height:52px; font-size:22px;">${company.company_name.charAt(0).toUpperCase()}</div>
      <div>
        <div class="org-info-name">${company.company_name}</div>
        <span class="status-badge ${company.status}">${company.status}</span>
      </div>
    </div>
    ${company.industry ? `<div class="org-info-row"><span class="org-info-label">Industry</span><span class="org-info-value">${company.industry}</span></div>` : ''}
    ${company.gln ? `<div class="org-info-row"><span class="org-info-label">GLN</span><span class="org-info-value">${company.gln}</span></div>` : ''}
    ${company.pgln ? `<div class="org-info-row"><span class="org-info-label">PGLN</span><span class="org-info-value">${company.pgln}</span></div>` : ''}
    ${company.email ? `<div class="org-info-row"><span class="org-info-label">Email</span><span class="org-info-value">${company.email}</span></div>` : ''}
    ${company.phone ? `<div class="org-info-row"><span class="org-info-label">Phone</span><span class="org-info-value">${company.phone}</span></div>` : ''}
    ${company.website ? `<div class="org-info-row"><span class="org-info-label">Website</span><span class="org-info-value"><a href="${company.website}" target="_blank" style="color:#1a6fdb;">${company.website}</a></span></div>` : ''}
    ${company.address ? `<div class="org-info-row"><span class="org-info-label">Address</span><span class="org-info-value">${company.address}</span></div>` : ''}
    ${company.country ? `<div class="org-info-row"><span class="org-info-label">Country</span><span class="org-info-value">${company.country}</span></div>` : ''}
    ${company.coordinates ? `<div class="org-info-row"><span class="org-info-label">Coordinates</span><span class="org-info-value">${company.coordinates.lat}, ${company.coordinates.lng}</span></div>` : ''}
  `;

  await loadMembers(profile.company_id);
  await loadAssociatedOrgs(profile.company_id);
}

async function loadMembers(companyId) {
  const { data: members } = await dbClient
    .from('company_members')
    .select('*, profiles:user_id(first_name, last_name, avatar_color)')
    .eq('company_id', companyId);

  const container = document.getElementById('membersList');
  if (!members?.length) { container.innerHTML = '<p class="no-data">No members yet.</p>'; return; }

  container.innerHTML = members.map(m => {
    const p = m.profiles;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unknown';
    return `
      <div class="member-row">
        <div class="member-avatar" style="background:${p?.avatar_color || '#1a6fdb'};">${name.substring(0,2).toUpperCase()}</div>
        <div class="member-info">
          <div class="member-name">${name}</div>
          <div class="member-email">${m.status || 'active'}</div>
        </div>
        <span class="member-role-badge ${m.company_role}">${formatRole(m.company_role)}</span>
      </div>`;
  }).join('');
}

async function loadAssociatedOrgs(companyId) {
  const { data: associations } = await dbClient
    .from('company_associations')
    .select('*, associated:associated_company_id(id, company_name, industry, country, status)')
    .eq('company_id', companyId);

  const section = document.getElementById('associatedSection');
  const grid = document.getElementById('associatedGrid');

  if (!associations?.length) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  grid.innerHTML = associations.map(a => {
    const c = a.associated;
    return `
      <div class="company-card" style="cursor:default;">
        <div class="company-card-header">
          <div class="company-card-icon">${(c.company_name || 'O').charAt(0).toUpperCase()}</div>
          <span class="status-badge ${c.status}">${c.status}</span>
        </div>
        <div class="company-card-name">${c.company_name}</div>
        <div class="company-card-industry">${c.industry || '—'}</div>
      </div>`;
  }).join('');
}

// ── COMPANY DETAIL MODAL ──────────────────────────────────────
async function openCompanyDetail(companyId) {
  selectedCompanyId = companyId;
  const company = allCompanies.find(c => c.id === companyId);
  if (!company) return;

  document.getElementById('companyDetailTitle').textContent = company.company_name;

  // Build company avatar/photo
  const photoHtml = company.photo_url
    ? `<img src="${company.photo_url}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; border:2px solid #e8eaf0;" />`
    : `<div style="width:48px; height:48px; border-radius:50%; background:#eef4fd; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; color:#1a6fdb; flex-shrink:0;">${(company.company_name || 'O').charAt(0).toUpperCase()}</div>`;

  // Load members
  const { data: members } = await dbClient
    .from('company_members')
    .select('*, profiles:user_id(first_name, last_name, avatar_color)')
    .eq('company_id', companyId);

  // Load active certifications
  const { data: certs } = await dbClient
    .from('organisation_certifications')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('cert_type');

  const membersList = members?.length
    ? members.map(m => {
        const p = m.profiles;
        const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unknown';
        return `<div class="member-row">
          <div class="member-avatar" style="background:${p?.avatar_color || '#1a6fdb'}; width:32px; height:32px; font-size:11px;">${name.substring(0,2).toUpperCase()}</div>
          <div class="member-info"><div class="member-name">${name}</div></div>
          <span class="member-role-badge ${m.company_role}">${formatRole(m.company_role)}</span>
        </div>`;
      }).join('')
    : '<p class="no-data">No members yet.</p>';

  const certsList = certs?.length
    ? certs.map(cert => {
        const certLabel = CERT_TYPES.find(c => c.key === cert.cert_type)?.label || cert.cert_type;
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f2f8;">
          <div>
            <div style="font-size:13px; font-weight:600; color:#1a1a2e;">${certLabel}</div>
            <div style="font-size:11px; color:#9aa0b4;">${cert.cert_number || ''} · ${formatCertDate(cert.start_date)} → ${formatCertDate(cert.end_date)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="status-badge active">Active</span>
            <button class="cert-history-btn" onclick="viewCertHistory('${companyId}', '${cert.cert_type}', '${certLabel}')">View History</button>
          </div>
        </div>`;
      }).join('')
    : '<p class="no-data">No certifications recorded.</p>';

  document.getElementById('companyDetailContent').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div style="display:flex; gap:12px; align-items:center;">
        ${photoHtml}
        <div>
          <div style="font-size:18px; font-weight:800; color:#1a1a2e;">${company.company_name}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
            <span class="status-badge ${company.status}">${company.status}</span>
            ${company.industry ? `<span class="meta-chip">${company.industry}</span>` : ''}
            ${company.country ? `<span class="meta-chip">📍 ${company.country}</span>` : ''}
            ${company.gln ? `<span class="meta-chip">GLN: ${company.gln}</span>` : ''}
            ${company.pgln ? `<span class="meta-chip">PGLN: ${company.pgln}</span>` : ''}
          </div>
        </div>
      </div>
      ${company.email ? `<p style="font-size:13px; color:#4a4e69;">✉ ${company.email}</p>` : ''}
      ${company.phone ? `<p style="font-size:13px; color:#4a4e69;">📞 ${company.phone}</p>` : ''}
      ${company.website ? `<p style="font-size:13px;"><a href="${company.website}" target="_blank" style="color:#1a6fdb;">${company.website}</a></p>` : ''}
      ${company.address ? `<p style="font-size:13px; color:#4a4e69;">📍 ${company.address}</p>` : ''}
      ${company.coordinates ? `<p style="font-size:13px; color:#4a4e69;">🌍 ${company.coordinates.lat}, ${company.coordinates.lng}</p>` : ''}
      ${company.notes ? `<div style="background:#f9fafc; border-radius:8px; padding:10px; font-size:12px; color:#6b7280;">${company.notes}</div>` : ''}

      <div>
        <h4 style="font-size:13px; font-weight:700; margin-bottom:10px; color:#1a1a2e;">Members</h4>
        ${membersList}
      </div>

      <div>
        <h4 style="font-size:13px; font-weight:700; margin-bottom:10px; color:#1a1a2e;">Certifications & Compliance</h4>
        ${certsList}
      </div>
    </div>
  `;

  const suspendBtn = document.getElementById('btnSuspendCompany');
  if (company.status === 'suspended') {
    suspendBtn.textContent = 'Activate';
    suspendBtn.style.background = '#22c55e';
  } else {
    suspendBtn.textContent = 'Suspend';
    suspendBtn.style.background = '#e63946';
  }

  document.getElementById('companyDetailModal').classList.remove('hidden');
}

function closeCompanyDetailModal() {
  document.getElementById('companyDetailModal').classList.add('hidden');
  selectedCompanyId = null;
}

async function toggleCompanyStatus() {
  if (!selectedCompanyId) return;
  const company = allCompanies.find(c => c.id === selectedCompanyId);
  const newStatus = company.status === 'suspended' ? 'active' : 'suspended';

  const { error } = await dbClient.from('companies').update({ status: newStatus }).eq('id', selectedCompanyId);
  if (error) { showToast('Failed to update.', 'error'); return; }

  await logActivity('update', 'company', selectedCompanyId, `Status changed to ${newStatus}`);
  showToast(`Organisation ${newStatus}!`, 'success');
  closeCompanyDetailModal();
  await loadAllCompanies();
}

function openEditFromDetail() {
  const idToEdit = selectedCompanyId;
  closeCompanyDetailModal();
  openCompanyFormModal(idToEdit);
}

// ── CERT HISTORY ──────────────────────────────────────────────
async function viewCertHistory(companyId, certType, certLabel) {
  const { data } = await dbClient
    .from('organisation_certifications')
    .select('*')
    .eq('company_id', companyId)
    .eq('cert_type', certType)
    .order('start_date', { ascending: false });

  document.getElementById('certHistoryTitle').textContent = `${certLabel} — History`;

  if (!data?.length) {
    document.getElementById('certHistoryList').innerHTML = '<p class="no-data">No history found.</p>';
  } else {
    document.getElementById('certHistoryList').innerHTML = data.map(cert => `
      <div class="cert-history-item">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div class="cert-history-period">${formatCertDate(cert.start_date)} → ${formatCertDate(cert.end_date)}</div>
          <span class="cert-history-status ${cert.is_active ? 'active' : 'expired'}">${cert.is_active ? 'Active' : 'Expired'}</span>
        </div>
        ${cert.cert_number ? `<div class="cert-history-number">Cert No: ${cert.cert_number}</div>` : ''}
        ${cert.url ? `<a href="${cert.url}" target="_blank" style="font-size:11px; color:#1a6fdb;">View Certificate ↗</a>` : ''}
      </div>
    `).join('');
  }

  document.getElementById('certHistoryModal').classList.remove('hidden');
}

// ── COMPANY FORM (Create & Edit) ──────────────────────────────
async function openCompanyFormModal(companyId) {
  isEditMode = !!companyId;
  selectedCompanyId = companyId;

  document.getElementById('companyFormTitle').textContent = isEditMode ? 'Edit Organisation' : 'Add Organisation';
  document.getElementById('btnSaveCompanyForm').textContent = isEditMode ? 'Update Organisation' : 'Save Organisation';
  switchFormTab('basic', document.querySelector('.form-tab[data-ftab="basic"]'));

// Show/hide first user section
  const firstUserSection = document.getElementById('firstUserSection');
  if (firstUserSection) {
    firstUserSection.style.display = isEditMode ? 'none' : 'block';
  }

  // Users tab
  if (isEditMode && selectedCompanyId) {
    document.getElementById('usersTabCreateMsg').classList.add('hidden');
    document.getElementById('usersTabContent').classList.remove('hidden');
    // Hide Add User button for non-admin/operator
    if (!canManageMembers()) {
      document.getElementById('btnAddMember').classList.add('hidden');
    }
    await loadFormMembers(selectedCompanyId);
  } else {
    document.getElementById('usersTabCreateMsg').classList.remove('hidden');
    document.getElementById('usersTabContent').classList.add('hidden');
  }

  // Reset form
['fcName','fcEmail','fcPhone','fcWebsite','fcAddress','fcGln','fcPgln','fcLat','fcLng','fcNotes','fcIndustryOther','firstUserEmail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fcIndustry').value = '';
  document.getElementById('fcCountry').value = '';
  document.getElementById('fcStatus').value = 'active';
  document.getElementById('mapFrame').classList.add('hidden');
  document.getElementById('mapPlaceholder').classList.remove('hidden');
  document.getElementById('fcIndustryOther').classList.add('hidden');
  document.getElementById('companyPhotoPreview').innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9aa0b4" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  renderCertFormList();

  if (isEditMode) {
    const company = allCompanies.find(c => c.id === companyId);
    if (company) {
      document.getElementById('fcName').value = company.company_name || '';
      document.getElementById('fcIndustry').value = company.industry || '';
      // Handle Other industry
      const knownIndustries = ['Seafood Processing','Aquaculture','Fishing','Food & Beverage','Retail','Distribution & Logistics','Cold Chain / Logistics'];
      if (company.industry && !knownIndustries.includes(company.industry)) {
        document.getElementById('fcIndustry').value = 'Other';
        const otherField = document.getElementById('fcIndustryOther');
        otherField.value = company.industry;
        otherField.classList.remove('hidden');
      }
      document.getElementById('fcEmail').value = company.email || '';
      document.getElementById('fcPhone').value = company.phone || '';
      document.getElementById('fcWebsite').value = company.website || '';
      document.getElementById('fcAddress').value = company.address || '';
      document.getElementById('fcStatus').value = company.status || 'active';
      document.getElementById('fcNotes').value = company.notes || '';
      document.getElementById('fcGln').value = company.gln || '';
      document.getElementById('fcPgln').value = company.pgln || '';

      // Set country by matching country name to alpha2
      if (company.country) {
        const countryMatch = allCountries.find(c => c.country === company.country);
        if (countryMatch) document.getElementById('fcCountry').value = countryMatch.alpha2;
      }

      // Show existing photo
      if (company.photo_url) {
        document.getElementById('companyPhotoPreview').innerHTML = `<img src="${company.photo_url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`;
      }

      if (company.coordinates) {
        document.getElementById('fcLat').value = company.coordinates.lat || '';
        document.getElementById('fcLng').value = company.coordinates.lng || '';
        updateMapPreview();
      }

      // Load existing certs
      const { data: existingCerts } = await dbClient
        .from('organisation_certifications')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true);

      if (existingCerts?.length) {
        existingCerts.forEach(cert => {
          const checkbox = document.getElementById(`cert_${cert.cert_type}`);
          if (checkbox) {
            checkbox.checked = true;
            toggleCertDetails(cert.cert_type, true);
            document.getElementById(`cert_no_${cert.cert_type}`).value = cert.cert_number || '';
            document.getElementById(`cert_start_${cert.cert_type}`).value = cert.start_date || '';
            document.getElementById(`cert_end_${cert.cert_type}`).value = cert.end_date || '';
            document.getElementById(`cert_url_${cert.cert_type}`).value = cert.url || '';
          }
        });
      }
    }
  }

  document.getElementById('companyFormModal').classList.remove('hidden');
}

function closeCompanyFormModal() {
  document.getElementById('companyFormModal').classList.add('hidden');
}

async function saveCompanyForm() {
  const name = document.getElementById('fcName').value.trim();
  if (!name) { showToast('Organisation name is required.', 'error'); return; }

  const industrySelect = document.getElementById('fcIndustry').value;
  const industryOther = document.getElementById('fcIndustryOther')?.value.trim();
  const industry = industrySelect === 'Other' ? (industryOther || 'Other') : industrySelect;

  const lat = parseFloat(document.getElementById('fcLat').value);
  const lng = parseFloat(document.getElementById('fcLng').value);
  const coordinates = (!isNaN(lat) && !isNaN(lng)) ? { lat, lng } : null;

  const countryCode = document.getElementById('fcCountry').value;
  const countryObj = allCountries.find(c => c.alpha2 === countryCode);
  const countryName = countryObj ? countryObj.country : countryCode;

  const payload = {
    company_name: name,
    industry: industry || null,
    email: document.getElementById('fcEmail').value.trim() || null,
    phone: document.getElementById('fcPhone').value.trim() || null,
    website: document.getElementById('fcWebsite').value.trim() || null,
    address: document.getElementById('fcAddress').value.trim() || null,
    country: countryName || null,
    status: document.getElementById('fcStatus').value || 'active',
    notes: document.getElementById('fcNotes').value.trim() || null,
    gln: document.getElementById('fcGln').value.trim() || null,
    pgln: document.getElementById('fcPgln').value.trim() || null,
    coordinates,
  };

  let companyId = selectedCompanyId;

if (isEditMode) {
    // Upload photo first if new one selected
    const photoUrl = await uploadCompanyPhoto(companyId);
    if (photoUrl) payload.photo_url = photoUrl;

    const { error } = await dbClient.from('companies').update(payload).eq('id', companyId);
    if (error) { showToast('Failed to update.', 'error'); return; }

    await logActivity('update', 'company', companyId, `Updated: ${name}`);
  } else {
    const { data, error } = await dbClient
      .from('companies')
      .insert({ ...payload, created_by: currentUser.id })
      .select().single();
    if (error) { showToast('Failed to create.', 'error'); return; }
    companyId = data.id;

    // Upload photo
    const photoUrl = await uploadCompanyPhoto(companyId);
    if (photoUrl) {
      await dbClient.from('companies').update({ photo_url: photoUrl }).eq('id', companyId);
    }

    await logActivity('create', 'company', companyId, `Created: ${name}`);

    // Handle first user
    await assignFirstUser(companyId);
  }

  // Save certifications
  await saveCertifications(companyId);

showToast(isEditMode ? 'Changes saved successfully!' : 'Organisation created!', 'success');
  closeCompanyFormModal();
  await loadAllCompanies();
}

async function saveCertifications(companyId) {
  for (const cert of CERT_TYPES) {
    const checkbox = document.getElementById(`cert_${cert.key}`);
    if (!checkbox?.checked) continue;

    const certNo = document.getElementById(`cert_no_${cert.key}`)?.value.trim();
    const startDate = document.getElementById(`cert_start_${cert.key}`)?.value;
    const endDate = document.getElementById(`cert_end_${cert.key}`)?.value;
    const url = document.getElementById(`cert_url_${cert.key}`)?.value.trim();

    // Mark old active cert as inactive
    await dbClient
      .from('organisation_certifications')
      .update({ is_active: false, removed_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('cert_type', cert.key)
      .eq('is_active', true);

    // Insert new cert record
    await dbClient.from('organisation_certifications').insert({
      company_id: companyId,
      cert_type: cert.key,
      cert_number: certNo || null,
      start_date: startDate || null,
      end_date: endDate || null,
      url: url || null,
      is_active: true,
    });
  }
}

// ── CERT FORM LIST ────────────────────────────────────────────
function renderCertFormList() {
  const container = document.getElementById('certFormList');
  container.innerHTML = CERT_TYPES.map(cert => `
    <div class="cert-item" id="certItem_${cert.key}">
      <button type="button" class="cert-toggle" onclick="toggleCertItem('${cert.key}')">
        <input type="checkbox" class="cert-checkbox" id="cert_${cert.key}"
          onclick="event.stopPropagation(); toggleCertDetails('${cert.key}', this.checked)" />
        <span class="cert-name">${cert.label}</span>
      </button>
      <div class="cert-details" id="certDetails_${cert.key}">
        <div class="cert-details-grid">
          <div class="form-group">
            <label>Certificate Number</label>
            <input type="text" id="cert_no_${cert.key}" placeholder="e.g. MSC-C-12345" />
          </div>
          <div class="form-group">
            <label>Certificate URL</label>
            <input type="text" id="cert_url_${cert.key}" placeholder="https://..." />
          </div>
          <div class="form-group">
            <label>Start Date</label>
            <input type="date" id="cert_start_${cert.key}" />
          </div>
          <div class="form-group">
            <label>End Date</label>
            <input type="date" id="cert_end_${cert.key}" />
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function toggleCertItem(key) {
  const checkbox = document.getElementById(`cert_${key}`);
  checkbox.checked = !checkbox.checked;
  toggleCertDetails(key, checkbox.checked);
}

function toggleCertDetails(key, show) {
  const details = document.getElementById(`certDetails_${key}`);
  const item = document.getElementById(`certItem_${key}`);
  if (show) {
    details.classList.add('open');
    item.classList.add('selected');
  } else {
    details.classList.remove('open');
    item.classList.remove('selected');
  }
}

// ── FORM TABS ─────────────────────────────────────────────────
function switchFormTab(tab, btn) {
  document.querySelectorAll('.form-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.form-tab-panel').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById(`ftab-${tab}`)?.classList.add('active');
}

// ── MAP PREVIEW ───────────────────────────────────────────────
function updateMapPreview() {
  const lat = document.getElementById('fcLat').value;
  const lng = document.getElementById('fcLng').value;

  if (!lat || !lng) return;

  const frame = document.getElementById('mapFrame');
  const placeholder = document.getElementById('mapPlaceholder');

  frame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${parseFloat(lng)-0.05},${parseFloat(lat)-0.05},${parseFloat(lng)+0.05},${parseFloat(lat)+0.05}&layer=mapnik&marker=${lat},${lng}`;
  frame.classList.remove('hidden');
  placeholder.classList.add('hidden');
}

// ── INVITE ────────────────────────────────────────────────────
function openInviteModal() { document.getElementById('inviteModal').classList.remove('hidden'); }
function closeInviteModal() { document.getElementById('inviteModal').classList.add('hidden'); }
function inviteMember() {
  showToast('Invite sent! (Full invite system coming soon)', 'success');
  closeInviteModal();
}

// ── REQUEST ───────────────────────────────────────────────────
function openRequestModal() { document.getElementById('requestModal').classList.remove('hidden'); }
function closeRequestModal() { document.getElementById('requestModal').classList.add('hidden'); }
function sendRequest() {
  showToast('Request sent! Our team will contact you shortly.', 'success');
  closeRequestModal();
}

// ── HELPERS ───────────────────────────────────────────────────
function formatRole(role) {
  return { company_admin: 'Company Admin', editor: 'Editor', viewer: 'Viewer' }[role] || role;
}

function formatCertDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── USERS TAB ─────────────────────────────────────────────────
async function loadFormMembers(companyId) {
  const { data: members } = await dbClient
    .from('company_members')
    .select('*, profiles:user_id(first_name, last_name, avatar_color)')
    .eq('company_id', companyId);

  const container = document.getElementById('formMembersList');
  if (!members?.length) {
    container.innerHTML = '<p class="no-data">No members yet. Add the first user above.</p>';
    return;
  }

  container.innerHTML = members.map(m => {
    const p = m.profiles;
    const name = [p?.first_name, p?.last_name].filter(Boolean).join(' ') || 'Unknown';
    const initials = name.substring(0, 2).toUpperCase();
    const roleLabel = { company_admin: 'Administrator', contributor: 'Contributor', member: 'Member' }[m.company_role] || m.company_role;

    return `
      <div class="form-member-row">
        <div class="form-member-avatar" style="background:${p?.avatar_color || '#1a6fdb'}">${initials}</div>
        <div class="form-member-info">
          <div class="form-member-name">${name}</div>
          <div class="form-member-email">${p?.email || '—'}</div>
        </div>
        <span class="form-member-role ${m.company_role}">${roleLabel}</span>
        ${canManageMembers() ? `<button class="btn-remove-member" onclick="removeMember('${m.id}', '${name}')">Remove</button>` : ''}
      </div>
    `;
  }).join('');
}

function canManageMembers() {
  return ['admin', 'operator'].includes(currentProfile?.role);
}

function openAddMemberModal() {
  document.getElementById('addMemberEmail').value = '';
  document.getElementById('addMemberPassword').value = '';
  document.getElementById('addMemberFirstName').value = '';
  document.getElementById('addMemberLastName').value = '';
  document.getElementById('addMemberRole').value = 'member';
  document.getElementById('addMemberModal').classList.remove('hidden');
}

function closeAddMemberModal() {
  document.getElementById('addMemberModal').classList.add('hidden');
}

async function addMemberToOrg() {
  const email = document.getElementById('addMemberEmail').value.trim();
  const password = document.getElementById('addMemberPassword').value.trim();
  const firstName = document.getElementById('addMemberFirstName').value.trim();
  const lastName = document.getElementById('addMemberLastName').value.trim();
  const role = document.getElementById('addMemberRole').value;

  if (!email || !password) { showToast('Email and password are required.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (!selectedCompanyId) { showToast('Please save the organisation first.', 'error'); return; }

  // Check admin limit
  if (role === 'company_admin') {
    const { count } = await dbClient
      .from('company_members')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', selectedCompanyId)
      .eq('company_role', 'company_admin');
    if (count >= 2) { showToast('Maximum 2 Administrators allowed per organisation.', 'error'); return; }
  }

  const btn = document.querySelector('#addMemberModal .modal-ok-btn');
  btn.textContent = 'Adding...';
  btn.disabled = true;

  try {
    let userId = null;

    // Check if user already exists
    const { data: existingProfiles } = await dbClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .limit(1);

    const existingProfile = existingProfiles?.[0];

    if (existingProfile) {
      userId = existingProfile.id;
    } else {
      // Create new user via Edge Function
      const { data: { session } } = await dbClient.auth.getSession();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email, password,
          first_name: firstName,
          last_name: lastName,
          role: 'supplier',
          company_id: selectedCompanyId
        })
      });

      const result = await response.json();
      if (result.error) throw new Error(result.error);
      userId = result.user_id;
    }

    // Check if already a member
    const { data: existingMember } = await dbClient
      .from('company_members')
      .select('id')
      .eq('company_id', selectedCompanyId)
      .eq('user_id', userId)
      .limit(1);

    if (existingMember?.[0]) {
      showToast('This user is already a member of this organisation.', 'error');
      return;
    }

    // Add to company_members
    await dbClient.from('company_members').insert({
      company_id: selectedCompanyId,
      user_id: userId,
      company_role: role,
      status: 'active'
    });

    // Update profile company_id
    await dbClient.from('profiles').update({ company_id: selectedCompanyId }).eq('id', userId);

    await logActivity('create', 'company_member', selectedCompanyId, `Added ${email} as ${role}`);
    showToast(`${email} added successfully!`, 'success');
    closeAddMemberModal();
    await loadFormMembers(selectedCompanyId);

  } catch (err) {
    showToast(err.message || 'Failed to add user.', 'error');
  } finally {
    btn.textContent = 'Add User';
    btn.disabled = false;
  }
}

async function removeMember(memberId, name) {
  if (!confirm(`Remove ${name} from this organisation?`)) return;

  const { error } = await dbClient.from('company_members').delete().eq('id', memberId);
  if (error) { showToast('Failed to remove member.', 'error'); return; }

  showToast(`${name} removed.`, 'success');
  await loadFormMembers(selectedCompanyId);
}