// country.js — List + Detail page logic

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

// ── CONTINENT DATA ─────────────────────────────────────────────
const CONTINENT_ICONS = {}; /* emoji set removed; the list shows a line globe instead */
const GLOBE_IC = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"/></svg>';

const CONTINENTS = ['All','Africa','Antarctica','Asia','Europe','North America','Oceania','South America'];

const CONTINENT_MAP = {
  AF:'Asia',AX:'Europe',AL:'Europe',DZ:'Africa',AS:'Oceania',AD:'Europe',AO:'Africa',AI:'North America',AQ:'Antarctica',AG:'North America',AR:'South America',AM:'Asia',AW:'North America',AU:'Oceania',AT:'Europe',AZ:'Asia',BS:'North America',BH:'Asia',BD:'Asia',BB:'North America',BY:'Europe',BE:'Europe',BZ:'North America',BJ:'Africa',BM:'North America',BT:'Asia',BO:'South America',BQ:'North America',BA:'Europe',BW:'Africa',BV:'Antarctica',BR:'South America',IO:'Asia',BN:'Asia',BG:'Europe',BF:'Africa',BI:'Africa',CV:'Africa',KH:'Asia',CM:'Africa',CA:'North America',KY:'North America',CF:'Africa',TD:'Africa',CL:'South America',CN:'Asia',CX:'Asia',CC:'Asia',CO:'South America',KM:'Africa',CG:'Africa',CD:'Africa',CK:'Oceania',CR:'North America',CI:'Africa',HR:'Europe',CU:'North America',CW:'North America',CY:'Asia',CZ:'Europe',DK:'Europe',DJ:'Africa',DM:'North America',DO:'North America',EC:'South America',EG:'Africa',SV:'North America',GQ:'Africa',ER:'Africa',EE:'Europe',SZ:'Africa',ET:'Africa',FK:'South America',FO:'Europe',FJ:'Oceania',FI:'Europe',FR:'Europe',GF:'South America',PF:'Oceania',TF:'Antarctica',GA:'Africa',GM:'Africa',GE:'Asia',DE:'Europe',GH:'Africa',GI:'Europe',GR:'Europe',GL:'North America',GD:'North America',GP:'North America',GU:'Oceania',GT:'North America',GG:'Europe',GN:'Africa',GW:'Africa',GY:'South America',HT:'North America',HM:'Antarctica',VA:'Europe',HN:'North America',HK:'Asia',HU:'Europe',IS:'Europe',IN:'Asia',ID:'Asia',IR:'Asia',IQ:'Asia',IE:'Europe',IM:'Europe',IL:'Asia',IT:'Europe',JM:'North America',JP:'Asia',JE:'Europe',JO:'Asia',KZ:'Asia',KE:'Africa',KI:'Oceania',KP:'Asia',KR:'Asia',KW:'Asia',KG:'Asia',LA:'Asia',LV:'Europe',LB:'Asia',LS:'Africa',LR:'Africa',LY:'Africa',LI:'Europe',LT:'Europe',LU:'Europe',MO:'Asia',MG:'Africa',MW:'Africa',MY:'Asia',MV:'Asia',ML:'Africa',MT:'Europe',MH:'Oceania',MQ:'North America',MR:'Africa',MU:'Africa',YT:'Africa',MX:'North America',FM:'Oceania',MD:'Europe',MC:'Europe',MN:'Asia',ME:'Europe',MS:'North America',MA:'Africa',MZ:'Africa',MM:'Asia',NA:'Africa',NR:'Oceania',NP:'Asia',NL:'Europe',NC:'Oceania',NZ:'Oceania',NI:'North America',NE:'Africa',NG:'Africa',NU:'Oceania',NF:'Oceania',MK:'Europe',MP:'Oceania',NO:'Europe',OM:'Asia',PK:'Asia',PW:'Oceania',PS:'Asia',PA:'North America',PG:'Oceania',PY:'South America',PE:'South America',PH:'Asia',PN:'Oceania',PL:'Europe',PT:'Europe',PR:'North America',QA:'Asia',RE:'Africa',RO:'Europe',RU:'Europe',RW:'Africa',BL:'North America',SH:'Africa',KN:'North America',LC:'North America',MF:'North America',PM:'North America',VC:'North America',WS:'Oceania',SM:'Europe',ST:'Africa',SA:'Asia',SN:'Africa',RS:'Europe',SC:'Africa',SL:'Africa',SG:'Asia',SX:'North America',SK:'Europe',SI:'Europe',SB:'Oceania',SO:'Africa',ZA:'Africa',GS:'Antarctica',SS:'Africa',ES:'Europe',LK:'Asia',SD:'Africa',SR:'South America',SJ:'Europe',SE:'Europe',CH:'Europe',SY:'Asia',TW:'Asia',TJ:'Asia',TZ:'Africa',TH:'Asia',TL:'Asia',TG:'Africa',TK:'Oceania',TO:'Oceania',TT:'North America',TN:'Africa',TR:'Asia',TM:'Asia',TC:'North America',TV:'Oceania',UG:'Africa',UA:'Europe',AE:'Asia',GB:'Europe',US:'North America',UM:'Oceania',UY:'South America',UZ:'Asia',VU:'Oceania',VE:'South America',VN:'Asia',VG:'North America',VI:'North America',WF:'Oceania',EH:'Africa',YE:'Asia',ZM:'Africa',ZW:'Africa'
};

