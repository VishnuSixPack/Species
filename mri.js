/* ============================================================
   PROJECT MANHATTAN — mri.js
   Manhattan IUU Risk Index
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

let currentUser = null;
let currentProfile = null;

// ── AUTH ──────────────────────────────────────────────────────
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

// ── HELPERS ───────────────────────────────────────────────────
function getMriStatus(score) {
  if (score === 0) return { label: 'Transparent', cls: 'transparent', emoji: '🟢' };
  if (score < 100) return { label: 'Low Risk', cls: 'low', emoji: '🔵' };
  if (score < 500) return { label: 'Medium Risk', cls: 'medium', emoji: '🟡' };
  return { label: 'Critical', cls: 'critical', emoji: '🔴' };
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  currentUser = session.user;

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url, company_id')
    .eq('id', currentUser.id)
    .single();

  currentProfile = profile;

  const email = currentUser.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  const avatarColor = profile?.avatar_color || '#1a6fdb';

  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, initials, avatarColor);
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(profile?.first_name || email.split('@')[0]);
  setHomeLink(profile?.role);

  // Show admin bar for admin/operator
  const isAdminOrOperator = ['admin', 'operator'].includes(profile?.role);
  if (isAdminOrOperator) {
    document.getElementById('mriAdminBar').classList.remove('hidden');
  }

  await loadAssessments(profile, isAdminOrOperator);
});

// ── LOAD ASSESSMENTS ─────────────────────────────────────────
async function loadAssessments(profile, isAdminOrOperator) {
  const loading = document.getElementById('mriLoading');
  const wrapper = document.getElementById('mriWrapper');

  try {
    let query = dbClient
      .from('mri_assessments')
      .select(`
        *,
        product:product_id (product_name, brand),
        company:company_id (company_name),
        assessor:assessed_by (first_name, last_name)
      `)
      .order('assessed_at', { ascending: false });

    // Non-admin users only see their own company
    if (!isAdminOrOperator && profile?.company_id) {
      query = query.eq('company_id', profile.company_id);
    }

    const { data: assessments, error } = await query;

    loading.style.display = 'none';
    wrapper.classList.remove('hidden');

    if (error) throw error;

    if (!assessments || !assessments.length) {
      document.getElementById('mriEmpty').classList.remove('hidden');
      renderOrgScore(null);
      return;
    }

    renderOrgScore(assessments);
    renderTable(assessments);

  } catch (err) {
    console.error('MRI load error:', err);
    loading.style.display = 'none';
    wrapper.classList.remove('hidden');
    document.getElementById('mriEmpty').classList.remove('hidden');
  }
}

// ── RENDER ORG SCORE ─────────────────────────────────────────
function renderOrgScore(assessments) {
  const container = document.getElementById('mriOrgScore');

  if (!assessments || !assessments.length) {
    container.innerHTML = `
      <div class="mri-score-card">
        <div class="mri-score-label">Overall Risk Score</div>
        <div class="mri-score-number">—</div>
        <div class="mri-score-max">Not assessed yet</div>
        <span class="mri-status-pill transparent">
          <span class="dot"></span> Awaiting Assessment
        </span>
      </div>`;
    return;
  }

  // Average total score across all products
  const totalScore = assessments.reduce((sum, a) => sum + (a.total_score || 0), 0);
  const totalMax = assessments.reduce((sum, a) => sum + (a.max_score || 0), 0);
  const status = getMriStatus(totalScore);

  container.innerHTML = `
    <div class="mri-score-card">
      <div class="mri-score-label">Overall Risk Score</div>
      <div class="mri-score-number">${totalScore.toLocaleString()}</div>
      <div class="mri-score-max">/ ${totalMax.toLocaleString()} max</div>
      <span class="mri-status-pill ${status.cls}">
        <span class="dot"></span> ${status.label}
      </span>
    </div>`;
}

// ── RENDER TABLE ──────────────────────────────────────────────
function renderTable(assessments) {
  const wrap = document.getElementById('mriTableWrap');
  const table = document.getElementById('mriTable');
  const count = document.getElementById('mriCount');

  wrap.classList.remove('hidden');
  count.textContent = `${assessments.length} assessment${assessments.length !== 1 ? 's' : ''}`;

  table.innerHTML = `
    <div class="mri-row-head">
      <span>Product</span>
      <span>Risk Score</span>
      <span>Status</span>
      <span>Assessed</span>
      <span>Assessor</span>
    </div>
    ${assessments.map(a => {
      const status = getMriStatus(a.total_score || 0);
      const assessorName = [a.assessor?.first_name, a.assessor?.last_name].filter(Boolean).join(' ') || '—';
      return `
        <div class="mri-row" onclick="window.location.href='mri-assessment.html?id=${a.id}'">
          <div>
            <div class="mri-product-name">${a.product?.product_name || '—'}</div>
            <div class="mri-product-brand">${a.product?.brand || ''}</div>
          </div>
          <div class="mri-score-cell">
            ${(a.total_score || 0).toLocaleString()}
            <span>/ ${(a.max_score || 3150).toLocaleString()}</span>
          </div>
          <div>
            <span class="mri-status-pill ${status.cls}">
              <span class="dot"></span> ${status.label}
            </span>
          </div>
          <div class="mri-date-cell">${formatDate(a.assessed_at)}</div>
          <div class="mri-assessor-cell">${assessorName}</div>
        </div>`;
    }).join('')}
  `;
}