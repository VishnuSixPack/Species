/* ============================================================
   PROJECT MANHATTAN — country.js
   Handles both country.html and country-detail.html
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let allCountries = [];

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
  document.getElementById('navDropdown').classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('navDropdown');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!e.target.closest('.nav-profile')) dropdown.classList.add('hidden');
  }
});

// ── SHARED NAV INIT ───────────────────────────────────────────
async function initNav(session) {
  const email = session.user.email || '';
  const initials = email.substring(0, 2).toUpperCase();

  const { data: profile } = await dbClient
    .from('profiles')
    .select('first_name, avatar_color')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.first_name || email.split('@')[0];
  const avatarColor = profile?.avatar_color || '#1a6fdb';

  document.getElementById('navAvatar').textContent = initials;
  document.getElementById('navAvatar').style.background = avatarColor;
  document.getElementById('navEmail').textContent = email;
  document.getElementById('navFirstName').textContent = getGreeting(firstName);
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
  renderCountries(data);
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

  grid.innerHTML = countries.map(c => `
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
      </div>
    </a>
  `).join('');
}

function filterCountries(query) {
  const q = query.toLowerCase();
  const filtered = allCountries.filter(c =>
    c.country.toLowerCase().includes(q) ||
    c.alpha2.toLowerCase().includes(q) ||
    c.alpha3.toLowerCase().includes(q) ||
    c.numeric.includes(q)
  );
  renderCountries(filtered);
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

  if (error || !data) {
    window.location.href = 'country.html';
    return;
  }

  // Set page title
  document.title = `${data.country} — Project Manhattan`;

  // Flag
  document.getElementById('countryFlag').src = `https://flagcdn.com/w160/${data.alpha2.toLowerCase()}.png`;
  document.getElementById('countryFlag').alt = `${data.country} flag`;

  // Hero
  document.getElementById('countryName').textContent = data.country;
  document.getElementById('alpha2Chip').textContent = `Alpha-2: ${data.alpha2}`;
  document.getElementById('alpha3Chip').textContent = `Alpha-3: ${data.alpha3}`;
  document.getElementById('numericChip').textContent = `Numeric: ${data.numeric}`;

  // Detail fields
  document.getElementById('d-country').textContent = data.country;
  document.getElementById('d-alpha2').textContent = data.alpha2;
  document.getElementById('d-alpha3').textContent = data.alpha3;
  document.getElementById('d-numeric').textContent = data.numeric;

  document.getElementById('detailContent').classList.remove('hidden');
}

if (['admin', 'operator'].includes(profile?.role)) {
  const link = document.getElementById('switchAccountLink');
  if (link) link.style.display = 'flex';
}