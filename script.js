// =============================================
//  SEAFOOD SPECIES MANAGEMENT APP — script.js
// =============================================

// ── 1. SUPABASE CONFIGURATION ──
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';

const dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ── 2. STATE ──
let allSpecies = [];
let editingId  = null;


// ── 3. GRAB HTML ELEMENTS ──
const tableBody      = document.getElementById('species-table-body');
const modalOverlay   = document.getElementById('modal-overlay');
const modalTitle     = document.getElementById('modal-title');
const speciesForm    = document.getElementById('species-form');
const btnOpenCreate  = document.getElementById('btn-create-species');
const btnModalClose  = document.getElementById('btn-modal-close');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnSave        = document.getElementById('btn-save-species');
const toastContainer = document.getElementById('toast-container');


// ── 4. TOAST NOTIFICATION ──
function showToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(24px)';
    toast.style.transition = '0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ── 5. RENDER TABLE ──
function renderTable(data) {
  tableBody.innerHTML = '';

  if (data.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="4">
          <div class="empty-state">
            <div class="empty-icon">🐟</div>
            <p>No species found</p>
            <small>Click "Create Species" to add your first record.</small>
          </div>
        </td>
      </tr>`;
    return;
  }

  data.forEach(species => {
    const date = species.created_at
      ? new Date(species.created_at).toLocaleDateString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric'
        })
      : '—';

    const row = document.createElement('tr');
    row.innerHTML = `
 <td class="species-name-cell">
  <div style="display:flex; align-items:center; gap:10px;">
    <div style="width:36px; height:36px; border-radius:6px; background:#f5f5f5; border:1px solid #e8e8e8; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
      <img src="fish-icon.png" style="width:22px; height:22px; opacity:0.5;"/>
    </div>
    <a href="species-detail.html?id=${species.id}" style="color:#0f0f0f; text-decoration:none; font-weight:600;">${escapeHtml(species.species_name || '—')}</a>
  </div>
</td>
      <td class="scientific-name-cell">${escapeHtml(species.scientific_name || '—')}</td>
      <td class="date-cell">${date}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-edit" onclick="openEditModal(${species.id})">✏️ Edit</button>
          <button class="btn btn-danger" onclick="deleteSpecies(${species.id}, '${escapeHtml(species.species_name || '')}')">🗑 Delete</button>
        </div>
      </td>`;
    tableBody.appendChild(row);
  });
}


// ── 6. LOAD SPECIES FROM SUPABASE ──
async function loadSpecies() {
  tableBody.innerHTML = Array(3).fill(`
    <tr>
      <td><div class="skeleton w-80"></div></td>
      <td><div class="skeleton w-60"></div></td>
      <td><div class="skeleton w-40"></div></td>
      <td><div class="skeleton w-60"></div></td>
    </tr>`).join('');

  const { data, error } = await dbClient
    .from('species')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    showToast('Failed to load: ' + error.message, 'error');
    tableBody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><p>Could not load data.</p><small>${error.message}</small></div></td></tr>`;
    return;
  }

  allSpecies = data;
  renderTable(allSpecies);
}


// ── 7. OPEN / CLOSE MODAL ──
function openCreateModal() {
  editingId = null;
  modalTitle.textContent = 'Create New Species';
  speciesForm.reset();
  
  // Clear photo preview
  document.getElementById('photo-preview-group').style.display = 'none';
  document.getElementById('photo-preview').src = '';
  document.getElementById('file-name-display').textContent = 'No file chosen';
  
  modalOverlay.classList.add('open');
}

function openEditModal(id) {
  const species = allSpecies.find(s => s.id === id);
  if (!species) return;

  editingId = id;
  modalTitle.textContent = 'Edit Species';
  speciesForm.reset();

  Object.keys(species).forEach(key => {
    const field = speciesForm.querySelector(`[name="${key}"]`);
    if (!field) return;
    if (field.tagName === 'SELECT' && field.multiple) {
      const values = (species[key] || '').split(',').map(v => v.trim());
      Array.from(field.options).forEach(opt => {
        opt.selected = values.includes(opt.value);
      });
    } else {
      field.value = species[key] ?? '';
    }
  });

 // Show existing photo preview if editing
  const previewGroup = document.getElementById('photo-preview-group');
  const previewImg = document.getElementById('photo-preview');
  if (species.photo_url) {
    previewImg.src = species.photo_url;
    previewGroup.style.display = 'block';
  } else {
    previewGroup.style.display = 'none';
  }


  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  editingId = null;
  speciesForm.reset();
}


