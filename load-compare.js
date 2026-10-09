// ============================================================
// SmarTuna · Compare plans
// ------------------------------------------------------------
// Two saved plans side by side in 3D with locked cameras, a
// metric scorecard, and a real answer to "which fits more" —
// computed by actually trying to pack more cartons into each.
//
// The geometry, stability and packing constants here mirror
// load-planner.js exactly, so both pages agree on the numbers.
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- shared with the planner — keep in step ----
const ORIENTATIONS = [
  { x: 'length_cm', y: 'height_cm', z: 'width_cm'  },
  { x: 'width_cm',  y: 'height_cm', z: 'length_cm' },
  { x: 'length_cm', y: 'width_cm',  z: 'height_cm' },
  { x: 'height_cm', y: 'width_cm',  z: 'length_cm' },
  { x: 'width_cm',  y: 'length_cm', z: 'height_cm' },
  { x: 'height_cm', y: 'length_cm', z: 'width_cm'  }
];
const SUPPORT_RATIO = 0.7;
const PACK_EPS = 0.01;
const MAX_POINTS = 2400;
const BCT_KGF_PER_CM = { carton: 2.0, pallet: 12, slipsheet: 1.5 };
const STACK_SAFETY_FACTOR = 6;
const MIN_SUPPORT_RATIO = 0.6;
const CONTACT_EPS_CM = 1.0;
// Above any realistic carton count for a 45ft, so the figure reported is the
// packer's real answer rather than the ceiling. A full 40HC of small cartons
// takes roughly half a second.
const MAX_HEADROOM_ADDS = 1500;

const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

let planList = [];
const slots = { a: null, b: null };      // { plan, items, metrics, scene… }
let currentView = 'perspective';
let syncing = false;

// ============================================================
// HELPERS
// ============================================================
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function describeError(err) {
  if (!err) return 'unknown error';
  const bits = [err.message, err.details, err.hint].filter(Boolean);
  const text = bits.join(' · ') || 'unknown error';
  return err.code ? `${text} [${err.code}]` : text;
}

function showToast(msg) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => t.classList.remove('show'), 2800);
}

function normaliseOrient(raw) {
  const n = Number(raw);
  if (n === 90) return 1;
  return (Number.isInteger(n) && n >= 0 && n <= 5) ? n : 0;
}
function extentFor(item, o) {
  const m = ORIENTATIONS[o] || ORIENTATIONS[0];
  return { l: item[m.x], h: item[m.y], w: item[m.z] };
}
const itemExtent = item => extentFor(item, item.rot_y);

function itemBounds(item) {
  const e = itemExtent(item);
  return {
    minX: item.pos_x - e.l / 2, maxX: item.pos_x + e.l / 2,
    minY: item.pos_y - e.h / 2, maxY: item.pos_y + e.h / 2,
    minZ: item.pos_z - e.w / 2, maxZ: item.pos_z + e.w / 2
  };
}

const volumeOf = i => i.length_cm * i.width_cm * i.height_cm;

function bearingCapacity(item) {
  if (item.max_stack_kg > 0) return Number(item.max_stack_kg);
  const e = itemExtent(item);
  const k = BCT_KGF_PER_CM[item.kind] ?? BCT_KGF_PER_CM.carton;
  return 2 * (e.l + e.w) * k / STACK_SAFETY_FACTOR;
}

