// =============================================
//  SPECIES DETAIL PAGE — detail.js
// =============================================

// ── SUPABASE CONFIGURATION ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── AUTH CHECK ──
async function checkAuth() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
  }
  return session;
}

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