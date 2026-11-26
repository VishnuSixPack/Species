/* ============================================================
   SmarTuna — admin.js
   Admin console. Who can open it: the admin email below AND a
   profile with role "admin". The browser check only hides the page;
   what an admin can really read and change is decided by the
   database rules (row level security) and the edge functions.
   ============================================================ */

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const dbClient = window._sharedSupabase || (window._sharedSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY));

const ADMIN_EMAIL = 'vishnu@pacifical.com';
const HOME = 'home-logged-in.html';
const TRASH_DAYS = 30;
const LOG_LIMIT = 500;
const PAGE_ROWS = 300;              /* rows drawn per table; search narrows the rest */

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const fullName = u => [u?.first_name, u?.last_name].filter(Boolean).join(' ');
const initials = (name, email) => { const p = String(name || '').trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] || email?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase(); };
const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : 'var(--accent)';
const safeUrl = u => /^https:\/\//i.test(String(u || '')) ? u : '';

let ME = null;
const D = { users:[], requests:[], orgs:[], tickets:[], products:[], species:[], logs:[], archives:[], trash:{ products:[], species:[] }, todayCount:null };
const F = { users:{ q:'', status:'', role:'' }, requests:{ q:'', status:'pending' }, organisations:{ q:'', status:'' },
            support:{ q:'', status:'', type:'' }, products:{ q:'' }, species:{ q:'' }, activity:{ q:'', action:'' },
            archives:{ q:'' }, trash:{ q:'', type:'' }, dashboard:{ q:'' } };
let SECTION = 'dashboard';

/* ── THEME ─────────────────────────────────────────────────── */
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('smartuna-admin-theme', t); }catch(e){}
}
$('themeSwitch').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'));

/* ── HELPERS ───────────────────────────────────────────────── */
function formatDate(d, withTime = true){
  if(!d) return '—';
  const x = new Date(d); if(isNaN(x)) return '—';
  return x.toLocaleString('en-GB', withTime ? { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' } : { day:'2-digit', month:'short', year:'numeric' });
}
function timeAgo(d){
  if(!d) return '—';
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if(m < 1) return 'just now'; if(m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if(h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24); return days < 30 ? `${days}d ago` : formatDate(d, false);
}
let _tt;
function showToast(msg, type = 'success'){
  const t = $('toast'); t.querySelector('span').textContent = msg;
  t.className = 'toast show ' + (type === 'error' ? 'error' : '');
  clearTimeout(_tt); _tt = setTimeout(() => t.className = 'toast', 3400);
}
function moveInd(seg){
  const on = seg.querySelector('button.active'), ind = seg.querySelector('.ind');
  if(!ind) return;
  if(!on || !on.offsetWidth){ ind.style.width = '0'; return; }
  ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`;
}
function moveNavInd(){
  const on = document.querySelector('.nav-item.active'), ind = $('navInd');
  if(!on){ ind.style.height = '0'; return; }
  ind.style.height = on.offsetHeight + 'px'; ind.style.transform = `translateY(${on.offsetTop}px)`;
}
window.addEventListener('resize', () => { document.querySelectorAll('.seg').forEach(moveInd); moveNavInd(); });
const matches = (q, ...vals) => !q || vals.some(v => String(v ?? '').toLowerCase().includes(q));
function capped(rows, cols, render){
  const shown = rows.slice(0, PAGE_ROWS).map(render).join('');
  return shown + (rows.length > PAGE_ROWS ? `<tr><td colspan="${cols}" class="dim">Showing ${PAGE_ROWS} of ${rows.length}. Search to narrow the list.</td></tr>` : '');
}
async function edgeFn(name, body){
  const { data: { session } } = await dbClient.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${session.access_token}` }, body:JSON.stringify(body) });
  let out = {}; try{ out = await res.json(); }catch(e){}
  if(!res.ok || out.error) throw new Error(out.error || `The ${name} service returned an error (${res.status}).`);
  return out;
}

/* ── MODALS ────────────────────────────────────────────────── */
const ICONS = {
  info:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  warning:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/></svg>',
  danger:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>',
  user:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  ok:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  mail:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
};
/* openModal({title, icon, kind, html, wide, actions:[{label, kind:'primary'|'danger'|'', id, onClick(close, box) -> false keeps it open}], onOpen(box)}) */
function openModal({ title, icon = 'info', kind = '', html = '', wide = false, actions = [], onOpen }){
  const root = $('modalRoot');
  const ov = document.createElement('div'); ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-box ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><span class="modal-icon ${kind}">${ICONS[icon] || ICONS.info}</span><h3 class="modal-title">${esc(title)}</h3><button class="modal-x" aria-label="Close">&times;</button></div>
    <div class="modal-body">${html}</div>
    <div class="modal-actions">${actions.map((a, i) => `<button class="pill-btn ${a.kind || ''}" data-i="${i}" ${a.id ? `id="${a.id}"` : ''} ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}</div></div>`;
  root.appendChild(ov);
  const prevFocus = document.activeElement;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); prevFocus?.focus?.(); };
  const onKey = e => { if(e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', e => { if(e.target === ov) close(); });
  ov.querySelector('.modal-x').onclick = close;
  ov.querySelectorAll('.modal-actions button').forEach(b => b.onclick = async () => {
    const a = actions[+b.dataset.i];
    if(!a.onClick){ close(); return; }
    const label = b.textContent; b.disabled = true; if(a.busy) b.textContent = a.busy;
    try{ const keep = await a.onClick(close, ov); if(keep === false){ b.disabled = false; b.textContent = label; } }
    catch(err){ b.disabled = false; b.textContent = label; showToast(err.message || 'Something went wrong.', 'error'); }
  });
  onOpen?.(ov);
  setTimeout(() => (ov.querySelector('input, select, textarea') || ov.querySelector('.modal-actions .primary, .modal-actions .danger') || ov.querySelector('.modal-actions button'))?.focus(), 40);
  return close;
}
const confirmModal = ({ title, html, ok = 'Confirm', kind = 'danger', icon = 'warning' }) => new Promise(res => {
  let done = false;
  const close = openModal({ title, html, icon, kind: kind === 'danger' ? 'danger' : kind === 'warning' ? 'warning' : '',
    actions:[{ label:'Cancel', onClick:c => { done = true; c(); res(false); } },
             { label:ok, kind: kind === 'danger' ? 'danger' : 'primary', onClick:c => { done = true; c(); res(true); } }] });
  const obs = new MutationObserver(() => { if(!document.querySelector('#modalRoot .modal-overlay') && !done){ done = true; obs.disconnect(); res(false); } });
  obs.observe($('modalRoot'), { childList:true });
});

/* ── AUTH ──────────────────────────────────────────────────── */
async function checkAdminAuth(){
  const { data: { session } } = await dbClient.auth.getSession();
  if(!session){ location.href = 'login.html'; return null; }
  if((session.user.email || '').toLowerCase() !== ADMIN_EMAIL){ location.href = HOME; return null; }
  const { data: profile } = await dbClient.from('profiles').select('role, first_name, last_name, avatar_color, photo_url').eq('id', session.user.id).maybeSingle();
  if(!profile || profile.role !== 'admin'){ location.href = HOME; return null; }
  return { session, profile };
}
$('logoutBtn').onclick = async () => { await dbClient.auth.signOut(); location.href = 'login.html'; };

async function logActivity(action, resource, resourceId, details){
  try{
    await dbClient.from('activity_logs').insert({ user_id:ME.id, user_email:ME.email, action, resource, resource_id:resourceId, metadata:{ details } });
  }catch(e){}
}

/* ── NAVIGATION ────────────────────────────────────────────── */
const LABELS = { dashboard:'Dashboard', users:'Users', requests:'Access requests', organisations:'Organisations', support:'Support tickets',
                 products:'Products', species:'Species', activity:'Activity log', archives:'Company archives', trash:'Trash' };
const SEARCH_PH = { dashboard:'Search users, organisations, tickets, then Enter', users:'Search name, email, company', requests:'Search name, email, company',
  organisations:'Search name, country, industry', support:'Search sender, subject, message', products:'Search product, brand, creator',
  species:'Search common or scientific name', activity:'Search user, action, resource', archives:'Search company', trash:'Search deleted items' };
function switchSection(name){
  if(!LABELS[name]) name = 'dashboard';
  SECTION = name;
  document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('active', s.id === `section-${name}`));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.sec === name));
  $('breadcrumbCurrent').textContent = LABELS[name];
  const gs = $('globalSearch'); gs.placeholder = SEARCH_PH[name]; gs.value = F[name]?.q || '';
  if(location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  closeSide(); moveNavInd();
  requestAnimationFrame(() => document.querySelectorAll(`#section-${name} .seg`).forEach(moveInd));
}
$('sideNav').addEventListener('click', e => { const b = e.target.closest('.nav-item'); if(b) switchSection(b.dataset.sec); });
document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if(g){ if(g.dataset.goFilter){ const [s, k, v] = g.dataset.goFilter.split(':'); setSeg(s, k, v); } switchSection(g.dataset.go); } });
$('menuBtn').onclick = () => { $('sidebar').classList.add('open'); $('sideScrim').classList.add('open'); };
const closeSide = () => { $('sidebar').classList.remove('open'); $('sideScrim').classList.remove('open'); };
$('sideScrim').onclick = closeSide;

