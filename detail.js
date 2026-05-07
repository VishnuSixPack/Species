// =============================================
//  SPECIES DETAIL PAGE — detail.js
// =============================================

// ── SUPABASE CONFIGURATION ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── GET SPECIES ID FROM URL ──
// When you click a species name, the URL becomes:
// species-detail.html?id=5
// This reads that "5" so we know which species to load
function getIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

// ── FILL A FIELD ──
// Finds the element by id and puts the value in it
// If value is empty, shows a dash "—"
function fillField(id, value, suffix = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value ? `${value}${suffix}` : '—';
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

  // Store species id for edit button
  window.currentSpeciesId = data.id;

  // ── Fill header ──
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

  // ── Basic Information ──
  fillField('d-common_trade_family_name', data.common_trade_family_name);
  fillField('d-afsis_3a_code', data.afsis_3a_code);
  fillField('d-taxonomic_code', data.taxonomic_code);
  fillField('d-alphia_id', data.alphia_id);
  fillField('d-isscaap_code', data.isscaap_code);
  fillField('d-caab_code', data.caab_code);

  // ── Classification ──
  fillField('d-kingdom', data.kingdom);
  fillField('d-phylum', data.phylum);
  fillField('d-class_name', data.class_name);
  fillField('d-order_name', data.order_name);
  fillField('d-family', data.family);
  fillField('d-genus', data.genus);

  // ── Dimensions ──
  fillField('d-maturity_cm', data.maturity_cm, data.maturity_cm_type ? ` ${data.maturity_cm_type}` : ' cm');
  fillField('d-max_length_cm', data.max_length_cm, data.max_length_cm_type ? ` ${data.max_length_cm_type}` : ' cm');
  fillField('d-common_length_cm', data.common_length_cm, data.common_length_cm_type ? ` ${data.common_length_cm_type}` : ' cm');
  fillField('d-max_published_weight', data.max_published_weight, data.max_published_weight_type ? ` ${data.max_published_weight_type}` : ' kg');
  fillField('d-max_reported_age', data.max_reported_age, data.max_reported_age_type ? ` ${data.max_reported_age_type}` : ' years');

  // ── Characteristics ──
  fillField('d-short_description', data.short_description);
  fillField('d-habitat', data.habitat);
  fillField('d-biology', data.biology);
  fillField('d-distribution', data.distribution);
  fillField('d-colour', data.colour);
  fillField('d-temperature', data.temperature);
  fillField('d-behavior', data.behavior);
  fillField('d-diet', data.diet);
  fillField('d-predators', data.predators);
  fillField('d-main_prey', data.main_prey);
  fillField('d-depth_range', data.depth_range);
  fillField('d-fao_area', data.fao_area);

  // ── Harvest ──
  fillField('d-source_type', data.source_type);
  fillField('d-gear_type', data.gear_type);

  // ── Show content ──
  document.getElementById('detail-content').style.display = 'block';
}

// ── EDIT BUTTON ──
function goToEdit() {
  // Goes back to species list and opens edit modal
  window.location.href = `Species.html?edit=${window.currentSpeciesId}`;
}

// ── START ──
document.addEventListener('DOMContentLoaded', loadSpecies);