const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

// ── LIST PAGE ──────────────────────────────────────────────────
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
  const host = document.getElementById('continentHost');
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
      ${c}
      <span class="continent-count">${count}</span>
    </button>`;
  }).join('');
  host.appendChild(bar);
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

let searchQuery = '';
function getFiltered() {
  const q = searchQuery;
  return allCountries.filter(c => {
    const continentMatch = activeContinent === 'All' || CONTINENT_MAP[c.alpha2] === activeContinent;
    const euMatch = !euOnly || EU_COUNTRIES.includes(c.alpha2);
    const qMatch = !q || [c.country, c.alpha2, c.alpha3].some(v => (v || '').toLowerCase().includes(q));
    return continentMatch && euMatch && qMatch;
  });
}

function filterCountries(q) {
  searchQuery = (q || '').toLowerCase().trim();
  renderCountries(getFiltered());
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

  const countEl = document.getElementById('countryCount');
  if (countEl) countEl.textContent = countries.length === allCountries.length ? `${allCountries.length} countries` : `${countries.length} of ${allCountries.length}`;
  grid.innerHTML = countries.map((c, i) => {
    const continent = CONTINENT_MAP[c.alpha2] || '';
    return `
      <div class="country-card" style="animation-delay:${Math.min(i, 24) * 15}ms" onclick="window.location.href='country-detail.html?id=${encodeURIComponent(c.id)}'">
        <div class="country-card-flag">
          <img src="https://flagcdn.com/w80/${(c.alpha2 || '').toLowerCase()}.png" alt="" loading="lazy"/>
        </div>
        <div class="country-card-name">${_esc(c.country)}</div>
        <div class="country-card-codes">
          <span class="code-chip small">${_esc(c.alpha2)}</span>
          <span class="code-chip small">${_esc(c.alpha3)}</span>
        </div>
        ${continent ? `<span class="continent-tag">${GLOBE_IC}${continent}</span>` : ''}
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

  document.title = `${data.country} · SmarTuna concept`;
  const crumb = document.getElementById('crumbName'); if (crumb) crumb.textContent = data.country;

  const continent = CONTINENT_MAP[data.alpha2] || '';

  document.getElementById('countryFlag').src = `https://flagcdn.com/w160/${data.alpha2.toLowerCase()}.png`;
  document.getElementById('countryFlag').alt = `${data.country} flag`;
  document.getElementById('countryName').textContent = data.country;
  document.getElementById('alpha2Chip').textContent = `Alpha-2: ${data.alpha2}`;
  document.getElementById('alpha3Chip').textContent = `Alpha-3: ${data.alpha3}`;
  document.getElementById('numericChip').textContent = `Numeric: ${data.numeric}`;
  const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  setEl('d-country', data.country);
  setEl('d-alpha2', data.alpha2);
  setEl('d-alpha3', data.alpha3);
  setEl('d-numeric', data.numeric);

  const contEl = document.getElementById('d-continent');
  if (contEl) { if (continent) contEl.textContent = continent; else contEl.style.display = 'none'; }

  // ── General Information ──
  populateGeneralInfo(data);

  // ── Flag of Convenience ──
  const focEl = document.getElementById('foc-status');
  const focWidget = document.getElementById('foc-widget');
  if (focEl) {
    if (data.is_foc === true) {
      focEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>Yes';
      focEl.style.color = 'var(--crit)';
      if (focWidget) focWidget.className = 'widget widget-foc';
    } else if (data.is_foc === false) {
      focEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>No';
      focEl.style.color = 'var(--ok)';
      if (focWidget) focWidget.className = 'widget widget-foc foc-no';
    } else {
      focEl.textContent = '—';
    }
  }

  // ── Modern Slavery Index ──
  const setBar = (barId, valId, value, max) => {
    const bar = document.getElementById(barId), val = document.getElementById(valId);
    if (!bar || !val) return;
    if (value !== null && value !== undefined) {
      bar.style.width = Math.min((value / max) * 100, 100).toFixed(1) + '%';
      val.textContent = value;
    } else { val.textContent = '—'; }
  };
  setBar('msi-prev-bar', 'msi-prevalence',   data.msi_prevalence,   50);
  setBar('msi-vuln-bar', 'msi-vulnerability', data.msi_vulnerability, 100);
  setBar('msi-gov-bar',  'msi-gov-response',  data.msi_gov_response,  100);
  if (data.msi_year) { const e = document.getElementById('msi-year-label'); if (e) e.textContent = 'Source: Walk Free Global Slavery Index ' + data.msi_year; }
  if (data.msi_url)  { const e = document.getElementById('msi-url');  if (e) { e.href = data.msi_url; e.style.display = 'inline-flex'; } }

  // ── IUU Fishing Index ──
  if (data.iuu_score !== null && data.iuu_score !== undefined) {
    const iS = document.getElementById('iuu-score'), iB = document.getElementById('iuu-bar'), iBadge = document.getElementById('iuu-risk-badge');
    if (iS) iS.textContent = data.iuu_score;
    if (iB) { iB.style.width = Math.min(data.iuu_score, 100) + '%'; }
    if (iBadge) {
      iBadge.style.display = 'inline-flex';
      if      (data.iuu_score >= 60) { iBadge.textContent = 'High risk';   iBadge.className = 'foc-badge yes'; }
      else if (data.iuu_score >= 35) { iBadge.textContent = 'Medium risk'; iBadge.className = 'foc-badge mid'; }
      else                            { iBadge.textContent = 'Low risk';    iBadge.className = 'foc-badge no'; }
    }
    if (data.iuu_year) { const e = document.getElementById('iuu-year-label'); if (e) e.textContent = 'IUU Fishing Index ' + data.iuu_year; }
  }
  if (data.iuu_url) { const e = document.getElementById('iuu-url'); if (e) { e.href = data.iuu_url; e.style.display = 'inline-flex'; } }

  populateFiti(data);

  document.getElementById('detailContent').classList.remove('hidden');

  // show country on map
  loadCountryMap(data.alpha3, data.country);

  // load vessels and ports for this country
  if (typeof loadVesselsAndPorts === 'function') {
    loadVesselsAndPorts(data.alpha2, data.alpha3, data.country);
  }
}