$('globalSearch').addEventListener('input', e => {
  F[SECTION].q = e.target.value.trim().toLowerCase();
  if(SECTION !== 'dashboard') RENDER[SECTION]?.();          /* on the dashboard, Enter jumps to the section that has a match */
});
$('globalSearch').addEventListener('keydown', e => {
  if(e.key !== 'Enter' || SECTION !== 'dashboard') return;
  F.dashboard.q = e.target.value.trim().toLowerCase();
  if(F.dashboard.q && !renderDashboardSearch()) showToast('Nothing matches in users, organisations or tickets.', 'error');
});
/* segmented filters: data-filter="section.key" */
document.querySelectorAll('.seg[data-filter]').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    const [s, k] = seg.dataset.filter.split('.');
    setSeg(s, k, b.dataset.v);
  });
});
function setSeg(s, k, v){
  F[s][k] = v;
  const seg = document.querySelector(`.seg[data-filter="${s}.${k}"]`);
  if(seg){ seg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.v === v)); moveInd(seg); }
  RENDER[s]?.();
}
$('usersRole').onchange = e => { F.users.role = e.target.value; renderUsers(); };
$('logsAction').onchange = e => { F.activity.action = e.target.value; renderLogs(); };

/* ── INIT ──────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  const auth = await checkAdminAuth();
  if(!auth) return;
  const { session, profile } = auth;
  ME = { id:session.user.id, email:session.user.email, profile };
  const name = fullName(profile) || profile.first_name || 'Admin';
  const av = $('adminAvatar');
  if(safeUrl(profile.photo_url)){ av.innerHTML = `<img src="${esc(profile.photo_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; }
  else { av.textContent = initials(name, ME.email); av.style.background = safeColor(profile.avatar_color); }
  $('adminName').textContent = name;
  const h = new Date().getHours();
  $('helloTitle').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${profile.first_name || 'admin'}`;
  const img = new Image(); img.onload = () => { $('brandMark').outerHTML = '<img src="sc-blue-logo.png" alt="" style="width:30px;height:30px;object-fit:contain">'; }; img.src = 'sc-blue-logo.png';

  $('authGuard').style.display = 'none';
  $('adminWrapper').classList.remove('hidden');
  switchSection(location.hash.slice(1) || 'dashboard');
  await loadAll();
  /* once per browser session, so reloads don't flood the log */
  try{ if(!sessionStorage.getItem('smt-admin-logged')){ sessionStorage.setItem('smt-admin-logged', '1'); logActivity('access', 'admin_console', null, 'Opened the admin console'); } }catch(e){}
});
$('refreshBtn').onclick = async () => { const b = $('refreshBtn'); b.classList.add('spin'); await loadAll(); setTimeout(() => b.classList.remove('spin'), 700); showToast('Up to date.'); };

async function loadAll(){
  await Promise.all([loadUsers(), loadAccessRequests(), loadAdminOrgs(), loadTickets(), loadProducts(), loadSpecies(), loadLogs(), loadArchives(), loadTrash(), loadToday()]);
  renderDashboard();
}