// ============================================================
// METRICS
// ============================================================
// Same model as the planner: who rests on whom, weight pushed
// down the stack, then crush / tipping / float checks.
function countIssues(items) {
  const supportsOf = new Map();
  for (const item of items) {
    const b = itemBounds(item);
    if (b.minY < 0.5) { supportsOf.set(item.id, null); continue; }
    const list = [];
    for (const other of items) {
      if (other.id === item.id) continue;
      const ob = itemBounds(other);
      if (Math.abs(ob.maxY - b.minY) > CONTACT_EPS_CM) continue;
      const ox = Math.min(b.maxX, ob.maxX) - Math.max(b.minX, ob.minX);
      const oz = Math.min(b.maxZ, ob.maxZ) - Math.max(b.minZ, ob.minZ);
      if (ox > 0.1 && oz > 0.1) list.push({ id: other.id, area: ox * oz, handling: other.handling });
    }
    supportsOf.set(item.id, list);
  }

  const carried = new Map(items.map(i => [i.id, 0]));
  [...items].sort((a, b) => b.pos_y - a.pos_y).forEach(item => {
    const sup = supportsOf.get(item.id);
    if (!sup || !sup.length) return;
    const total = sup.reduce((s, x) => s + x.area, 0);
    if (total <= 0) return;
    const passing = (item.weight_kg || 0) + carried.get(item.id);
    sup.forEach(s => carried.set(s.id, carried.get(s.id) + passing * (s.area / total)));
  });

  let danger = 0, warn = 0;
  for (const item of items) {
    const e = itemExtent(item);
    const footprint = e.l * e.w;
    const sup = supportsOf.get(item.id);
    const load = carried.get(item.id) || 0;
    let lvl = null;

    if (sup !== null) {
      if (!sup.length) lvl = 'danger';
      else {
        const ratio = footprint > 0 ? sup.reduce((s, x) => s + x.area, 0) / footprint : 1;
        if (ratio < MIN_SUPPORT_RATIO) lvl = ratio < 0.3 ? 'danger' : 'warn';
      }
    }
    if (load > 0.05) {
      const cap = bearingCapacity(item);
      if (load > cap) lvl = 'danger';
      else if (load > cap * 0.8 && lvl !== 'danger') lvl = 'warn';
      if (item.handling === 'fragile' && lvl !== 'danger') lvl = 'warn';
    }
    if (item.handling === 'this_side_up' && item.rot_y > 1 && lvl !== 'danger') lvl = 'warn';

    if (lvl === 'danger') danger++;
    else if (lvl === 'warn') warn++;
  }
  return { danger, warn, total: danger + warn };
}

// Positive means the load sits toward the doors
function balanceOf(plan, items) {
  const L = Number(plan.space_length_cm);
  let totalW = 0, moment = 0;
  for (const i of items) {
    const w = i.weight_kg || 0;
    totalW += w;
    moment += w * i.pos_x;
  }
  if (totalW <= 0 || L <= 0) return 0;
  return ((moment / totalW) - L / 2) / (L / 2) * 100;
}

function computeMetrics(plan, items) {
  const L = Number(plan.space_length_cm);
  const W = Number(plan.space_width_cm);
  const H = Number(plan.space_height_cm);
  const spaceVol = L * W * H;
  const itemVol = items.reduce((s, i) => s + volumeOf(i), 0);
  const weight = items.reduce((s, i) => s + (i.weight_kg || 0), 0);

  // How tall the load actually stands, as a share of the container
  const topY = items.reduce((m, i) => Math.max(m, itemBounds(i).maxY), 0);

  return {
    spaceVol, itemVol,
    fillPct: spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0,
    wastedM3: Math.max(0, (spaceVol - itemVol)) / 1e6,
    itemCount: items.length,
    weight,
    densityKgM3: itemVol > 0 ? weight / (itemVol / 1e6) : 0,
    heightUsePct: H > 0 ? (topY / H) * 100 : 0,
    balance: balanceOf(plan, items),
    issues: countIssues(items),
    containerM3: spaceVol / 1e6
  };
}

// ============================================================
// HEADROOM — actually try to pack more in
// ------------------------------------------------------------
// Extreme-point first fit, seeded with the plan's existing
// cargo as obstacles, then adding copies of a reference carton
// until nothing more fits.
// ============================================================
function packCollides(placed, x, y, z, dl, dh, dw) {
  for (const r of placed) {
    if (x + dl - PACK_EPS <= r.minX || r.minX + r.dl - PACK_EPS <= x) continue;
    if (y + dh - PACK_EPS <= r.minY || r.minY + r.dh - PACK_EPS <= y) continue;
    if (z + dw - PACK_EPS <= r.minZ || r.minZ + r.dw - PACK_EPS <= z) continue;
    return true;
  }
  return false;
}

