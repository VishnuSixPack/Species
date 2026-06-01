/* ============================================================
   PROJECT MANHATTAN — mri-dashboard.js
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const STAGE_MAX = { FV: 1080, CR: 430, FCL: 460, PP: 270, SP: 470, LFP: 440 };

function getMriStatus(score) {
  if (score === 0) return { label: 'Transparent', cls: 'transparent', emoji: '🟢' };
  if (score < 100) return { label: 'Low Risk', cls: 'low', emoji: '🔵' };
  if (score < 500) return { label: 'Medium Risk', cls: 'medium', emoji: '🟡' };
  return { label: 'Critical', cls: 'critical', emoji: '🔴' };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function handleLogout() { dbClient.auth.signOut().then(() => window.location.href = 'login.html'); }

function toggleNavDropdown() {
  document.getElementById('navDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.topbar-right')) {
    document.getElementById('navDropdown')?.classList.remove('open');
  }
});

// ── GAUGE ANIMATION ───────────────────────────────────────────
function animateGauge(score, maxScore) {
  const arc = document.getElementById('gaugeArc');
  const dot = document.getElementById('gaugeDot');
  if (!arc || !dot) return;

  const totalLength = 251.2;
  const ratio = maxScore > 0 ? Math.min(score / maxScore, 1) : 0;
  const offset = totalLength - (ratio * totalLength);

  // Color based on status
  const status = getMriStatus(score);
  const colors = { transparent: '#22c55e', low: '#3b82f6', medium: '#f59e0b', critical: '#e63946' };
  const color = colors[status.cls];

  arc.style.stroke = color;
  arc.style.strokeDashoffset = offset;
  dot.style.stroke = color;

  // Move dot along arc
  const angle = -180 + (ratio * 180);
  const rad = (angle * Math.PI) / 180;
  const cx = 100 + 80 * Math.cos(rad);
  const cy = 110 + 80 * Math.sin(rad);
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);

  // Animate score number
  let current = 0;
  const step = Math.ceil(score / 40);
  const timer = setInterval(() => {
    current = Math.min(current + step, score);
    document.getElementById('gaugeScore').textContent = current.toLocaleString();
    if (current >= score) clearInterval(timer);
  }, 30);
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();

  const email = session.user.email || '';
  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, email.substring(0, 2).toUpperCase(), profile?.avatar_color || '#1a6fdb');
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(profile?.first_name || email.split('@')[0]);

  // Show edit button for admin/operator
  if (['admin', 'operator'].includes(profile?.role)) {
    document.getElementById('dashEditBtn').classList.remove('hidden');
  }

  // Read URL params
  const params = new URLSearchParams(window.location.search);
  const projectName = decodeURIComponent(params.get('name') || 'Project');
  const projectStatus = params.get('status') || 'transparent';

  document.getElementById('dashProjectName').textContent = projectName;
  document.title = `${projectName} — MRI`;

  // Status badge
  const statusBadge = document.getElementById('dashStatusBadge');
  const statusObj = getMriStatus(projectStatus === 'medium' ? 320 : 0);
  statusBadge.textContent = projectStatus === 'medium' ? 'Medium Risk' : 'Transparent';
  statusBadge.style.background = projectStatus === 'medium' ? '#fef3c7' : '#dcfce7';
  statusBadge.style.color = projectStatus === 'medium' ? '#d97706' : '#16a34a';

  // Dummy data for beta
  if (projectStatus === 'medium') {
    // Thai Union project — has some risk
    const score = 320;
    const maxScore = 2890;
    const stageScores = { FV: 120, CR: 80, FCL: 50, PP: 30, SP: 40, LFP: 0 };

    document.getElementById('gaugeMax').textContent = `/ ${maxScore.toLocaleString()}`;
    const s = getMriStatus(score);
    document.getElementById('gaugeStatus').textContent = `${s.emoji} ${s.label}`;
    animateGauge(score, maxScore);

    // Stage breakdown
    Object.entries(stageScores).forEach(([stage, stageScore]) => {
      const max = STAGE_MAX[stage];
      document.getElementById(`stageMiniScore-${stage}`).innerHTML = `${stageScore} <span>/ ${max}</span>`;
      const pct = Math.round((stageScore / max) * 100);
      document.getElementById(`stageMiniBar-${stage}`).style.width = `${pct}%`;
    });

    // Products table
    document.getElementById('productsEmpty').classList.add('hidden');
    const table = document.getElementById('productsTable');
    table.classList.remove('hidden');
    table.innerHTML = `
      <div class="product-row" style="border-bottom:1px solid #f0f2f8; padding-bottom:8px; margin-bottom:4px;">
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Product</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Risk Score</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Status</span>
        <span style="font-size:10px; font-weight:700; color:#9aa0b4; text-transform:uppercase; letter-spacing:0.8px;">Assessed</span>
      </div>
      <div class="product-row">
        <div>
          <div class="product-row-name">Skipjack Loin — MSC</div>
          <div class="product-row-brand">Thai Union Frozen</div>
        </div>
        <div class="product-row-score">320 <span>/ 2,890</span></div>
        <div><span class="mri-status-pill medium"><span class="dot"></span> Medium Risk</span></div>
        <div style="font-size:12px; color:#9aa0b4;">28 May 2026</div>
      </div>`;

    // KDE Coverage
    document.getElementById('kdeCovData').textContent = '54';
    document.getElementById('kdeCovMissing').textContent = '18';
    document.getElementById('kdeCovNA').textContent = '5';
    document.getElementById('kdeCovBarGreen').style.width = '70%';
    document.getElementById('kdeCovBarRed').style.width = '23%';
    document.getElementById('kdeCovBarGrey').style.width = '7%';
    document.getElementById('kdeCovNote').textContent = '70% data coverage across 77 KDEs';

    // Last assessment
    document.getElementById('lastAssessEmpty').classList.add('hidden');
    document.getElementById('lastAssessInfo').classList.remove('hidden');
    document.getElementById('lastAssessDate').textContent = '28 May 2026';
    document.getElementById('lastAssessBy').textContent = 'Assessed by Vishnu S.';
    document.getElementById('lastAssessScore').textContent = '320 / 2,890';

  } else {
    // MMP project — transparent / not assessed
    animateGauge(0, 3150);
    document.getElementById('gaugeStatus').textContent = '🟢 Transparent';
    Object.keys(STAGE_MAX).forEach(stage => {
      document.getElementById(`stageMiniScore-${stage}`).innerHTML = `0 <span>/ ${STAGE_MAX[stage]}</span>`;
    });
  }
});