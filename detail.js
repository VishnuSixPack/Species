// =============================================
//  SPECIES DETAIL PAGE — detail.js
// =============================================

// ── SUPABASE CONFIGURATION ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);



function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour < 17) return `Good Afternoon, ${name}! 👋`;
  if (hour < 21) return `Good Evening, ${name}! 🌆`;
  return `Good Night, ${name}! 🌙`;
}

// ── AUTH CHECK ──
async function checkAuth() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
  }
  return session;
}



// ── UPDATE NAV ──
async function updateNav() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) return;

  const email = session.user.email;
  const initials = email.substring(0, 2).toUpperCase();

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.first_name || email.split('@')[0];
  const avatarColor = profile?.avatar_color || '#1a6fdb';

  const profileLink = document.getElementById('detail-profile-link');
  if (profileLink) {
    profileLink.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; cursor:pointer; position:relative;" onclick="toggleProfileMenu()">
        <div style="width:32px; height:32px; border-radius:50%; background:${avatarColor}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700;">${initials}</div>
        <span style="font-size:12px; color:#6b7280; font-weight:500;">${email}</span>
        <div class="nav-profile-menu" id="nav-profile-menu" style="position:absolute; top:calc(100% + 8px); right:0; background:#fff; border:1px solid #e8eaf0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.10); min-width:160px; overflow:hidden; display:none;">
          <div style="padding:10px 16px 6px; font-size:12px; font-weight:700; color:#1a1a2e; border-bottom:1px solid #f0f2f8;">${getGreeting(firstName)}</div>
          <a href="profile.html" style="display:flex; align-items:center; gap:8px; padding:9px 16px; font-size:13px; color:#4a4e69; text-decoration:none; font-weight:500;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Profile
          </a>
          ${['admin', 'operator'].includes(profile?.role) ? `
          <a href="#" onclick="openSwitchAccount(); return false;" style="display:flex; align-items:center; gap:8px; padding:9px 16px; font-size:13px; color:#4a4e69; text-decoration:none; font-weight:500;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            Switch Account
          </a>` : ''}
          <button onclick="handleLogout()" style="width:100%; padding:9px 16px; background:none; border:none; border-top:1px solid #f0f2f8; text-align:left; font-family:'DM Sans',sans-serif; font-size:13px; color:#e63946; cursor:pointer; font-weight:500;">Logout</button>
        </div>
      </div>`;
  }

  // Enable Edit and Delete in settings menu
  const editBtn = document.getElementById('detail-edit-btn');
  const deleteBtn = document.getElementById('detail-delete-btn');
  if (editBtn) {
    editBtn.disabled = false;
    editBtn.style.cursor = 'pointer';
    editBtn.style.color = '#0f0f0f';
    editBtn.title = '';
  }
  if (deleteBtn) {
    deleteBtn.disabled = false;
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.color = '#c0392b';
    deleteBtn.title = '';
  }
}

async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

function toggleProfileMenu() {
  const menu = document.getElementById('nav-profile-menu');
  menu.classList.toggle('open');
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-profile-wrap')) {
    const menu = document.getElementById('nav-profile-menu');
    if (menu) menu.classList.remove('open');
  }
});

// ── GET SPECIES ID FROM URL ──
function getIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// ── FILL A FIELD ──
function fillField(id, value, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ? `${value}${suffix}` : '—';
}

function fillPills(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!value) {
    el.textContent = '—';
    return;
  }
  const items = value.split(',').map(v => v.trim()).filter(v => v);
  el.innerHTML = items.map(item => 
    `<span style="display:inline-block; background:#f0f5ff; border:1px solid #c0d4f5; color:#1a6fdb; font-size:12px; font-weight:500; padding:3px 10px; border-radius:999px; margin:2px 3px 2px 0;">${item}</span>`
  ).join('');
}

// ── SWITCH TAB ──
function switchTab(tabName) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Remove active from all tabs
  document.querySelectorAll('.detail-tab').forEach(tab => {
    tab.classList.remove('active');
  });

  // Show selected panel
  document.getElementById(`tab-${tabName}`).classList.add('active');

  // Mark clicked tab as active
  event.target.classList.add('active');
}

// ── LOAD SPECIES ──
async function loadSpecies() {
  const id = getIdFromUrl();

  if (!id) {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'block';
    return;
  }

  const { data, error } = await dbClient
    .from('species')
    .select('*')
    .eq('id', id)
    .single();

  document.getElementById('loading-state').style.display = 'none';

  if (error || !data) {
    document.getElementById('error-state').style.display = 'block';
    return;
  }

  // Store id for edit button
  window.currentSpeciesId = data.id;

  // ── Header ──
  document.getElementById('detail-species-name').textContent = data.species_name || '—';
  document.getElementById('detail-scientific-name').textContent = data.scientific_name || '';
  document.title = data.species_name || 'Species Detail';

  // ── Photo ──
  if (data.photo_url) {
    const img = document.getElementById('detail-photo');
    img.src = data.photo_url;
    img.style.display = 'block';
    document.getElementById('detail-no-photo').style.display = 'none';
  }

  // ── Left panel summary ──
  fillField('s-common_trade_family_name', data.common_trade_family_name);
  fillField('s-afsis_3a_code', data.afsis_3a_code);
  fillField('s-taxonomic_code', data.taxonomic_code);
  fillField('s-maturity_cm', data.maturity_cm, data.maturity_cm_type ? ` ${data.maturity_cm_type}` : ' cm');

  // ── Basic Information tab ──
  fillField('d-species_name', data.species_name);
  fillField('d-scientific_name', data.scientific_name);
  fillField('d-common_trade_family_name', data.common_trade_family_name);
  fillField('d-afsis_3a_code', data.afsis_3a_code);
  fillField('d-taxonomic_code', data.taxonomic_code);
  fillField('d-alphia_id', data.alphia_id);
  fillField('d-isscaap_code', data.isscaap_code);
  fillField('d-caab_code', data.caab_code);

  // ── Classification tab ──
  fillField('d-kingdom', data.kingdom);
  fillField('d-phylum', data.phylum);
  fillField('d-class_name', data.class_name);
  fillField('d-order_name', data.order_name);
  fillField('d-family', data.family);
  fillField('d-genus', data.genus);

  // ── Dimensions tab ──
  fillField('d-maturity_cm', data.maturity_cm, data.maturity_cm_type ? ` ${data.maturity_cm_type}` : ' cm');
  fillField('d-max_length_cm', data.max_length_cm, data.max_length_cm_type ? ` ${data.max_length_cm_type}` : ' cm');
  fillField('d-common_length_cm', data.common_length_cm, data.common_length_cm_type ? ` ${data.common_length_cm_type}` : ' cm');
  fillField('d-max_published_weight', data.max_published_weight, data.max_published_weight_type ? ` ${data.max_published_weight_type}` : ' kg');
  fillField('d-max_reported_age', data.max_reported_age, data.max_reported_age_type ? ` ${data.max_reported_age_type}` : ' years');
  fillField('d-generation_length', data.generation_length, data.generation_length_type ? ` ${data.generation_length_type}` : '');

  // ── Characteristics tab ──
  fillField('d-short_description', data.short_description);
  fillField('d-habitat', data.habitat);
  fillField('d-biology', data.biology);
  fillField('d-distribution', data.distribution);
  fillField('d-colour', data.colour);
  fillField('d-dna_sequence', data.dna_sequence);
  fillField('d-reproduction_lifecycle', data.reproduction_lifecycle);
  fillField('d-temperature', data.temperature);
  fillField('d-behavior', data.behavior);
  fillField('d-swim_speed', data.swim_speed);
  fillField('d-short_bursts', data.short_bursts);
  fillField('d-predators', data.predators);
  fillField('d-main_prey', data.main_prey);
  fillField('d-diet', data.diet);
  fillField('d-depth_range', data.depth_range);
  fillPills('d-fao_area', data.fao_area);

  // ── Harvest tab ──
  fillPills('d-source_type', data.source_type);
  fillPills('d-gear_type', data.gear_type);

  // ── Show content ──
  document.getElementById('detail-content').style.display = 'block';
}

// ── EDIT BUTTON ──
function goToEdit() {
  window.location.href = `Species.html?edit=${window.currentSpeciesId}`;
}

// ── START ──
document.addEventListener('DOMContentLoaded', async function() {
  const session = await checkAuth();
  if (session) {
    updateNav();
    loadSpecies();
  }
});

// ── SETTINGS MENU ──
function toggleSettingsMenu() {
  const menu = document.getElementById('detail-settings-menu');
  menu.classList.toggle('open');
}

// Close menu when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.detail-settings-wrap')) {
    document.getElementById('detail-settings-menu').classList.remove('open');
  }
});
// ── DELETE FROM DETAIL PAGE ──
async function deleteCurrentSpecies() {
  const name = document.getElementById('detail-species-name').textContent;
  window.deleteSpeciesName = name;
  document.getElementById('deleteSpeciesName').textContent = name;
  document.getElementById('speciesDeleteStep1').classList.remove('hidden');
  document.getElementById('speciesDeleteStep2').classList.add('hidden');
  document.getElementById('speciesDeleteModal').style.display = 'flex';
}

function closeSpeciesDeleteModal() {
  document.getElementById('speciesDeleteModal').style.display = 'none';
}

function proceedToSpeciesStep2() {
  document.getElementById('speciesDeleteStep1').classList.add('hidden');
  document.getElementById('speciesDeleteStep2').classList.remove('hidden');
}

async function confirmSpeciesDelete(reminder) {
  const btn = reminder
    ? document.querySelector('.species-remind-btn')
    : document.querySelector('.species-no-remind-btn');
  btn.textContent = 'Moving to Trash...';
  btn.disabled = true;

  const { error } = await dbClient
    .from('species')
    .update({
      deleted_at: new Date().toISOString(),
      reminder: reminder
    })
    .eq('id', window.currentSpeciesId);

  if (error) {
    alert('Delete failed: ' + error.message);
    btn.textContent = reminder ? 'Yes, remind me' : "No, I'm sure";
    btn.disabled = false;
    return;
  }

  await logActivity('delete', 'species', window.currentSpeciesId, `Moved species to Trash: ${window.deleteSpeciesName}`);
  window.location.href = 'Species.html';
}

// ── CUSTOM CONFIRM ──
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    overlay.classList.add('open');

    document.getElementById('confirm-ok').onclick = () => {
      overlay.classList.remove('open');
      resolve(true);
    };
    document.getElementById('confirm-cancel').onclick = () => {
      overlay.classList.remove('open');
      resolve(false);
    };
  });
}