function packSupport(placed, x, y, z, dl, dw) {
  let area = 0, onFragile = false;
  for (const r of placed) {
    if (Math.abs(r.minY + r.dh - y) > 0.5) continue;
    const ox = Math.min(x + dl, r.minX + r.dl) - Math.max(x, r.minX);
    const oz = Math.min(z + dw, r.minZ + r.dw) - Math.max(z, r.minZ);
    if (ox > PACK_EPS && oz > PACK_EPS) {
      area += ox * oz;
      if (r.handling === 'fragile') onFragile = true;
    }
  }
  return { area, onFragile };
}

function prunePoints(points, placed) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = `${p.x.toFixed(1)}|${p.y.toFixed(1)}|${p.z.toFixed(1)}`;
    if (seen.has(key)) continue;
    let inside = false;
    for (const r of placed) {
      if (p.x > r.minX - PACK_EPS && p.x < r.minX + r.dl - PACK_EPS &&
          p.y > r.minY - PACK_EPS && p.y < r.minY + r.dh - PACK_EPS &&
          p.z > r.minZ - PACK_EPS && p.z < r.minZ + r.dw - PACK_EPS) { inside = true; break; }
    }
    if (inside) continue;
    seen.add(key);
    out.push(p);
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);
  return out.length > MAX_POINTS ? out.slice(0, MAX_POINTS) : out;
}

// The carton a planner would most likely add more of: the SKU
// that appears most often, breaking ties by larger volume.
function referenceItem(items) {
  if (!items.length) return null;
  const groups = new Map();
  for (const i of items) {
    const key = i.base_label || i.label;
    if (!groups.has(key)) groups.set(key, { key, items: [], count: 0 });
    const g = groups.get(key);
    g.items.push(i);
    g.count++;
  }
  const best = [...groups.values()].sort((a, b) =>
    b.count - a.count || volumeOf(b.items[0]) - volumeOf(a.items[0]))[0];
  return { label: best.key, count: best.count, proto: best.items[0] };
}

function computeHeadroom(plan, items) {
  const ref = referenceItem(items);
  if (!ref) return null;

  const L = Number(plan.space_length_cm);
  const W = Number(plan.space_width_cm);
  const H = Number(plan.space_height_cm);

  // Seed with what's already loaded
  const placed = items.map(i => {
    const b = itemBounds(i);
    const e = itemExtent(i);
    return {
      minX: b.minX, minY: b.minY, minZ: b.minZ,
      dl: e.l, dh: e.h, dw: e.w, handling: i.handling
    };
  });

  let points = [{ x: 0, y: 0, z: 0 }];
  for (const r of placed) {
    points.push({ x: r.minX + r.dl, y: r.minY, z: r.minZ });
    points.push({ x: r.minX, y: r.minY + r.dh, z: r.minZ });
    points.push({ x: r.minX, y: r.minY, z: r.minZ + r.dw });
  }
  points = prunePoints(points, placed);

  const proto = ref.proto;
  const allowed = proto.handling === 'this_side_up' ? [0, 1] : [0, 1, 2, 3, 4, 5];
  let added = 0;

  while (added < MAX_HEADROOM_ADDS) {
    let hit = null;
    search:
    for (const p of points) {
      for (const oi of allowed) {
        const e = extentFor(proto, oi);
        const dl = e.l, dw = e.w, dh = e.h;
        if (p.x + dl > L + PACK_EPS) continue;
        if (p.y + dh > H + PACK_EPS) continue;
        if (p.z + dw > W + PACK_EPS) continue;
        if (packCollides(placed, p.x, p.y, p.z, dl, dh, dw)) continue;
        if (p.y > 0.5) {
          const sup = packSupport(placed, p.x, p.y, p.z, dl, dw);
          if (sup.onFragile) continue;
          if (sup.area < dl * dw * SUPPORT_RATIO) continue;
        }
        hit = { p, dl, dw, dh };
        break search;
      }
    }
    if (!hit) break;

    placed.push({
      minX: hit.p.x, minY: hit.p.y, minZ: hit.p.z,
      dl: hit.dl, dh: hit.dh, dw: hit.dw, handling: proto.handling
    });
    points = points.filter(q => q !== hit.p);
    points.push({ x: hit.p.x + hit.dl, y: hit.p.y, z: hit.p.z });
    points.push({ x: hit.p.x, y: hit.p.y + hit.dh, z: hit.p.z });
    points.push({ x: hit.p.x, y: hit.p.y, z: hit.p.z + hit.dw });
    points = prunePoints(points, placed);
    added++;
  }

  const unitVol = volumeOf(proto);
  return {
    label: ref.label,
    added,
    capped: added >= MAX_HEADROOM_ADDS,
    unitWeight: proto.weight_kg || 0,
    extraVolM3: (added * unitVol) / 1e6,
    extraWeight: added * (proto.weight_kg || 0),
    protoDims: `${proto.length_cm} × ${proto.width_cm} × ${proto.height_cm} cm`
  };
}

