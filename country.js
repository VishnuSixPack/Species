// country.js — List + Detail page logic
// Works for both country.html (list) and country-detail.html (detail)

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

// ── CONTINENT DATA ─────────────────────────────────────────────
const CONTINENT_ICONS = {
  'Africa': '🌍', 'Antarctica': '🧊', 'Asia': '🌏',
  'Europe': '🌍', 'North America': '🌎', 'Oceania': '🌏',
  'South America': '🌎', 'All': '🌐'
};

const CONTINENTS = ['All','Africa','Antarctica','Asia','Europe','North America','Oceania','South America'];

const CONTINENT_MAP = {
  AF:'Africa',AX:'Europe',AL:'Europe',DZ:'Africa',AS:'Oceania',AD:'Europe',AO:'Africa',AI:'North America',AQ:'Antarctica',AG:'North America',AR:'South America',AM:'Asia',AW:'North America',AU:'Oceania',AT:'Europe',AZ:'Asia',BS:'North America',BH:'Asia',BD:'Asia',BB:'North America',BY:'Europe',BE:'Europe',BZ:'North America',BJ:'Africa',BM:'North America',BT:'Asia',BO:'South America',BQ:'North America',BA:'Europe',BW:'Africa',BV:'Antarctica',BR:'South America',IO:'Asia',BN:'Asia',BG:'Europe',BF:'Africa',BI:'Africa',CV:'Africa',KH:'Asia',CM:'Africa',CA:'North America',KY:'North America',CF:'Africa',TD:'Africa',CL:'South America',CN:'Asia',CX:'Asia',CC:'Asia',CO:'South America',KM:'Africa',CG:'Africa',CD:'Africa',CK:'Oceania',CR:'North America',CI:'Africa',HR:'Europe',CU:'North America',CW:'North America',CY:'Asia',CZ:'Europe',DK:'Europe',DJ:'Africa',DM:'North America',DO:'North America',EC:'South America',EG:'Africa',SV:'North America',GQ:'Africa',ER:'Africa',EE:'Europe',SZ:'Africa',ET:'Africa',FK:'South America',FO:'Europe',FJ:'Oceania',FI:'Europe',FR:'Europe',GF:'South America',PF:'Oceania',TF:'Antarctica',GA:'Africa',GM:'Africa',GE:'Asia',DE:'Europe',GH:'Africa',GI:'Europe',GR:'Europe',GL:'North America',GD:'North America',GP:'North America',GU:'Oceania',GT:'North America',GG:'Europe',GN:'Africa',GW:'Africa',GY:'South America',HT:'North America',HM:'Antarctica',VA:'Europe',HN:'North America',HK:'Asia',HU:'Europe',IS:'Europe',IN:'Asia',ID:'Asia',IR:'Asia',IQ:'Asia',IE:'Europe',IM:'Europe',IL:'Asia',IT:'Europe',JM:'North America',JP:'Asia',JE:'Europe',JO:'Asia',KZ:'Asia',KE:'Africa',KI:'Oceania',KP:'Asia',KR:'Asia',KW:'Asia',KG:'Asia',LA:'Asia',LV:'Europe',LB:'Asia',LS:'Africa',LR:'Africa',LY:'Africa',LI:'Europe',LT:'Europe',LU:'Europe',MO:'Asia',MG:'Africa',MW:'Africa',MY:'Asia',MV:'Asia',ML:'Africa',MT:'Europe',MH:'Oceania',MQ:'North America',MR:'Africa',MU:'Africa',YT:'Africa',MX:'North America',FM:'Oceania',MD:'Europe',MC:'Europe',MN:'Asia',ME:'Europe',MS:'North America',MA:'Africa',MZ:'Africa',MM:'Asia',NA:'Africa',NR:'Oceania',NP:'Asia',NL:'Europe',NC:'Oceania',NZ:'Oceania',NI:'North America',NE:'Africa',NG:'Africa',NU:'Oceania',NF:'Oceania',MK:'Europe',MP:'Oceania',NO:'Europe',OM:'Asia',PK:'Asia',PW:'Oceania',PS:'Asia',PA:'North America',PG:'Oceania',PY:'South America',PE:'South America',PH:'Asia',PN:'Oceania',PL:'Europe',PT:'Europe',PR:'North America',QA:'Asia',RE:'Africa',RO:'Europe',RU:'Europe',RW:'Africa',BL:'North America',SH:'Africa',KN:'North America',LC:'North America',MF:'North America',PM:'North America',VC:'North America',WS:'Oceania',SM:'Europe',ST:'Africa',SA:'Asia',SN:'Africa',RS:'Europe',SC:'Africa',SL:'Africa',SG:'Asia',SX:'North America',SK:'Europe',SI:'Europe',SB:'Oceania',SO:'Africa',ZA:'Africa',GS:'Antarctica',SS:'Africa',ES:'Europe',LK:'Asia',SD:'Africa',SR:'South America',SJ:'Europe',SE:'Europe',CH:'Europe',SY:'Asia',TW:'Asia',TJ:'Asia',TZ:'Africa',TH:'Asia',TL:'Asia',TG:'Africa',TK:'Oceania',TO:'Oceania',TT:'North America',TN:'Africa',TR:'Asia',TM:'Asia',TC:'North America',TV:'Oceania',UG:'Africa',UA:'Europe',AE:'Asia',GB:'Europe',US:'North America',UM:'Oceania',UY:'South America',UZ:'Asia',VU:'Oceania',VE:'South America',VN:'Asia',VG:'North America',VI:'North America',WF:'Oceania',EH:'Africa',YE:'Asia',ZM:'Africa',ZW:'Africa'
};

