// ============================================================
// SmarTuna · Load plans overview
// ------------------------------------------------------------
// Lists every saved plan with its status, container, fill and
// weight, and offers the lifecycle actions: open, duplicate,
// publish, revert, archive, trash and restore.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const PRESET_NAMES = {
  '40HC': "40' High Cube",
  '40STD': "40' Standard",
  '20STD': "20' Standard",
  '45HC': "45' High Cube",
  'Custom': 'Custom'
};

const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

let plans = [];
let statusFilter = 'all';
let sortBy = 'updated';
let searchTerm = '';
let openMenuId = null;

// ============================================================
// HELPERS
// ============================================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function describeError(err) {
  if (!err) return 'unknown error';
  const bits = [err.message, err.details, err.hint].filter(Boolean);
  const text = bits.join(' · ') || 'unknown error';
  return err.code ? `${text} [${err.code}]` : text;
}

function showToast(msg) {
  const toast = $('#toast');
  toast.innerHTML = msg;
  toast.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => toast.classList.remove('show'), 2800);
}

// "3 days ago" reads faster than a timestamp when scanning a list
function relativeTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 42) {
    const wks = Math.round(days / 7);
    return `${wks} week${wks === 1 ? '' : 's'} ago`;
  }
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function containerLabel(plan) {
  const preset = PRESET_NAMES[plan.container_preset] || plan.container_preset || 'Custom';
  const L = (Number(plan.space_length_cm) / 100).toFixed(2);
  const W = (Number(plan.space_width_cm) / 100).toFixed(2);
  const H = (Number(plan.space_height_cm) / 100).toFixed(2);
  return { preset, dims: `${L} × ${W} × ${H} m` };
}

function fillLevel(pct) {
  if (pct > 100) return 'lvl-danger';
  if (pct > 90) return 'lvl-warn';
  return '';
}

// ============================================================
// DATA
// ============================================================
async function loadPlans() {
  const grid = $('#plansGrid');
  grid.innerHTML = '<div class="state-msg">Loading plans…</div>';
  try {
    const { data, error } = await supabase
      .from('load_plans')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    plans = data || [];
    render();
  } catch (err) {
    console.error('Load failed:', describeError(err), err);
    grid.innerHTML = `<div class="state-msg">
      Couldn't load your plans.<span class="state-hint">${escapeHtml(describeError(err))}</span>
    </div>`;
  }
}

