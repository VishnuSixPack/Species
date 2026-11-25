/* ============================================================
   PROJECT MANHATTAN — mri-assessment.js
   MRI Assessment Form — Admin/Operator only
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

let currentUser = null;
let currentProfile = null;
let existingAssessmentId = null;

// ── ALL 77 KDEs ───────────────────────────────────────────────
const KDE_DATA = {
  FV: {
    label: 'Fishing Vessel',
    desc: 'Vessel identification, certification and catch data',
    kdes: [
      { key: 'FV_001', label: 'Fishing Method - Gear type', weight: 30 },
      { key: 'FV_002', label: 'Vessel Name', weight: 50 },
      { key: 'FV_003', label: 'Vessel VID', weight: 10 },
      { key: 'FV_004', label: 'Vessel flag', weight: 50 },
      { key: 'FV_005', label: 'On Register of RFMO of Fishing zone - Certification', weight: 50 },
      { key: 'FV_006', label: 'Goods standing on FFA register', weight: 50 },
      { key: 'FV_007', label: 'Flag state registration', weight: 50 },
      { key: 'FV_008', label: 'Flag state is not considered FOC', weight: 50 },
      { key: 'FV_009', label: 'Flag state has no EU yellow or Red Card', weight: 30 },
      { key: 'FV_010', label: 'Previous Flag declared', weight: 30 },
      { key: 'FV_011', label: 'Previous Name declared', weight: 30 },
      { key: 'FV_012', label: 'IMO number', weight: 50 },
      { key: 'FV_013', label: 'IRCS', weight: 30 },
      { key: 'FV_014', label: 'MMSI', weight: 30 },
      { key: 'FV_015', label: 'Fishing permit number - Fishing Authorization', weight: 50 },
      { key: 'FV_016', label: 'EU Facility Approval #', weight: 50 },
      { key: 'FV_017', label: 'Name of Captain provided', weight: 30 },
      { key: 'FV_018', label: 'Crew list provided', weight: 30 },
      { key: 'FV_019', label: 'Flag state approval for HS incl. tranship at sea and other EEZ', weight: 50 },
      { key: 'FV_020', label: 'Only transshipment in port unless monitored by observers', weight: 50 },
      { key: 'FV_021', label: 'Catch Area - FAO Fishing Zones', weight: 50 },
      { key: 'FV_022', label: 'Port of Departure', weight: 50 },
      { key: 'FV_023', label: 'Port of Arrival', weight: 50 },
      { key: 'FV_024', label: 'Vessel Trip - Capture Dates Start + End', weight: 30 },
      { key: 'FV_025', label: 'Date of Discharge - Landing or Transshipment', weight: 50 },
      { key: 'FV_026', label: 'Species scientific name of Target Species', weight: 50 },
    ]
  },
  CR: {
    label: 'Carrier / Transshipment Vessel',
    desc: 'Carrier vessel identification and compliance',
    kdes: [
      { key: 'CR_001', label: 'Name of vessel', weight: 50 },
      { key: 'CR_002', label: 'Vessel VID', weight: 10 },
      { key: 'CR_003', label: 'Vessel flag', weight: 50 },
      { key: 'CR_004', label: 'Flag state registration', weight: 50 },
      { key: 'CR_005', label: 'IMO number', weight: 50 },
      { key: 'CR_006', label: 'IRCS', weight: 30 },
      { key: 'CR_007', label: 'MMSI', weight: 30 },
      { key: 'CR_008', label: 'Carrier on RFMO register', weight: 50 },
      { key: 'CR_009', label: 'Flag state is not considered FOC', weight: 50 },
      { key: 'CR_010', label: 'Flag state has no EU yellow or Red Card', weight: 30 },
      { key: 'CR_011', label: 'Previous Flag declared', weight: 30 },
    ]
  },
  FCL: {
    label: 'Reefer Container Loading',
    desc: 'Port, container and logistics data',
    kdes: [
      { key: 'FCL_001', label: 'Port Name + Wharf LOADING', weight: 50 },
      { key: 'FCL_002', label: 'Geo-location - GLN - Lat-Lon - LOADING WHARF', weight: 10 },
      { key: 'FCL_003', label: 'Port state has EU competence', weight: 50 },
      { key: 'FCL_004', label: 'Loading Wharf is covered under MSC COC certificate if MSC', weight: 50 },
      { key: 'FCL_005', label: 'Independently monitored by port state CA', weight: 50 },
      { key: 'FCL_006', label: 'Bill of Lading, noting MSC is applicable', weight: 50 },
      { key: 'FCL_007', label: 'Product Ownership', weight: 50 },
      { key: 'FCL_008', label: 'Consignee', weight: 50 },
      { key: 'FCL_009', label: 'Date of loading', weight: 50 },
      { key: 'FCL_010', label: 'Container number', weight: 50 },
    ]
  },
  PP: {
    label: 'Primary Processor',
    desc: 'First processing facility data',
    kdes: [
      { key: 'PP_001', label: 'Name of Primary Processor', weight: 50 },
      { key: 'PP_002', label: 'Geo-location - GLN - Lat-Lon', weight: 10 },
      { key: 'PP_003', label: 'EU Facility Approval #', weight: 50 },
      { key: 'PP_004', label: 'Coldstore used has MSC COC or marked as part of PP CoC', weight: 50 },
      { key: 'PP_005', label: 'Holding Facility if not processor', weight: 50 },
      { key: 'PP_006', label: 'Geo-location - GLN - Lat-Lon of holding or storage facility', weight: 10 },
      { key: 'PP_007', label: 'Date received raw material', weight: 50 },
    ]
  },
  SP: {
    label: 'Secondary Processor',
    desc: 'Second processing, lot codes and compliance',
    kdes: [
      { key: 'SP_001', label: 'Name of Secondary Processor', weight: 50 },
      { key: 'SP_002', label: 'Geo-location - GLN - Lat-Lon', weight: 10 },
      { key: 'SP_003', label: 'EU Facility Approval #', weight: 50 },
      { key: 'SP_004', label: 'Coldstore used has MSC COC or marked as part of SP CoC', weight: 30 },
      { key: 'SP_005', label: 'Geo-location - GLN - Lat-Lon of holding or storage facility', weight: 10 },
      { key: 'SP_006', label: 'Verified if Broker/secondary processor has Valid MSC COC', weight: 50 },
      { key: 'SP_007', label: 'Container Discharge/Arrival Date Raw Material', weight: 30 },
      { key: 'SP_008', label: 'Full catch data received from primary processor', weight: 50 },
      { key: 'SP_009', label: 'Lot Code - TLC - Batch number of PP matched to Own Lot code', weight: 50 },
      { key: 'SP_010', label: 'Uses single batch of primary processor per Prod/Lotcode', weight: 50 },
      { key: 'SP_011', label: 'Provides full data timely', weight: 30 },
      { key: 'SP_012', label: 'Passes Pacifical audits on CoC and reporting', weight: 30 },
      { key: 'SP_013', label: 'Product subject to MSC CoC', weight: 30 },
    ]
  },
  LFP: {
    label: 'Logistics - Final Product',
    desc: 'Final shipment to end market',
    kdes: [
      { key: 'LFP_001', label: 'Name of the Shipper - End Buyer - GLN', weight: 50 },
      { key: 'LFP_002', label: 'MSC COC # Shipper', weight: 30 },
      { key: 'LFP_003', label: 'Name of Receiver - End Buyer - GLN - Lat-Lon', weight: 50 },
      { key: 'LFP_004', label: 'Buyers purchase order', weight: 50 },
      { key: 'LFP_005', label: 'Container number', weight: 50 },
      { key: 'LFP_006', label: 'Seal number', weight: 30 },
      { key: 'LFP_007', label: 'Bill of Lading, noting MSC if applicable', weight: 50 },
      { key: 'LFP_008', label: 'Commercial invoice, noting MSC if applicable', weight: 50 },
      { key: 'LFP_009', label: 'Packing list, noting MSC if applicable', weight: 50 },
      { key: 'LFP_010', label: 'Port state IUU Risk index CR', weight: 30 },
    ]
  }
};

// ── STATE ─────────────────────────────────────────────────────
const kdeState = {};
const stageResponsibility = {
  FV: 'seller', CR: 'seller', FCL: 'seller',
  PP: 'seller', SP: 'buyer', LFP: 'buyer'
};

Object.values(KDE_DATA).forEach(stage => {
  stage.kdes.forEach(kde => {
    kdeState[kde.key] = { response: true, na: false, evidence: '', points: 0 };
  });
});

// ── AUTH ──────────────────────────────────────────────────────
async function handleLogout() {
  await dbClient.auth.signOut();
  window.location.href = 'login.html';
}

function toggleNavDropdown() {
  document.getElementById('navDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.kde-severity-select')) {
    document.querySelectorAll('.kde-severity-select.open').forEach(el => el.classList.remove('open'));
  }
  if (!e.target.closest('.resp-custom')) {
    document.querySelectorAll('.resp-custom.open').forEach(el => el.classList.remove('open'));
  }
  if (!e.target.closest('.topbar-right')) {
    document.getElementById('navDropdown')?.classList.remove('open');
  }
});

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? '' : 'error'}`;
  toast.innerHTML = '<i></i>';
  toast.appendChild(document.createTextNode(message));
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── INIT ──────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await dbClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  currentUser = session.user;

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', currentUser.id)
    .single();

  currentProfile = profile;

  if (!['admin', 'operator'].includes(profile?.role)) {
    window.location.href = 'mri.html';
    return;
  }

  const email = currentUser.email || '';
  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, email.substring(0, 2).toUpperCase(), profile?.avatar_color || '#2f6fed');
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(profile?.first_name || email.split('@')[0]);

  await loadOrganisations();
  renderKDEStages();

  const params = new URLSearchParams(window.location.search);
  const assessmentId = params.get('id');
  if (assessmentId) await loadExistingAssessment(assessmentId);

  updateLiveScore();
});

// ── LOAD ORGS ─────────────────────────────────────────────────
async function loadOrganisations() {
  const { data } = await dbClient
    .from('companies')
    .select('id, company_name')
    .eq('status', 'active')
    .order('company_name');

  const select = document.getElementById('selectOrg');
  if (data?.length) {
    data.forEach(org => {
      const opt = document.createElement('option');
      opt.value = org.id;
      opt.textContent = org.company_name;
      select.appendChild(opt);
    });
  }
}

async function loadOrgProducts() {
  const orgId = document.getElementById('selectOrg').value;
  const select = document.getElementById('selectProduct');
  select.innerHTML = '<option value="">Select product...</option>';
  if (!orgId) return;

  const { data } = await dbClient
    .from('products')
    .select('id, product_name, brand')
    .eq('company_id', orgId)
    .is('deleted_at', null)
    .order('product_name');

  if (data?.length) {
    data.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.product_name}${p.brand ? ` · ${p.brand}` : ''}`;
      select.appendChild(opt);
    });
  }
}

// ── LOAD EXISTING ─────────────────────────────────────────────
async function loadExistingAssessment(id) {
  existingAssessmentId = id;
  const title = document.getElementById('assessTitle');
  if (title) title.textContent = 'Edit SRI assessment';

  const { data: assessment } = await dbClient
    .from('mri_assessments')
    .select('*')
    .eq('id', id)
    .single();

  if (!assessment) return;

  document.getElementById('selectOrg').value = assessment.company_id;
  await loadOrgProducts();
  document.getElementById('selectProduct').value = assessment.product_id;
  document.getElementById('assessmentNotes').value = assessment.notes || '';

  if (assessment.stage_responsibility) {
    Object.assign(stageResponsibility, assessment.stage_responsibility);
    Object.keys(stageResponsibility).forEach(code => {
      updateStageResponsibilityBadge(code, stageResponsibility[code]);
    });
  }

  const { data: responses } = await dbClient
    .from('mri_responses')
    .select('*')
    .eq('assessment_id', id);

  if (responses?.length) {
    responses.forEach(r => {
      if (kdeState[r.kde_key] !== undefined) {
        kdeState[r.kde_key] = {
          response: r.response,
          na: !r.is_applicable,
          evidence: r.evidence_type || '',
          points: r.score || 0
        };
      }
    });
    Object.keys(kdeState).forEach(key => {
      const toggle = document.getElementById(`toggle-${key}`);
      const naCheck = document.getElementById(`na-${key}`);
      const evidenceInput = document.getElementById(`evidence-${key}`);
      const sevBtn = document.getElementById(`sevBtn-${key}`);
      if (toggle) toggle.checked = kdeState[key].response;
      if (naCheck) {
        naCheck.checked = kdeState[key].na;
        if (kdeState[key].na) onNaChange(key, true);
      }
      if (evidenceInput) evidenceInput.value = kdeState[key].evidence;
      if (sevBtn && kdeState[key].points > 0) {
        selectSeverity(key, kdeState[key].points);
      }
      updateRowStyle(key);
    });
    updateLiveScore();
  }
}

// ── RESPONSIBILITY ────────────────────────────────────────────
const RESP_CONFIGS = {
  seller: { label: 'Seller', bg: '#edf3fe', color: '#2f6fed' },
  buyer:  { label: 'Buyer',  bg: '#e8f6ee', color: '#178a4c' },
  both:   { label: 'Both',   bg: '#fdf4e3', color: '#b7791f' },
};

function onResponsibilityChange(stageCode, value) {
  stageResponsibility[stageCode] = value;
  updateStageResponsibilityBadge(stageCode, value);
}

function updateStageResponsibilityBadge(stageCode, value) {
  const badge = document.getElementById(`respBadge-${stageCode}`);
  if (!badge) return;
  const cfg = RESP_CONFIGS[value] || RESP_CONFIGS.seller;
  badge.textContent = cfg.label;
  badge.style.background = cfg.bg;
  badge.style.color = cfg.color;
}

function toggleRespDropdown(stageCode) {
  document.querySelectorAll('.resp-custom.open').forEach(el => {
    if (el.id !== `respWrap-${stageCode}`) el.classList.remove('open');
  });
  document.getElementById(`respWrap-${stageCode}`)?.classList.toggle('open');
}

function selectResp(stageCode, value) {
  stageResponsibility[stageCode] = value;
  updateStageResponsibilityBadge(stageCode, value);
  document.getElementById(`respWrap-${stageCode}`)?.classList.remove('open');
}

// ── RENDER KDE STAGES ─────────────────────────────────────────
const CHEVRON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>';

function renderKDEStages() {
  const container = document.getElementById('kdeStages');
  let html = '';
  let globalIndex = 1;

  Object.entries(KDE_DATA).forEach(([stageCode, stage], si) => {
    const maxStageScore = stage.kdes.reduce((sum, k) => sum + k.weight, 0);

    html += `
      <section class="stage-section rv" style="--i:${si}" id="stage-${stageCode}">
        <div class="stage-header" onclick="toggleStage('${stageCode}')">
          <div class="stage-header-left">
            <div class="stage-code">${stageCode}</div>
            <div style="min-width:0">
              <div class="stage-name">${stage.label}</div>
              <div class="stage-desc">${stage.desc} · ${stage.kdes.length} KDEs · max ${maxStageScore} pts</div>
            </div>
          </div>
          <div class="stage-header-right">
            <div class="resp-custom" id="respWrap-${stageCode}" onclick="event.stopPropagation(); toggleRespDropdown('${stageCode}')">
              <span class="k">responsible</span>
              <span class="resp-badge" id="respBadge-${stageCode}">Seller</span>
              ${CHEVRON}
              <div class="resp-dropdown" id="respDropdown-${stageCode}">
                <div class="resp-option" onclick="event.stopPropagation(); selectResp('${stageCode}', 'seller')"><span class="resp-opt-dot" style="background:#2f6fed"></span>Seller</div>
                <div class="resp-option" onclick="event.stopPropagation(); selectResp('${stageCode}', 'buyer')"><span class="resp-opt-dot" style="background:#178a4c"></span>Buyer</div>
                <div class="resp-option" onclick="event.stopPropagation(); selectResp('${stageCode}', 'both')"><span class="resp-opt-dot" style="background:#b7791f"></span>Both</div>
              </div>
            </div>
            <div class="stage-score-badge" id="stageScore-${stageCode}">0 / ${maxStageScore}</div>
            <svg class="stage-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div class="stage-kdes">
          <div class="kde-row head">
            <span>#</span><span>key data element</span><span>data available</span><span>risk points</span><span>max</span><span>evidence</span>
          </div>
          ${stage.kdes.map(kde => {
            const idx = globalIndex++;
            return `
              <div class="kde-row" id="row-${kde.key}">
                <span class="kde-number">${String(idx).padStart(2, '0')}</span>
                <div>
                  <div class="kde-label">${kde.label}</div>
                  <label class="kde-na">
                    <input type="checkbox" id="na-${kde.key}" onchange="onNaChange('${kde.key}', this.checked)" />
                    Not applicable, exclude from scoring
                  </label>
                </div>
                <div>
                  <span class="cell-k">data available</span>
                  <div class="kde-toggle">
                    <label class="toggle-switch">
                      <input type="checkbox" id="toggle-${kde.key}" checked onchange="onToggleChange('${kde.key}', this.checked)" aria-label="Data available for ${kde.label}" />
                      <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label" id="toggleLabel-${kde.key}">YES</span>
                  </div>
                </div>
                <div>
                  <span class="cell-k">risk points</span>
                  <div class="kde-severity-select" id="sevSelect-${kde.key}">
                    <button type="button" class="kde-severity-btn none" id="sevBtn-${kde.key}" onclick="toggleSeverityDropdown('${kde.key}')">— pts ${CHEVRON}</button>
                    <div class="kde-severity-dropdown" id="sevDropdown-${kde.key}">
                      <div class="kde-severity-option" onclick="selectSeverity('${kde.key}', 0)"><span><span class="opt-dot w0"></span>No risk</span><span class="pts">0 pts</span></div>
                      <div class="kde-severity-option" onclick="selectSeverity('${kde.key}', 10)"><span><span class="opt-dot w10"></span>Low</span><span class="pts">10 pts</span></div>
                      <div class="kde-severity-option" onclick="selectSeverity('${kde.key}', 30)"><span><span class="opt-dot w30"></span>High</span><span class="pts">30 pts</span></div>
                      <div class="kde-severity-option" onclick="selectSeverity('${kde.key}', 50)"><span><span class="opt-dot w50"></span>Critical</span><span class="pts">50 pts</span></div>
                    </div>
                  </div>
                </div>
                <div class="kde-max"><span class="cell-k">max</span><b>${kde.weight}</b> pts</div>
                <div class="kde-evidence-col">
                  <span class="cell-k">evidence</span>
                  <input type="text" id="evidence-${kde.key}" placeholder="Connected documents..." oninput="kdeState['${kde.key}'].evidence = this.value" />
                </div>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  });

  container.innerHTML = html;
  document.getElementById('stage-FV')?.classList.add('open');

  Object.entries(stageResponsibility).forEach(([code, val]) => {
    updateStageResponsibilityBadge(code, val);
  });
}

// ── TOGGLE / JUMP ─────────────────────────────────────────────
function toggleStage(code) {
  document.getElementById(`stage-${code}`)?.classList.toggle('open');
}

function setAllStages(open) {
  document.querySelectorAll('.stage-section').forEach(s => s.classList.toggle('open', open));
}

function jumpToStage(code) {
  const el = document.getElementById(`stage-${code}`);
  if (!el) return;
  el.classList.add('open');
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── KDE HANDLERS ─────────────────────────────────────────────
function onToggleChange(key, checked) {
  kdeState[key].response = checked;
  document.getElementById(`toggleLabel-${key}`).textContent = checked ? 'YES' : 'NO';
  updateRowStyle(key);
  updateLiveScore();
}

function onNaChange(key, checked) {
  kdeState[key].na = checked;
  const row = document.getElementById(`row-${key}`);
  const toggle = document.getElementById(`toggle-${key}`);
  const evidence = document.getElementById(`evidence-${key}`);
  const sevBtn = document.getElementById(`sevBtn-${key}`);
  row.classList.toggle('na', checked);
  if (toggle) toggle.disabled = checked;
  if (evidence) evidence.disabled = checked;
  if (sevBtn) sevBtn.disabled = checked;
  updateLiveScore();
}

function updateRowStyle(key) {
  const label = document.getElementById(`toggleLabel-${key}`);
  if (label) label.textContent = kdeState[key].response ? 'YES' : 'NO';
}

function toggleSeverityDropdown(key) {
  document.querySelectorAll('.kde-severity-select.open').forEach(el => {
    if (el.id !== `sevSelect-${key}`) el.classList.remove('open');
  });
  document.getElementById(`sevSelect-${key}`)?.classList.toggle('open');
}

function selectSeverity(key, pts) {
  kdeState[key].points = pts;
  const btn = document.getElementById(`sevBtn-${key}`);
  const classes = { 0: 'none', 10: 'w10', 30: 'w30', 50: 'w50' };
  const labels = { 0: '— pts', 10: 'Low · 10', 30: 'High · 30', 50: 'Critical · 50' };
  btn.className = `kde-severity-btn ${classes[pts]}`;
  btn.innerHTML = `${labels[pts]} ${CHEVRON}`;
  document.getElementById(`sevSelect-${key}`)?.classList.remove('open');
  updateLiveScore();
}

// ── LIVE SCORE ────────────────────────────────────────────────
const STATUS_COLORS = { transparent: '#178a4c', low: '#2f6fed', medium: '#b7791f', critical: '#d64545' };

function updateLiveScore() {
  let totalScore = 0;
  let totalMax = 0;
  const stageScores = {};

  Object.entries(KDE_DATA).forEach(([stageCode, stage]) => {
    let stageScore = 0;
    let stageMax = 0;
    stage.kdes.forEach(kde => {
      const state = kdeState[kde.key];
      if (state.na) return;
      stageMax += kde.weight;
      totalMax += kde.weight;
      stageScore += (state.points || 0);
      totalScore += (state.points || 0);
    });
    stageScores[stageCode] = { score: stageScore, max: stageMax };
  });

  document.getElementById('liveScore').textContent = totalScore.toLocaleString();
  document.getElementById('liveMax').textContent = `/ ${totalMax.toLocaleString()} max`;
  document.getElementById('saveBarScore').textContent = `${totalScore.toLocaleString()} / ${totalMax.toLocaleString()}`;

  Object.entries(stageScores).forEach(([code, s]) => {
    const chip = document.getElementById(`scoreChip-${code}`);
    if (chip) chip.textContent = s.score;
    const bar = document.getElementById(`scoreBar-${code}`);
    if (bar) bar.style.width = s.max ? `${Math.min(100, s.score / s.max * 100)}%` : '0%';
    const badge = document.getElementById(`stageScore-${code}`);
    if (badge) badge.textContent = `${s.score} / ${s.max}`;
  });

  const status = getMriStatus(totalScore);
  const pill = document.getElementById('liveStatusPill');
  const label = document.getElementById('liveStatusLabel');
  pill.className = `mri-status-pill ${status.cls}`;
  label.textContent = status.label;

  const meter = document.getElementById('liveMeter');
  if (meter) {
    meter.style.width = totalMax ? `${Math.min(100, totalScore / totalMax * 100)}%` : '0%';
    meter.style.background = STATUS_COLORS[status.cls];
  }
}

function getMriStatus(score) {
  if (score === 0) return { label: 'Transparent', cls: 'transparent' };
  if (score < 100) return { label: 'Low Risk', cls: 'low' };
  if (score < 500) return { label: 'Medium Risk', cls: 'medium' };
  return { label: 'Critical', cls: 'critical' };
}

// ── SAVE ─────────────────────────────────────────────────────
const SAVE_LABEL = document.getElementById('btnSaveAssessment')?.innerHTML || 'Save assessment';

async function saveAssessment() {
  const orgId = document.getElementById('selectOrg').value;
  const productId = document.getElementById('selectProduct').value;
  const notes = document.getElementById('assessmentNotes').value.trim();

  if (!orgId) { showToast('Please select an organisation.', 'error'); document.getElementById('selectOrg').focus(); return; }
  if (!productId) { showToast('Please select a product.', 'error'); document.getElementById('selectProduct').focus(); return; }

  const btn = document.getElementById('btnSaveAssessment');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    let totalScore = 0;
    let totalMax = 0;
    const responses = [];

    Object.entries(KDE_DATA).forEach(([stageCode, stage]) => {
      stage.kdes.forEach(kde => {
        const state = kdeState[kde.key];
        const isApplicable = !state.na;
        const score = isApplicable ? (state.points || 0) : 0;
        if (isApplicable) {
          totalMax += kde.weight;
          totalScore += score;
        }
        responses.push({
          stage: stageCode,
          kde_key: kde.key,
          kde_label: kde.label,
          weight: kde.weight,
          is_applicable: isApplicable,
          response: state.response,
          evidence_type: state.evidence || null,
          score
        });
      });
    });

    const statusObj = getMriStatus(totalScore);
    const assessmentPayload = {
      company_id: orgId,
      product_id: productId,
      assessed_by: currentUser.id,
      assessed_at: new Date().toISOString(),
      total_score: totalScore,
      max_score: totalMax,
      status: statusObj.cls,
      notes: notes || null,
      stage_responsibility: stageResponsibility
    };

    if (existingAssessmentId) {
      await dbClient.from('mri_assessments').update(assessmentPayload).eq('id', existingAssessmentId);
      await dbClient.from('mri_responses').delete().eq('assessment_id', existingAssessmentId);
      await dbClient.from('mri_responses').insert(responses.map(r => ({ ...r, assessment_id: existingAssessmentId })));
    } else {
      const { data: assessment, error } = await dbClient.from('mri_assessments').insert(assessmentPayload).select().single();
      if (error) throw error;
      await dbClient.from('mri_responses').insert(responses.map(r => ({ ...r, assessment_id: assessment.id })));
      existingAssessmentId = assessment.id;
    }

    await logActivity('create', 'mri_assessment', existingAssessmentId, `MRI assessment saved — Score: ${totalScore}/${totalMax}`);
    showToast(`Assessment saved. Score: ${totalScore} / ${totalMax}`, 'success');
    setTimeout(() => { window.location.href = 'mri.html'; }, 1500);

  } catch (err) {
    console.error('Save error:', err);
    showToast('Failed to save assessment.', 'error');
    btn.innerHTML = SAVE_LABEL;
    btn.disabled = false;
  }
}