// ============================================================
// 3D PANES
// ============================================================
function makePane(slot) {
  const canvas = $(`#canvas${slot.toUpperCase()}`);
  const host = $(`#view${slot.toUpperCase()}`);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 400);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(12, 18, 10);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e4f5, 0.3);
  fill.position.set(-8, 6, -10);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;

  const world = new THREE.Group();
  scene.add(world);

  // Orbiting one pane drives the other when the lock is on
  controls.addEventListener('change', () => {
    if (!$('#syncCams').checked || syncing) return;
    const other = slots[slot === 'a' ? 'b' : 'a'];
    if (!other) return;
    syncing = true;
    other.camera.position.copy(camera.position);
    other.controls.target.copy(controls.target);
    other.camera.updateProjectionMatrix();
    other.controls.update();
    syncing = false;
  });

  return { slot, scene, camera, renderer, controls, world, host, canvas };
}

function clearWorld(pane) {
  const w = pane.world;
  while (w.children.length) {
    const c = w.children[0];
    w.remove(c);
    c.traverse?.(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      }
    });
  }
}

function buildScene(pane, plan, items) {
  clearWorld(pane);
  const L = Number(plan.space_length_cm) / 100;
  const W = Number(plan.space_width_cm) / 100;
  const H = Number(plan.space_height_cm) / 100;

  // Floor
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(L, 0.05, W),
    new THREE.MeshStandardMaterial({ color: 0xdae2ec, roughness: 0.9 })
  );
  floor.position.set(L / 2, -0.025, 0);
  pane.world.add(floor);

  // Container outline + door marker
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
    new THREE.LineBasicMaterial({ color: 0x1a6fdb, transparent: true, opacity: 0.6 })
  );
  wire.position.set(L / 2, H / 2, 0);
  pane.world.add(wire);

  const doorPts = [
    new THREE.Vector3(L, 0, -W / 2), new THREE.Vector3(L, H, -W / 2),
    new THREE.Vector3(L, H, W / 2),  new THREE.Vector3(L, 0, W / 2),
    new THREE.Vector3(L, 0, -W / 2)
  ];
  const door = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(doorPts),
    new THREE.LineDashedMaterial({ color: 0x1a6fdb, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.8 })
  );
  door.computeLineDistances();
  pane.world.add(door);

  // Cargo
  for (const it of items) {
    const e = itemExtent(it);
    const geo = new THREE.BoxGeometry(e.l / 100, e.h / 100, e.w / 100);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: it.color || '#1a6fdb', roughness: 0.75, metalness: 0.05
    }));
    mesh.position.set(it.pos_x / 100, it.pos_y / 100, it.pos_z / 100 - W / 2);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x1a2536, transparent: true, opacity: 0.4 })
    );
    mesh.add(edge);
    pane.world.add(mesh);
  }

  pane.dims = { L, W, H };
  applyView(pane, currentView);
}

// With "match scale" on, both panes frame the larger of the two
// containers, so a 20ft genuinely looks shorter than a 40ft.
function framingSpan(pane) {
  const own = pane.dims;
  if (!own) return 12;
  if (!$('#normScale').checked) return Math.max(own.L, own.W * 3, own.H * 3);
  const other = slots[pane.slot === 'a' ? 'b' : 'a'];
  const o = other?.dims;
  const L = o ? Math.max(own.L, o.L) : own.L;
  const W = o ? Math.max(own.W, o.W) : own.W;
  const H = o ? Math.max(own.H, o.H) : own.H;
  return Math.max(L, W * 3, H * 3);
}

