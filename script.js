// =============================================
//  SEAFOOD SPECIES MANAGEMENT APP — script.js
// =============================================

// ── 1. SUPABASE CONFIGURATION ──
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

// ── UPDATE NAV FOR LOGGED IN USER ──
function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour < 17) return `Good Afternoon, ${name}! 👋`;
  if (hour < 21) return `Good Evening, ${name}! 🌆`;
  return `Good Night, ${name}! 🌙`;
}

async function updateNav() {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) return;

  const email = session.user.email;
  const initials = email.substring(0, 2).toUpperCase();

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.first_name || email.split('@')[0];
  const avatarColor = profile?.avatar_color || '#1a6fdb';

  // Set home link based on role
  setHomeLink(profile?.role);

  const profileLink = document.getElementById('nav-profile-link');
  if (profileLink) {
    profileLink.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; background:#fff; border-radius:999px; padding:5px 8px 5px 5px; box-shadow:0 1px 6px rgba(0,0,0,0.07); cursor:pointer; position:relative;" onclick="toggleProfileMenu()">
        <div style="width:30px; height:30px; border-radius:50%; background:${profile?.photo_url ? 'transparent' : avatarColor}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; overflow:hidden; flex-shrink:0;">
          ${profile?.photo_url ? `<img src="${profile.photo_url}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />` : initials}
        </div>
        <span style="font-size:12px; color:#4a4e69; font-weight:500;">${email}</span>
        <div class="nav-profile-menu" id="nav-profile-menu" style="position:absolute; top:calc(100% + 8px); right:0; background:#fff; border:1px solid #e8eaf0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,0.10); min-width:160px; overflow:hidden; display:none;">
          <div style="padding:10px 16px 6px; font-size:12px; font-weight:700; color:#1a1a2e; border-bottom:1px solid #f0f2f8;">${getGreeting(firstName)}</div>
          <a href="profile.html" style="display:flex; align-items:center; gap:8px; padding:9px 16px; font-size:13px; color:#4a4e69; text-decoration:none; font-weight:500;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Profile
          </a>
          <button onclick="handleLogout()" style="width:100%; padding:9px 16px; background:none; border:none; border-top:1px solid #f0f2f8; text-align:left; font-family:'DM Sans',sans-serif; font-size:13px; color:#e63946; cursor:pointer; font-weight:500;">Logout</button>
        </div>
      </div>`;
  }
}

async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

function toggleProfileMenu() {
  const menu = document.getElementById('nav-profile-menu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-profile-wrap')) {
    const menu = document.getElementById('nav-profile-menu');
    if (menu) menu.classList.remove('open');
  }
});

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
    .is('deleted_at', null)
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

  // Reset multi-selects
  resetMultiSelect('source_type');
  resetMultiSelect('gear_type');
  resetMultiSelect('fao_area');
  
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

  setMultiSelect('source_type', species.source_type ? species.source_type.split(',').map(v => v.trim()) : []);
  setMultiSelect('gear_type', species.gear_type ? species.gear_type.split(',').map(v => v.trim()) : []);
  setMultiSelect('fao_area', species.fao_area ? species.fao_area.split(',').map(v => v.trim()) : []);

  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  editingId = null;
  speciesForm.reset();
  
  // Reset save button
  btnSave.disabled = false;
  btnSave.textContent = 'Save Species';
}


// ── 8. COLLECT FORM DATA ──
function collectFormData() {
  const formData = new FormData(speciesForm);
  const data = {};

  for (const [key, value] of formData.entries()) {
    data[key] = value === '' ? null : value;
  }

// Multi-select fields — read from hidden inputs
data['fao_area'] = document.getElementById('fao_area')?.value || null;
data['source_type'] = document.getElementById('source_type')?.value || null;
data['gear_type'] = document.getElementById('gear_type')?.value || null;

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
    if (!error) {
      showToast('Species created!', 'success');
      await logActivity('create', 'species', null, `Created species: ${data.species_name}`);
    }
  } else {
    const result = await dbClient.from('species').update(data).eq('id', editingId);
    error = result.error;
    if (!error) {
      showToast('Species updated!', 'success');
      await logActivity('update', 'species', editingId, `Updated species: ${data.species_name}`);
    }
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
let deleteSpeciesTargetId = null;
let deleteSpeciesTargetName = null;

function deleteSpecies(id, name) {
  deleteSpeciesTargetId = id;
  deleteSpeciesTargetName = name;
  document.getElementById('deleteSpeciesListName').textContent = name;
  document.getElementById('speciesListDeleteStep1').classList.remove('hidden');
  document.getElementById('speciesListDeleteStep2').classList.add('hidden');
  document.getElementById('speciesListDeleteModal').style.display = 'flex';
}

function closeSpeciesListDeleteModal() {
  document.getElementById('speciesListDeleteModal').style.display = 'none';
  deleteSpeciesTargetId = null;
  deleteSpeciesTargetName = null;
}

function proceedToSpeciesListStep2() {
  document.getElementById('speciesListDeleteStep1').classList.add('hidden');
  document.getElementById('speciesListDeleteStep2').classList.remove('hidden');
}

async function confirmSpeciesListDelete(reminder) {
  const btn = reminder
    ? document.querySelector('.species-list-remind-btn')
    : document.querySelector('.species-list-no-remind-btn');
  btn.textContent = 'Moving to Trash...';
  btn.disabled = true;

  const { error } = await dbClient
    .from('species')
    .update({
      deleted_at: new Date().toISOString(),
      reminder: reminder
    })
    .eq('id', deleteSpeciesTargetId);

  if (error) {
    showToast('Delete failed: ' + error.message, 'error');
    btn.textContent = reminder ? 'Yes, remind me' : "No, I'm sure";
    btn.disabled = false;
    return;
  }

  await logActivity('delete', 'species', deleteSpeciesTargetId, `Moved species to Trash: ${deleteSpeciesTargetName}`);
  closeSpeciesListDeleteModal();
  showToast(`"${deleteSpeciesTargetName}" moved to Trash.`, 'success');
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

// ── MULTI-SELECT COMPONENT ──
const multiSelectState = {};

function toggleMultiSelect(field) {
  const dropdown = document.getElementById(`ms-dropdown-${field}`);
  const box = dropdown.previousElementSibling;
  const isOpen = dropdown.classList.contains('open');

  // Close all other dropdowns first
  document.querySelectorAll('.multi-select-dropdown.open').forEach(d => {
    d.classList.remove('open');
    d.previousElementSibling.classList.remove('open');
  });

  if (!isOpen) {
    dropdown.classList.add('open');
    box.classList.add('open');
  }
}

function selectMultiOption(field, value) {
  if (!multiSelectState[field]) multiSelectState[field] = [];

  const index = multiSelectState[field].indexOf(value);
  if (index === -1) {
    multiSelectState[field].push(value);
  } else {
    multiSelectState[field].splice(index, 1);
  }

  updateMultiSelectUI(field);
  updateMultiSelectHidden(field);
}

function updateMultiSelectUI(field) {
  const selected = multiSelectState[field] || [];
  const box = document.querySelector(`#ms-wrap-${field} .multi-select-box`);
  const placeholder = document.getElementById(`ms-placeholder-${field}`);
  const options = document.querySelectorAll(`#ms-options-${field} .multi-select-option`);

  // Update checkboxes
  options.forEach(option => {
    const label = option.querySelector('span').textContent;
    if (selected.includes(label)) {
      option.classList.add('selected');
    } else {
      option.classList.remove('selected');
    }
  });

  // Update tags in box
  // Remove old tags
  box.querySelectorAll('.multi-select-tag').forEach(t => t.remove());

  if (selected.length === 0) {
    placeholder.style.display = '';
  } else {
    placeholder.style.display = 'none';
    selected.forEach(val => {
      const tag = document.createElement('div');
      tag.className = 'multi-select-tag';
      tag.innerHTML = `${val} <button type="button" onclick="event.stopPropagation(); removeMultiOption('${field}', '${val}')">✕</button>`;
      box.insertBefore(tag, box.querySelector('.multi-select-arrow'));
    });
  }
}

