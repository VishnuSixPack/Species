/* ============================================================
   SMARTUNA CONCEPT — product-list.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let allProducts = [];
let deleteTargetId = null;

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

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await checkAuth();
  if (!session) return;

const email = session.user.email || '';

  // Load profile for first name and avatar color
  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.first_name || email.split('@')[0];
  const initials = email.substring(0, 2).toUpperCase();
  const avatarColor = profile?.avatar_color || '#1a6fdb';

  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, initials, avatarColor);
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(firstName);

  // Set home link based on role
  setHomeLink(profile?.role);

  // Get org role for UI permissions
  allOrgRole = await getUserOrgRole();
  const orgRole = allOrgRole;

  // Hide Add Product button for members
  if (!canEdit(orgRole)) {
    document.querySelector('.btn-add-product')?.style.setProperty('display', 'none');
  }

  await loadProducts(orgRole);
});

// ── LOAD PRODUCTS ─────────────────────────────────────────────
async function loadProducts(orgRole) {
  showLoading(true);

// Get user's company_id first
  const { data: profileData } = await dbClient
    .from('profiles')
    .select('company_id, role')
    .eq('id', (await dbClient.auth.getSession()).data.session.user.id)
    .single();

  // Admin/Operator see all products, others see only their company's
  const isAdminOrOperator = ['admin', 'operator'].includes(profileData?.role);

  let query = dbClient
    .from('products')
    .select(`
      id, product_name, brand, product_form, pack_style, ean_gtin, photo_url,
      species:species_id (species_name),
      product_allergens (allergen_label, containment_level)
    `)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  // Filter by company unless admin/operator
  if (!isAdminOrOperator && profileData?.company_id) {
    query = query.eq('company_id', profileData.company_id);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error loading products:', error);
    showLoading(false);
    return;
  }

  // IMPORTANT: allProducts must be assigned BEFORE showLoading(false).
  // showLoading(false) calls setView(_currentView), and if the saved view
  // is 'list', setView renders the list table immediately using whatever
  // is in allProducts *right then*. Assigning it after left the list view
  // rendering against the stale empty array from page load, permanently —
  // nothing ever re-rendered it once real data arrived, since renderProducts()
  // only touches the grid DOM, not the list table.
  allProducts = data || [];
  showLoading(false);
  renderProducts(allProducts, orgRole);
}

// ── RENDER ────────────────────────────────────────────────────
function renderProducts(products, orgRole) {
  const grid = document.getElementById('productGrid');
  const empty = document.getElementById('emptyState');

  grid.innerHTML = '';

  document.getElementById('productCount').textContent =
    `${products.length} product${products.length !== 1 ? 's' : ''}`;

  if (products.length === 0) {
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  products.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.style.animationDelay = `${i * 0.05}s`;

    const speciesName = p.species?.species_name || '—';
    const allergens = p.product_allergens || [];

    const allergenChips = allergens.slice(0, 3).map(a =>
      `<span class="allergen-chip">${a.allergen_label || ''}</span>`
    ).join('');

    const moreAllergens = allergens.length > 3
      ? `<span class="allergen-chip">+${allergens.length - 3}</span>` : '';

    card.innerHTML = `
      <div class="product-card-photo" onclick="viewProduct('${p.id}')">
        ${p.photo_url
          ? `<img src="${p.photo_url}" alt="${p.product_name}" />`
          : `<div class="no-photo">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span>No photo</span>
            </div>`
        }
        ${p.product_form ? `<span class="product-card-badge">${p.product_form}</span>` : ''}
      </div>
      <div class="product-card-body" onclick="viewProduct('${p.id}')">
        <div>
          <div class="product-card-title">${p.product_name || 'Untitled Product'}</div>
          <div class="product-card-brand">${p.brand || '—'}</div>
        </div>
        <div class="product-card-meta">
          ${speciesName !== '—' ? `
          <div class="meta-chip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            ${speciesName}
          </div>` : ''}
          ${p.pack_style ? `
          <div class="meta-chip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            ${p.pack_style}
          </div>` : ''}
          ${p.ean_gtin ? `
          <div class="meta-chip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="3" height="16"/><rect x="6" y="4" width="2" height="16"/><rect x="10" y="4" width="3" height="16"/><rect x="15" y="4" width="2" height="16"/><rect x="19" y="4" width="2" height="16"/></svg>
            ${p.ean_gtin}
          </div>` : ''}
        </div>
        ${allergens.length > 0 ? `
        <div class="allergen-chips">
          ${allergenChips}${moreAllergens}
        </div>` : ''}
      </div>
      <div class="product-card-footer">
        <button class="btn-card-view" onclick="event.stopPropagation(); viewProduct('${p.id}')">View Details</button>
        ${canEdit(orgRole) ? `<button class="btn-card-edit" onclick="event.stopPropagation(); editProduct('${p.id}')">Edit</button>` : ''}

      </div>
    `;

    grid.appendChild(card);
  });
}

// ── SEARCH ────────────────────────────────────────────────────
function filterProducts(query) {
  const q = query.toLowerCase().trim();
  const filtered = !q ? allProducts : allProducts.filter(p =>
    (p.product_name || '').toLowerCase().includes(q) ||
    (p.brand || '').toLowerCase().includes(q) ||
    (p.species?.species_name || '').toLowerCase().includes(q) ||
    (p.pack_style || '').toLowerCase().includes(q) ||
    (p.ean_gtin || '').toLowerCase().includes(q) ||
    (p.product_form || '').toLowerCase().includes(q)
  );
  if (_currentView === 'list') renderListTable(filtered, allOrgRole);
  else renderProducts(filtered, allOrgRole);
}

// ── ACTIONS ───────────────────────────────────────────────────
function viewProduct(id) {
  window.location.href = `product-detail.html?id=${id}`;
}

function editProduct(id) {
  window.location.href = `product.html?id=${id}`;
}

function openAiModal() {
  document.getElementById('aiModal').classList.remove('hidden');
}

let deleteReminderChoice = false;

function openDeleteModal(id, name) {
  deleteTargetId = id;
  document.getElementById('deleteProductName').textContent = name;
  // Show step 1
  document.getElementById('deleteStep1').classList.remove('hidden');
  document.getElementById('deleteStep2').classList.add('hidden');
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  deleteTargetId = null;
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

  // Soft delete — set deleted_at instead of hard delete
  const { error } = await dbClient
    .from('products')
    .update({
      deleted_at: new Date().toISOString(),
      reminder: reminder
    })
    .eq('id', deleteTargetId);

  btn.textContent = reminder ? 'Yes, remind me' : "No, I'm sure";
  btn.disabled = false;
  closeDeleteModal();

  if (error) {
    showToast('Failed to move to Trash.', 'error');
  } else {
    await logActivity('delete', 'product', deleteTargetId, `Moved product to Trash`);
    showToast('Product moved to Trash. It will be deleted after 30 days.', 'success');
    await loadProducts(allOrgRole);
  }
}

// ── VIEW TOGGLE ───────────────────────────────────────────────
let _currentView = localStorage.getItem('pm_product_view') || 'grid';

function setView(v) {
  _currentView = v;
  localStorage.setItem('pm_product_view', v);
  const grid = document.getElementById('productGrid');
  const tableWrap = document.getElementById('listTableWrap');
  if (v === 'list') {
    grid.style.display = 'none';
    if (tableWrap) { tableWrap.style.display = 'block'; renderListTable(allProducts, allOrgRole); }
  } else {
    grid.style.display = 'grid';
    if (tableWrap) tableWrap.style.display = 'none';
  }
  document.getElementById('gridViewBtn').classList.toggle('active', v === 'grid');
  document.getElementById('listViewBtn').classList.toggle('active', v === 'list');
}

function renderListTable(products, orgRole) {
  const tbody = document.getElementById('listTableBody');
  if (!tbody) return;
  tbody.innerHTML = products.length === 0
    ? `<tr><td colspan="6" style="text-align:center;padding:32px;color:#9aa0b4;">No products found.</td></tr>`
    : products.map(p => `
      <tr onclick="viewProduct('${p.id}')">
        <td title="${p.product_name||''}">${p.product_name || '—'}</td>
        <td class="${p.species?.species_name?'':'muted'}">${p.species?.species_name || '—'}</td>
        <td class="${p.ean_gtin?'':'muted'}" style="font-family:monospace;font-size:12px;">${p.ean_gtin || '—'}</td>
        <td class="${p.brand?'':'muted'}">${p.brand || '—'}</td>
        <td class="${p.product_form?'':'muted'}">${p.product_form || '—'}</td>
        <td onclick="event.stopPropagation()" style="overflow:visible;text-overflow:clip;text-align:center;">
          <button class="btn-list-view" onclick="viewProduct('${p.id}')" title="View details" aria-label="View details" style="display:inline-flex;align-items:center;justify-content:center;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </td>
      </tr>`).join('');
}

// ── LOADING ───────────────────────────────────────────────────
function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'flex' : 'none';
  const grid = document.getElementById('productGrid');
  if (show) {
    grid.style.display = 'none';
    const tw = document.getElementById('listTableWrap');
    if (tw) tw.style.display = 'none';
  } else {
    setView(_currentView);
  }
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
    font-family: 'Poppins', 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); z-index: 9999;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}