// ── FiTI (saved by country-edit.html; the card was never filled before) ──
function populateFiti(d) {
  const card = document.getElementById('fitiCard');
  if (!card) return;
  const has = d.fiti_participation !== null && d.fiti_participation !== undefined || d.fiti_fis || d.fiti_status || d.fiti_url;
  if (!has) return;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
  set('fiti-participation', d.fiti_participation === true ? 'Yes' : d.fiti_participation === false ? 'No' : null);
  set('fiti-fis', d.fiti_fis);
  set('fiti-status', d.fiti_status);
  if (d.fiti_url) { const a = document.getElementById('fiti-url'); if (a) { a.href = d.fiti_url; a.style.display = 'inline-flex'; } }
  card.style.display = '';
}

// ── GENERAL INFORMATION ────────────────────────────────────────
function populateGeneralInfo(d) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v && String(v).trim()) ? v : '—'; };
  set('gi-capital', d.capital);
  const cur = [d.currency_name, d.currency_symbol ? `(${d.currency_symbol})` : '', d.currency_code ? `· ${d.currency_code}` : '']
    .filter(Boolean).join(' ');
  set('gi-currency', cur);
  set('gi-languages', d.languages);
  set('gi-region', [d.region, d.subregion].filter(Boolean).join(' · '));
  set('gi-decimal', d.decimal_example);
  document.getElementById('gi-timezone').textContent = formatTimeZone(d.timezone_iana, d.tz_multiple);
}