function applyView(pane, view) {
  if (!pane.dims) return;
  const { L, W, H } = pane.dims;
  const span = framingSpan(pane);
  const cx = L / 2, cy = H / 2;
  const targets = {
    perspective: [[cx + span * 0.75, H * 2.4, W * 4.2], [cx, cy, 0]],
    top:         [[cx, span * 1.5, 0.01],                [cx, 0, 0]],
    side:        [[cx, cy, W * 6.5 + span * 0.25],       [cx, cy, 0]],
    front:       [[L + span * 1.25, cy, 0.01],           [cx, cy, 0]]
  };
  const [pos, tgt] = targets[view] || targets.perspective;
  pane.camera.position.set(...pos);
  pane.controls.target.set(...tgt);
  pane.camera.updateProjectionMatrix();
  pane.controls.update();
}

function resizePane(pane) {
  const r = pane.host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  pane.camera.aspect = r.width / r.height;
  pane.camera.updateProjectionMatrix();
  pane.renderer.setSize(r.width, r.height);
}

function animate() {
  requestAnimationFrame(animate);
  for (const slot of ['a', 'b']) {
    const p = slots[slot];
    if (!p) continue;
    p.controls.update();
    p.renderer.render(p.scene, p.camera);
  }
}

// ============================================================
// LOADING
// ============================================================
async function fetchPlanList() {
  const { data, error } = await supabase
    .from('load_plans').select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  planList = data || [];
  for (const id of ['#pickA', '#pickB']) {
    $(id).innerHTML = '<option value="">Choose a plan…</option>' +
      planList.map(p => {
        const fill = (Number(p.volume_utilization) || 0).toFixed(0);
        return `<option value="${p.id}">${escapeHtml(p.name)} · ${p.status} · ${fill}%</option>`;
      }).join('');
  }
}

async function fetchPlanItems(planId) {
  const { data, error } = await supabase
    .from('load_plan_items').select('*')
    .eq('load_plan_id', planId).order('created_at');
  if (error) throw error;
  return (data || []).map(it => ({
    ...it,
    length_cm: Number(it.length_cm), width_cm: Number(it.width_cm),
    height_cm: Number(it.height_cm), weight_kg: Number(it.weight_kg) || 0,
    pos_x: Number(it.pos_x), pos_y: Number(it.pos_y), pos_z: Number(it.pos_z),
    rot_y: normaliseOrient(it.rot_y)
  }));
}

async function selectPlan(slot, planId) {
  const pane = slots[slot];
  const emptyEl = $(`#empty${slot.toUpperCase()}`);
  const openEl = $(`#open${slot.toUpperCase()}`);

  if (!planId) {
    pane.plan = null; pane.items = null; pane.metrics = null; pane.headroom = null;
    clearWorld(pane);
    emptyEl.hidden = false;
    openEl.hidden = true;
    $(`#foot${slot.toUpperCase()}`).innerHTML = '';
    refreshComparison();
    return;
  }

  const plan = planList.find(p => p.id === planId);
  if (!plan) return;

  emptyEl.hidden = false;
  emptyEl.textContent = 'Loading…';
  try {
    const items = await fetchPlanItems(planId);
    pane.plan = plan;
    pane.items = items;
    pane.metrics = computeMetrics(plan, items);
    pane.headroom = computeHeadroom(plan, items);

    buildScene(pane, plan, items);
    resizePane(pane);
    emptyEl.hidden = true;
    openEl.hidden = false;
    openEl.href = `load-planner.html?plan=${encodeURIComponent(planId)}`;
    renderPaneFoot(slot);
    refreshComparison();
    syncUrl();
  } catch (err) {
    console.error('Plan load failed:', describeError(err), err);
    emptyEl.hidden = false;
    emptyEl.textContent = 'Could not load this plan';
    showToast(`Load failed: ${escapeHtml(describeError(err))}`);
  }
}