/* ── DASHBOARD ─────────────────────────────────────────────── */
async function loadToday(){
  const { count } = await dbClient.from('activity_logs').select('id', { count:'exact', head:true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString());
  D.todayCount = count ?? null;
}
function renderDashboard(){
  const openT = D.tickets.filter(t => isOpenTicket(t)).length;
  const pendR = D.requests.filter(r => r.status === 'pending').length;
  const invited = D.users.filter(u => u.status === 'invited' && !u.is_suspended).length;
  const suspended = D.users.filter(u => u.is_suspended).length;
  const S = [
    { k:'Users', v:D.users.length, note: invited ? `${invited} invite${invited === 1 ? '' : 's'} not accepted` : `${suspended} suspended`, c:'blue', go:'users', i:'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
    { k:'Organisations', v:D.orgs.length, note:`${D.orgs.filter(o => o.status === 'suspended').length} suspended`, c:'violet', go:'organisations', i:'<path d="M3 21V8l6-4v17M9 21V4l12 5v12M3 21h18"/>' },
    { k:'Products', v:D.products.length, note:`${D.trash.products.length} in trash`, c:'green', go:'products', i:'<path d="M21 16V8l-9-5-9 5v8l9 5z"/><path d="M3.3 7.5 12 12l8.7-4.5M12 22V12"/>' },
    { k:'Species', v:D.species.length, note:`${D.trash.species.length} in trash`, c:'green', go:'species', i:'<path d="M2 12c3-5 9-7 14-4l5-3v14l-5-3c-5 3-11 1-14-4z"/>' },
    { k:'Open tickets', v:openT, note:`${D.tickets.length} in total`, c: openT ? 'red' : 'blue', go:'support', f:'support:status:open', i:'<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
    { k:'Pending requests', v:pendR, note: D.todayCount != null ? `${D.todayCount} actions today` : 'access to SmarTuna', c: pendR ? 'amber' : 'blue', go:'requests', f:'requests:status:pending', i:'<path d="M22 6l-10 7L2 6"/><rect x="2" y="4" width="20" height="16" rx="2"/>' }];
  $('statsGrid').innerHTML = S.map((s, i) => `<button class="stat-card" style="animation-delay:${i * 40}ms" data-go="${s.go}" ${s.f ? `data-go-filter="${s.f}"` : ''}>
    <span class="stat-top"><span class="lbl">${s.k}</span><span class="stat-icon ${s.c}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${s.i}</svg></span></span>
    <span class="stat-value">${s.v.toLocaleString()}</span><span class="stat-note">${esc(s.note)}</span></button>`).join('');

  /* needs attention: pending requests, open tickets, invites waiting, trash expiring soon */
  const items = [];
  D.requests.filter(r => r.status === 'pending').slice(0, 4).forEach(r => items.push({ pill:['amber','request'], t:fullName(r) || r.email, s:`${r.company_name || 'No company'} · asked ${timeAgo(r.created_at)}`, go:'requests' }));
  D.tickets.filter(isOpenTicket).slice(0, 4).forEach(t => items.push({ pill: t.type === 'report' ? ['red','problem'] : ['blue','question'], t:t.subject || '(no subject)', s:`${t.user_name || t.user_email || '—'} · ${timeAgo(t.created_at)}`, ticket:t.id }));
  const soon = [...D.trash.products.map(p => ({ n:p.product_name, d:p.deleted_at })), ...D.trash.species.map(s => ({ n:s.species_name, d:s.deleted_at }))].filter(x => daysLeft(x.d) <= 5);
  if(soon.length) items.push({ pill:['red','trash'], t:`${soon.length} item${soon.length === 1 ? '' : 's'} removed for good within 5 days`, s:soon.slice(0, 3).map(x => x.n || '—').join(', '), go:'trash' });
  $('attentionList').innerHTML = items.length ? items.map(x => `<div class="row-item link" ${x.ticket ? `data-ticket="${esc(x.ticket)}"` : `data-go="${x.go}"`} tabindex="0"><span class="pill ${x.pill[0]}">${x.pill[1]}</span><span class="t">${esc(x.t)}<small>${esc(x.s)}</small></span></div>`).join('')
    : '<div class="empty">Nothing waiting. No pending requests or open tickets.</div>';

  const recent = D.logs.filter(l => l.action !== 'access');
  $('recentActivityList').innerHTML = recent.length ? recent.slice(0, 8).map(l => `<div class="row-item">${actionPill(l.action)}<span class="t">${esc(l.user_email || 'Unknown')}<small>${esc(logDetail(l) || l.resource || '')}</small></span><span class="time">${timeAgo(l.created_at)}</span></div>`).join('')
    : '<div class="empty">No activity yet.</div>';
  $('liveUsersList').innerHTML = D.users.length ? D.users.slice(0, 6).map(u => `<div class="row-item">${avatar(u)}<span class="t">${esc(fullName(u) || u.email || 'Unknown')}<small>${esc(companyOf(u) || 'No company')} · joined ${timeAgo(u.created_at)}</small></span>${statusPill(u)}</div>`).join('')
    : '<div class="empty">No users yet.</div>';
}
/* dashboard search: jump to the best section */
function renderDashboardSearch(){
  const q = F.dashboard.q; if(!q) return;
  const hit = D.users.some(u => matches(q, fullName(u), u.email, companyOf(u))) ? 'users'
    : D.orgs.some(o => matches(q, o.company_name, o.country)) ? 'organisations'
    : D.tickets.some(t => matches(q, t.subject, t.user_email, t.user_name)) ? 'support' : null;
  if(hit){ F[hit].q = q; F.dashboard.q = ''; switchSection(hit); RENDER[hit](); }
  return !!hit;
}
document.addEventListener('click', e => { const t = e.target.closest('[data-ticket]'); if(t) viewTicket(t.dataset.ticket); });
document.addEventListener('keydown', e => { if(e.key === 'Enter' && e.target.matches?.('.row-item.link')) e.target.click(); });

/* ── USERS ─────────────────────────────────────────────────── */
const companyOf = u => u.company?.company_name || u.company_name || '';
const userStatus = u => u.is_suspended ? 'suspended' : u.status === 'invited' ? 'invited' : 'active';
const statusPill = u => { const s = userStatus(u); return `<span class="pill ${s === 'suspended' ? 'red' : s === 'invited' ? 'amber' : 'green'}"><i></i>${s}</span>`; };
const rolePill = r => `<span class="pill ${r === 'admin' ? 'amber' : r === 'partner' ? 'violet' : 'blue'}">${esc(r || 'user')}</span>`;
const avatar = u => { const n = fullName(u); return safeUrl(u.photo_url) ? `<span class="user-mini-avatar"><img src="${esc(u.photo_url)}" alt=""></span>` : `<span class="user-mini-avatar" style="background:${safeColor(u.avatar_color)}">${esc(initials(n, u.email))}</span>`; };
async function loadUsers(){
  const { data, error } = await dbClient.from('profiles').select('*, company:company_id(company_name)').order('created_at', { ascending:false });
  if(error){ console.error('Users:', error); $('usersTableBody').innerHTML = `<tr><td colspan="6" class="loading-cell">Couldn’t load users: ${esc(error.message)}</td></tr>`; return; }
  D.users = data || [];
  const roles = [...new Set(D.users.map(u => u.role || 'user'))].sort();
  $('usersRole').innerHTML = '<option value="">All roles</option>' + roles.map(r => `<option value="${esc(r)}" ${F.users.role === r ? 'selected' : ''}>${esc(r[0].toUpperCase() + r.slice(1))}</option>`).join('');
  renderUsers();
}
function renderUsers(){
  const f = F.users;
  const rows = D.users.filter(u => (!f.status || userStatus(u) === f.status) && (!f.role || (u.role || 'user') === f.role) && matches(f.q, fullName(u), u.email, companyOf(u), u.id, u.role));
  $('usersSub').textContent = `${rows.length} of ${D.users.length} user${D.users.length === 1 ? '' : 's'}`;
  $('usersTableBody').innerHTML = rows.length ? capped(rows, 6, (u, i) => {
    const self = u.id === ME.id, admin = u.role === 'admin', s = userStatus(u);
    return `<tr style="animation-delay:${Math.min(i, 15) * 18}ms" data-user="${esc(u.id)}">
      <td><div class="user-cell">${avatar(u)}<div><div class="user-mini-name">${esc(fullName(u) || '—')}${self ? '<span class="you">you</span>' : ''}</div><div class="user-mini-email">${esc(u.email || u.id)}</div></div></div></td>
      <td>${rolePill(u.role)}</td><td>${esc(companyOf(u) || '—')}</td>
      <td class="dim">${u.last_login ? timeAgo(u.last_login) : 'Never'}</td><td>${statusPill(u)}</td>
      <td>${self || admin ? `<span class="dim">${self ? 'Your account' : 'Administrator'}</span>` : `<div class="action-btns">
        ${s === 'invited' ? '<button class="btn-action" data-act="resend">Resend invite</button>' : ''}
        <button class="btn-action ${u.is_suspended ? 'good' : 'bad'}" data-act="${u.is_suspended ? 'activate' : 'suspend'}">${u.is_suspended ? 'Activate' : 'Suspend'}</button>
        <button class="btn-action" data-act="role">Role</button>
        <button class="btn-action bad" data-act="delete">Delete</button></div>`}</td></tr>`; })
    : `<tr><td colspan="6" class="loading-cell">${D.users.length ? 'No users match.' : 'No users yet.'}</td></tr>`;
}
$('usersTableBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  const u = D.users.find(x => x.id === b.closest('[data-user]').dataset.user); if(!u) return;
  ({ resend:resendInvite, suspend:suspendUser, activate:activateUser, role:openRoleModal, delete:deleteUser })[b.dataset.act]?.(u);
});
async function suspendUser(u){
  if(!await confirmModal({ title:`Suspend ${fullName(u) || u.email}?`, html:'<p>They lose access straight away. Their data stays and you can activate them again later.</p>', ok:'Suspend' })) return;
  const { error } = await dbClient.from('profiles').update({ is_suspended:true }).eq('id', u.id);
  if(error){ showToast('Couldn’t suspend: ' + error.message, 'error'); return; }
  await logActivity('suspend_user', 'profile', u.id, `Suspended ${u.email}`);
  showToast('User suspended.'); await loadUsers(); renderDashboard();
}
async function activateUser(u){
  if(!await confirmModal({ title:`Activate ${fullName(u) || u.email}?`, html:'<p>They can sign in again with their existing password.</p>', ok:'Activate', kind:'primary', icon:'ok' })) return;
  const { error } = await dbClient.from('profiles').update({ is_suspended:false }).eq('id', u.id);
  if(error){ showToast('Couldn’t activate: ' + error.message, 'error'); return; }
  await logActivity('activate_user', 'profile', u.id, `Activated ${u.email}`);
  showToast('User activated.'); await loadUsers(); renderDashboard();
}
function openRoleModal(u){
  openModal({ title:`Change role for ${fullName(u) || u.email}`, icon:'user',
    html:`<label class="fld"><span>Role</span><select class="in" id="roleSelect"><option value="user">User</option><option value="admin">Administrator</option></select></label>
      <div class="warn-box hidden" id="roleWarn">Administrators can see and change every company’s data in this console.</div>`,
    onOpen: box => { const s = box.querySelector('#roleSelect'); s.value = u.role === 'admin' ? 'admin' : 'user'; s.onchange = () => box.querySelector('#roleWarn').classList.toggle('hidden', s.value !== 'admin'); },
    actions:[{ label:'Cancel' }, { label:'Save role', kind:'primary', busy:'Saving…', onClick: async (close, box) => {
      const role = box.querySelector('#roleSelect').value;
      if(role === (u.role || 'user')){ close(); return; }
      const { error } = await dbClient.from('profiles').update({ role }).eq('id', u.id);
      if(error) throw new Error('Role change failed: ' + error.message);
      await logActivity('update', 'profile', u.id, `Role changed to ${role}`);
      close(); showToast(`Role set to ${role}.`); await loadUsers();
    } }] });
}
async function resendInvite(u){
  if(!u.email){ showToast('No email on record for that user.', 'error'); return; }
  const { error } = await dbClient.auth.resetPasswordForEmail(u.email, { redirectTo:`${location.origin}${location.pathname.replace(/[^/]*$/, '')}set-password.html` });
  if(error){ showToast(error.message || 'Could not resend the invite.', 'error'); return; }
  await logActivity('invite', 'user', u.id, `Resent invite: ${u.email}`);
  showToast(`New link sent to ${u.email}.`);
}
function deleteUser(u){
  const name = fullName(u) || u.email || 'this user', expected = (u.email || u.id).toLowerCase();
  const notes = [];
  if(u.status === 'invited') notes.push('This invite hasn’t been accepted yet. Deleting cancels it, and any link already emailed stops working.');
  if(u.last_login) notes.push(`Last signed in ${formatDate(u.last_login)}. Suspending keeps their history and can be undone.`);
  else if(u.status !== 'invited') notes.push('This account has never signed in.');
  openModal({ title:`Delete ${name}?`, icon:'danger', kind:'danger',
    html:`<p>Their login, profile and company membership are removed for good. Work they created stays, but is no longer linked to an account. There is no undo.</p>
      ${notes.length ? `<div class="warn-box">${notes.map(esc).join('<br>')}</div>` : ''}
      <label class="fld"><span>Type <strong>${esc(u.email || u.id)}</strong> to confirm</span><input class="in" id="delConfirm" autocomplete="off" spellcheck="false" placeholder="${esc(u.email || u.id)}"></label>`,
    onOpen: box => { const i = box.querySelector('#delConfirm'), b = box.querySelector('#delBtn'); i.oninput = () => { const ok = i.value.trim().toLowerCase() === expected; i.classList.toggle('match', ok); b.disabled = !ok; }; },
    actions:[{ label:'Cancel' }, { label:'Delete account', kind:'danger', id:'delBtn', disabled:true, busy:'Deleting…', onClick: async close => {
      await edgeFn('delete-user', { user_id:u.id });         /* the login first: if this fails nothing else is touched */
      await dbClient.from('company_members').delete().eq('user_id', u.id);
      await dbClient.from('profiles').delete().eq('id', u.id);
      await logActivity('delete', 'user', u.id, `Deleted user: ${u.email || name}`);
      close(); showToast(`${name} deleted.`); await Promise.all([loadUsers(), loadAdminOrgs()]); renderDashboard();
    } }] });
}
$('addUserBtn').onclick = () => {
  const orgs = D.orgs.filter(o => o.status !== 'suspended');
  openModal({ title:'Invite a user', icon:'user',
    html:`<div class="grid2"><label class="fld"><span>First name <em>*</em></span><input class="in" id="nuFirst" autocomplete="off"></label><label class="fld"><span>Last name <em>*</em></span><input class="in" id="nuLast" autocomplete="off"></label></div>
      <label class="fld"><span>Email <em>*</em></span><input class="in" id="nuEmail" type="email" placeholder="name@company.com" autocomplete="off"></label>
      <label class="fld"><span>Position</span><input class="in" id="nuPos" placeholder="e.g. Procurement manager"></label>
      <div class="grid2"><label class="fld"><span>Company <em>*</em></span><select class="in" id="nuCompany"><option value="">${orgs.length ? 'Choose a company' : 'No active companies yet'}</option>${orgs.map(o => `<option value="${esc(o.id)}">${esc(o.company_name)}${o.company_code ? ` (${esc(o.company_code)})` : ''}</option>`).join('')}</select></label>
      <label class="fld"><span>Role</span><select class="in" id="nuRole"><option value="user">User</option><option value="admin">Administrator</option></select></label></div>
      <p style="margin-top:12px;font-size:12px">They get an email to set their own password. Use an address they can open; you can’t sign in for them.</p>`,
    actions:[{ label:'Cancel' }, { label:'Send invite', kind:'primary', busy:'Sending…', onClick: async (close, box) => {
      const v = id => box.querySelector('#' + id).value.trim();
      const email = v('nuEmail').toLowerCase(), first = v('nuFirst'), last = v('nuLast'), company = v('nuCompany'), role = v('nuRole'), position = v('nuPos');
      if(!first || !last){ showToast('First and last name are required.', 'error'); return false; }
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)){ showToast('That doesn’t look like a valid email address.', 'error'); return false; }
      if(D.users.some(u => (u.email || '').toLowerCase() === email)){ showToast('Someone with that email already has an account.', 'error'); return false; }
      if(!company){ showToast('Choose a company. Every user belongs to an organisation.', 'error'); return false; }
      const result = await edgeFn('create-user', { email, first_name:first, last_name:last, role, company_id:company, position });
      await addMembership(company, result.user_id);
      await logActivity('invite', 'user', result.user_id, `Invited user: ${email}`);
      close(); showToast(`Invite sent to ${email}.`); await Promise.all([loadUsers(), loadAdminOrgs()]); renderDashboard();
    } }] });
};
/* company membership, without a duplicate if the edge function already added it */
async function addMembership(companyId, userId){
  if(!companyId || !userId) return;
  const { data } = await dbClient.from('company_members').select('id').eq('company_id', companyId).eq('user_id', userId).limit(1);
  if(data && data.length) return;
  await dbClient.from('company_members').insert({ company_id:companyId, user_id:userId, company_role:'member', status:'active' });
}

