/* ============================================================
   PROJECT MANHATTAN — admin.js
   Admin console — accessible only to vishnu@pacifical.com
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_EMAIL = 'vishnu@pacifical.com';

let allUsers = [];
let allLogs = [];
let suspendTargetId = null;
let suspendAction = null;
let roleTargetId = null;

// ── AUTH GUARD ────────────────────────────────────────────────
async function checkAdminAuth() {
  const { data: { session } } = await dbClient.auth.getSession();

  if (!session) {
    window.location.href = 'login.html';
    return null;
  }

  if (session.user.email !== ADMIN_EMAIL) {
    window.location.href = 'index.html';
    return null;
  }

  const { data: profile } = await dbClient
    .from('profiles')
    .select('role, first_name, avatar_color')
    .eq('id', session.user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    window.location.href = 'index.html';
    return null;
  }

  return { session, profile };
}

async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const auth = await checkAdminAuth();
  if (!auth) return;

  const { session, profile } = auth;
  const email = session.user.email;
  const initials = email.substring(0, 2).toUpperCase();
  const firstName = profile.first_name || 'Admin';

  document.getElementById('adminAvatar').textContent = initials;
  document.getElementById('adminAvatar').style.background = profile.avatar_color || '#1a6fdb';
  document.getElementById('adminName').textContent = firstName;

  // Log admin login
  await logActivity('login', 'admin_console', null, 'Admin accessed console');

  // Show app
  document.getElementById('authGuard').style.display = 'none';
  document.getElementById('adminWrapper').classList.remove('hidden');

  // Load all data
await Promise.all([
    loadStats(),
    loadUsers(),
    loadLogs(),
    loadProducts(),
    loadSpecies(),
    loadRecentActivity(),
    loadUserOverview(),
    loadTrash(),
    loadAdminOrgs(),
    loadArchives(),
    loadTickets(),
  ]);
});

// ── SECTION SWITCHER ──────────────────────────────────────────
function switchSection(name) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(`'${name}'`)) btn.classList.add('active');
  });

  const labels = {
    dashboard: 'Dashboard', users: 'User Management',
    activity: 'Activity Logs',
    products: 'Products Overview', species: 'Species Overview',
    support: 'Support Tickets', trash: 'Trash',
    organisations: 'Organisations', archives: 'Company Archives'
  };
  document.getElementById('breadcrumbCurrent').textContent = labels[name] || name;
}

// ── STATS ─────────────────────────────────────────────────────
async function loadStats() {
  const [usersRes, productsRes, speciesRes, logsRes] = await Promise.all([
    dbClient.from('profiles').select('id', { count: 'exact', head: true }),
    dbClient.from('products').select('id', { count: 'exact', head: true }),
    dbClient.from('species').select('id', { count: 'exact', head: true }),
    dbClient.from('activity_logs').select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
  ]);

  document.getElementById('statUsers').textContent = usersRes.count ?? '—';
  document.getElementById('statProducts').textContent = productsRes.count ?? '—';
  document.getElementById('statSpecies').textContent = speciesRes.count ?? '—';
  document.getElementById('statActions').textContent = logsRes.count ?? '—';
}

// ── USERS ─────────────────────────────────────────────────────
async function loadUsers() {
  const { data, error } = await dbClient
    .from('profiles')
    .select('*, company:company_id(company_name)')
    .order('created_at', { ascending: false });

  if (error) { console.error('Error loading users:', error); return; }

  // Get emails from auth via our edge function isn't possible client-side
  // So we store email in profiles table — let's add it
  allUsers = data || [];
  renderUsersTable(allUsers);
  renderUserOverview(allUsers);
}

function renderUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No users found.</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>
        <div class="user-cell">
          <div class="user-mini-avatar" style="background:${u.avatar_color || '#1a6fdb'}">${(u.first_name || 'U').charAt(0).toUpperCase()}</div>
          <div>
            <div class="user-mini-name">${[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</div>
            <div class="user-mini-email">${u.email || u.id}</div>
          </div>
        </div>
      </td>
      <td><span class="role-pill ${u.role || 'supplier'}">${u.role || 'supplier'}</span></td>
      <td>${u.company?.company_name || '—'}</td>
      <td>${u.last_login ? formatDate(u.last_login) : 'Never'}</td>
      <td>
        <span class="status-pill ${u.is_suspended ? 'suspended' : 'active'}">
          <span class="status-dot"></span>
          ${u.is_suspended ? 'Suspended' : 'Active'}
        </span>
      </td>
      <td>
        <div class="action-btns">
            ${u.role !== 'admin' ? `
            <button class="btn-action ${u.is_suspended ? 'activate' : 'suspend'}"
              onclick="${u.is_suspended ? `openActivateModal('${u.id}')` : `openSuspendModal('${u.id}')`}">
              ${u.is_suspended ? 'Activate' : 'Suspend'}
            </button>
            <button class="btn-action role" onclick="openRoleModal('${u.id}', '${u.role || 'supplier'}')">Role</button>
            <button class="btn-action suspend" onclick="deleteUser('${u.id}', '${[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}')">Delete</button>
          ` : '<span style="color:#4a4e7a; font-size:11px;">God Mode</span>'}
        </div>
      </td>
    </tr>
  `).join('');
}

function filterUsers(query) {
  const q = query.toLowerCase();
  const filtered = allUsers.filter(u =>
    (u.first_name || '').toLowerCase().includes(q) ||
    (u.last_name || '').toLowerCase().includes(q) ||
    (u.company_name || '').toLowerCase().includes(q) ||
    (u.id || '').toLowerCase().includes(q)
  );
  renderUsersTable(filtered);
}

function filterUsersByRole(role) {
  const filtered = role ? allUsers.filter(u => u.role === role) : allUsers;
  renderUsersTable(filtered);
}

// ── USER OVERVIEW (dashboard) ─────────────────────────────────
function loadUserOverview() {
  // Already loaded via loadUsers
}

function renderUserOverview(users) {
  const container = document.getElementById('liveUsersList');
  const recent = users.slice(0, 5);

  if (!recent.length) {
    container.innerHTML = '<p class="coming-soon">No users yet.</p>';
    return;
  }

  container.innerHTML = recent.map(u => `
    <div class="activity-log-row">
      <div class="user-mini-avatar" style="background:${u.avatar_color || '#1a6fdb'}; width:28px; height:28px; font-size:10px;">
        ${(u.first_name || 'U').charAt(0).toUpperCase()}
      </div>
      <div class="activity-text">
        <strong style="color:#e0e2f0;">${[u.first_name, u.last_name].filter(Boolean).join(' ') || 'Unknown'}</strong>
        <br/><span style="font-size:11px; color:#4a4e7a;">${u.company_name || 'No company'} · ${u.role || 'supplier'}</span>
      </div>
      <span class="status-pill ${u.is_suspended ? 'suspended' : 'active'}" style="font-size:10px;">
        <span class="status-dot"></span>
        ${u.is_suspended ? 'Suspended' : 'Active'}
      </span>
    </div>
  `).join('');
}

// ── ACTIVITY LOGS ─────────────────────────────────────────────
async function loadLogs() {
  const { data, error } = await dbClient
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) { console.error('Error loading logs:', error); return; }

  allLogs = data || [];
  renderLogsTable(allLogs);
}

function renderLogsTable(logs) {
  const tbody = document.getElementById('logsTableBody');
  if (!logs.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No activity logs yet.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr>
      <td style="white-space:nowrap; color:#4a4e7a;">${formatDate(l.created_at)}</td>
      <td style="font-size:12px;">${l.user_email || l.user_id || '—'}</td>
      <td><span class="activity-action-badge ${l.action || ''}">${l.action || '—'}</span></td>
      <td style="color:#6b7080;">${l.resource || '—'}</td>
      <td style="font-size:12px; color:#4a4e7a; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${l.metadata ? JSON.stringify(l.metadata) : '—'}</td>
    </tr>
  `).join('');
}

async function loadRecentActivity() {
  const { data } = await dbClient
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(8);

  const container = document.getElementById('recentActivityList');
  if (!data || !data.length) {
    container.innerHTML = '<p class="coming-soon">No activity yet.</p>';
    return;
  }

  container.innerHTML = data.map(l => `
    <div class="activity-log-row">
      <span class="activity-action-badge ${l.action || ''}">${l.action || '—'}</span>
      <span class="activity-text">${l.user_email || 'Unknown'} · ${l.resource || ''}</span>
      <span class="activity-time">${timeAgo(l.created_at)}</span>
    </div>
  `).join('');
}

function filterLogs(query) {
  const q = query.toLowerCase();
  const filtered = allLogs.filter(l =>
    (l.user_email || '').toLowerCase().includes(q) ||
    (l.action || '').toLowerCase().includes(q) ||
    (l.resource || '').toLowerCase().includes(q)
  );
  renderLogsTable(filtered);
}

function filterLogsByAction(action) {
  const filtered = action ? allLogs.filter(l => l.action === action) : allLogs;
  renderLogsTable(filtered);
}

// ── PRODUCTS ──────────────────────────────────────────────────
async function loadProducts() {
  const { data } = await dbClient
    .from('products')
    .select('id, product_name, brand, created_at, user_id')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('productsTableBody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No products found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(p => `
    <tr>
      <td style="font-weight:600; color:#e0e2f0;">${p.product_name || '—'}</td>
      <td>${p.brand || '—'}</td>
      <td style="font-size:11px; color:#4a4e7a;">${p.user_id || '—'}</td>
      <td style="color:#4a4e7a;">${formatDate(p.created_at)}</td>
      <td>
        <button class="btn-action view" onclick="window.open('product-detail.html?id=${p.id}', '_blank')">View</button>
      </td>
    </tr>
  `).join('');
}

// ── SPECIES ───────────────────────────────────────────────────
async function loadSpecies() {
  const { data } = await dbClient
    .from('species')
    .select('id, species_name, scientific_name, created_at')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('speciesTableBody');
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">No species found.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(s => `
    <tr>
      <td style="font-weight:600; color:#e0e2f0;">${s.species_name || '—'}</td>
      <td style="font-style:italic; color:#6b7080;">${s.scientific_name || '—'}</td>
      <td style="color:#4a4e7a;">${formatDate(s.created_at)}</td>
      <td>
        <button class="btn-action view" onclick="window.open('species-detail.html?id=${s.id}', '_blank')">View</button>
      </td>
    </tr>
  `).join('');
}

// ── SUSPEND / ACTIVATE ────────────────────────────────────────
function openSuspendModal(userId) {
  suspendTargetId = userId;
  suspendAction = 'suspend';
  const user = allUsers.find(u => u.id === userId);
  document.getElementById('suspendModalTitle').textContent = 'Suspend User';
  document.getElementById('suspendModalBody').textContent = `Are you sure you want to suspend ${[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'this user'}? They will lose access immediately.`;
  document.getElementById('suspendConfirmBtn').textContent = 'Suspend';
  document.getElementById('suspendConfirmBtn').className = 'modal-confirm-btn';
  document.getElementById('suspendModal').classList.remove('hidden');
}

function openActivateModal(userId) {
  suspendTargetId = userId;
  suspendAction = 'activate';
  const user = allUsers.find(u => u.id === userId);
  document.getElementById('suspendModalTitle').textContent = 'Activate User';
  document.getElementById('suspendModalBody').textContent = `Restore access for ${[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'this user'}?`;
  document.getElementById('suspendConfirmBtn').textContent = 'Activate';
  document.getElementById('suspendConfirmBtn').className = 'modal-confirm-btn blue';
  document.getElementById('suspendModal').classList.remove('hidden');
}

function closeSuspendModal() {
  suspendTargetId = null;
  document.getElementById('suspendModal').classList.add('hidden');
}

async function confirmSuspend() {
  if (!suspendTargetId) return;
  const isSuspending = suspendAction === 'suspend';

  const { error } = await dbClient
    .from('profiles')
    .update({ is_suspended: isSuspending })
    .eq('id', suspendTargetId);

  if (error) { showToast('Action failed.', 'error'); return; }

  await logActivity(
    isSuspending ? 'suspend_user' : 'activate_user',
    'profile',
    suspendTargetId,
    `Admin ${isSuspending ? 'suspended' : 'activated'} user`
  );

  closeSuspendModal();
  showToast(`User ${isSuspending ? 'suspended' : 'activated'} successfully.`, 'success');
  await loadUsers();
}

// ── ROLE CHANGE ───────────────────────────────────────────────
function openRoleModal(userId, currentRole) {
  roleTargetId = userId;
  const user = allUsers.find(u => u.id === userId);
  document.getElementById('roleModalBody').textContent = `Change role for ${[user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'this user'}`;
  document.getElementById('roleSelect').value = currentRole;
  document.getElementById('roleModal').classList.remove('hidden');
}

function closeRoleModal() {
  roleTargetId = null;
  document.getElementById('roleModal').classList.add('hidden');
}

async function confirmRoleChange() {
  if (!roleTargetId) return;
  const newRole = document.getElementById('roleSelect').value;

  const { error } = await dbClient
    .from('profiles')
    .update({ role: newRole })
    .eq('id', roleTargetId);

  if (error) { showToast('Role change failed.', 'error'); return; }

  await logActivity('update', 'profile', roleTargetId, `Role changed to ${newRole}`);

  closeRoleModal();
  showToast(`Role updated to ${newRole}.`, 'success');
  await loadUsers();
}

// ── LOG ACTIVITY ──────────────────────────────────────────────
async function logActivity(action, resource, resourceId, details) {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) return;

  await dbClient.from('activity_logs').insert({
    user_id: session.user.id,
    user_email: session.user.email,
    action,
    resource,
    resource_id: resourceId,
    metadata: { details }
  });
}

// ── SEARCH ────────────────────────────────────────────────────
function handleGlobalSearch(query) {
  // Search within current active section
  const activeSection = document.querySelector('.admin-section.active')?.id;
  if (activeSection === 'section-users') filterUsers(query);
  if (activeSection === 'section-activity') filterLogs(query);
}

function refreshAll() {
  loadStats();
  loadUsers();
  loadLogs();
  loadProducts();
  loadSpecies();
  loadRecentActivity();
  loadTrash();
  loadAdminOrgs();
  loadArchives();
  loadTickets(); 
  showToast('Refreshed!', 'success');
}

// ── TRASH ─────────────────────────────────────────────────────
async function loadTrash() {
  await Promise.all([loadTrashProducts(), loadTrashSpecies()]);
}

async function loadTrashProducts() {
  const { data } = await dbClient
    .from('products')
    .select('id, product_name, brand, deleted_at, reminder')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  const tbody = document.getElementById('trashProductsBody');
  const count = document.getElementById('trashProductCount');

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No deleted products.</td></tr>';
    count.textContent = '0 items';
    return;
  }

  count.textContent = `${data.length} item${data.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = data.map(p => {
    const deletedAt = new Date(p.deleted_at);
    const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const daysLeft = Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24));

    return `
      <tr>
        <td style="font-weight:600; color:#e0e2f0;">${p.product_name || '—'}</td>
        <td>${p.brand || '—'}</td>
        <td style="color:#4a4e7a;">${formatDate(p.deleted_at)}</td>
        <td>
          <span style="color:${daysLeft <= 5 ? '#e63946' : '#f59e0b'}; font-weight:600;">
            ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left
          </span>
        </td>
        <td>
          <span style="color:${p.reminder ? '#22c55e' : '#4a4e7a'}; font-size:12px;">
            ${p.reminder ? '✓ Yes' : '—'}
          </span>
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-action activate" onclick="restoreProduct('${p.id}')">Restore</button>
            <button class="btn-action suspend" onclick="permanentDeleteProduct('${p.id}')">Delete Forever</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadTrashSpecies() {
  const { data } = await dbClient
    .from('species')
    .select('id, species_name, scientific_name, deleted_at, reminder')
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  const tbody = document.getElementById('trashSpeciesBody');
  const count = document.getElementById('trashSpeciesCount');

  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No deleted species.</td></tr>';
    count.textContent = '0 items';
    return;
  }

  count.textContent = `${data.length} item${data.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = data.map(s => {
    const deletedAt = new Date(s.deleted_at);
    const expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const daysLeft = Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60 * 24));

    return `
      <tr>
        <td style="font-weight:600; color:#e0e2f0;">${s.species_name || '—'}</td>
        <td style="font-style:italic; color:#6b7080;">${s.scientific_name || '—'}</td>
        <td style="color:#4a4e7a;">${formatDate(s.deleted_at)}</td>
        <td>
          <span style="color:${daysLeft <= 5 ? '#e63946' : '#f59e0b'}; font-weight:600;">
            ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left
          </span>
        </td>
        <td>
          <span style="color:${s.reminder ? '#22c55e' : '#4a4e7a'}; font-size:12px;">
            ${s.reminder ? '✓ Yes' : '—'}
          </span>
        </td>
        <td>
          <div class="action-btns">
            <button class="btn-action activate" onclick="restoreSpecies('${s.id}')">Restore</button>
            <button class="btn-action suspend" onclick="permanentDeleteSpecies('${s.id}')">Delete Forever</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function restoreProduct(id) {
  const { error } = await dbClient
    .from('products')
    .update({ deleted_at: null, reminder: false })
    .eq('id', id);

  if (error) { showToast('Failed to restore.', 'error'); return; }
  await logActivity('restore', 'product', id, 'Product restored from Trash');
  showToast('Product restored!', 'success');
  await loadTrashProducts();
}

async function permanentDeleteProduct(id) {
  if (!confirm('This will permanently delete the product. This cannot be undone!')) return;

  await dbClient.from('product_allergens').delete().eq('product_id', id);
  await dbClient.from('product_nutrition').delete().eq('product_id', id);
  await dbClient.from('product_artwork').delete().eq('product_id', id);

  const { error } = await dbClient.from('products').delete().eq('id', id);
  if (error) { showToast('Failed to delete permanently.', 'error'); return; }

  await logActivity('permanent_delete', 'product', id, 'Product permanently deleted');
  showToast('Product permanently deleted.', 'success');
  await loadTrashProducts();
}

async function restoreSpecies(id) {
  const { error } = await dbClient
    .from('species')
    .update({ deleted_at: null, reminder: false })
    .eq('id', id);

  if (error) { showToast('Failed to restore.', 'error'); return; }
  await logActivity('restore', 'species', id, 'Species restored from Trash');
  showToast('Species restored!', 'success');
  await loadTrashSpecies();
}

async function permanentDeleteSpecies(id) {
  if (!confirm('This will permanently delete the species. This cannot be undone!')) return;

  const { error } = await dbClient.from('species').delete().eq('id', id);
  if (error) { showToast('Failed to delete permanently.', 'error'); return; }

  await logActivity('permanent_delete', 'species', id, 'Species permanently deleted');
  showToast('Species permanently deleted.', 'success');
  await loadTrashSpecies();
}

function filterTrashByType(type) {
  const productsTable = document.getElementById('trashProductsTable').closest('.admin-card');
  const speciesTable = document.getElementById('trashSpeciesTable').closest('.admin-card');

  if (type === 'products') {
    productsTable.style.display = 'block';
    speciesTable.style.display = 'none';
  } else if (type === 'species') {
    productsTable.style.display = 'none';
    speciesTable.style.display = 'block';
  } else {
    productsTable.style.display = 'block';
    speciesTable.style.display = 'block';
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── ORGANISATIONS ─────────────────────────────────────────────
let allAdminOrgs = [];

async function loadAdminOrgs() {
  const { data } = await dbClient
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  allAdminOrgs = data || [];

  // Get member and product counts
  const tbody = document.getElementById('orgsTableBody');
  if (!allAdminOrgs.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No organisations found.</td></tr>';
    return;
  }

  // Fetch counts for each org
  const rows = await Promise.all(allAdminOrgs.map(async org => {
    const [{ count: memberCount }, { count: productCount }] = await Promise.all([
      dbClient.from('company_members').select('id', { count: 'exact', head: true }).eq('company_id', org.id),
      dbClient.from('products').select('id', { count: 'exact', head: true }).eq('company_id', org.id).is('deleted_at', null),
    ]);
    return { ...org, memberCount: memberCount || 0, productCount: productCount || 0 };
  }));

  renderAdminOrgsTable(rows);
}

function renderAdminOrgsTable(orgs) {
  const tbody = document.getElementById('orgsTableBody');
  tbody.innerHTML = orgs.map(org => `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          ${org.photo_url
            ? `<img src="${org.photo_url}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;" />`
            : `<div style="width:32px; height:32px; border-radius:50%; background:rgba(26,111,219,0.15); color:#1a6fdb; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px;">${(org.company_name||'O').charAt(0).toUpperCase()}</div>`
          }
          <div>
            <div style="font-weight:600; color:#e0e2f0;">${org.company_name || '—'}</div>
            <div style="font-size:11px; color:#4a4e7a;">${org.email || '—'}</div>
          </div>
        </div>
      </td>
      <td style="color:#6b7080;">${org.industry || '—'}</td>
      <td style="color:#6b7080;">${org.country || '—'}</td>
      <td><span style="color:#1a6fdb; font-weight:600;">${org.memberCount}</span></td>
      <td><span style="color:#22c55e; font-weight:600;">${org.productCount}</span></td>
      <td><span class="status-pill ${org.status === 'active' ? 'active' : 'suspended'}">
        <span class="status-dot"></span>${org.status}
      </span></td>
      <td>
        <div class="action-btns">
          <button class="btn-action ${org.status === 'suspended' ? 'activate' : 'suspend'}"
            onclick="${org.status === 'suspended' ? `activateOrg('${org.id}')` : `suspendOrg('${org.id}')`}">
            ${org.status === 'suspended' ? 'Activate' : 'Suspend'}
          </button>
          <button class="btn-action suspend" onclick="deleteOrgWithArchive('${org.id}', '${(org.company_name||'').replace(/'/g,"\\'")}', ${org.memberCount}, ${org.productCount})">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterAdminOrgs(query) {
  const q = query.toLowerCase();
  const filtered = allAdminOrgs.filter(o =>
    (o.company_name||'').toLowerCase().includes(q) ||
    (o.country||'').toLowerCase().includes(q) ||
    (o.industry||'').toLowerCase().includes(q)
  );
  renderAdminOrgsTable(filtered);
}

function filterAdminOrgsByStatus(status) {
  const filtered = status ? allAdminOrgs.filter(o => o.status === status) : allAdminOrgs;
  renderAdminOrgsTable(filtered);
}

async function suspendOrg(id) {
  await dbClient.from('companies').update({ status: 'suspended' }).eq('id', id);
  showToast('Organisation suspended.', 'success');
  await loadAdminOrgs();
}

async function activateOrg(id) {
  await dbClient.from('companies').update({ status: 'active' }).eq('id', id);
  showToast('Organisation activated.', 'success');
  await loadAdminOrgs();
}

async function deleteOrgWithArchive(companyId, companyName, memberCount, productCount) {
  if (!confirm(`Delete "${companyName}"?\n\n⚠️ This will:\n- Delete ${memberCount} user(s)\n- Move ${productCount} product(s) to Trash\n- Create a JSON archive\n\nThis cannot be undone!`)) return;

  showToast('Archiving and deleting...', 'success');

  try {
    // 1. Collect all data for archive
    const [
      { data: company },
      { data: members },
      { data: products },
      { data: certs },
      { data: logs }
    ] = await Promise.all([
      dbClient.from('companies').select('*').eq('id', companyId).single(),
      dbClient.from('company_members').select('*, profiles:user_id(*)').eq('company_id', companyId),
      dbClient.from('products').select('*').eq('company_id', companyId),
      dbClient.from('organisation_certifications').select('*').eq('company_id', companyId),
      dbClient.from('activity_logs').select('*').eq('resource', 'company').eq('resource_id', companyId),
    ]);

    // 2. Build archive JSON
    const archive = {
      archived_at: new Date().toISOString(),
      company,
      members: members || [],
      products: products || [],
      certifications: certs || [],
      activity_logs: logs || [],
    };

    // 3. Upload JSON to storage
    const fileName = `${companyId}_${Date.now()}.json`;
    const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });

    const { error: uploadError } = await dbClient.storage
      .from('company-archives')
      .upload(fileName, blob);

    let archiveUrl = null;
    if (!uploadError) {
      const { data: urlData } = dbClient.storage
        .from('company-archives')
        .getPublicUrl(fileName);
      archiveUrl = urlData.publicUrl;
    }

    // 4. Save archive record
    await dbClient.from('company_archives').insert({
      company_id: companyId,
      company_name: companyName,
      deleted_by: (await dbClient.auth.getSession()).data.session?.user.id,
      archive_url: archiveUrl,
      user_count: memberCount,
      product_count: productCount,
    });

    // 5. Soft delete products (move to trash)
    if (products?.length) {
      await dbClient.from('products')
        .update({ deleted_at: new Date().toISOString() })
        .eq('company_id', companyId);
    }

    // 6. Delete users (profiles + auth)
    if (members?.length) {
      for (const member of members) {
        await dbClient.from('profiles').delete().eq('id', member.user_id);
      }
    }

    // 7. Delete company (cascades members, certs, associations)
    await dbClient.from('companies').delete().eq('id', companyId);

    await logActivity('delete', 'company', companyId, `Deleted company with archive: ${companyName}`);
    showToast(`"${companyName}" deleted and archived!`, 'success');
    await Promise.all([loadAdminOrgs(), loadArchives(), loadStats(), loadTrash()]);

  } catch (err) {
    console.error('Delete org error:', err);
    showToast('Something went wrong during deletion.', 'error');
  }
}

// ── ARCHIVES ──────────────────────────────────────────────────
async function loadArchives() {
  const { data } = await dbClient
    .from('company_archives')
    .select('*')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('archivesTableBody');
  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No archives yet.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(a => `
    <tr>
      <td style="font-weight:600; color:#e0e2f0;">${a.company_name || '—'}</td>
      <td style="color:#4a4e7a;">${formatDate(a.created_at)}</td>
      <td style="color:#1a6fdb; font-weight:600;">${a.user_count || 0}</td>
      <td style="color:#22c55e; font-weight:600;">${a.product_count || 0}</td>
      <td>
        ${a.archive_url
          ? `<a href="${a.archive_url}" target="_blank" class="btn-action view">Download JSON</a>`
          : '<span style="color:#4a4e7a; font-size:12px;">No file</span>'
        }
      </td>
    </tr>
  `).join('');
}

function showToast(message, type = 'success') {
  const existing = document.querySelector('.admin-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px;
    background:${type === 'success' ? '#22c55e' : '#e63946'};
    color:#fff; padding:10px 18px; border-radius:8px;
    font-family:'DM Sans',sans-serif; font-size:13px; font-weight:600;
    box-shadow:0 4px 20px rgba(0,0,0,0.3); z-index:9999;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── ADD USER ──────────────────────────────────────────────────
async function openAddUserModal() {
  // Load companies into dropdown
  const select = document.getElementById('newUserCompany');
  select.innerHTML = '<option value="">Select company...</option>';

  if (!allAdminOrgs.length) {
    select.innerHTML = '<option value="">No companies yet — create one first</option>';
  } else {
    allAdminOrgs.forEach(org => {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = `${org.company_name} (${org.company_code || '—'})`;
      select.appendChild(opt);
    });
  }

  // Load partner of dropdown
  const partnerSelect = document.getElementById('newUserPartnerOf');
  partnerSelect.innerHTML = '<option value="">Select organisation...</option>';
  allAdminOrgs.forEach(org => {
    const opt = document.createElement('option');
    opt.value = org.id;
    opt.textContent = org.company_name;
    partnerSelect.appendChild(opt);
  });

  // Clear fields
  ['newUserFirstName', 'newUserLastName', 'newUserEmail', 'newUserPassword', 'newUserPosition'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.getElementById('newUserRole').value = 'supplier';
  document.getElementById('newUserPartnerOfGroup').style.display = 'none';
  document.getElementById('addUserModal').classList.remove('hidden');
}

function handleNewUserRoleChange(select) {
  const partnerGroup = document.getElementById('newUserPartnerOfGroup');
  partnerGroup.style.display = select.value === 'partner' ? 'flex' : 'none';
}

async function createUser() {
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value.trim();
  const firstName = document.getElementById('newUserFirstName').value.trim();
  const lastName = document.getElementById('newUserLastName').value.trim();
  const role = document.getElementById('newUserRole').value;
  const companyId = document.getElementById('newUserCompany').value || null;
  const position = document.getElementById('newUserPosition').value.trim();
  const partnerOf = role === 'partner' ? document.getElementById('newUserPartnerOf').value || null : null;

  if (!email || !password) { showToast('Email and password are required.', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters.', 'error'); return; }
  if (!companyId) { showToast('Please select a company. Every user must belong to an organisation.', 'error'); return; }

  const btn = document.querySelector('#addUserModal .modal-confirm-btn');
  btn.textContent = 'Creating...';
  btn.disabled = true;

  try {
    const { data: { session } } = await dbClient.auth.getSession();

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/create-user`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
          body: JSON.stringify({
          email, password, first_name: firstName,
          last_name: lastName, role, company_id: companyId,
          position, partner_of: partnerOf
        })
      }
    );

    const result = await response.json();

    if (result.error) throw new Error(result.error);

// Add to company_members
    if (companyId && result.user_id) {
      await dbClient.from('company_members').insert({
        company_id: companyId,
        user_id: result.user_id,
        company_role: 'member',
        status: 'active'
      });
    }

    await logActivity('create', 'user', result.user_id, `Created user: ${email}`);
    showToast(`User ${email} created successfully!`, 'success');
    document.getElementById('addUserModal').classList.add('hidden');
    await loadUsers();

  } catch (err) {
    showToast(err.message || 'Failed to create user.', 'error');
  } finally {
    btn.textContent = 'Create User';
    btn.disabled = false;
  }
}

// ── SUPPORT TICKETS ───────────────────────────────────────────
let allTickets = [];

async function loadTickets() {
  const { data } = await dbClient
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  allTickets = data || [];
  renderTickets(allTickets);
}

function renderTickets(tickets) {
  const tbody = document.getElementById('ticketsTableBody');
  if (!tbody) return;
  if (!tickets.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No tickets yet.</td></tr>';
    return;
  }

  tbody.innerHTML = tickets.map(t => `
    <tr>
      <td>
        <div style="font-size:13px; font-weight:600; color:#e0e2f0;">${t.user_name || '—'}</div>
        <div style="font-size:11px; color:#4a4e7a;">${t.user_email || '—'}</div>
      </td>
      <td>
        <span class="role-pill ${t.type === 'report' ? 'buyer' : 'supplier'}">
          ${t.type === 'report' ? '🐛 Bug Report' : '✉ Contact'}
        </span>
      </td>
      <td style="color:#c0c2d8; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.subject || '—'}</td>
      <td style="color:#4a4e7a; font-size:12px;">${formatDate(t.created_at)}</td>
      <td>
        <select onchange="updateTicketStatus('${t.id}', this.value)"
          style="padding:4px 8px; background:#1a1a30; border:1px solid #2a2a4a; border-radius:6px; font-family:'DM Sans',sans-serif; font-size:11px; color:#e0e2f0; outline:none; cursor:pointer;">
          <option value="open" ${t.status === 'open' ? 'selected' : ''}>Open</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved" ${t.status === 'resolved' ? 'selected' : ''}>Resolved</option>
        </select>
      </td>
      <td>
        <button class="btn-action view" onclick="viewTicket('${t.id}')">View</button>
      </td>
    </tr>
  `).join('');
}

function filterTicketsByType(type) {
  renderTickets(type ? allTickets.filter(t => t.type === type) : allTickets);
}

function filterTicketsByStatus(status) {
  renderTickets(status ? allTickets.filter(t => t.status === status) : allTickets);
}

async function updateTicketStatus(id, status) {
  await dbClient.from('support_tickets').update({ status }).eq('id', id);
  showToast('Status updated!', 'success');
  await loadTickets();
}

function viewTicket(id) {
  const t = allTickets.find(t => t.id === id);
  if (!t) return;
  alert(`From: ${t.user_name} (${t.user_email})\n\nSubject: ${t.subject}\n\n${t.message}`);
}

// ── DELETE USER ───────────────────────────────────────────────
async function deleteUser(userId, name) {
  if (!confirm(`Permanently delete ${name}?\n\nThis will:\n- Remove their profile\n- Remove them from all companies\n- Delete their login account\n\nThis cannot be undone!`)) return;

  try {
    const { data: { session } } = await dbClient.auth.getSession();

    // Remove from company_members first
    await dbClient.from('company_members').delete().eq('user_id', userId);

    // Delete profile
    await dbClient.from('profiles').delete().eq('id', userId);

    // Delete auth user via Edge Function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ user_id: userId })
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    await logActivity('delete', 'user', userId, `Deleted user: ${name}`);
    showToast(`${name} deleted.`, 'success');
    await loadUsers();
    await loadStats();

  } catch (err) {
    showToast(err.message || 'Failed to delete user.', 'error');
  }
}