function utcLabel(min) {
  const s = min < 0 ? '-' : '+';
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return 'UTC' + s + h + (m ? ':' + String(m).padStart(2, '0') : '');
}

function zoneOffsetMinutes(date, timeZone) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date);
  const tn = (p.find(x => x.type === 'timeZoneName') || {}).value || 'GMT';
  const m = tn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

function formatTimeZone(iana, multiple) {
  if (!iana) return '—';
  try {
    const now = new Date();
    const diff = zoneOffsetMinutes(now, iana) - (-now.getTimezoneOffset());
    let rel;
    if (diff === 0) rel = 'same as your time';
    else {
      const sign = diff > 0 ? '+' : '−';
      const a = Math.abs(diff), h = Math.floor(a / 60), m = a % 60;
      rel = sign + h + 'h' + (m ? ' ' + m + 'm' : '') + ' from you';
    }
    return utcLabel(zoneOffsetMinutes(now, iana)) + ' (' + rel + ')' + (multiple ? ' · multiple zones' : '');
  } catch (e) {
    return iana;
  }
}

// ── COUNTRY MAP ────────────────────────────────────────────────
let countryMap = null;
let countryBase = null;
let countryLayer = null;
let currentAlpha3 = null;
let currentCountryName = null;

async function loadCountryMap(alpha3, countryName) {
  currentAlpha3 = alpha3;
  currentCountryName = countryName;
  const el = document.getElementById('countryMap');
  if (!el) return;

  if (!countryMap) {
    countryMap = L.map('countryMap', {
      zoomControl: true, attributionControl: true,
      dragging: true, scrollWheelZoom: true,
      doubleClickZoom: true, touchZoom: true,
      keyboard: false, minZoom: 1, maxZoom: 7
    });
    setTimeout(() => countryMap.invalidateSize(), 200);


  }

  if (countryBase)  { countryMap.removeLayer(countryBase);  countryBase = null; }
  if (countryLayer) { countryMap.removeLayer(countryLayer); countryLayer = null; }
  document.getElementById('mapNote').textContent = '';

  try {
    const geo = await (await fetch('countries.geo.json')).json();

    // gray base — every country
    countryBase = L.geoJSON(geo, {
      interactive: false,
      style: { color: '#ffffff', weight: 1, fillColor: '#dfe3ea', fillOpacity: 1 }
    }).addTo(countryMap);

    const feature = geo.features.find(f => f.id === alpha3);

    if (feature) {
      countryLayer = L.geoJSON(feature, {
        interactive: false,
        style: { color: '#2560d6', weight: 1.2, fillColor: '#2f6fed', fillOpacity: 0.9 }
      }).addTo(countryMap);

      countryMap.fitBounds(countryLayer.getBounds(), { padding: [40, 40], maxZoom: 6 });

      const area = feature.properties && feature.properties.area_km2;
      const areaText = area ? area.toLocaleString('en-US') + ' km²' : '';
      countryLayer.bindTooltip(
        `<span class="cml-name">${countryName.toUpperCase()}</span>` +
        (areaText ? `<span class="cml-area">${areaText}</span>` : ''),
        { permanent: true, direction: 'right', className: 'country-map-label', offset: [12, 0] }
      ).openTooltip();
      return;
    }

    // Fallback for small territories
    const hits = await (await fetch(
      `https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(countryName)}&format=json&limit=1`
    )).json();

    if (hits && hits.length) {
      const h = hits[0], bb = h.boundingbox.map(Number);
      countryMap.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { padding: [30, 30], maxZoom: 8 });
      countryLayer = L.circleMarker([+h.lat, +h.lon], {
        radius: 8, color: '#2f6fed', fillColor: '#2f6fed', fillOpacity: 0.6
      }).addTo(countryMap);
      document.getElementById('mapNote').textContent = 'Approximate location shown.';
    } else {
      document.getElementById('mapNote').textContent = 'Map not available for this country.';
    }
  } catch (e) {
    document.getElementById('mapNote').textContent = 'Map could not be loaded.';
  }
}

