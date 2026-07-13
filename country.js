/* ============================================================
   PROJECT MANHATTAN — country.js
   Handles both country.html and country-detail.html
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

let allCountries = [];
let activeContinent = 'All';

// ── CONTINENT MAP (client-side, alpha2 → continent) ──────────
const CONTINENT_MAP = {
  // Africa
  DZ:'Africa',AO:'Africa',BJ:'Africa',BW:'Africa',BF:'Africa',BI:'Africa',CV:'Africa',
  CM:'Africa',CF:'Africa',TD:'Africa',KM:'Africa',CG:'Africa',CD:'Africa',CI:'Africa',
  DJ:'Africa',EG:'Africa',GQ:'Africa',ER:'Africa',SZ:'Africa',ET:'Africa',GA:'Africa',
  GM:'Africa',GH:'Africa',GN:'Africa',GW:'Africa',KE:'Africa',LS:'Africa',LR:'Africa',
  LY:'Africa',MG:'Africa',MW:'Africa',ML:'Africa',MR:'Africa',MU:'Africa',MA:'Africa',
  MZ:'Africa',NA:'Africa',NE:'Africa',NG:'Africa',RW:'Africa',ST:'Africa',SN:'Africa',
  SC:'Africa',SL:'Africa',SO:'Africa',ZA:'Africa',SS:'Africa',SD:'Africa',TZ:'Africa',
  TG:'Africa',TN:'Africa',UG:'Africa',ZM:'Africa',ZW:'Africa',EH:'Africa',RE:'Africa',
  YT:'Africa',SH:'Africa',IO:'Africa',
  // Asia
  AF:'Asia',AM:'Asia',AZ:'Asia',BH:'Asia',BD:'Asia',BT:'Asia',BN:'Asia',KH:'Asia',
  CN:'Asia',CY:'Asia',GE:'Asia',IN:'Asia',ID:'Asia',IR:'Asia',IQ:'Asia',IL:'Asia',
  JP:'Asia',JO:'Asia',KZ:'Asia',KW:'Asia',KG:'Asia',LA:'Asia',LB:'Asia',MY:'Asia',
  MV:'Asia',MN:'Asia',MM:'Asia',NP:'Asia',KP:'Asia',OM:'Asia',PK:'Asia',PS:'Asia',
  PH:'Asia',QA:'Asia',SA:'Asia',SG:'Asia',KR:'Asia',LK:'Asia',SY:'Asia',TW:'Asia',
  TJ:'Asia',TH:'Asia',TL:'Asia',TR:'Asia',TM:'Asia',AE:'Asia',UZ:'Asia',VN:'Asia',
  YE:'Asia',HK:'Asia',MO:'Asia',
  // Europe
  AL:'Europe',AD:'Europe',AT:'Europe',BY:'Europe',BE:'Europe',BA:'Europe',BG:'Europe',
  HR:'Europe',CZ:'Europe',DK:'Europe',EE:'Europe',FI:'Europe',FR:'Europe',DE:'Europe',
  GR:'Europe',HU:'Europe',IS:'Europe',IE:'Europe',IT:'Europe',XK:'Europe',LV:'Europe',
  LI:'Europe',LT:'Europe',LU:'Europe',MT:'Europe',MD:'Europe',MC:'Europe',ME:'Europe',
  NL:'Europe',MK:'Europe',NO:'Europe',PL:'Europe',PT:'Europe',RO:'Europe',RU:'Europe',
  SM:'Europe',RS:'Europe',SK:'Europe',SI:'Europe',ES:'Europe',SE:'Europe',CH:'Europe',
  UA:'Europe',GB:'Europe',VA:'Europe',AX:'Europe',FO:'Europe',GI:'Europe',GG:'Europe',
  IM:'Europe',JE:'Europe',SJ:'Europe',
  // North America
  AG:'North America',BS:'North America',BB:'North America',BZ:'North America',
  CA:'North America',CR:'North America',CU:'North America',DM:'North America',
  DO:'North America',SV:'North America',GD:'North America',GT:'North America',
  HT:'North America',HN:'North America',JM:'North America',MX:'North America',
  NI:'North America',PA:'North America',KN:'North America',LC:'North America',
  VC:'North America',TT:'North America',US:'North America',PR:'North America',
  GP:'North America',MQ:'North America',VI:'North America',VG:'North America',
  KY:'North America',TC:'North America',BM:'North America',GL:'North America',
  PM:'North America',AW:'North America',CW:'North America',SX:'North America',
  // South America
  AR:'South America',BO:'South America',BR:'South America',CL:'South America',
  CO:'South America',EC:'South America',GY:'South America',PY:'South America',
  PE:'South America',SR:'South America',UY:'South America',VE:'South America',
  FK:'South America',GF:'South America',
  // Oceania
  AU:'Oceania',FJ:'Oceania',KI:'Oceania',MH:'Oceania',FM:'Oceania',NR:'Oceania',
  NZ:'Oceania',PW:'Oceania',PG:'Oceania',WS:'Oceania',SB:'Oceania',TO:'Oceania',
  TV:'Oceania',VU:'Oceania',CK:'Oceania',GU:'Oceania',NC:'Oceania',PF:'Oceania',
  AS:'Oceania',NU:'Oceania',MP:'Oceania',WF:'Oceania',TK:'Oceania',NF:'Oceania',
  // Antarctica
  AQ:'Antarctica',TF:'Antarctica',GS:'Antarctica',BV:'Antarctica',
};

const CONTINENT_ICONS = {
  All:'🌐', Africa:'🌍', Asia:'🌏', Europe:'🌍',
  'North America':'🌎', 'South America':'🌎', Oceania:'🌏', Antarctica:'🧊',
};
const CONTINENTS = ['All','Africa','Asia','Europe','North America','South America','Oceania','Antarctica'];

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

// ── SHARED NAV INIT ───────────────────────────────────────────
async function initNav(session) {
  const email = session.user.email || '';
  const initials = email.substring(0, 2).toUpperCase();
  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color, role, photo_url')
    .eq('id', session.user.id)
    .single();
  const firstName = profile?.first_name || email.split('@')[0];
  const avatarColor = profile?.avatar_color || '#1a6fdb';
  setNavAvatar(document.getElementById('navAvatar'), profile?.photo_url, initials, avatarColor);
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(firstName);
  setHomeLink(profile?.role);
}

// ── DETERMINE WHICH PAGE ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const session = await checkAuth();
  if (!session) return;
  await initNav(session);
  const isDetailPage = !!document.getElementById('detailContent');
  if (isDetailPage) {
    await initDetailPage();
  } else {
    await initListPage();
  }
});

// ── LIST PAGE ─────────────────────────────────────────────────
async function initListPage() {
  const { data, error } = await dbClient
    .from('countries')
    .select('*')
    .order('country');

  document.getElementById('loadingState').style.display = 'none';

  if (error || !data?.length) {
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  allCountries = data;
  document.getElementById('countryCount').textContent = `${data.length} countries`;

  // Render continent filter bar
  renderContinentFilter();
  renderCountries(getFiltered());
}

function renderContinentFilter() {
  const grid = document.getElementById('countryGrid');
  const bar = document.createElement('div');
  bar.id = 'continentBar';
  bar.innerHTML = CONTINENTS.map(c => {
    const count = c === 'All'
      ? allCountries.length
      : allCountries.filter(co => CONTINENT_MAP[co.alpha2] === c).length;
    return `<button
      id="cbtn-${c.replace(/ /g,'-')}"
      class="continent-btn${c === 'All' ? ' active' : ''}"
      onclick="setContinent('${c}')">
      ${CONTINENT_ICONS[c]} ${c}
      <span class="continent-count">${count}</span>
    </button>`;
  }).join('');
  grid.parentNode.insertBefore(bar, grid);
}

function setContinent(continent) {
  activeContinent = continent;
  CONTINENTS.forEach(c => {
    const btn = document.getElementById('cbtn-'+c.replace(/ /g,'-'));
    if (btn) btn.classList.toggle('active', c === continent);
  });
  renderCountries(getFiltered());
}

function getFiltered() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  return allCountries.filter(c => {
    const matchesContinent = activeContinent === 'All' || CONTINENT_MAP[c.alpha2] === activeContinent;
    const matchesSearch = !q ||
      c.country.toLowerCase().includes(q) ||
      c.alpha2.toLowerCase().includes(q) ||
      c.alpha3.toLowerCase().includes(q) ||
      (c.numeric && c.numeric.includes(q));
    return matchesContinent && matchesSearch;
  });
}

function renderCountries(countries) {
  const grid = document.getElementById('countryGrid');
  const empty = document.getElementById('emptyState');

  if (!countries.length) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = countries.map(c => {
    const continent = CONTINENT_MAP[c.alpha2] || '';
    return `
      <a href="country-detail.html?id=${c.id}" class="country-card">
        <img
          class="country-flag"
          src="https://flagcdn.com/w80/${c.alpha2.toLowerCase()}.png"
          alt="${c.country} flag"
          onerror="this.style.display='none'"
        />
        <div class="country-card-name">${c.country}</div>
        <div class="country-card-codes">
          <span class="code-tag">${c.alpha2}</span>
          <span class="code-tag">${c.alpha3}</span>
          <span class="code-tag numeric">${c.numeric}</span>
          ${continent?`<span class="code-tag continent">${CONTINENT_ICONS[continent]||''} ${continent}</span>`:''}
        </div>
      </a>
    `;
  }).join('');
}

function filterCountries(query) {
  renderCountries(getFiltered());
}

// ── DETAIL PAGE ───────────────────────────────────────────────
async function initDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { window.location.href = 'country.html'; return; }

  const { data, error } = await dbClient
    .from('countries')
    .select('*')
    .eq('id', id)
    .single();

  document.getElementById('loadingState').style.display = 'none';

  if (error || !data) { window.location.href = 'country.html'; return; }

  document.title = `${data.country} — Project Manhattan`;

  const continent = CONTINENT_MAP[data.alpha2] || '';

  document.getElementById('countryFlag').src = `https://flagcdn.com/w160/${data.alpha2.toLowerCase()}.png`;
  document.getElementById('countryFlag').alt = `${data.country} flag`;
  document.getElementById('countryName').textContent = data.country;
  document.getElementById('alpha2Chip').textContent = `Alpha-2: ${data.alpha2}`;
  document.getElementById('alpha3Chip').textContent = `Alpha-3: ${data.alpha3}`;
  document.getElementById('numericChip').textContent = `Numeric: ${data.numeric}`;
  document.getElementById('d-country').textContent = data.country;
  document.getElementById('d-alpha2').textContent = data.alpha2;
  document.getElementById('d-alpha3').textContent = data.alpha3;
  document.getElementById('d-numeric').textContent = data.numeric;

  // Add continent field if element exists
  const contEl = document.getElementById('d-continent');
  if (contEl) contEl.textContent = continent ? `${CONTINENT_ICONS[continent]} ${continent}` : '—';


  // ── Flag of Convenience ──
  const focEl = document.getElementById('foc-status');
  if (focEl) {
    if (data.is_foc === true) {
      focEl.innerHTML = '<span class="foc-badge yes">🚩 Yes — Flag of Convenience</span>';
    } else if (data.is_foc === false) {
      focEl.innerHTML = '<span class="foc-badge no">✓ Not a Flag of Convenience</span>';
    } else { focEl.textContent = '—'; }
  }

  // ── Modern Slavery Index ──
  const setMsiBar = (barId, valId, value, max) => {
    const bar = document.getElementById(barId), val = document.getElementById(valId);
    if (!bar || !val) return;
    if (value !== null && value !== undefined) { bar.style.width = Math.min((value/max)*100,100).toFixed(1)+'%'; val.textContent = value; }
    else { val.textContent = '—'; }
  };
  setMsiBar('msi-prev-bar','msi-prevalence', data.msi_prevalence, 50);
  setMsiBar('msi-vuln-bar','msi-vulnerability', data.msi_vulnerability, 100);
  setMsiBar('msi-gov-bar','msi-gov-response', data.msi_gov_response, 100);
  if (data.msi_year) { const e=document.getElementById('msi-year-label'); if(e) e.textContent='Source: Walk Free Global Slavery Index '+data.msi_year; }
  if (data.msi_url)  { const e=document.getElementById('msi-url');  if(e){ e.href=data.msi_url; e.style.display='inline-flex'; } }

  // ── IUU Fishing Index ──
  if (data.iuu_score !== null && data.iuu_score !== undefined) {
    const iS=document.getElementById('iuu-score'), iB=document.getElementById('iuu-bar'), iBadge=document.getElementById('iuu-risk-badge');
    if (iS) iS.textContent = data.iuu_score;
    if (iB) iB.style.width = Math.min(data.iuu_score,100)+'%';
    if (iBadge) {
      iBadge.style.display='inline-flex';
      if (data.iuu_score>=60)      { iBadge.textContent='High Risk';   iBadge.className='foc-badge yes'; }
      else if (data.iuu_score>=35) { iBadge.textContent='Medium Risk'; iBadge.style.cssText='display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:700;background:#fffbeb;color:#d97706;border:1.5px solid #fde68a;'; }
      else                          { iBadge.textContent='Low Risk';    iBadge.className='foc-badge no'; }
    }
    if (data.iuu_year) { const e=document.getElementById('iuu-year-label'); if(e) e.textContent='IUU Fishing Index '+data.iuu_year; }
  }
  if (data.iuu_url) { const e=document.getElementById('iuu-url'); if(e){ e.href=data.iuu_url; e.style.display='inline-flex'; } }

    document.getElementById('detailContent').classList.remove('hidden');
}