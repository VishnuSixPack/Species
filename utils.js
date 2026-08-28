/* ============================================================
   PROJECT MANHATTAN — utils.js
   Shared utilities across all pages
   ============================================================ */

const UTILS_SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const UTILS_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuYmRhYWpjcm9teG1oZ2N2ZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjc4MTUsImV4cCI6MjA5MzcwMzgxNX0.wlVbN57eAwRmTROEEY3D6BIX3H5pI6MwZ5hM2BqpnEs';

// ── GREETING ──────────────────────────────────────────────────
function getGreeting(name) {
  const hour = new Date().getHours();
  if (hour < 12) return `Good Morning, ${name}! ☀️`;
  if (hour < 17) return `Good Afternoon, ${name}! 👋`;
  if (hour < 21) return `Good Evening, ${name}! 🌆`;
  return `Good Night, ${name}! 🌙`;
}

// ── TOAST ─────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const existing = document.querySelector('.pm-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'pm-toast';
  toast.style.cssText = `
    position: fixed; bottom: 28px; right: 28px;
    background: ${type === 'success' ? '#22c55e' : '#e63946'};
    color: #fff; padding: 12px 20px; border-radius: 10px;
    font-family: 'Poppins', 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    z-index: 9999;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── DATE FORMAT ───────────────────────────────────────────────
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

// ── ACTIVITY LOGGER ───────────────────────────────────────────
async function logActivity(action, resource, resourceId = null, details = null) {
  try {
    const dbClient = window._sharedSupabase || (window._sharedSupabase = window.supabase.createClient(UTILS_SUPABASE_URL, UTILS_SUPABASE_KEY));
    const { data: { session } } = await dbClient.auth.getSession();
    if (!session) return;

    await dbClient.from('activity_logs').insert({
      user_id: session.user.id,
      user_email: session.user.email,
      action,
      resource,
      resource_id: resourceId ? String(resourceId) : null,
      metadata: details ? { details } : null
    });
  } catch (err) {
    console.warn('Activity log failed:', err);
  }
}

// ── UPDATE LAST LOGIN ─────────────────────────────────────────
async function updateLastLogin() {
  try {
    const dbClient = window._sharedSupabase || (window._sharedSupabase = window.supabase.createClient(UTILS_SUPABASE_URL, UTILS_SUPABASE_KEY));
    const { data: { session } } = await dbClient.auth.getSession();
    if (!session) return;
    await dbClient
      .from('profiles')
      .update({ last_login: new Date().toISOString() })
      .eq('id', session.user.id);
  } catch (err) {
    console.warn('Last login update failed:', err);
  }
}
// ── SET HOME LINK ─────────────────────────────────────────────
function setHomeLink(role) {
  document.querySelectorAll('a[href="index.html"]').forEach(link => {
    link.href = 'home-logged-in.html';
  });
}

// ── SET NAV AVATAR ────────────────────────────────────────────
function setNavAvatar(avatarEl, photoUrl, initials, avatarColor) {
  if (photoUrl) {
    avatarEl.innerHTML = `<img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;" />`;
    avatarEl.style.background = 'transparent';
  } else {
    avatarEl.textContent = initials;
    avatarEl.style.background = avatarColor || '#1a6fdb';
  }
}

// ── ORG ROLE ──────────────────────────────────────────────────
async function getUserOrgRole() {
  try {
    const dbClient = window._sharedSupabase || (window._sharedSupabase = window.supabase.createClient(UTILS_SUPABASE_URL, UTILS_SUPABASE_KEY));
    const { data: { session } } = await dbClient.auth.getSession();
    if (!session) return null;

    const { data: profile } = await dbClient
      .from('profiles')
      .select('company_id, role')
      .eq('id', session.user.id)
      .single();

    // Admin and operator have full access always
    if (['admin', 'operator'].includes(profile?.role)) return 'company_admin';

    if (!profile?.company_id) return null;

    const { data: member } = await dbClient
      .from('company_members')
      .select('company_role')
      .eq('user_id', session.user.id)
      .eq('company_id', profile.company_id)
      .single();

    return member?.company_role || 'member';
  } catch (err) {
    console.warn('getUserOrgRole failed:', err);
    return null;
  }
}

function canEdit(role) {
  return ['company_admin', 'contributor'].includes(role);
}