/* ── ACCESS REQUESTS ───────────────────────────────────────── */
const FREE_MAIL = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','live.com','aol.com','proton.me','protonmail.com'];
async function loadAccessRequests(){
  const { data, error } = await dbClient.from('access_requests').select('*').order('created_at', { ascending:false });
  if(error){ console.error('Requests:', error); $('requestsTableBody').innerHTML = '<tr><td colspan="6" class="loading-cell">Couldn’t load requests.</td></tr>'; D.requests = []; updateBadges(); return; }
  D.requests = data || []; renderRequests(); updateBadges();
}
function renderRequests(){
  const f = F.requests;
  const rows = D.requests.filter(r => (!f.status || r.status === f.status) && matches(f.q, fullName(r), r.email, r.company_name, r.position, r.reason));
  $('requestsTableBody').innerHTML = rows.length ? capped(rows, 6, (r, i) => {
    const domain = (r.email || '').split('@')[1] || '';
    const st = r.status === 'approved' ? 'green' : r.status === 'declined' ? 'red' : 'amber';
    return `<tr style="animation-delay:${Math.min(i, 15) * 18}ms" data-req="${esc(r.id)}">
      <td><div class="user-cell"><span class="user-mini-avatar">${esc(initials(fullName(r), r.email))}</span><div><div class="user-mini-name">${esc(fullName(r) || '—')}</div><div class="user-mini-email">${esc(r.email)}${FREE_MAIL.includes(domain.toLowerCase()) ? '<span class="req-flag">personal address</span>' : ''}</div></div></div></td>
      <td><span class="ink">${esc(r.company_name || '—')}</span><div class="dim">${esc(r.position || '')}</div></td>
      <td><div class="req-reason" title="${esc(r.reason || '')}">${esc(r.reason || '—')}</div></td>
      <td class="dim">${timeAgo(r.created_at)}</td>
      <td><span class="pill ${st}"><i></i>${esc(r.status)}</span></td>
      <td>${r.status === 'pending' ? `<div class="action-btns"><button class="btn-action good" data-act="approve">Approve</button><button class="btn-action bad" data-act="decline">Decline</button></div>`
        : `<span class="dim">${r.reviewed_at ? formatDate(r.reviewed_at, false) : '—'}${r.review_note ? ` · ${esc(r.review_note)}` : ''}</span>`}</td></tr>`; })
    : `<tr><td colspan="6" class="loading-cell">${f.status === 'pending' ? 'Nothing waiting for review.' : 'No requests here.'}</td></tr>`;
}
$('requestsTableBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  const r = D.requests.find(x => x.id === b.closest('[data-req]').dataset.req); if(!r) return;
  (b.dataset.act === 'approve' ? approveRequest : declineRequest)(r);
});
function approveRequest(r){
  const typed = (r.company_name || '').trim().toLowerCase();
  const orgs = D.orgs.filter(o => o.status === 'active');
  const guess = typed ? orgs.find(o => (o.company_name || '').toLowerCase() === typed) || orgs.find(o => (o.company_name || '').toLowerCase().includes(typed) || typed.includes((o.company_name || '').toLowerCase())) : null;
  openModal({ title:`Approve ${fullName(r) || r.email}?`, icon:'ok',
    html:`<p>This creates their account and emails an invite to <strong>${esc(r.email)}</strong>. They choose their own password from that link.</p>
      ${typed ? `<div class="warn-box">They wrote their company as <strong>${esc(r.company_name)}</strong>. Check it matches the organisation below.</div>` : ''}
      <label class="fld"><span>Company <em>*</em></span><select class="in" id="arCompany"><option value="">Choose a company</option>${orgs.map(o => `<option value="${esc(o.id)}" ${guess && guess.id === o.id ? 'selected' : ''}>${esc(o.company_name)}</option>`).join('')}</select></label>
      <label class="fld"><span>Role</span><select class="in" id="arRole"><option value="user">User</option></select></label>`,
    actions:[{ label:'Cancel' }, { label:'Approve and invite', kind:'primary', busy:'Inviting…', onClick: async (close, box) => {
      const companyId = box.querySelector('#arCompany').value, role = box.querySelector('#arRole').value;
      if(!companyId){ showToast('Choose a company first.', 'error'); return false; }
      const result = await edgeFn('create-user', { email:r.email, first_name:r.first_name, last_name:r.last_name, position:r.position, company_id:companyId, role });
      /* only marked approved once the invite went out */
      await dbClient.from('access_requests').update({ status:'approved', reviewed_by:ME.id, reviewed_at:new Date().toISOString() }).eq('id', r.id);
      await addMembership(companyId, result.user_id);
      await logActivity('approve', 'access_request', r.id, `Approved access for ${r.email}`);
      close(); showToast(`Invite sent to ${r.email}.`); await Promise.all([loadAccessRequests(), loadUsers(), loadAdminOrgs()]); renderDashboard();
    } }] });
}
function declineRequest(r){
  openModal({ title:`Decline ${fullName(r) || r.email}?`, icon:'warning', kind:'warning',
    html:`<p>No account is created and no email is sent. The request stays on file, so the same address can’t apply again unnoticed.</p>
      <label class="fld"><span>Internal note (optional)</span><input class="in" id="drNote" placeholder="e.g. no known contact at this company"></label>`,
    actions:[{ label:'Cancel' }, { label:'Decline', kind:'danger', busy:'Saving…', onClick: async (close, box) => {
      const note = box.querySelector('#drNote').value.trim();
      const { error } = await dbClient.from('access_requests').update({ status:'declined', reviewed_by:ME.id, reviewed_at:new Date().toISOString(), review_note:note || null }).eq('id', r.id);
      if(error) throw error;
      await logActivity('decline', 'access_request', r.id, `Declined access for ${r.email}`);
      close(); showToast('Request declined.'); await loadAccessRequests(); renderDashboard();
    } }] });
}