// ── 8. COLLECT FORM DATA ──
function collectFormData() {
  const formData = new FormData(speciesForm);
  const data = {};

  for (const [key, value] of formData.entries()) {
    data[key] = value === '' ? null : value;
  }

  // FAO Area multi-select
  const faoSelect = speciesForm.querySelector('[name="fao_area"]');
  if (faoSelect) {
    const selected = Array.from(faoSelect.selectedOptions).map(o => o.value);
    data['fao_area'] = selected.length > 0 ? selected.join(',') : null;
  }

  // Convert numeric fields
  const numericFields = [
    'taxonomic_code', 'alphia_id', 'isscaap_code', 'caab_code',
    'maturity_cm', 'max_length_cm', 'common_length_cm',
    'max_published_weight', 'max_reported_age', 'generation_length'
  ];
  numericFields.forEach(field => {
    if (data[field] !== null && data[field] !== undefined) {
      data[field] = Number(data[field]) || null;
    }
  });

  return data;
}


// ── 9. SAVE SPECIES ──
async function saveSpecies() {
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';

  const data = collectFormData();

  if (!data.species_name || data.species_name.trim() === '') {
    showToast('Species Name is required.', 'error');
    btnSave.disabled = false;
    btnSave.textContent = 'Save Species';
    return;
  }

  // ── Handle photo upload ──
  const photoFile = document.getElementById('species_photo').files[0];
  if (photoFile) {
    const fileExt = photoFile.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { error: uploadError } = await dbClient.storage
      .from('species-photos')
      .upload(fileName, photoFile);

    if (uploadError) {
      showToast('Photo upload failed: ' + uploadError.message, 'error');
      btnSave.disabled = false;
      btnSave.textContent = 'Save Species';
      return;
    }

    const { data: urlData } = dbClient.storage
      .from('species-photos')
      .getPublicUrl(fileName);

    data['photo_url'] = urlData.publicUrl;
  }
// If photo was removed, clear the URL
  const previewGroup = document.getElementById('photo-preview-group');
  if (previewGroup.dataset.removed === 'true') {
    data['photo_url'] = null;
    previewGroup.dataset.removed = 'false';
  }


  // Remove photo file from data object — not a DB column
  delete data['species_photo'];

  let error;

  if (editingId === null) {
    const result = await dbClient.from('species').insert([data]);
    error = result.error;
    if (!error) showToast('Species created!', 'success');
  } else {
    const result = await dbClient.from('species').update(data).eq('id', editingId);
    error = result.error;
    if (!error) showToast('Species updated!', 'success');
  }

  btnSave.disabled = false;
  btnSave.textContent = 'Save Species';

  if (error) {
    showToast('Error: ' + error.message, 'error');
    return;
  }

  closeModal();
  await loadSpecies();
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
// ── 10. DELETE SPECIES ──
async function deleteSpecies(id, name) {
  const confirmed = await showConfirm(`Delete "${name}"?`, 'This cannot be undone.');
  if (!confirmed) return;

  const { error } = await dbClient.from('species').delete().eq('id', id);

  if (error) {
    showToast('Delete failed: ' + error.message, 'error');
    return;
  }

  showToast(`"${name}" deleted.`);
  await loadSpecies();
}


// ── 11. UTILITY: ESCAPE HTML ──
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── 11B. SEARCH / FILTER ──
function filterSpecies(query) {
  if (!query.trim()) {
    renderTable(allSpecies);
    return;
  }

  const q = query.toLowerCase();
  const filtered = allSpecies.filter(s =>
    (s.species_name    || '').toLowerCase().includes(q) ||
    (s.scientific_name || '').toLowerCase().includes(q) ||
    (s.common_trade_family_name || '').toLowerCase().includes(q)
  );

  renderTable(filtered);
}

// ── 12. EVENT LISTENERS ──
btnOpenCreate.addEventListener('click', openCreateModal);
btnModalClose.addEventListener('click', closeModal);
btnModalCancel.addEventListener('click', closeModal);
btnSave.addEventListener('click', saveSpecies);

modalOverlay.addEventListener('click', function(e) {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// Search
const searchEl = document.getElementById('search-input');
if (searchEl) {
  searchEl.addEventListener('input', function() {
    filterSpecies(this.value);
  });
}

// ── 13. START ──
document.addEventListener('DOMContentLoaded', function() {
  loadSpecies();
});

// ── FILE NAME DISPLAY ──
function updateFileName(input) {
  const display = document.getElementById('file-name-display');
  display.textContent = input.files[0] ? input.files[0].name : 'No file chosen';
  
  // Show preview of selected photo
  if (input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('photo-preview').src = e.target.result;
      document.getElementById('photo-preview-group').style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// ── REMOVE PHOTO ──
function removePhoto() {
  document.getElementById('photo-preview').src = '';
  document.getElementById('photo-preview-group').style.display = 'none';
  document.getElementById('file-name-display').textContent = 'No file chosen';
  document.getElementById('species_photo').value = '';
  // Flag to remove photo from database on save
  document.getElementById('photo-preview-group').dataset.removed = 'true';
}