function visiblePlans() {
  const inTrash = statusFilter === 'trash';
  let out = plans.filter(p => (inTrash ? !!p.deleted_at : !p.deleted_at));

  if (!inTrash && statusFilter !== 'all') {
    out = out.filter(p => (p.status || 'draft') === statusFilter);
  }

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    out = out.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.plan_ref || '').toLowerCase().includes(q) ||
      (p.container_preset || '').toLowerCase().includes(q) ||
      (p.transport_mode || '').toLowerCase().includes(q)
    );
  }

  const num = v => Number(v) || 0;
  const sorters = {
    updated: (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
    created: (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    name:    (a, b) => (a.name || '').localeCompare(b.name || ''),
    fill:    (a, b) => num(b.volume_utilization) - num(a.volume_utilization),
    items:   (a, b) => num(b.total_items) - num(a.total_items)
  };
  return out.sort(sorters[sortBy] || sorters.updated);
}

function updateSummary() {
  const live = plans.filter(p => !p.deleted_at);
  const count = s => live.filter(p => (p.status || 'draft') === s).length;
  $('#sumAll').textContent = live.length;
  $('#sumDraft').textContent = count('draft');
  $('#sumPublished').textContent = count('published');
  $('#sumArchived').textContent = count('archived');
  $('#sumItems').textContent = live.reduce((s, p) => s + (Number(p.total_items) || 0), 0);

  const trashed = plans.filter(p => p.deleted_at).length;
  $('#pageSub').textContent = live.length === 0
    ? "Nothing saved yet — create your first plan to see it here."
    : `${live.length} plan${live.length === 1 ? '' : 's'}${trashed ? ` · ${trashed} in trash` : ''}.`;
}

// ============================================================
// RENDER
// ============================================================
function emptyMessage() {
  if (searchTerm) return `No plans match <b>${escapeHtml(searchTerm)}</b>.`;
  if (statusFilter === 'trash') return 'Trash is empty.<span class="state-hint">Deleted plans stay here for 30 days.</span>';
  if (statusFilter === 'draft') return 'No drafts.<span class="state-hint">Plans you save without publishing land here.</span>';
  if (statusFilter === 'published') return 'Nothing published yet.<span class="state-hint">Publish a plan once it is ready to share.</span>';
  if (statusFilter === 'archived') return 'Nothing archived.<span class="state-hint">Archive plans you want out of the way but not deleted.</span>';
  return 'No plans yet.<span class="state-hint">Hit <b>New plan</b> to build your first one.</span>';
}

function planCard(p) {
  const status = p.deleted_at ? 'trashed' : (p.status || 'draft');
  const { preset, dims } = containerLabel(p);
  const pct = Number(p.volume_utilization) || 0;
  const items = Number(p.total_items) || 0;
  const inTrash = !!p.deleted_at;

  const actions = inTrash
    ? `<button class="act act-primary" data-act="restore" data-id="${p.id}">Restore</button>
       <button class="act act-danger" data-act="purge" data-id="${p.id}">Delete forever</button>`
    : `<a class="act act-primary" href="load-planner.html?plan=${encodeURIComponent(p.id)}">Open</a>
       <div class="menu-wrap">
         <button class="act act-more" data-act="menu" data-id="${p.id}" title="More">⋯</button>
         <div class="menu" id="menu-${p.id}" hidden>
           <button data-act="duplicate" data-id="${p.id}">Duplicate</button>
           ${status === 'published'
             ? `<button data-act="unpublish" data-id="${p.id}">Revert to draft</button>`
             : `<button data-act="publish" data-id="${p.id}">Publish</button>`}
           ${status === 'archived'
             ? `<button data-act="unarchive" data-id="${p.id}">Move to drafts</button>`
             : `<button data-act="archive" data-id="${p.id}">Archive</button>`}
           <div class="menu-sep"></div>
           <button class="danger" data-act="trash" data-id="${p.id}">Move to trash</button>
         </div>
       </div>`;

  return `
  <article class="plan-card ${status === 'archived' ? 'is-archived' : ''}">
    <div class="plan-top">
      <div class="plan-title-row">
        <div class="plan-name">${escapeHtml(p.name || 'Untitled plan')}</div>
        <span class="badge ${status}">${status}</span>
      </div>
      <div class="plan-ref">${escapeHtml(p.plan_ref || '—')}</div>
    </div>

    <div class="plan-meta">
      <span class="chip chip-mode">${escapeHtml(p.transport_mode || 'Sea')}</span>
      <span class="chip">${escapeHtml(preset)}</span>
      <span>${escapeHtml(dims)}</span>
    </div>

    <div class="plan-fill">
      <div class="fill-head"><span>Volume filled</span><b>${pct.toFixed(1)}%</b></div>
      <div class="fill-bar">
        <span class="${fillLevel(pct)}" style="width:${Math.min(100, pct).toFixed(1)}%"></span>
      </div>
    </div>

    <div class="plan-stats">
      <div class="plan-stat"><span>Items</span><b>${items}</b></div>
      <div class="plan-stat"><span>Created</span><b>${relativeTime(p.created_at)}</b></div>
    </div>

    <div class="plan-foot">
      <span class="plan-updated">${inTrash ? 'Deleted' : 'Updated'} ${relativeTime(inTrash ? p.deleted_at : p.updated_at)}</span>
      ${actions}
    </div>
  </article>`;
}

function render() {
  updateSummary();
  const grid = $('#plansGrid');
  const list = visiblePlans();
  grid.innerHTML = list.length
    ? list.map(planCard).join('')
    : `<div class="state-msg">${emptyMessage()}</div>`;
  openMenuId = null;
}

// ============================================================
// ACTIONS
// ============================================================
async function setStatus(id, status, label) {
  const { error } = await supabase.from('load_plans')
    .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return showToast(`Failed: ${escapeHtml(describeError(error))}`);
  const p = plans.find(x => x.id === id);
  if (p) { p.status = status; p.updated_at = new Date().toISOString(); }
  render();
  showToast(`<b>${escapeHtml(p?.name || 'Plan')}</b> ${label}.`);
}

async function trashPlan(id) {
  const p = plans.find(x => x.id === id);
  if (!confirm(`Move "${p?.name}" to trash? You can restore it for 30 days.`)) return;
  const stamp = new Date().toISOString();
  const { error } = await supabase.from('load_plans').update({ deleted_at: stamp }).eq('id', id);
  if (error) return showToast(`Failed: ${escapeHtml(describeError(error))}`);
  if (p) p.deleted_at = stamp;
  render();
  showToast(`<b>${escapeHtml(p?.name || 'Plan')}</b> moved to trash.`);
}

async function restorePlan(id) {
  const { error } = await supabase.from('load_plans').update({ deleted_at: null }).eq('id', id);
  if (error) return showToast(`Failed: ${escapeHtml(describeError(error))}`);
  const p = plans.find(x => x.id === id);
  if (p) p.deleted_at = null;
  render();
  showToast(`<b>${escapeHtml(p?.name || 'Plan')}</b> restored.`);
}

async function purgePlan(id) {
  const p = plans.find(x => x.id === id);
  if (!confirm(`Permanently delete "${p?.name}"? This cannot be undone.`)) return;
  // Items and contents cascade from the plan row
  const { error } = await supabase.from('load_plans').delete().eq('id', id);
  if (error) return showToast(`Failed: ${escapeHtml(describeError(error))}`);
  plans = plans.filter(x => x.id !== id);
  render();
  showToast('Plan permanently deleted.');
}

// Copies the plan row, its items, and each item's batch contents
async function duplicatePlan(id) {
  const src = plans.find(x => x.id === id);
  if (!src) return;
  showToast('Duplicating…');
  try {
    const copy = { ...src };
    // Let the database assign these afresh
    ['id', 'plan_ref', 'created_at', 'updated_at', 'deleted_at'].forEach(k => delete copy[k]);
    copy.name = `${src.name} (copy)`;
    copy.status = 'draft';

    const { data: newPlan, error: pErr } = await supabase
      .from('load_plans').insert(copy).select().single();
    if (pErr) throw pErr;

    const { data: srcItems, error: iErr } = await supabase
      .from('load_plan_items').select('*').eq('load_plan_id', id).order('created_at');
    if (iErr) throw iErr;

    if (srcItems?.length) {
      const rows = srcItems.map(it => {
        const row = { ...it, load_plan_id: newPlan.id };
        ['id', 'created_at', 'updated_at'].forEach(k => delete row[k]);
        return row;
      });
      const { data: newItems, error: insErr } = await supabase
        .from('load_plan_items').insert(rows).select('id');
      if (insErr) throw insErr;

      // Carry the batch contents across, matched by insert order
      const { data: srcContents } = await supabase
        .from('load_plan_item_contents').select('*')
        .in('load_plan_item_id', srcItems.map(i => i.id));

      if (srcContents?.length && newItems?.length === srcItems.length) {
        const idMap = new Map(srcItems.map((it, idx) => [it.id, newItems[idx].id]));
        const contentRows = srcContents.map(c => {
          const row = { ...c, load_plan_item_id: idMap.get(c.load_plan_item_id) };
          ['id', 'created_at'].forEach(k => delete row[k]);
          return row;
        }).filter(r => r.load_plan_item_id);
        if (contentRows.length) {
          const { error: cErr } = await supabase.from('load_plan_item_contents').insert(contentRows);
          if (cErr) console.warn('Contents copy failed:', cErr);
        }
      }
    }

    plans.unshift(newPlan);
    statusFilter = 'all';
    $$('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.status === 'all'));
    render();
    showToast(`Duplicated as <b>${escapeHtml(newPlan.name)}</b>.`);
  } catch (err) {
    console.error('Duplicate failed:', describeError(err), err);
    showToast(`Duplicate failed: ${escapeHtml(describeError(err))}`);
  }
}

function toggleMenu(id) {
  const menu = $(`#menu-${CSS.escape(id)}`);
  if (!menu) return;
  const wasOpen = openMenuId === id;
  $$('.menu').forEach(m => m.hidden = true);
  menu.hidden = wasOpen;
  openMenuId = wasOpen ? null : id;
}

// ============================================================
// EVENTS
// ============================================================
$('#plansGrid').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, id } = btn.dataset;
  e.stopPropagation();

  if (act !== 'menu') { $$('.menu').forEach(m => m.hidden = true); openMenuId = null; }

  switch (act) {
    case 'menu':      toggleMenu(id); break;
    case 'duplicate': duplicatePlan(id); break;
    case 'publish':   setStatus(id, 'published', 'published'); break;
    case 'unpublish': setStatus(id, 'draft', 'reverted to draft'); break;
    case 'archive':   setStatus(id, 'archived', 'archived'); break;
    case 'unarchive': setStatus(id, 'draft', 'moved to drafts'); break;
    case 'trash':     trashPlan(id); break;
    case 'restore':   restorePlan(id); break;
    case 'purge':     purgePlan(id); break;
  }
});

document.addEventListener('click', () => {
  if (!openMenuId) return;
  $$('.menu').forEach(m => m.hidden = true);
  openMenuId = null;
});

$$('.filter-tab').forEach(tab => tab.addEventListener('click', () => {
  statusFilter = tab.dataset.status;
  $$('.filter-tab').forEach(t => t.classList.toggle('active', t === tab));
  render();
}));

$$('.stat-card[data-jump]').forEach(card => card.addEventListener('click', () => {
  const target = card.dataset.jump;
  statusFilter = target;
  $$('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.status === target));
  render();
}));

let searchTimer;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTerm = e.target.value.trim(); render(); }, 140);
});

$('#sortSelect').addEventListener('change', e => { sortBy = e.target.value; render(); });

$('#btnRefresh').addEventListener('click', () => loadPlans());

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (openMenuId) { $$('.menu').forEach(m => m.hidden = true); openMenuId = null; return; }
    if (document.activeElement === $('#searchInput')) $('#searchInput').blur();
  }
  // "/" focuses search, the way most list views behave
  if (e.key === '/' && document.activeElement !== $('#searchInput')) {
    e.preventDefault();
    $('#searchInput').focus();
  }
});

loadPlans();