/* ── ORGANISATIONS ─────────────────────────────────────────── */
async function loadAdminOrgs(){
  const [orgs, members, prods] = await Promise.all([
    dbClient.from('companies').select('*').order('created_at', { ascending:false }),
    fetchAll(() => dbClient.from('company_members').select('company_id')),
    fetchAll(() => dbClient.from('products').select('company_id').is('deleted_at', null))]);
  if(orgs.error){ $('orgsTableBody').innerHTML = `<tr><td colspan="7" class="loading-cell">Couldn’t load organisations.</td></tr>`; return; }
  const tally = rows => rows.reduce((m, r) => (m[r.company_id] = (m[r.company_id] || 0) + 1, m), {});
  const mc = tally(members), pc = tally(prods);
  D.orgs = (orgs.data || []).map(o => ({ ...o, memberCount:mc[o.id] || 0, productCount:pc[o.id] || 0 }));
  renderOrgs();
}
async function fetchAll(make){
  const out = [];
  for(let from = 0; ; from += 1000){
    const { data, error } = await make().range(from, from + 999);
    if(error || !data) break; out.push(...data); if(data.length < 1000) break;
  }
  return out;
}
function renderOrgs(){
  const f = F.organisations;
  const rows = D.orgs.filter(o => (!f.status || o.status === f.status) && matches(f.q, o.company_name, o.country, o.industry, o.email, o.company_code));
  $('orgsTableBody').innerHTML = rows.length ? capped(rows, 7, (o, i) => {
    const st = o.status === 'active' ? 'green' : o.status === 'suspended' ? 'red' : 'amber';
    return `<tr style="animation-delay:${Math.min(i, 15) * 18}ms" data-org="${esc(o.id)}">
      <td><div class="user-cell"><span class="org-dot">${safeUrl(o.photo_url) ? `<img src="${esc(o.photo_url)}" alt="">` : esc((o.company_name || 'O').charAt(0).toUpperCase())}</span><div><div class="user-mini-name">${esc(o.company_name || '—')}</div><div class="user-mini-email">${esc(o.email || o.company_code || '')}</div></div></div></td>
      <td class="dim">${esc(o.industry || '—')}</td><td class="dim">${esc(o.country || '—')}</td>
      <td class="ink">${o.memberCount}</td><td class="ink">${o.productCount}</td>
      <td><span class="pill ${st}"><i></i>${esc(o.status || '—')}</span></td>
      <td><div class="action-btns"><button class="btn-action ${o.status === 'suspended' ? 'good' : 'bad'}" data-act="${o.status === 'suspended' ? 'activate' : 'suspend'}">${o.status === 'suspended' ? 'Activate' : 'Suspend'}</button><button class="btn-action bad" data-act="delete">Delete</button></div></td></tr>`; })
    : `<tr><td colspan="7" class="loading-cell">${D.orgs.length ? 'No organisations match.' : 'No organisations yet.'}</td></tr>`;
}
$('orgsTableBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  const o = D.orgs.find(x => x.id === b.closest('[data-org]').dataset.org); if(!o) return;
  if(b.dataset.act === 'delete') deleteOrg(o); else setOrgStatus(o, b.dataset.act === 'suspend' ? 'suspended' : 'active');
});
async function setOrgStatus(o, status){
  const suspend = status === 'suspended';
  if(!await confirmModal({ title:`${suspend ? 'Suspend' : 'Activate'} ${o.company_name}?`, ok: suspend ? 'Suspend' : 'Activate', kind: suspend ? 'danger' : 'primary', icon: suspend ? 'warning' : 'ok',
    html: suspend ? `<p>The organisation is marked suspended. Its ${o.memberCount} member${o.memberCount === 1 ? '' : 's'} keep their logins; suspend them under Users if they should lose access too.</p>` : '<p>The organisation is marked active again.</p>' })) return;
  const { error } = await dbClient.from('companies').update({ status }).eq('id', o.id);
  if(error){ showToast('Couldn’t update: ' + error.message, 'error'); return; }
  await logActivity(suspend ? 'suspend' : 'activate', 'company', o.id, `${suspend ? 'Suspended' : 'Activated'} ${o.company_name}`);
  showToast(`Organisation ${suspend ? 'suspended' : 'activated'}.`); await loadAdminOrgs(); renderDashboard();
}
function deleteOrg(o){
  const memberIds = () => D.users.filter(u => u.company_id === o.id).map(u => u.id);
  openModal({ title:`Delete ${o.company_name}?`, icon:'danger', kind:'danger',
    html:`<p>Before anything is removed, a JSON copy of the company, its members, products and certificates is saved under Company archives.</p>
      <div class="warn-box">This deletes <strong>${o.memberCount} member account${o.memberCount === 1 ? '' : 's'}</strong> (their logins too), moves <strong>${o.productCount} product${o.productCount === 1 ? '' : 's'}</strong> to Trash and removes the organisation. There is no undo.</div>
      <label class="fld"><span>Type <strong>${esc(o.company_name)}</strong> to confirm</span><input class="in" id="doConfirm" autocomplete="off" spellcheck="false"></label>`,
    onOpen: box => { const i = box.querySelector('#doConfirm'), b = box.querySelector('#doBtn'); i.oninput = () => { const ok = i.value.trim() === (o.company_name || '').trim(); i.classList.toggle('match', ok); b.disabled = !ok; }; },
    actions:[{ label:'Cancel' }, { label:'Archive and delete', kind:'danger', id:'doBtn', disabled:true, busy:'Archiving…', onClick: async close => {
      /* 1. archive */
      const [company, members, products, certs, logs] = await Promise.all([
        dbClient.from('companies').select('*').eq('id', o.id).maybeSingle(),
        dbClient.from('company_members').select('*, profiles:user_id(*)').eq('company_id', o.id),
        dbClient.from('products').select('*').eq('company_id', o.id),
        dbClient.from('organisation_certifications').select('*').eq('company_id', o.id),
        dbClient.from('activity_logs').select('*').eq('resource', 'company').eq('resource_id', o.id)]);
      const archive = { archived_at:new Date().toISOString(), archived_by:ME.email, company:company.data, members:members.data || [], products:products.data || [], certifications:certs.data || [], activity_logs:logs.data || [] };
      const path = `${o.id}_${Date.now()}.json`;
      const up = await dbClient.storage.from('company-archives').upload(path, new Blob([JSON.stringify(archive, null, 2)], { type:'application/json' }));
      if(up.error) throw new Error('The archive couldn’t be saved, so nothing was deleted. ' + up.error.message);
      await dbClient.from('company_archives').insert({ company_id:o.id, company_name:o.company_name, deleted_by:ME.id, archive_url:path, user_count:o.memberCount, product_count:o.productCount });
      /* 2. products to trash */
      await dbClient.from('products').update({ deleted_at:new Date().toISOString() }).eq('company_id', o.id).is('deleted_at', null);
      /* 3. member accounts: login first, then profile (never your own) */
      const ids = [...new Set([...(members.data || []).map(m => m.user_id), ...memberIds()])].filter(id => id && id !== ME.id);
      const failed = [];
      for(const id of ids){
        try{ await edgeFn('delete-user', { user_id:id }); await dbClient.from('profiles').delete().eq('id', id); }
        catch(e){ failed.push(id); }
      }
      await dbClient.from('company_members').delete().eq('company_id', o.id);
      /* 4. the organisation */
      const del = await dbClient.from('companies').delete().eq('id', o.id);
      if(del.error) throw new Error('Archived, but the organisation couldn’t be deleted: ' + del.error.message);
      await logActivity('delete', 'company', o.id, `Deleted company with archive: ${o.company_name}`);
      close();
      showToast(failed.length ? `${o.company_name} deleted. ${failed.length} login${failed.length === 1 ? '' : 's'} couldn’t be removed; check Users.` : `${o.company_name} archived and deleted.`, failed.length ? 'error' : 'success');
      await loadAll();
    } }] });
}