let allCountries = [];
let activeContinent = 'All';
let euOnly = false;
const EU_COUNTRIES = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];

// ── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const isDetail = !!new URLSearchParams(window.location.search).get('id');
  if (isDetail) {
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

function setEUFilter(checked) {
  euOnly = checked;
  const countEl = document.getElementById('filterCount');
  if (countEl) { countEl.textContent = checked ? '1' : ''; countEl.classList.toggle('hidden', !checked); }
  renderCountries(getFiltered());
}

function getFiltered() {
  return allCountries.filter(c => {
    const continentMatch = activeContinent === 'All' || CONTINENT_MAP[c.alpha2] === activeContinent;
    const euMatch = !euOnly || EU_COUNTRIES.includes(c.alpha2);
    return continentMatch && euMatch;
  });
}

function filterCountries(q) {
  const filtered = allCountries.filter(c =>
    c.country?.toLowerCase().includes(q.toLowerCase()) ||
    c.alpha2?.toLowerCase().includes(q.toLowerCase()) ||
    c.alpha3?.toLowerCase().includes(q.toLowerCase())
  );
  renderCountries(filtered);
}

function toggleFilterMenu() {
  document.getElementById('filterMenu')?.classList.toggle('hidden');
}

function renderCountries(countries) {
  const grid = document.getElementById('countryGrid');
  document.getElementById('loadingState').style.display = 'none';

  if (!countries?.length) {
    grid.classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  document.getElementById('emptyState').classList.add('hidden');
  grid.classList.remove('hidden');

  grid.innerHTML = countries.map(c => {
    const continent = CONTINENT_MAP[c.alpha2] || '';
    const icon = CONTINENT_ICONS[continent] || '🌐';
    return `
      <div class="country-card" onclick="window.location.href='country-detail.html?id=${c.id}'">
        <div class="country-card-flag">
          <img src="https://flagcdn.com/w80/${c.alpha2?.toLowerCase()}.png" alt="${c.country} flag" loading="lazy"/>
        </div>
        <div class="country-card-body">
          <div class="country-card-name">${c.country}</div>
          <div class="country-card-codes">
            <span class="code-chip small">${c.alpha2}</span>
            <span class="code-chip small">${c.alpha3}</span>
            <span class="continent-tag">${icon} ${continent}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── DETAIL PAGE ────────────────────────────────────────────────
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

  const contEl = document.getElementById('d-continent');
  if (contEl) contEl.textContent = continent ? `${CONTINENT_ICONS[continent]} ${continent}` : '—';

  // ── General Information ──
  const sf = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
  sf('gi-capital',   data.capital);
  sf('gi-currency',  data.currency ? `${data.currency}${data.currency_code ? ' ('+data.currency_code+')' : ''}` : null);
  sf('gi-languages', Array.isArray(data.languages) ? data.languages.join(', ') : data.languages);
  sf('gi-region',    data.region || continent);
  sf('gi-decimal',   data.decimal_format);
  sf('gi-timezone',  Array.isArray(data.timezones) ? data.timezones.join(', ') : data.timezones);

  // ── Flag of Convenience ──
  const focEl = document.getElementById('foc-status');
  if (focEl) {
    if (data.is_foc === true)       focEl.innerHTML = '<span class="foc-badge yes">🚩 Yes — Flag of Convenience</span>';
    else if (data.is_foc === false) focEl.innerHTML = '<span class="foc-badge no">✓ Not a Flag of Convenience</span>';
    else                            focEl.textContent = '—';
  }

  // ── Modern Slavery Index ──
  const setBar = (barId, valId, value, max) => {
    const bar = document.getElementById(barId), val = document.getElementById(valId);
    if (!bar || !val) return;
    if (value !== null && value !== undefined) { bar.style.width = Math.min((value/max)*100,100).toFixed(1)+'%'; val.textContent = value; }
    else { val.textContent = '—'; }
  };
  setBar('msi-prev-bar', 'msi-prevalence',  data.msi_prevalence,  50);
  setBar('msi-vuln-bar', 'msi-vulnerability', data.msi_vulnerability, 100);
  setBar('msi-gov-bar',  'msi-gov-response', data.msi_gov_response, 100);
  if (data.msi_year) { const e = document.getElementById('msi-year-label'); if (e) e.textContent = 'Source: Walk Free Global Slavery Index ' + data.msi_year; }
  if (data.msi_url)  { const e = document.getElementById('msi-url');  if (e) { e.href = data.msi_url; e.style.display = 'inline-flex'; } }

  // ── IUU Fishing Index ──
  if (data.iuu_score !== null && data.iuu_score !== undefined) {
    const iS = document.getElementById('iuu-score'), iB = document.getElementById('iuu-bar'), iBadge = document.getElementById('iuu-risk-badge');
    if (iS) iS.textContent = data.iuu_score;
    if (iB) iB.style.width = Math.min(data.iuu_score, 100) + '%';
    if (iBadge) {
      iBadge.style.display = 'inline-flex';
      if      (data.iuu_score >= 60) { iBadge.textContent = 'High Risk';   iBadge.className = 'foc-badge yes'; }
      else if (data.iuu_score >= 35) { iBadge.textContent = 'Medium Risk'; iBadge.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:700;background:#fffbeb;color:#d97706;border:1.5px solid #fde68a;'; }
      else                            { iBadge.textContent = 'Low Risk';    iBadge.className = 'foc-badge no'; }
    }
    if (data.iuu_year) { const e = document.getElementById('iuu-year-label'); if (e) e.textContent = 'IUU Fishing Index ' + data.iuu_year; }
  }
  if (data.iuu_url) { const e = document.getElementById('iuu-url'); if (e) { e.href = data.iuu_url; e.style.display = 'inline-flex'; } }

  document.getElementById('detailContent').classList.remove('hidden');
  loadCountryMap(data.alpha3, data.country);
}

// ── COUNTRY MAP ────────────────────────────────────────────────
let countryMap = null;
const faoLayer = null, eezLayer = null, highSeasLayer = null;
let eezScope = 'country';

function loadCountryMap(alpha3, countryName) {
  const mapEl = document.getElementById('countryMap');
  if (!mapEl) return;
  if (countryMap) { countryMap.remove(); countryMap = null; }

  countryMap = L.map('countryMap', { zoomControl: true, scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18
  }).addTo(countryMap);

  // Load country boundary via GeoJSON (nominatim-based)
  const url = `https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(countryName)}&format=json&limit=1&featuretype=country`;
  fetch(url, { headers: { 'Accept-Language': 'en' } })
    .then(r => r.json())
    .then(results => {
      if (results && results[0]) {
        const lat = parseFloat(results[0].lat);
        const lon = parseFloat(results[0].lon);
        const zoom = results[0].importance > 0.7 ? 4 : results[0].importance > 0.5 ? 5 : 6;
        countryMap.setView([lat, lon], zoom);
        L.marker([lat, lon]).addTo(countryMap).bindPopup(`<strong>${countryName}</strong>`);
        document.getElementById('mapNote').textContent = '';
      } else {
        countryMap.setView([20, 0], 2);
      }
    })
    .catch(() => countryMap.setView([20, 0], 2));
}

function toggleFao(btn) { btn.classList.toggle('active'); updateMapLegend(); }
function toggleEez(btn) {
  btn.classList.toggle('active');
  const wrap = document.getElementById('eezScopeWrap');
  if (wrap) wrap.classList.toggle('hidden', !btn.classList.contains('active'));
  updateMapLegend();
}
function toggleHighSeas(btn) { btn.classList.toggle('active'); updateMapLegend(); }
function setEezScope(scope, btn) {
  eezScope = scope;
  document.querySelectorAll('.eez-scope-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function updateMapLegend() {
  const legend = document.getElementById('mapLegend');
  const faoActive = document.querySelector('.map-toggle:nth-child(1)')?.classList.contains('active');
  const eezActive = document.querySelector('.map-toggle:nth-child(2)')?.classList.contains('active');
  const hsActive  = document.querySelector('.map-toggle:nth-child(3)')?.classList.contains('active');
  if (legend) legend.classList.toggle('hidden', !faoActive && !eezActive && !hsActive);
  const lFao = document.getElementById('legendFao');
  const lEez = document.getElementById('legendEez');
  const lHs  = document.getElementById('legendHighseas');
  if (lFao) lFao.classList.toggle('hidden', !faoActive);
  if (lEez) lEez.classList.toggle('hidden', !eezActive);
  if (lHs)  lHs.classList.toggle('hidden', !hsActive);
}

// ── SEARCH (detail page back button) ─────────────────────────
function filterCountriesDetail(q) {
  // Used if search is present on detail page
}