function renderPaneFoot(slot) {
  const p = slots[slot];
  const m = p.metrics;
  if (!m) return;
  const issueTone = m.issues.danger ? 'tone-danger' : m.issues.warn ? 'tone-warn' : 'tone-ok';
  const issueText = m.issues.danger ? `${m.issues.danger} unsafe`
                  : m.issues.warn ? `${m.issues.warn} to check` : 'Clear';
  $(`#foot${slot.toUpperCase()}`).innerHTML = `
    <div class="pf-stat"><span>Filled</span><b>${m.fillPct.toFixed(1)}%</b></div>
    <div class="pf-stat"><span>Items</span><b>${m.itemCount}</b></div>
    <div class="pf-stat"><span>Weight</span><b>${m.weight.toFixed(0)} kg</b></div>
    <div class="pf-stat"><span>Checks</span><b class="${issueTone}">${issueText}</b></div>`;
}

// ============================================================
// COMPARISON OUTPUT
// ============================================================
// higher: is a bigger number better? null means neither — shown for context only
const METRICS = [
  { key: 'fillPct',      name: 'Volume filled',    note: 'Share of the container taken by cargo',            higher: true,  fmt: v => `${v.toFixed(1)}%` },
  { key: 'itemCount',    name: 'Items loaded',     note: 'Pieces placed in the plan',                        higher: true,  fmt: v => `${v}` },
  { key: 'wastedM3',     name: 'Wasted space',     note: 'Container volume left empty',                      higher: false, fmt: v => `${v.toFixed(2)} m³` },
  { key: 'weight',       name: 'Total weight',     note: 'Heavier is not better — shown for payload limits', higher: null,  fmt: v => `${v.toFixed(0)} kg` },
  { key: 'densityKgM3',  name: 'Cargo density',    note: 'Weight per m³ of cargo',                           higher: null,  fmt: v => `${v.toFixed(0)} kg/m³` },
  { key: 'heightUsePct', name: 'Height used',      note: 'How far the load reaches up the walls',            higher: true,  fmt: v => `${v.toFixed(0)}%` },
  { key: 'balanceAbs',   name: 'Fore/aft balance', note: 'Distance of the load centre from the middle',      higher: false, fmt: v => `${v.toFixed(1)}%` },
  { key: 'issueCount',   name: 'Stability flags',  note: 'Crush, tipping and orientation warnings',          higher: false, fmt: v => `${v}` }
];

function metricValue(m, key) {
  if (key === 'balanceAbs') return Math.abs(m.balance);
  if (key === 'issueCount') return m.issues.total;
  return m[key];
}

function refreshComparison() {
  const A = slots.a?.metrics, B = slots.b?.metrics;
  const both = A && B;

  $('#scorecard').hidden = !both;
  $('#headroom').hidden = !both;
  $('#verdict').hidden = !both;
  if (!both) return;

  // ---- scorecard ----
  const rows = METRICS.map(def => {
    const va = metricValue(A, def.key);
    const vb = metricValue(B, def.key);
    let winner = null;
    if (def.higher !== null && Math.abs(va - vb) > 1e-6) {
      winner = def.higher ? (va > vb ? 'a' : 'b') : (va < vb ? 'a' : 'b');
    }
    const diff = Math.abs(va - vb);
    const gap = winner
      ? `<b>${def.fmt(diff)}</b> better for ${winner.toUpperCase()}`
      : (def.higher === null ? 'for reference' : 'level');

    return `
      <div class="metric-row">
        <div class="metric-name">${def.name}<small>${def.note}</small></div>
        <div class="metric-val ${winner === 'a' ? 'win-a' : ''}" data-slot="A">
          ${winner === 'a' ? '<span class="win-dot a">✓</span>' : ''}${def.fmt(va)}
        </div>
        <div class="metric-val ${winner === 'b' ? 'win-b' : ''}" data-slot="B">
          ${winner === 'b' ? '<span class="win-dot b">✓</span>' : ''}${def.fmt(vb)}
        </div>
        <div class="metric-gap">${gap}</div>
      </div>`;
  }).join('');

  $('#metricTable').innerHTML = `
    <div class="metric-row is-head">
      <div>Metric</div><div>Plan A</div><div>Plan B</div><div>Difference</div>
    </div>${rows}`;

  renderHeadroom();
  renderVerdict();
}