/* ── ARCHIVES ──────────────────────────────────────────────── */
async function loadArchives(){
  const { data } = await dbClient.from('company_archives').select('*').order('created_at', { ascending:false });
  D.archives = data || []; renderArchives();
}
function renderArchives(){
  const rows = D.archives.filter(a => matches(F.archives.q, a.company_name));
  $('archivesTableBody').innerHTML = rows.length ? capped(rows, 5, (a, i) => `<tr style="animation-delay:${Math.min(i, 15) * 18}ms">
      <td class="ink">${esc(a.company_name || '—')}</td><td class="dim">${formatDate(a.created_at)}</td><td>${a.user_count || 0}</td><td>${a.product_count || 0}</td>
      <td>${a.archive_url ? `<button class="btn-action" data-arch="${esc(a.archive_url)}">Download JSON</button>` : '<span class="dim">No file</span>'}</td></tr>`)
    : `<tr><td colspan="5" class="loading-cell">${D.archives.length ? 'No archives match.' : 'No archives yet.'}</td></tr>`;
}
$('archivesTableBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-arch]'); if(!b) return;
  const v = b.dataset.arch;
  /* older archives saved a public link; new ones save the file path and get a short-lived link */
  if(/^https?:\/\//.test(v)){ window.open(v, '_blank', 'noopener'); return; }
  const { data, error } = await dbClient.storage.from('company-archives').createSignedUrl(v, 120);
  if(error){ showToast('Couldn’t open the archive: ' + error.message, 'error'); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
});