// ── MAP OVERLAY LAYERS ────────────────────────────────────────
let faoWmsLayer    = null;
let eezWmsLayer    = null;
let highSeasWmsLayer = null;
let eezScope = 'country'; // 'country' or 'all'

function toggleFao(btn) {
  if (!countryMap) return;
  btn.classList.toggle('active');
  if (faoWmsLayer) { countryMap.removeLayer(faoWmsLayer); faoWmsLayer = null; }
  if (btn.classList.contains('active')) {
    // OpenSeaMap FAO areas via VLIZ WMS — publicly accessible
    faoWmsLayer = L.tileLayer.wms('https://geo.vliz.be/geoserver/MarineRegions/wms', {
      layers: 'MarineRegions:fao',
      format: 'image/png',
      transparent: true,
      opacity: 0.5,
      attribution: '© Marine Regions / FAO'
    }).addTo(countryMap);
  }
  updateMapLegend();
}

function toggleEez(btn) {
  if (!countryMap) return;
  btn.classList.toggle('active');
  const wrap = document.getElementById('eezScopeWrap');
  if (wrap) wrap.classList.toggle('hidden', !btn.classList.contains('active'));
  refreshEez();
  updateMapLegend();
}

function setEezScope(scope, btn) {
  eezScope = scope;
  document.querySelectorAll('.eez-scope-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  refreshEez();
}

function refreshEez() {
  if (eezWmsLayer) { countryMap.removeLayer(eezWmsLayer); eezWmsLayer = null; }
  const eezBtn = document.getElementById('eezToggle') || document.querySelector('.map-toggle:nth-child(2)');
  if (!eezBtn || !eezBtn.classList.contains('active')) return;

  if (eezScope === 'country' && currentAlpha3) {
    // Filter EEZ to this country using CQL filter
    eezWmsLayer = L.tileLayer.wms('https://geo.vliz.be/geoserver/MarineRegions/wms', {
      layers: 'MarineRegions:eez',
      format: 'image/png',
      transparent: true,
      opacity: 0.55,
      CQL_FILTER: `iso_ter1='${currentAlpha3}'`,
      attribution: '© Marine Regions'
    }).addTo(countryMap);
  } else {
    // All EEZ
    eezWmsLayer = L.tileLayer.wms('https://geo.vliz.be/geoserver/MarineRegions/wms', {
      layers: 'MarineRegions:eez',
      format: 'image/png',
      transparent: true,
      opacity: 0.4,
      attribution: '© Marine Regions'
    }).addTo(countryMap);
  }
}

function toggleHighSeas(btn) {
  if (!countryMap) return;
  btn.classList.toggle('active');
  if (highSeasWmsLayer) { countryMap.removeLayer(highSeasWmsLayer); highSeasWmsLayer = null; }
  if (btn.classList.contains('active')) {
    highSeasWmsLayer = L.tileLayer.wms('https://geo.vliz.be/geoserver/MarineRegions/wms', {
      layers: 'MarineRegions:high_seas',
      format: 'image/png',
      transparent: true,
      opacity: 0.45,
      attribution: '© Marine Regions'
    }).addTo(countryMap);
  }
  updateMapLegend();
}

function updateMapLegend() {
  const legend = document.getElementById('mapLegend');
  const faoActive = !!faoWmsLayer;
  const eezActive = !!eezWmsLayer;
  const hsActive  = !!highSeasWmsLayer;
  if (legend) legend.classList.toggle('hidden', !faoActive && !eezActive && !hsActive);
  const lFao = document.getElementById('legendFao');
  const lEez = document.getElementById('legendEez');
  const lHs  = document.getElementById('legendHighseas');
  if (lFao) lFao.classList.toggle('hidden', !faoActive);
  if (lEez) lEez.classList.toggle('hidden', !eezActive);
  if (lHs)  lHs.classList.toggle('hidden', !hsActive);
}