function renderHeadroom() {
  const ha = slots.a.headroom, hb = slots.b.headroom;
  const grid = $('#headroomGrid');

  $('#headroomNote').innerHTML =
    'Each plan is re-packed with more of its own most-used carton until nothing else fits — ' +
    'the same packer the planner uses, respecting support, fragile cargo and orientation rules. ' +
    'This is spare capacity on top of what is already loaded.';

  const card = (slot, h, plan) => {
    if (!h) return `<div class="headroom-card" data-slot="${slot}">
      <div class="hr-head"><span class="slot-tag tag-${slot}">${slot.toUpperCase()}</span>${escapeHtml(plan.name)}</div>
      <div class="hr-big">—<small>No cargo to extrapolate from</small></div></div>`;
    return `
      <div class="headroom-card" data-slot="${slot}">
        <div class="hr-head"><span class="slot-tag tag-${slot}">${slot.toUpperCase()}</span>${escapeHtml(plan.name)}</div>
        <div class="hr-big">${h.capped ? h.added + '+' : h.added}
          <small>more × ${escapeHtml(h.label)}</small></div>
        <div class="hr-detail">
          Reference carton <b>${escapeHtml(h.protoDims)}</b>${h.unitWeight ? ` at <b>${h.unitWeight} kg</b>` : ''}.<br>
          That would add <b>${h.extraVolM3.toFixed(2)} m³</b>${h.extraWeight ? ` and <b>${h.extraWeight.toFixed(0)} kg</b>` : ''}.
          ${h.capped ? '<br>Stopped at the simulation limit — effectively wide open.' : ''}
        </div>
      </div>`;
  };

  grid.innerHTML = card('a', ha, slots.a.plan) + card('b', hb, slots.b.plan);
}

function renderVerdict() {
  const A = slots.a.metrics, B = slots.b.metrics;
  const nameA = slots.a.plan.name, nameB = slots.b.plan.name;
  const ha = slots.a.headroom, hb = slots.b.headroom;

  // Three independent questions, judged separately
  const fitWin = Math.abs(A.fillPct - B.fillPct) < 0.5 ? null : (A.fillPct > B.fillPct ? 'a' : 'b');
  const safeWin = A.issues.total === B.issues.total ? null
    : (A.issues.danger !== B.issues.danger
        ? (A.issues.danger < B.issues.danger ? 'a' : 'b')
        : (A.issues.total < B.issues.total ? 'a' : 'b'));
  const balWin = Math.abs(Math.abs(A.balance) - Math.abs(B.balance)) < 1 ? null
    : (Math.abs(A.balance) < Math.abs(B.balance) ? 'a' : 'b');

  const score = { a: 0, b: 0 };
  if (fitWin)  score[fitWin]  += 2;        // fit is the headline question
  if (safeWin) score[safeWin] += 2;        // an unsafe plan is not a better plan
  if (balWin)  score[balWin]  += 1;

  let overall = 'tie';
  if (score.a > score.b) overall = 'a';
  else if (score.b > score.a) overall = 'b';

  const winName = overall === 'a' ? nameA : overall === 'b' ? nameB : null;
  const mark = overall === 'a' ? 'A' : overall === 'b' ? 'B' : '=';

  const reasons = [];
  if (fitWin) {
    const hi = fitWin === 'a' ? A : B, lo = fitWin === 'a' ? B : A;
    reasons.push(`<b>${fitWin.toUpperCase()}</b> fills ${(hi.fillPct - lo.fillPct).toFixed(1)} percentage points more of the container`);
  } else {
    reasons.push('both fill the container to within half a point of each other');
  }
  if (safeWin) {
    const w = safeWin === 'a' ? A : B, l = safeWin === 'a' ? B : A;
    reasons.push(`<b>${safeWin.toUpperCase()}</b> raises ${l.issues.total - w.issues.total} fewer stability flag${(l.issues.total - w.issues.total) === 1 ? '' : 's'}`);
  } else if (A.issues.total > 0) {
    reasons.push(`both raise ${A.issues.total} stability flag${A.issues.total === 1 ? '' : 's'}`);
  } else {
    reasons.push('neither raises a stability flag');
  }
  if (balWin) {
    reasons.push(`<b>${balWin.toUpperCase()}</b> sits closer to centre fore/aft`);
  }

  // Headroom is reported, not scored — it depends on carton choice
  let roomLine = '';
  if (ha && hb) {
    if (ha.added === hb.added) {
      roomLine = ` Both have room for about ${ha.added} more of their own carton.`;
    } else {
      const more = ha.added > hb.added ? 'A' : 'B';
      const hiH = ha.added > hb.added ? ha : hb;
      const loH = ha.added > hb.added ? hb : ha;
      roomLine = ` <b>${more}</b> has the most left over — room for ${hiH.added} more ${escapeHtml(hiH.label)} against ${loH.added} for the other.`;
    }
  }

  const danger = (A.issues.danger || B.issues.danger)
    ? ` <b>Note:</b> ${A.issues.danger ? `A has ${A.issues.danger} likely-unsafe item${A.issues.danger === 1 ? '' : 's'}` : ''}${A.issues.danger && B.issues.danger ? ' and ' : ''}${B.issues.danger ? `B has ${B.issues.danger}` : ''} — worth fixing before shipping either.`
    : '';

  $('#verdict').innerHTML = `
    <div class="verdict-mark win-${overall}">${mark}</div>
    <div class="verdict-body">
      <div class="verdict-title">${overall === 'tie'
        ? 'Too close to call'
        : `${escapeHtml(winName)} packs better`}</div>
      <div class="verdict-why">${reasons.join(', ')}.${roomLine}${danger}</div>
    </div>`;
}