/* ── SUPPORT TICKETS ───────────────────────────────────────── */
const isOpenTicket = t => !['resolved', 'closed'].includes(String(t.status || 'open'));
async function loadTickets(){
  const { data, error } = await dbClient.from('support_tickets').select('*').order('created_at', { ascending:false });
  if(error){ $('ticketsTableBody').innerHTML = '<tr><td colspan="6" class="loading-cell">Couldn’t load tickets.</td></tr>'; D.tickets = []; updateBadges(); return; }
  D.tickets = data || []; renderTickets(); updateBadges();
}
const STATUS_OPTS = [['open','Open'], ['in_progress','In progress'], ['resolved','Resolved']];
const statusSelect = t => `<select class="status-sel" data-status aria-label="Status">${STATUS_OPTS.map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}${t.status && !STATUS_OPTS.some(([v]) => v === t.status) ? `<option selected>${esc(t.status)}</option>` : ''}</select>`;
const typePill = t => t.type === 'report' ? '<span class="pill red">problem</span>' : '<span class="pill blue">question</span>';
function renderTickets(){
  const f = F.support;
  const rows = D.tickets.filter(t => (!f.status || (t.status || 'open') === f.status) && (!f.type || t.type === f.type) && matches(f.q, t.user_name, t.user_email, t.subject, t.message));
  $('ticketsTableBody').innerHTML = rows.length ? capped(rows, 6, (t, i) => `<tr style="animation-delay:${Math.min(i, 15) * 18}ms" data-tk="${esc(t.id)}">
      <td><div class="user-mini-name">${esc(t.user_name || '—')}</div><div class="user-mini-email">${esc(t.user_email || '—')}</div></td>
      <td>${typePill(t)}</td><td class="ink clip" title="${esc(t.subject || '')}">${esc(t.subject || '—')}</td>
      <td class="dim">${timeAgo(t.created_at)}</td><td>${statusSelect(t)}</td>
      <td><button class="btn-action" data-view>Open</button></td></tr>`)
    : `<tr><td colspan="6" class="loading-cell">${D.tickets.length ? 'No tickets match.' : 'No tickets yet.'}</td></tr>`;
}
$('ticketsTableBody').addEventListener('change', e => { if(e.target.matches('[data-status]')) updateTicketStatus(e.target.closest('[data-tk]').dataset.tk, e.target.value); });
$('ticketsTableBody').addEventListener('click', e => { if(e.target.closest('[data-view]')) viewTicket(e.target.closest('[data-tk]').dataset.tk); });
async function updateTicketStatus(id, status){
  const { error } = await dbClient.from('support_tickets').update({ status }).eq('id', id);
  if(error){ showToast('Couldn’t update the status.', 'error'); await loadTickets(); return; }
  const t = D.tickets.find(x => x.id === id); if(t) t.status = status;
  await logActivity('update', 'support_ticket', id, `Ticket set to ${status}`);
  showToast('Status updated.'); renderTickets(); updateBadges(); renderDashboard();
}
function viewTicket(id){
  const t = D.tickets.find(x => String(x.id) === String(id)); if(!t) return;
  const subj = String(t.subject || '').replace(/^\[[^\]]*\]\s*/, '');
  const mailto = t.user_email ? `mailto:${encodeURIComponent(t.user_email)}?subject=${encodeURIComponent('Re: ' + subj)}` : '';
  openModal({ title:t.subject || '(no subject)', icon:'mail', wide:true,
    html:`<div class="kv"><span>From</span><span>${esc(t.user_name || '—')} · ${esc(t.user_email || '—')}</span><span>Type</span><span>${t.type === 'report' ? 'Problem report' : 'Question'}</span><span>Sent</span><span>${formatDate(t.created_at)}</span>
      <span>Status</span><span>${statusSelect(t)}</span></div><div class="msg-box">${esc(t.message || '')}</div>`,
    onOpen: box => box.querySelector('[data-status]').onchange = e => updateTicketStatus(t.id, e.target.value),
    actions:[{ label:'Close' }, ...(mailto ? [{ label:'Reply by email', kind:'primary', onClick: close => { location.href = mailto; if(t.status === 'open') updateTicketStatus(t.id, 'in_progress'); close(); } }] : [])] });
}

/* ── PRODUCTS / SPECIES ────────────────────────────────────── */
const userName = id => { const u = D.users.find(x => x.id === id); return u ? (fullName(u) || u.email) : (id ? `${String(id).slice(0, 8)}…` : '—'); };
async function loadProducts(){
  const { data, error } = await dbClient.from('products').select('id, product_name, brand, created_at, user_id').is('deleted_at', null).order('created_at', { ascending:false });
  D.products = error ? [] : (data || []); renderProducts();
}
function renderProducts(){
  const rows = D.products.filter(p => matches(F.products.q, p.product_name, p.brand, userName(p.user_id)));
  $('productsTableBody').innerHTML = rows.length ? capped(rows, 5, (p, i) => `<tr style="animation-delay:${Math.min(i, 15) * 18}ms">
      <td class="ink">${esc(p.product_name || '—')}</td><td>${esc(p.brand || '—')}</td><td class="dim">${esc(userName(p.user_id))}</td><td class="dim">${formatDate(p.created_at, false)}</td>
      <td><a class="btn-action" href="product-detail.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Open</a></td></tr>`)
    : `<tr><td colspan="5" class="loading-cell">${D.products.length ? 'No products match.' : 'No products yet.'}</td></tr>`;
}
async function loadSpecies(){
  const { data, error } = await dbClient.from('species').select('id, species_name, scientific_name, created_at').is('deleted_at', null).order('created_at', { ascending:false });
  D.species = error ? [] : (data || []); renderSpecies();
}
function renderSpecies(){
  const rows = D.species.filter(s => matches(F.species.q, s.species_name, s.scientific_name));
  $('speciesTableBody').innerHTML = rows.length ? capped(rows, 4, (s, i) => `<tr style="animation-delay:${Math.min(i, 15) * 18}ms">
      <td class="ink">${esc(s.species_name || '—')}</td><td class="dim" style="font-style:italic">${esc(s.scientific_name || '—')}</td><td class="dim">${formatDate(s.created_at, false)}</td>
      <td><a class="btn-action" href="species-detail.html?id=${encodeURIComponent(s.id)}" target="_blank" rel="noopener">Open</a></td></tr>`)
    : `<tr><td colspan="4" class="loading-cell">${D.species.length ? 'No species match.' : 'No species yet.'}</td></tr>`;
}