function removeMultiOption(field, value) {
  if (!multiSelectState[field]) return;
  multiSelectState[field] = multiSelectState[field].filter(v => v !== value);
  updateMultiSelectUI(field);
  updateMultiSelectHidden(field);
}

function updateMultiSelectHidden(field) {
  const hidden = document.getElementById(field);
  if (hidden) {
    hidden.value = (multiSelectState[field] || []).join(',');
  }
}

function filterMultiSelect(field, query) {
  const options = document.querySelectorAll(`#ms-options-${field} .multi-select-option`);
  const q = query.toLowerCase();
  options.forEach(option => {
    const label = option.querySelector('span').textContent.toLowerCase();
    option.style.display = label.includes(q) ? '' : 'none';
  });
}

function resetMultiSelect(field) {
  multiSelectState[field] = [];
  updateMultiSelectUI(field);
  updateMultiSelectHidden(field);
}

function setMultiSelect(field, values) {
  multiSelectState[field] = values;
  updateMultiSelectUI(field);
  updateMultiSelectHidden(field);
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('.multi-select-wrap')) {
    document.querySelectorAll('.multi-select-dropdown.open').forEach(d => {
      d.classList.remove('open');
      d.previousElementSibling.classList.remove('open');
    });
  }
});

// ── 12. EVENT LISTENERS ──
btnOpenCreate.addEventListener('click', openCreateModal);
btnModalClose.addEventListener('click', closeModal);
btnModalCancel.addEventListener('click', closeModal);
btnSave.addEventListener('click', saveSpecies);

modalOverlay.addEventListener('click', function(e) {
  if (e.target === modalOverlay) {
    // Shake the modal
    const modal = document.querySelector('.modal');
    modal.style.animation = 'none';
    modal.offsetHeight; // trigger reflow
    modal.style.animation = 'shake 0.4s ease';
    showToast('Please complete the form or use the Close button.', 'error');
  }
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
document.addEventListener('DOMContentLoaded', async function() {
  const session = await checkAuth();
  if (session) {
    updateNav();
    await loadSpecies();

    // Check if we need to open edit modal
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (editId) {
      openEditModal(parseInt(editId));
    }
  }
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