// ============================================================
// URL + EVENTS
// ============================================================
function syncUrl() {
  const url = new URL(window.location);
  slots.a?.plan ? url.searchParams.set('a', slots.a.plan.id) : url.searchParams.delete('a');
  slots.b?.plan ? url.searchParams.set('b', slots.b.plan.id) : url.searchParams.delete('b');
  window.history.replaceState({}, '', url);
}

$('#pickA').addEventListener('change', e => selectPlan('a', e.target.value));
$('#pickB').addEventListener('change', e => selectPlan('b', e.target.value));

$('#btnSwap').addEventListener('click', () => {
  const av = $('#pickA').value, bv = $('#pickB').value;
  $('#pickA').value = bv; $('#pickB').value = av;
  selectPlan('a', bv); selectPlan('b', av);
});

$$('.view-pill').forEach(pill => pill.addEventListener('click', () => {
  $$('.view-pill').forEach(p => p.classList.toggle('selected', p === pill));
  currentView = pill.dataset.view;
  ['a', 'b'].forEach(s => slots[s] && applyView(slots[s], currentView));
}));

$('#normScale').addEventListener('change', () => {
  ['a', 'b'].forEach(s => slots[s] && applyView(slots[s], currentView));
});

$('#syncCams').addEventListener('change', e => {
  if (!e.target.checked || !slots.a?.plan || !slots.b?.plan) return;
  syncing = true;
  slots.b.camera.position.copy(slots.a.camera.position);
  slots.b.controls.target.copy(slots.a.controls.target);
  slots.b.controls.update();
  syncing = false;
});

window.addEventListener('resize', () => {
  ['a', 'b'].forEach(s => slots[s] && resizePane(slots[s]));
});

// ============================================================
// BOOT
// ============================================================
async function boot() {
  slots.a = makePane('a');
  slots.b = makePane('b');
  animate();

  try {
    await fetchPlanList();
  } catch (err) {
    console.error('Plan list failed:', describeError(err), err);
    showToast(`Couldn't load plans: ${escapeHtml(describeError(err))}`);
    return;
  }

  if (planList.length < 2) {
    showToast('You need at least two saved plans to compare.');
  }

  // Arrive pre-loaded from the overview page, or default to the two newest
  const params = new URLSearchParams(window.location.search);
  const a = params.get('a') || planList[0]?.id || '';
  const b = params.get('b') || planList[1]?.id || '';
  if (a) { $('#pickA').value = a; await selectPlan('a', a); }
  if (b && b !== a) { $('#pickB').value = b; await selectPlan('b', b); }

  requestAnimationFrame(() => ['a', 'b'].forEach(s => slots[s] && resizePane(slots[s])));
  setTimeout(() => ['a', 'b'].forEach(s => slots[s] && resizePane(slots[s])), 200);
}

boot();