/* ── ACTIVITY ──────────────────────────────────────────────── */
const ACTION_COLOR = { login:'green', access:'green', activate:'green', activate_user:'green', approve:'green', restore:'green', create:'blue', invite:'blue',
  update:'amber', suspend:'red', suspend_user:'red', decline:'red', delete:'red', permanent_delete:'red', logout:'grey' };
const actionPill = a => `<span class="pill ${ACTION_COLOR[a] || 'violet'}">${esc(String(a || '—').replace(/_/g, ' '))}</span>`;
const logDetail = l => l.metadata?.details ?? (l.metadata ? JSON.stringify(l.metadata) : '');
async function loadLogs(){
  const { data, error } = await dbClient.from('activity_logs').select('*').order('created_at', { ascending:false }).limit(LOG_LIMIT);
  D.logs = error ? [] : (data || []);
  const acts = [...new Set(D.logs.map(l => l.action).filter(Boolean))].sort();
  $('logsAction').innerHTML = '<option value="">All actions</option>' + acts.map(a => `<option value="${esc(a)}" ${F.activity.action === a ? 'selected' : ''}>${esc(a.replace(/_/g, ' '))}</option>`).join('');
  renderLogs();
}
function renderLogs(){
  const f = F.activity;
  const rows = D.logs.filter(l => (!f.action || l.action === f.action) && matches(f.q, l.user_email, l.action, l.resource, logDetail(l)));
  $('logsTableBody').innerHTML = rows.length ? capped(rows, 5, (l, i) => `<tr style="animation-delay:${Math.min(i, 15) * 12}ms">
      <td class="dim" style="white-space:nowrap" title="${esc(formatDate(l.created_at))}">${timeAgo(l.created_at)}</td>
      <td>${esc(l.user_email || l.user_id || '—')}</td><td>${actionPill(l.action)}</td><td class="dim">${esc(String(l.resource || '—').replace(/_/g, ' '))}</td>
      <td class="dim clip" title="${esc(logDetail(l))}">${esc(logDetail(l) || '—')}</td></tr>`)
    : `<tr><td colspan="5" class="loading-cell">${D.logs.length ? 'No entries match.' : 'No activity yet.'}</td></tr>`;
}

/* ── TRASH ─────────────────────────────────────────────────── */
const daysLeft = d => Math.ceil((new Date(d).getTime() + TRASH_DAYS * 864e5 - Date.now()) / 864e5);
async function loadTrash(){
  const [p, s] = await Promise.all([
    dbClient.from('products').select('id, product_name, brand, deleted_at, reminder').not('deleted_at', 'is', null).order('deleted_at', { ascending:false }),
    dbClient.from('species').select('id, species_name, scientific_name, deleted_at, reminder').not('deleted_at', 'is', null).order('deleted_at', { ascending:false })]);
  D.trash.products = p.data || []; D.trash.species = s.data || [];
  renderTrash(); updateBadges();
}
function renderTrash(){
  const f = F.trash;
  $('trashProductsCard').classList.toggle('hidden', f.type === 'species');
  $('trashSpeciesCard').classList.toggle('hidden', f.type === 'products');
  const left = d => { const n = daysLeft(d); return `<span class="pill ${n <= 5 ? 'red' : 'amber'}">${n <= 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`}</span>`; };
  const acts = `<div class="action-btns"><button class="btn-action good" data-act="restore">Restore</button><button class="btn-action bad" data-act="purge">Delete for good</button></div>`;
  const P = D.trash.products.filter(p => matches(f.q, p.product_name, p.brand));
  const S = D.trash.species.filter(s => matches(f.q, s.species_name, s.scientific_name));
  $('trashProductCount').textContent = `${P.length} item${P.length === 1 ? '' : 's'}`;
  $('trashSpeciesCount').textContent = `${S.length} item${S.length === 1 ? '' : 's'}`;
  $('trashProductsBody').innerHTML = P.length ? capped(P, 6, p => `<tr data-kind="products" data-id="${esc(p.id)}"><td class="ink">${esc(p.product_name || '—')}</td><td>${esc(p.brand || '—')}</td><td class="dim">${formatDate(p.deleted_at, false)}</td><td>${left(p.deleted_at)}</td><td class="dim">${p.reminder ? 'Yes' : '—'}</td><td>${acts}</td></tr>`)
    : '<tr><td colspan="6" class="loading-cell">No deleted products.</td></tr>';
  $('trashSpeciesBody').innerHTML = S.length ? capped(S, 6, s => `<tr data-kind="species" data-id="${esc(s.id)}"><td class="ink">${esc(s.species_name || '—')}</td><td class="dim" style="font-style:italic">${esc(s.scientific_name || '—')}</td><td class="dim">${formatDate(s.deleted_at, false)}</td><td>${left(s.deleted_at)}</td><td class="dim">${s.reminder ? 'Yes' : '—'}</td><td>${acts}</td></tr>`)
    : '<tr><td colspan="6" class="loading-cell">No deleted species.</td></tr>';
}
$('section-trash').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if(!b) return;
  const tr = b.closest('[data-kind]'), kind = tr.dataset.kind, id = tr.dataset.id;
  const item = D.trash[kind].find(x => String(x.id) === id); if(!item) return;
  const name = kind === 'products' ? item.product_name : item.species_name, noun = kind === 'products' ? 'product' : 'species';
  if(b.dataset.act === 'restore'){
    const { error } = await dbClient.from(kind).update({ deleted_at:null, reminder:false }).eq('id', id);
    if(error){ showToast('Couldn’t restore.', 'error'); return; }
    await logActivity('restore', noun, id, `${name} restored from Trash`);
    showToast(`${name || 'Item'} restored.`);
  } else {
    if(!await confirmModal({ title:`Delete ${name || 'this ' + noun} for good?`, html:`<p>The ${noun}${kind === 'products' ? ' and its allergens, nutrition and artwork' : ''} are removed permanently. This can’t be undone.</p>`, ok:'Delete for good' })) return;
    if(kind === 'products'){
      await Promise.all(['product_allergens', 'product_nutrition', 'product_artwork'].map(t => dbClient.from(t).delete().eq('product_id', id)));
    }
    const { error } = await dbClient.from(kind).delete().eq('id', id);
    if(error){ showToast('Couldn’t delete: ' + error.message, 'error'); return; }
    await logActivity('permanent_delete', noun, id, `${name} permanently deleted`);
    showToast(`${name || 'Item'} deleted for good.`);
  }
  await Promise.all([loadTrash(), kind === 'products' ? loadProducts() : loadSpecies()]); renderDashboard();
});

/* ── BADGES / RENDER MAP ───────────────────────────────────── */
function updateBadges(){
  const set = (id, n) => { const b = $(id); b.textContent = n; b.classList.toggle('hidden', !n); };
  set('requestsBadge', D.requests.filter(r => r.status === 'pending').length);
  set('ticketsBadge', D.tickets.filter(isOpenTicket).length);
  set('trashBadge', D.trash.products.length + D.trash.species.length);
}
const RENDER = { dashboard:renderDashboardSearch, users:renderUsers, requests:renderRequests, organisations:renderOrgs, support:renderTickets,
                 products:renderProducts, species:renderSpecies, activity:renderLogs, archives:renderArchives, trash:renderTrash };
document.addEventListener('keydown', e => {
  if(e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName) && !document.querySelector('.modal-overlay')){ e.preventDefault(); $('globalSearch').focus(); }
});
