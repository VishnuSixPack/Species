/* ============================================================
   PROJECT MANHATTAN — product.js
   Supabase client: dbClient (consistent with Species pages)
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── AUTH ──────────────────────────────────────────────────────
async function checkAuth() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

function toggleProfileMenu() {
  document.getElementById('profileDropdown').classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!e.target.closest('.profile-menu-wrapper')) {
      dropdown.classList.add('hidden');
    }
  }
});

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await checkAuth();
  if (!session) return;

  // Set user info in left panel
  const user = session.user;
  const email = user.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userEmail').textContent = email;

await loadSpecies();
  initDualModeToggles();
  initNutritionCards();
  initMultiselects();

  // Add first allergen row by default
  addAllergenRow();

// Init save button state
  updateSaveButton();

  // Re-validate on any input change
  document.addEventListener('input', updateSaveButton);
  document.addEventListener('change', updateSaveButton);

  // Mandatory field blur validation
  initMandatoryFieldValidation();
});

// ── TABS ──────────────────────────────────────────────────────
// ── TABS ──────────────────────────────────────────────────────
let previousTab = 0;
const visitedTabs = new Set();

function switchTab(index) {
  const pills = document.querySelectorAll('.tab-pill');
  const panels = document.querySelectorAll('.tab-panel');

  // Mark previous tab as visited
  visitedTabs.add(previousTab);

  pills.forEach((btn, i) => {
    btn.classList.remove('active', 'completed', 'invalid');
    if (i === index) {
      btn.classList.add('active');
    } else if (visitedTabs.has(i)) {
      const tabValid = isTabValid(i);
      btn.classList.add(tabValid ? 'completed' : 'invalid');
    }
  });

  panels.forEach((panel, i) => panel.classList.toggle('active', i === index));

  previousTab = index;
  updateSaveButton();
}

// ── SUMMARY PANEL ─────────────────────────────────────────────
function updateSummary(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value || 'Enter value';
  el.style.color = value ? '#1a1a2e' : '#9aa0b4';
}

function focusField(id) {
  switchTab(0);
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }, 100);
}

// ── PHOTO UPLOAD ──────────────────────────────────────────────
function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${e.target.result}" alt="Product photo" />`;
  };
  reader.readAsDataURL(file);
}

// ── DUAL MODE TOGGLE ──────────────────────────────────────────
function initDualModeToggles() {
  document.querySelectorAll('.dual-mode-toggle').forEach(toggle => {
    toggle.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        toggle.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const content = toggle.nextElementSibling; // .dual-mode-content
        const selectEl = content.querySelector('.mode-select');
        const customEl = content.querySelector('.mode-custom');

        if (mode === 'select') {
          selectEl.classList.remove('hidden');
          customEl.classList.add('hidden');
        } else {
          selectEl.classList.add('hidden');
          customEl.classList.remove('hidden');
          customEl.focus();
        }
      });
    });
  });
}

// ── INNER PACKAGING CHECKBOX ──────────────────────────────────
function toggleInnerPackaging(checkbox) {
  const select = document.getElementById('innerPackaging');
  select.disabled = checkbox.checked;
  if (checkbox.checked) select.value = '';
}

// ── LOAD SPECIES FROM SUPABASE ────────────────────────────────
let speciesCache = [];

async function loadSpecies() {
  const { data, error } = await dbClient
    .from('species')
    .select('id, species_name, scientific_name, afsis_3a_code, taxonomic_code, source_type, gear_type, fao_area')
   .order('species_name');

  if (error) { console.error('Error loading species:', error); return; }

  speciesCache = data || [];
  const select = document.getElementById('commercialName');

  speciesCache.forEach(sp => {
    const opt = document.createElement('option');
    opt.value = sp.id;
    opt.textContent = sp.species_name || sp.id;
    select.appendChild(opt);
  });
}

function onSpeciesSelect(speciesId) {
  const sp = speciesCache.find(s => String(s.id) === String(speciesId));

  // Clear auto-populated fields if nothing selected
  if (!sp) {
    resetSpeciesFields();
    return;
  }

  // Auto-populate Raw Material fields
  setReadonlySelect('scientificName', sp.scientific_name);
  setReadonlySelect('afisisCode', sp.afsis_3a_code);
  const taxonEl = document.getElementById('taxonCode');
  taxonEl.value = sp.taxonomic_code || '';
  taxonEl.readOnly = false;
  taxonEl.style.background = '#fff';
  taxonEl.style.color = '#1a1a2e';

// Auto-populate Fishing Methods as selectable options
  setMultiToSingle('typeOfCatch', sp.source_type);
  setMultiToSingle('harvestMethod', sp.gear_type);

  // Auto-populate FAO in Sustainability tab
  autoPopulateFAO(sp.fao_area);

  // Update summary
  updateSummary('sumSpecies', sp.species_name);

  // Hide required errors
  document.getElementById('errCommercialName').classList.add('hidden');
  document.getElementById('errTypeOfCatch').classList.add('hidden');
}

function setReadonlySelect(selectId, value) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = '';
  if (value) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
    sel.value = value;
    sel.disabled = false;
  } else {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Not available';
    sel.appendChild(opt);
    sel.disabled = true;
  }
}

function setMultiToSingle(selectId, commaSeparatedValue) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  sel.innerHTML = '';
  sel.disabled = false;

  if (!commaSeparatedValue) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Not available';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  // Add a blank default
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select one...';
  sel.appendChild(blank);

  // Parse comma-separated values and build options
  const values = commaSeparatedValue.split(',').map(v => v.trim()).filter(v => v);
  values.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    sel.appendChild(opt);
  });

  // Auto-select if only one option
  if (values.length === 1) {
    sel.value = values[0];
  }
}

function autoPopulateFAO(faoArea) {
  if (!faoArea) return;
  const ms = document.getElementById('rawMaterialOriginMulti');
  if (!ms) return;

  // Parse comma-separated FAO values from species
  const values = faoArea.split(',').map(v => v.trim()).filter(v => v);

  ms.querySelectorAll('.multi-option input[type="checkbox"]').forEach(cb => {
    const match = values.some(v =>
      cb.value.toLowerCase().includes(v.toLowerCase()) ||
      v.toLowerCase().includes(cb.value.toLowerCase())
    );
    if (match) cb.checked = true;
  });

  updateMultiselectTags(ms);
}

function resetSpeciesFields() {
  ['scientificName', 'afisisCode', 'typeOfCatch', 'harvestMethod'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.innerHTML = '<option value="">Select an option</option>'; }
  });
  document.getElementById('taxonCode').value = '';
  updateSummary('sumSpecies', '');
}

// ── ALLERGEN ROWS ─────────────────────────────────────────────
let allergenCount = 0;

function addAllergenRow() {
  allergenCount++;
  const id = allergenCount;
  const container = document.getElementById('allergenRows');

  const row = document.createElement('div');
  row.className = 'allergen-row';
  row.id = `allergenRow_${id}`;

  row.innerHTML = `
    <button class="btn-remove-row" onclick="removeAllergenRow(${id})" title="Remove allergen">&times;</button>
    <div class="allergen-row-grid">
      <div class="form-field">
        <label>• Allergen Label</label>
        <span class="field-hint">How the allergen appears on the product label</span>
        <input type="text" id="allergenLabel_${id}" placeholder="e.g. Fish" oninput="updateAllergenSummary()" />
      </div>
      <div class="form-field">
        <label>• Allergen Type Code</label>
        <span class="field-hint">Enter the official allergen type code</span>
        <input type="text" id="allergenCode_${id}" placeholder="e.g. EN:FISH" />
      </div>
      <div class="form-field">
        <label>• Containment Level</label>
        <span class="field-hint">Indicate the allergen's presence level</span>
        <select id="containment_${id}" class="containment-select" onchange="applyContainmentStyle(this)">
          <option value="">Select an option</option>
          <option value="contain">Contain</option>
          <option value="free_from">Free from</option>
          <option value="may_contain">May contain</option>
        </select>
      </div>
    </div>
    <div class="allergen-row-grid-2">
      <div class="form-field">
        <label>• Allergen Specification Agency</label>
        <span class="field-hint">Enter the name of the regulatory or standard agency</span>
        <input type="text" id="allergenAgency_${id}" placeholder="e.g. EU Regulation 1169/2011" />
      </div>
      <div class="form-field">
        <label>• Agency Description</label>
        <span class="field-hint">Provide a short description or reference of the allergen standard</span>
        <textarea id="allergenAgencyDesc_${id}" placeholder="Enter value" rows="2"></textarea>
      </div>
    </div>
  `;

  container.appendChild(row);
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeAllergenRow(id) {
  const row = document.getElementById(`allergenRow_${id}`);
  if (row) row.remove();
  updateAllergenSummary();
}

function updateAllergenSummary() {
  const labels = [];
  document.querySelectorAll('[id^="allergenLabel_"]').forEach(el => {
    if (el.value.trim()) labels.push(el.value.trim());
  });
  updateSummary('sumAllergen', labels.length ? labels.join(', ') : '');
}

function applyContainmentStyle(select) {
  select.className = 'containment-select';
  if (select.value) select.classList.add(`containment-${select.value}`);
}

// ── NUTRITION ROWS ────────────────────────────────────────────
const DEFAULT_NUTRIENTS = [
  'Energy', 'Protein', 'Fat', 'Fat (fatty acid)',
  'Fatty acids (Monounsaturated)', 'Fatty acids (Saturated)',
  'Carbohydrates', 'Sugars', 'Sodium',
  'Fatty acids (Polyunsaturated)', 'Fatty acids (n-3 Polyunsaturated)'
];

function initNutritionCards() {
  DEFAULT_NUTRIENTS.forEach(name => {
    addNutritionRowWithName('serving', name);
    addNutritionRowWithName('100g', name);
  });
}

function addNutritionRowWithName(basis, name) {
  const containerId = basis === 'serving' ? 'nutritionServing' : 'nutrition100g';
  const container = document.getElementById(containerId);
  const rowId = `nut_${basis}_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;

  const row = document.createElement('div');
  row.className = 'nutrition-row';
  row.id = rowId;

  row.innerHTML = `
    <input type="text" class="nutrient-name" value="${name}" placeholder="Nutrient name" />
    <input type="number" placeholder="--" step="any" min="0" />
    <input type="text" placeholder="Unit" />
    <button class="btn-delete-nutrient" onclick="removeNutritionRow('${rowId}')" title="Remove nutrient">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
      </svg>
    </button>
  `;

  container.appendChild(row);
}

function addNutritionRow(basis) {
  addNutritionRowWithName(basis, '');
  const containerId = basis === 'serving' ? 'nutritionServing' : 'nutrition100g';
  const container = document.getElementById(containerId);
  const lastRow = container.lastElementChild;
  if (lastRow) {
    lastRow.querySelector('.nutrient-name').focus();
  }
}

function removeNutritionRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
}

// ── MULTISELECT ───────────────────────────────────────────────
function initMultiselects() {
  document.querySelectorAll('.custom-multiselect').forEach(ms => {
    ms.querySelectorAll('.multi-option input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => updateMultiselectTags(ms));
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.custom-multiselect').forEach(ms => {
      if (!ms.contains(e.target)) {
        ms.querySelector('.multiselect-dropdown').classList.add('hidden');
      }
    });
  });
}

function toggleMultiselect(containerId) {
  const ms = document.getElementById(containerId);
  const dropdown = ms.querySelector('.multiselect-dropdown');
  dropdown.classList.toggle('hidden');
}

function updateMultiselectTags(ms) {
  const tagsId = ms.id.replace('Multi', 'Tags');
  const tagsContainer = document.getElementById(tagsId);
  if (!tagsContainer) return;

  tagsContainer.innerHTML = '';
  const checked = ms.querySelectorAll('.multi-option input:checked');

  if (checked.length === 0) {
    ms.querySelector('.multiselect-placeholder').textContent = 'Select an option';
  } else {
    ms.querySelector('.multiselect-placeholder').textContent = `${checked.length} selected`;
    checked.forEach(cb => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `${cb.value} <button onclick="removeCertTag('${cb.value}', '${ms.id}')">&times;</button>`;
      tagsContainer.appendChild(chip);
    });
  }
}

function removeCertTag(value, containerId) {
  const ms = document.getElementById(containerId);
  const cb = ms.querySelector(`input[value="${value}"]`);
  if (cb) { cb.checked = false; updateMultiselectTags(ms); }
}

// ── FILE HANDLING ─────────────────────────────────────────────
function handleFileInput(event, listId) {
  const files = Array.from(event.target.files);
  renderFileList(files, listId);
}

function handleDropzoneDrop(event, inputId, listId) {
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files);
  renderFileList(files, listId);
}

function renderFileList(files, listId) {
  const container = document.getElementById(listId);
  if (!container) return;

  files.forEach(file => {
    const isImage = file.type.startsWith('image/');
    const chip = document.createElement('div');
    chip.className = 'file-chip';

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        chip.innerHTML = `
          <img src="${e.target.result}" class="file-thumb" alt="${file.name}" />
          <span>${file.name}</span>
          <button onclick="this.closest('.file-chip').remove()">&times;</button>
        `;
      };
      reader.readAsDataURL(file);
    } else {
      chip.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>${file.name}</span>
        <button onclick="this.closest('.file-chip').remove()">&times;</button>
      `;
    }
    container.appendChild(chip);
  });
}

// ── COLLECT FORM DATA ─────────────────────────────────────────
function getPackagingValue(fieldBase) {
  const toggle = document.querySelector(`.dual-mode-toggle[data-field="${fieldBase}"]`);
  const activeMode = toggle.querySelector('.mode-btn.active').dataset.mode;
  if (activeMode === 'select') {
    return document.getElementById(fieldBase)?.value || '';
  } else {
    return document.getElementById(`${fieldBase}Custom`)?.value || '';
  }
}

function collectFormData() {
  // Allergens
  const allergens = [];
  document.querySelectorAll('[id^="allergenRow_"]').forEach(row => {
    const idNum = row.id.split('_')[1];
    allergens.push({
      allergen_label: document.getElementById(`allergenLabel_${idNum}`)?.value || '',
      allergen_type_code: document.getElementById(`allergenCode_${idNum}`)?.value || '',
      containment_level: document.getElementById(`containment_${idNum}`)?.value || '',
      specification_agency: document.getElementById(`allergenAgency_${idNum}`)?.value || '',
      agency_description: document.getElementById(`allergenAgencyDesc_${idNum}`)?.value || '',
    });
  });

  // Nutrition
  function getNutritionRows(containerId, basis) {
    const rows = [];
    document.getElementById(containerId).querySelectorAll('.nutrition-row').forEach(row => {
      const inputs = row.querySelectorAll('input');
      const name = inputs[0]?.value?.trim();
      const value = inputs[1]?.value;
      const unit = inputs[2]?.value?.trim();
      if (name) rows.push({ basis, nutrient_name: name, value: value !== '' ? parseFloat(value) : null, unit });
    });
    return rows;
  }

  const nutrition = [
    ...getNutritionRows('nutritionServing', 'serving'),
    ...getNutritionRows('nutrition100g', '100g'),
  ];

  // Certifications
  const certifications = Array.from(
    document.querySelectorAll('#certificationMulti .multi-option input:checked')
  ).map(cb => cb.value);

  return {
    product: {
      product_name: document.getElementById('productName')?.value || '',
      brand: document.getElementById('brand')?.value || '',
      functional_product_name: document.getElementById('functionalName')?.value || '',
      gs1_product_name: document.getElementById('gs1Name')?.value || '',
      short_description: document.getElementById('shortDesc')?.value || '',
      ean_gtin: document.getElementById('eanGtin')?.value || '',
      description: document.getElementById('description')?.value || '',
      brand_item_id: document.getElementById('brandItemId')?.value || '',
      product_code: document.getElementById('productCode')?.value || '',
      depth_mm: parseFloat(document.getElementById('depth')?.value) || null,
      height_mm: parseFloat(document.getElementById('height')?.value) || null,
      width_mm: parseFloat(document.getElementById('width')?.value) || null,
      gross_weight_g: parseFloat(document.getElementById('grossWeight')?.value) || null,
      net_weight_g: parseFloat(document.getElementById('netWeight')?.value) || null,
      drained_weight_g: parseFloat(document.getElementById('drainedWeight')?.value) || null,
      product_form: getPackagingValue('productForm'),
      pack_style: getPackagingValue('packStyle'),
      pack_medium: getPackagingValue('packMedium'),
      primary_packaging: document.getElementById('primaryPackaging')?.value || '',
      inner_packaging: document.getElementById('innerPackaging')?.value || '',
      no_inner_packaging: document.getElementById('noInnerPackaging')?.checked || false,
      min_temp_c: parseFloat(document.getElementById('minTemp')?.value) || null,
      max_temp_c: parseFloat(document.getElementById('maxTemp')?.value) || null,
      shelf_life_value: parseFloat(document.getElementById('shelfLifeValue')?.value) || null,
      shelf_life_unit: document.getElementById('shelfLifeUnit')?.value || 'days',
      ingredients: document.getElementById('ingredients')?.value || '',
      species_id: document.getElementById('commercialName')?.value || null,
      harvest_method_custom: document.getElementById('harvestMethodCustom')?.value || '',
      raw_material_origin: Array.from(
        document.querySelectorAll('#rawMaterialOriginMulti .multi-option input:checked')
      ).map(cb => cb.value).join(','),
      certifications,
    },
    allergens,
    nutrition,
  };
}

// ── VALIDATE ──────────────────────────────────────────────────
// ── VALIDATION ────────────────────────────────────────────────
function isTabValid(tabIndex) {
  switch(tabIndex) {
    case 0: // Product Information
      return (
        !!document.getElementById('productName')?.value.trim() &&
        !!document.getElementById('brand')?.value.trim() &&
        !!getPackagingValue('productForm') &&
        !!getPackagingValue('packStyle') &&
        !!getPackagingValue('packMedium') &&
        !!document.getElementById('primaryPackaging')?.value
      );
    case 1: // Raw Material
      return (
        !!document.getElementById('commercialName')?.value &&
        !!document.getElementById('typeOfCatch')?.value &&
        !!document.getElementById('harvestMethod')?.value
      );
    case 2: // Allergen
      let allergenValid = false;
      document.querySelectorAll('[id^="allergenRow_"]').forEach(row => {
        const idNum = row.id.split('_')[1];
        const label = document.getElementById(`allergenLabel_${idNum}`)?.value.trim();
        const level = document.getElementById(`containment_${idNum}`)?.value;
        if (label && level) allergenValid = true;
      });
      return allergenValid;
    case 3: // Nutrition
      let nutritionValid = false;
      document.querySelectorAll('.nutrition-row').forEach(row => {
        const val = row.querySelectorAll('input')[1]?.value;
        if (val !== '' && val !== undefined) nutritionValid = true;
      });
      return nutritionValid;
    case 4: // Sustainability
      return !!document.getElementById('rawMaterialOrigin')?.value;
    case 5: // Art Work — all optional
      return true;
    default:
      return true;
  }
}

function isFormComplete() {
  for (let i = 0; i <= 5; i++) {
    if (!isTabValid(i)) return false;
  }
  return true;
}

// ── MANDATORY FIELD BLUR VALIDATION ──────────────────────────
const mandatoryFields = [
  { id: 'productName', type: 'input' },
  { id: 'brand', type: 'input' },
  { id: 'primaryPackaging', type: 'select' },
  { id: 'commercialName', type: 'select' },
  { id: 'rawMaterialOrigin', type: 'select' },
];

function initMandatoryFieldValidation() {
  mandatoryFields.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => validateMandatoryField(el));
    el.addEventListener('input', () => validateMandatoryField(el));
    el.addEventListener('change', () => validateMandatoryField(el));
  });

  ['productForm', 'packStyle', 'packMedium'].forEach(fieldBase => {
    const sel = document.getElementById(fieldBase);
    const custom = document.getElementById(`${fieldBase}Custom`);
    if (sel) {
      sel.addEventListener('blur', () => validateDualMode(fieldBase));
      sel.addEventListener('change', () => validateDualMode(fieldBase));
    }
    if (custom) {
      custom.addEventListener('blur', () => validateDualMode(fieldBase));
      custom.addEventListener('input', () => validateDualMode(fieldBase));
    }
  });
}

function validateMandatoryField(el) {
  const empty = !el.value.trim();
  el.classList.toggle('field-invalid', empty);
}

function validateDualMode(fieldBase) {
  const value = getPackagingValue(fieldBase);
  const toggle = document.querySelector(`.dual-mode-toggle[data-field="${fieldBase}"]`);
  const content = toggle.nextElementSibling;
  const activeEl = content.querySelector('.mode-select:not(.hidden), .mode-custom:not(.hidden)');
  if (activeEl) activeEl.classList.toggle('field-invalid', !value.trim());
}

function updateSaveButton() {
  const btn = document.getElementById('btnSave');
  const complete = isFormComplete();
  btn.disabled = !complete;
  btn.style.opacity = complete ? '1' : '0.5';
  btn.style.cursor = complete ? 'pointer' : 'not-allowed';
  btn.removeAttribute('title');
  btn.setAttribute('data-tooltip', complete ? '' : 'Please fill the necessary information to save');
}

function validateForm(data) {
  const errors = [];
  if (!data.product.product_name) errors.push('Product Name is required.');
  if (!data.product.species_id) {
    errors.push('Commercial Name (Species) is required.');
    document.getElementById('errCommercialName').classList.remove('hidden');
  }
  return errors;
}

// ── SAVE ──────────────────────────────────────────────────────
async function saveProduct() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  const formData = collectFormData();
  const errors = validateForm(formData);

  if (errors.length > 0) {
    showToast(errors[0], 'error');
    return;
  }

  const btnSave = document.getElementById('btnSave');
  btnSave.textContent = 'Saving...';
  btnSave.disabled = true;

  try {
    // Insert product
    const { data: product, error: productError } = await dbClient
      .from('products')
      .insert({ ...formData.product, user_id: session.user.id })
      .select()
      .single();

    if (productError) throw productError;

    const productId = product.id;

    // Insert allergens
    if (formData.allergens.length > 0) {
      const allergenRows = formData.allergens
        .filter(a => a.allergen_label)
        .map(a => ({ ...a, product_id: productId }));
      if (allergenRows.length > 0) {
        const { error: allergenError } = await dbClient.from('product_allergens').insert(allergenRows);
        if (allergenError) console.error('Allergen insert error:', allergenError);
      }
    }

    // Insert nutrition
    if (formData.nutrition.length > 0) {
      const nutritionRows = formData.nutrition
        .filter(n => n.nutrient_name && n.value !== null)
        .map(n => ({ ...n, product_id: productId }));
      if (nutritionRows.length > 0) {
        const { error: nutritionError } = await dbClient.from('product_nutrition').insert(nutritionRows);
        if (nutritionError) console.error('Nutrition insert error:', nutritionError);
      }
    }

    showToast('Product saved successfully!', 'success');
    setTimeout(() => { window.location.href = 'product-list.html'; }, 1200);

  } catch (err) {
    console.error('Save error:', err);
    showToast(err.message || 'Failed to save product.', 'error');
  } finally {
    btnSave.textContent = 'Save';
    btnSave.disabled = false;
  }
}

function cancelProduct() {
  document.getElementById('cancelModal').classList.remove('hidden');
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed; bottom: 28px; right: 28px;
    background: ${type === 'success' ? '#22c55e' : '#e63946'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    z-index: 9999; animation: slideUp 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function closeBulkModal(event) {
  if (event.target === document.getElementById('bulkUploadModal')) {
    document.getElementById('bulkUploadModal').classList.add('hidden');
  }
}
