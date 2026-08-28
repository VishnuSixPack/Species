/* ============================================================
   PROJECT MANHATTAN — product-detail.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

let currentProductId = null;
let currentProductName = '';

function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour < 17) return `Good Afternoon, ${name}! 👋`;
  if (hour < 21) return `Good Evening, ${name}! 🌆`;
  return `Good Night, ${name}! 🌙`;
}

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
  document.getElementById('navDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-right')) {
    document.getElementById('navDropdown')?.classList.remove('open');
  }
});

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

const email = session.user.email || '';

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.first_name || email.split('@')[0];
  const avatarColor = profile?.avatar_color || '#1a6fdb';
  const initials = email.substring(0, 2).toUpperCase();

  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, initials, avatarColor);
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(firstName);

  // Set home link
  setHomeLink(profile?.role);

  // Get org role and hide edit/delete for members
  const orgRole = await getUserOrgRole();
  if (!canEdit(orgRole)) {
    document.getElementById('btnEdit')?.style.setProperty('display', 'none');
    document.getElementById('btnDelete')?.style.setProperty('display', 'none');
  }

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) { showError(); return; }

  currentProductId = id;
  await loadProduct(id);
});

// ── LOAD PRODUCT ──────────────────────────────────────────────
async function loadProduct(id) {
  showLoading(true);

  // Fetch product with species join
  const { data: product, error } = await dbClient
    .from('products')
    .select(`
      *,
      species:species_id (
        species_name, scientific_name, afsis_3a_code, taxonomic_code,
        source_type, gear_type
      )
    `)
    .eq('id', id)
    .single();

  if (error || !product) { showLoading(false); showError(); return; }

  // Fetch allergens
  const { data: allergens } = await dbClient
    .from('product_allergens')
    .select('*')
    .eq('product_id', id);

  // Fetch nutrition
  const { data: nutrition } = await dbClient
    .from('product_nutrition')
    .select('*')
    .eq('product_id', id);

  // Fetch artwork
  const { data: artwork } = await dbClient
    .from('product_artwork')
    .select('*')
    .eq('product_id', id);

  showLoading(false);
  renderProduct(product, allergens || [], nutrition || [], artwork || []);
}

// ── RENDER ────────────────────────────────────────────────────
function renderProduct(p, allergens, nutrition, artwork) {
  currentProductName = p.product_name || 'Untitled Product';
  document.title = `${currentProductName} — Project Manhattan`;

  // ── Left Panel ──
  const photoEl = document.getElementById('detailPhoto');
  if (p.photo_url) {
    photoEl.innerHTML = `<img src="${p.photo_url}" alt="${p.product_name}" />`;
  }

  setText('leftName', p.product_name);
  setText('leftBrand', p.brand);
  setText('leftSpecies', p.species?.species_name);
  setText('leftEan', p.ean_gtin);
  setText('leftForm', p.product_form);
  setText('leftPack', p.pack_style);
  setText('leftMedium', p.pack_medium);
  setText('leftCode', p.product_code);

  // Certifications in left panel
  const certsEl = document.getElementById('detailCerts');
  if (p.certifications && p.certifications.length > 0) {
    certsEl.innerHTML = p.certifications.map(c =>
      `<span class="cert-pill">${c}</span>`
    ).join('');
  }

  // ── General Information ──
  setText('d-product_name', p.product_name);
  setText('d-brand', p.brand);
  setText('d-functional_name', p.functional_product_name);
  setText('d-gs1_name', p.gs1_product_name);
  setText('d-short_desc', p.short_description);
  setText('d-ean_gtin', p.ean_gtin);
  setText('d-brand_item_id', p.brand_item_id);
  setText('d-product_code', p.product_code);
  setText('d-description', p.description);

  // ── Physical Measurement ──
  setText('d-depth', p.depth_mm ? `${p.depth_mm} mm` : null);
  setText('d-height', p.height_mm ? `${p.height_mm} mm` : null);
  setText('d-width', p.width_mm ? `${p.width_mm} mm` : null);
  setText('d-gross_weight', p.gross_weight_g ? `${p.gross_weight_g} g` : null);
  setText('d-net_weight', p.net_weight_g ? `${p.net_weight_g} g` : null);
  setText('d-drained_weight', p.drained_weight_g ? `${p.drained_weight_g} g` : null);

  // ── Packaging ──
  setText('d-product_form', p.product_form);
  setText('d-pack_style', p.pack_style);
  setText('d-pack_medium', p.pack_medium);
  setText('d-primary_packaging', p.primary_packaging);
  setText('d-inner_packaging', p.no_inner_packaging ? 'No Secondary / Inner Packaging' : p.inner_packaging);

  // ── Storage ──
  setText('d-min_temp', p.min_temp_c !== null ? `${p.min_temp_c} °C` : null);
  setText('d-max_temp', p.max_temp_c !== null ? `${p.max_temp_c} °C` : null);
  setText('d-shelf_life', p.shelf_life_value ? `${p.shelf_life_value} ${p.shelf_life_unit || 'days'}` : null);

  // ── Ingredients ──
  const ingEl = document.getElementById('d-ingredients');
  ingEl.textContent = p.ingredients || '—';

  // ── Raw Material ──
  setText('d-commercial_name', p.species?.species_name);
  setText('d-scientific_name', p.species?.scientific_name);
  setText('d-afsis_code', p.species?.afsis_3a_code);
  setText('d-taxon_code', p.species?.taxonomic_code);
  // Prefer the actual per-product selection (type_of_catch / harvest_method,
  // now saved on the product itself). Species' source_type/gear_type are a
  // comma-separated list of every method possible for that species, not
  // the one actually used for this product — falling back to them here is
  // only for records saved before this field existed, and will still show
  // the full list for those older rows until re-saved.
  setText('d-type_of_catch', p.type_of_catch || p.species?.source_type);
  setText('d-harvest_method', p.harvest_method || p.species?.gear_type);
  setText('d-harvest_custom', p.harvest_method_custom);

  // ── Allergens ──
  renderAllergens(allergens);

  // ── Nutrition ──
  renderNutrition(nutrition);

  // ── Sustainability ──
const FAO_LABELS = {
    'FAO01': 'Africa – Inland waters (FAO 01)',
    'FAO02': 'America, North – Inland waters (FAO 02)',
    'FAO03': 'America, South – Inland waters (FAO 03)',
    'FAO21': 'Atlantic, Northwest (FAO 21)',
    'FAO27': 'Atlantic, Northeast (FAO 27)',
    'FAO31': 'Atlantic, Western Central (FAO 31)',
    'FAO34': 'Atlantic, Eastern Central (FAO 34)',
    'FAO37': 'Mediterranean and Black Sea (FAO 37)',
    'FAO41': 'Atlantic, Southwest (FAO 41)',
    'FAO47': 'Atlantic, Southeast (FAO 47)',
    'FAO48': 'Atlantic, Antarctic (FAO 48)',
    'FAO51': 'Indian Ocean, Western (FAO 51)',
    'FAO57': 'Indian Ocean, Eastern (FAO 57)',
    'FAO58': 'Indian Ocean, Antarctic (FAO 58)',
    'FAO61': 'Pacific, Northwest (FAO 61)',
    'FAO67': 'Pacific, Northeast (FAO 67)',
    'FAO71': 'Pacific, Western Central (FAO 71)',
    'FAO77': 'Pacific, Eastern Central (FAO 77)',
    'FAO81': 'Pacific, Southwest (FAO 81)',
    'FAO87': 'Pacific, Southeast (FAO 87)',
    'FAO88': 'Pacific, Antarctic (FAO 88)',
    'NS': 'Not Specified / Unavailable',
  };

  const CERT_LABELS = {
    'MSC': 'MSC (Marine Stewardship Council)',
    'ASC': 'ASC (Aquaculture Stewardship Council)',
    'BAP': 'BAP (Best Aquaculture Practices)',
    'GLOBALG.A.P': 'GLOBALG.A.P',
    'Friend of the Sea': 'Friend of the Sea',
    'Dolphin Safe': 'Dolphin Safe',
    'Organic EU': 'Organic EU',
    'Fairtrade': 'Fairtrade',
    'RSPO': 'RSPO',
    'Rainforest Alliance': 'Rainforest Alliance',
  };

  const originEl = document.getElementById('d-raw_origin');
  if (p.raw_material_origin) {
    const origins = p.raw_material_origin.split(',').map(v => v.trim()).filter(v => v);
    originEl.innerHTML = origins.map(o => `<span class="pill">${FAO_LABELS[o] || o}</span>`).join('');
  } else {
    originEl.textContent = '—';
  }

const certEl2 = document.getElementById('d-certifications');
  if (p.certifications && p.certifications.length > 0) {
    certEl2.innerHTML = p.certifications.map(c => `<span class="cert-pill">${CERT_LABELS[c] || c}</span>`).join('');
  } else {
    certEl2.textContent = '—';
  }

  // ── Artwork ──
  renderArtwork(artwork);

  // Show content
  document.getElementById('detailContent').classList.remove('hidden');
}

// ── ALLERGENS ─────────────────────────────────────────────────
function renderAllergens(allergens) {
  const el = document.getElementById('d-allergens');
  if (!allergens || allergens.length === 0) {
    el.innerHTML = '<p class="no-data">No allergens recorded.</p>';
    return;
  }

  const html = `<div class="allergen-table">` +
    allergens.map(a => `
      <div class="allergen-card">
        <div class="allergen-card-field">
          <span class="detail-label">Allergen Label</span>
          <span class="detail-value">${a.allergen_label || '—'}</span>
        </div>
        <div class="allergen-card-field">
          <span class="detail-label">Type Code</span>
          <span class="detail-value">${a.allergen_type_code || '—'}</span>
        </div>
        <div class="allergen-card-field">
          <span class="detail-label">Containment Level</span>
          <span class="containment-badge ${a.containment_level || ''}">
            ${formatContainment(a.containment_level)}
          </span>
        </div>
        <div class="allergen-card-field">
          <span class="detail-label">Agency</span>
          <span class="detail-value">${a.specification_agency || '—'}</span>
        </div>
        <div class="allergen-card-field">
          <span class="detail-label">Agency Description</span>
          <span class="detail-value">${a.agency_description || '—'}</span>
        </div>
      </div>
    `).join('') +
  `</div>`;

  el.innerHTML = html;
}

function formatContainment(level) {
  const map = { contain: 'Contain', free_from: 'Free from', may_contain: 'May contain' };
  return map[level] || level || '—';
}

// ── NUTRITION ─────────────────────────────────────────────────
function renderNutrition(nutrition) {
  const serving = nutrition.filter(n => n.basis === 'serving');
  const per100g = nutrition.filter(n => n.basis === '100g');

  renderNutritionTable('d-nutrition-serving', serving);
  renderNutritionTable('d-nutrition-100g', per100g);
}

function renderNutritionTable(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!rows || rows.length === 0) {
    el.innerHTML = '<p style="font-size:12px; color:#9aa0b4; padding:8px 0;">No data</p>';
    return;
  }

  el.innerHTML = rows.map(r => `
    <div class="nutrition-row-detail">
      <span class="nutrient-name">${r.nutrient_name || '—'}</span>
      <span class="nutrient-value">${r.value !== null ? r.value : '—'}</span>
      <span class="nutrient-unit">${r.unit || ''}</span>
    </div>
  `).join('');
}

// ── ARTWORK ───────────────────────────────────────────────────
function renderArtwork(artwork) {
  const el = document.getElementById('d-artwork');
  if (!artwork || artwork.length === 0) {
    el.innerHTML = '<p class="no-data">No files uploaded.</p>';
    return;
  }

  const categoryLabels = {
    label: 'Product Label', carton: 'Carton Markings',
    specs: 'Specifications', photo: 'Product Photo',
    barcode: 'Barcode / QR', cert: 'Certificate', other: 'Other'
  };

  el.innerHTML = `<div class="artwork-grid-detail">` +
    artwork.map(f => {
      const isImage = /\.(jpg|jpeg|png|webp)$/i.test(f.file_name || '');
      return `
        <div class="artwork-item">
          <span class="artwork-item-label">${categoryLabels[f.category] || f.category}</span>
          ${isImage
            ? `<img src="${f.file_url}" class="artwork-thumb" alt="${f.file_name}" />`
            : `<div class="artwork-file-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a6fdb" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                ${f.file_name || 'File'}
              </div>`
          }
          <a href="${f.file_url}" target="_blank" style="font-size:11px; color:#1a6fdb; text-decoration:none; font-weight:600;">View / Download</a>
        </div>
      `;
    }).join('') +
  `</div>`;
}

// ── ACTIONS ───────────────────────────────────────────────────
function editProduct() {
  window.location.href = `product.html?id=${currentProductId}`;
}

let deleteReminderChoice = false;

function deleteProduct() {
  document.getElementById('deleteProductName').textContent = currentProductName;
  document.getElementById('deleteStep1').classList.remove('hidden');
  document.getElementById('deleteStep2').classList.add('hidden');
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  deleteReminderChoice = false;
  document.getElementById('deleteModal').classList.add('hidden');
}

function proceedToStep2() {
  document.getElementById('deleteStep1').classList.add('hidden');
  document.getElementById('deleteStep2').classList.remove('hidden');
}

async function confirmDelete(reminder) {
  deleteReminderChoice = reminder;
  const btn = reminder
    ? document.querySelector('.modal-remind-btn')
    : document.querySelector('.modal-no-remind-btn');
  btn.textContent = 'Moving to Trash...';
  btn.disabled = true;

  const { error } = await dbClient
    .from('products')
    .update({
      deleted_at: new Date().toISOString(),
      reminder: reminder
    })
    .eq('id', currentProductId);

  if (error) {
    showToast('Failed to move to Trash.', 'error');
    btn.textContent = reminder ? 'Yes, remind me' : "No, I'm sure";
    btn.disabled = false;
    return;
  }

  await logActivity('delete', 'product', currentProductId, `Moved product to Trash: ${currentProductName}`);
  window.location.href = 'product-list.html';
}
// ── HELPERS ───────────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value || '—';
}

function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'flex' : 'none';
}

function showError() {
  document.getElementById('errorState').classList.remove('hidden');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed; bottom:28px; right:28px;
    background:${type === 'success' ? '#22c55e' : '#e63946'};
    color:#fff; padding:12px 20px; border-radius:10px;
    font-family:'DM Sans',sans-serif; font-size:14px; font-weight:600;
    box-shadow:0 4px 20px rgba(0,0,0,0.15); z-index:9999;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}