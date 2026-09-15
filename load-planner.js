// ============================================================
// SmarTuna · 3D Load Planner (ST) — Phase 2 (revised)
// ------------------------------------------------------------
// Fixes applied:
//   1. Non-overlapping auto-placement (grid scan for free slot)
//   2. Stacking — drag onto another carton snaps to top
//   3. Drag threshold (4px) — small clicks stay clicks
//   4. Shift-drag / Right-drag ALWAYS orbits, even over cartons
//   5. Form auto-clears after add — ready for next SKU
//   6. Same base-label → same colour (across separate adds)
//   7. Sprite labels above cartons — toggle with Aa button
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// Cargo-space presets (metres)
// ============================================================
const PRESETS = {
  '40HC':   { name: "40' High Cube",  length: 12.03, width: 2.35, height: 2.69 },
  '40STD':  { name: "40' Standard",   length: 12.03, width: 2.35, height: 2.39 },
  '20STD':  { name: "20' Standard",   length: 5.90,  width: 2.35, height: 2.39 },
  '45HC':   { name: "45' High Cube",  length: 13.55, width: 2.35, height: 2.69 },
  'Custom': { name: 'Custom',         length: 5.00,  width: 2.00, height: 2.10 }
};

const MODE_LABELS = { Sea: 'SEA', Road: 'ROAD', Air: 'AIR', Rail: 'RAIL' };

// 12-color palette — cycles when exhausted
const CARGO_COLORS = [
  '#1a6fdb', '#38b47a', '#f4a11c', '#e04a4a',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
  '#f97316', '#84cc16', '#6366f1', '#d946ef'
];

// ============================================================
// State
// ============================================================
let scene, camera, renderer, controls;
let containerGroup;
let cartonGroup;
let raycaster, dragPlane;
let cargoSpace = { length: 12.03, width: 2.35, height: 2.69 };
let transportMode = 'Sea';
let items = [];
let selectedItemId = null;
let quantity = 1;
let batchCounter = 0;      // for auto-generated base labels
let showLabels = false;    // sprite labels off by default
let dragState = null;

// ============================================================
// DOM refs
// ============================================================
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const canvas   = $('#scene-canvas');
const viewport = $('#viewport');
const toast    = $('#toast');

// ============================================================
// SCENE SETUP
// ============================================================
function initScene() {
  scene = new THREE.Scene();
  scene.background = null;

  const rect = viewport.getBoundingClientRect();
  const aspect = rect.width && rect.height ? rect.width / rect.height : 16 / 9;

  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
  camera.position.set(15, 8, 12);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(rect.width || 800, rect.height || 500);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(12, 18, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -25;
  key.shadow.camera.right = 25;
  key.shadow.camera.top = 25;
  key.shadow.camera.bottom = -25;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd6e4f5, 0.3);
  fill.position.set(-8, 6, -10);
  scene.add(fill);

  // Ground grid
  const grid = new THREE.GridHelper(60, 60, 0xc5d0dc, 0xe5eaf0);
  scene.add(grid);

  // Cargo group (all cartons)
  cartonGroup = new THREE.Group();
  scene.add(cartonGroup);

  // Orbit controls — right-click also orbits (double the affordance)
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };

  raycaster = new THREE.Raycaster();
  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  buildContainer();
  attachSceneInput();
  animate();
}

// ============================================================
// CONTAINER
// ============================================================
function buildContainer() {
  if (containerGroup) {
    scene.remove(containerGroup);
    containerGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }

  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  containerGroup = new THREE.Group();

  // Floor
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(L, 0.05, W),
    new THREE.MeshStandardMaterial({ color: 0xdae2ec, roughness: 0.9, metalness: 0.05 })
  );
  floor.position.set(L / 2, 0.025, 0);
  floor.receiveShadow = true;
  containerGroup.add(floor);

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xeaf0f7, roughness: 0.85, metalness: 0.05,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide
  });

  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
  back.position.set(0, H / 2, 0);
  back.rotation.y = Math.PI / 2;
  containerGroup.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  left.position.set(L / 2, H / 2, -W / 2);
  containerGroup.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  right.position.set(L / 2, H / 2, W / 2);
  right.rotation.y = Math.PI;
  containerGroup.add(right);

  // Faint ceiling
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshStandardMaterial({
      color: 0xf3f6fa, roughness: 0.95, transparent: true, opacity: 0.15, side: THREE.DoubleSide
    })
  );
  ceil.position.set(L / 2, H, 0);
  ceil.rotation.x = Math.PI / 2;
  containerGroup.add(ceil);

  // Wire outline
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W));
  const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x1a6fdb }));
  wire.position.set(L / 2, H / 2, 0);
  containerGroup.add(wire);

  // Dashed door line
  const doorPoints = [
    new THREE.Vector3(L, 0, -W / 2),
    new THREE.Vector3(L, H, -W / 2),
    new THREE.Vector3(L, H,  W / 2),
    new THREE.Vector3(L, 0,  W / 2),
    new THREE.Vector3(L, 0, -W / 2)
  ];
  const door = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(doorPoints),
    new THREE.LineDashedMaterial({
      color: 0x1a6fdb, dashSize: 0.15, gapSize: 0.1, opacity: 0.7, transparent: true
    })
  );
  door.computeLineDistances();
  containerGroup.add(door);

  scene.add(containerGroup);

  controls.target.set(L / 2, H / 2, 0);
  controls.update();

  items.forEach(clampItemToBounds);
  items.forEach(refreshItemMesh);
  updateStats();
}

// ============================================================
// GEOMETRY HELPERS — collision & bounds
// ============================================================

// Returns axis-aligned bounds of an item's footprint (cm)
function itemBounds(item) {
  const rotated = item.rot_y === 90;
  const boxL = rotated ? item.width_cm  : item.length_cm;
  const boxW = rotated ? item.length_cm : item.width_cm;
  return {
    minX: item.pos_x - boxL / 2, maxX: item.pos_x + boxL / 2,
    minY: item.pos_y - item.height_cm / 2, maxY: item.pos_y + item.height_cm / 2,
    minZ: item.pos_z - boxW / 2, maxZ: item.pos_z + boxW / 2
  };
}

// Does `test` overlap any other item? (Small epsilon so touching = no collision)
function collidesWithAny(test, excludeId) {
  const a = itemBounds(test);
  const eps = 0.5;
  return items.some(other => {
    if (other.id === excludeId) return false;
    const b = itemBounds(other);
    return a.minX + eps < b.maxX && a.maxX - eps > b.minX &&
           a.minY + eps < b.maxY && a.maxY - eps > b.minY &&
           a.minZ + eps < b.maxZ && a.maxZ - eps > b.minZ;
  });
}

// Highest surface directly beneath `item`'s XZ footprint (cm). 0 = floor.
function findSupportHeight(item, atX, atZ, excludeId) {
  const rotated = item.rot_y === 90;
  const boxL = rotated ? item.width_cm  : item.length_cm;
  const boxW = rotated ? item.length_cm : item.width_cm;
  const minX = atX - boxL / 2, maxX = atX + boxL / 2;
  const minZ = atZ - boxW / 2, maxZ = atZ + boxW / 2;
  const eps = 0.5;

  let top = 0;
  for (const other of items) {
    if (other.id === excludeId) continue;
    const b = itemBounds(other);
    // XZ footprints overlap?
    if (minX + eps < b.maxX && maxX - eps > b.minX &&
        minZ + eps < b.maxZ && maxZ - eps > b.minZ) {
      if (b.maxY > top) top = b.maxY;
    }
  }
  return top;
}

// Clamp position so item stays inside cargo space
function clampItemToBounds(item) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;

  const rotated = item.rot_y === 90;
  const halfL = (rotated ? item.width_cm  : item.length_cm) / 2;
  const halfW = (rotated ? item.length_cm : item.width_cm ) / 2;
  const halfH = item.height_cm / 2;

  item.pos_x = Math.max(halfL, Math.min(L - halfL, item.pos_x));
  item.pos_z = Math.max(halfW, Math.min(W - halfW, item.pos_z));
  item.pos_y = Math.max(halfH, Math.min(H - halfH, item.pos_y));
}

// ============================================================
// AUTO-PLACEMENT — find a free spot
// ============================================================
function findFreeSlot(item) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;

  const rotated = item.rot_y === 90;
  const boxL = rotated ? item.width_cm  : item.length_cm;
  const boxW = rotated ? item.length_cm : item.width_cm;
  const halfH = item.height_cm / 2;

  // Too big for the space? Just place at back-left (will overlap something).
  if (boxL > L || boxW > W || item.height_cm > H) {
    return { pos_x: boxL / 2, pos_y: halfH, pos_z: boxW / 2 };
  }

  // Grid scan on the floor: back-to-front, left-to-right
  const step = Math.max(2, Math.min(boxL, boxW) / 3);

  for (let x = boxL / 2; x <= L - boxL / 2; x += step) {
    for (let z = boxW / 2; z <= W - boxW / 2; z += step) {
      const test = {
        pos_x: x, pos_y: halfH, pos_z: z,
        length_cm: item.length_cm, width_cm: item.width_cm,
        height_cm: item.height_cm, rot_y: item.rot_y
      };
      if (!collidesWithAny(test, item.id)) {
        return { pos_x: x, pos_y: halfH, pos_z: z };
      }
    }
  }

  // Floor full — try stacking on top of existing items (lowest first)
  const candidates = items
    .filter(o => o.id !== item.id)
    .sort((a, b) => (a.pos_y + a.height_cm / 2) - (b.pos_y + b.height_cm / 2));

  for (const other of candidates) {
    const supportTop = other.pos_y + other.height_cm / 2;
    if (supportTop + item.height_cm > H) continue;                // ceiling
    const test = {
      pos_x: other.pos_x, pos_y: supportTop + halfH, pos_z: other.pos_z,
      length_cm: item.length_cm, width_cm: item.width_cm,
      height_cm: item.height_cm, rot_y: item.rot_y
    };
    if (!collidesWithAny(test, item.id)) {
      return { pos_x: other.pos_x, pos_y: supportTop + halfH, pos_z: other.pos_z };
    }
  }

  // Give up
  return { pos_x: boxL / 2, pos_y: halfH, pos_z: boxW / 2 };
}

// ============================================================
// COLOR — same base label = same color
// ============================================================
function pickColorForBase(baseLabel) {
  const existing = items.find(i => i.base_label === baseLabel);
  if (existing) return existing.color;

  const used = new Set(items.map(i => i.color));
  const available = CARGO_COLORS.find(c => !used.has(c));
  if (available) return available;

  const bases = new Set(items.map(i => i.base_label));
  return CARGO_COLORS[bases.size % CARGO_COLORS.length];
}

// ============================================================
// CARGO ITEMS — create / update / remove
// ============================================================
function uid() { return 'i_' + Math.random().toString(36).slice(2, 10); }

function generateBaseLabel() {
  batchCounter += 1;
  return `BATCH-${String(batchCounter).padStart(2, '0')}`;
}

function createItemMesh(item) {
  const rotated = item.rot_y === 90;
  const displayL = (rotated ? item.width_cm  : item.length_cm) / 100;
  const displayW = (rotated ? item.length_cm : item.width_cm ) / 100;
  const displayH = item.height_cm / 100;

  const geo = new THREE.BoxGeometry(displayL, displayH, displayW);
  const mat = new THREE.MeshStandardMaterial({
    color: item.color,
    roughness: 0.75,
    metalness: 0.05
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.itemId = item.id;

  // Edge lines
  const edgeGeo = new THREE.EdgesGeometry(geo);
  const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: 0x1a2536, transparent: true, opacity: 0.45
  }));
  wire.userData.isEdge = true;
  wire.raycast = () => {};                              // don't intercept clicks
  mesh.add(wire);

  // Label sprite
  const sprite = createLabelSprite(item);
  sprite.userData.isLabel = true;
  sprite.raycast = () => {};                            // don't intercept clicks
  sprite.visible = showLabels;
  mesh.add(sprite);

  return mesh;
}

function createLabelSprite(item) {
  const cnv = document.createElement('canvas');
  const width = 512, height = 160;
  cnv.width = width; cnv.height = height;
  const ctx = cnv.getContext('2d');

  // Rounded white pill with item-color border
  const pad = 8, radius = 24;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, radius);
  ctx.fill();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (item.product_name) {
    ctx.fillStyle = '#1a2536';
    ctx.font = 'bold 46px Poppins, sans-serif';
    ctx.fillText(truncate(item.label, 22), width / 2, height / 2 - 22);
    ctx.fillStyle = '#6b7789';
    ctx.font = '30px Poppins, sans-serif';
    ctx.fillText(truncate(item.product_name, 26), width / 2, height / 2 + 26);
  } else {
    ctx.fillStyle = '#1a2536';
    ctx.font = 'bold 58px Poppins, sans-serif';
    ctx.fillText(truncate(item.label, 22), width / 2, height / 2);
  }

  const texture = new THREE.CanvasTexture(cnv);
  texture.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,                                   // always on top
    depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);

  // Scale — width scales with box length, capped so it stays readable
  const baseW = Math.min(1.4, Math.max(0.7, item.length_cm / 100 * 1.1));
  sprite.scale.set(baseW, baseW * (height / width), 1);

  // Position above box top
  sprite.position.set(0, item.height_cm / 200 + 0.18, 0);

  return sprite;
}

function truncate(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function refreshItemMesh(item) {
  if (!item.mesh) return;
  const rotated = item.rot_y === 90;
  const displayL = (rotated ? item.width_cm  : item.length_cm) / 100;
  const displayW = (rotated ? item.length_cm : item.width_cm ) / 100;
  const displayH = item.height_cm / 100;

  item.mesh.geometry.dispose();
  item.mesh.geometry = new THREE.BoxGeometry(displayL, displayH, displayW);

  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (wire) {
    wire.geometry.dispose();
    wire.geometry = new THREE.EdgesGeometry(item.mesh.geometry);
  }

  const sprite = item.mesh.children.find(c => c.userData.isLabel);
  if (sprite) {
    sprite.position.y = item.height_cm / 200 + 0.18;
  }

  item.mesh.position.set(
    item.pos_x / 100,
    item.pos_y / 100,
    item.pos_z / 100 - cargoSpace.width / 2
  );
}

function highlightMesh(item, isSelected) {
  if (!item?.mesh) return;
  const mat = item.mesh.material;
  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (isSelected) {
    if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);
    mat.emissive.set(0x1a6fdb);
    mat.emissiveIntensity = 0.25;
    if (wire) { wire.material.color.set(0x1a6fdb); wire.material.opacity = 1; }
  } else {
    if (mat.emissive) mat.emissiveIntensity = 0;
    if (wire) { wire.material.color.set(0x1a2536); wire.material.opacity = 0.45; }
  }
}

function refreshItemSprite(item) {
  if (!item.mesh) return;
  const oldSprite = item.mesh.children.find(c => c.userData.isLabel);
  if (oldSprite) {
    oldSprite.material.map?.dispose();
    oldSprite.material.dispose();
    item.mesh.remove(oldSprite);
  }
  const newSprite = createLabelSprite(item);
  newSprite.userData.isLabel = true;
  newSprite.raycast = () => {};
  newSprite.visible = showLabels;
  item.mesh.add(newSprite);
}

function addItem(spec) {
  const item = {
    id: uid(),
    label: spec.label,
    base_label: spec.base_label,
    product_name: spec.product_name || '',
    kind: 'carton',
    length_cm: Number(spec.length_cm),
    width_cm:  Number(spec.width_cm),
    height_cm: Number(spec.height_cm),
    weight_kg: Number(spec.weight_kg) || 0,
    handling:  spec.handling || 'standard',
    color:     spec.color,
    rot_y: 0,
    pos_x: 0, pos_y: 0, pos_z: 0,
    mesh: null
  };

  item.mesh = createItemMesh(item);
  cartonGroup.add(item.mesh);

  const slot = findFreeSlot(item);
  item.pos_x = slot.pos_x;
  item.pos_y = slot.pos_y;
  item.pos_z = slot.pos_z;

  clampItemToBounds(item);
  refreshItemMesh(item);

  items.push(item);
  return item;
}

function removeItem(id) {
  const idx = items.findIndex(i => i.id === id);
  if (idx < 0) return;
  const item = items[idx];
  cartonGroup.remove(item.mesh);
  item.mesh.geometry.dispose();
  item.mesh.material.dispose();
  item.mesh.children.forEach(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      c.material.map?.dispose();
      c.material.dispose();
    }
  });
  items.splice(idx, 1);
  if (selectedItemId === id) selectedItemId = null;
}

// After anything moves/deletes, drop unsupported items down to their supporting surface
function settleAll() {
  const sorted = [...items].sort((a, b) => (a.pos_y - a.height_cm / 2) - (b.pos_y - b.height_cm / 2));
  for (const item of sorted) {
    const support = findSupportHeight(item, item.pos_x, item.pos_z, item.id);
    item.pos_y = support + item.height_cm / 2;
    clampItemToBounds(item);
    refreshItemMesh(item);
  }
}

// ============================================================
// SELECTION
// ============================================================
function selectItem(id) {
  const prev = items.find(i => i.id === selectedItemId);
  highlightMesh(prev, false);
  selectedItemId = id;
  const item = items.find(i => i.id === id);
  highlightMesh(item, true);
  renderCargoList();
  renderEditStrip();
}

function deselectAll() {
  const prev = items.find(i => i.id === selectedItemId);
  highlightMesh(prev, false);
  selectedItemId = null;
  renderCargoList();
  renderEditStrip();
}

// ============================================================
// STATS
// ============================================================
function updateStats() {
  const spaceVol = cargoSpace.length * cargoSpace.width * cargoSpace.height * 1000000;
  const itemVol  = items.reduce((s, i) => s + i.length_cm * i.width_cm * i.height_cm, 0);
  const weight   = items.reduce((s, i) => s + (i.weight_kg || 0), 0);
  const volPct   = spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0;

  $('#statVolume').textContent = `${volPct.toFixed(1)}%`;
  $('#statItems').textContent  = `${items.length}`;
  $('#statWeight').textContent = `${weight.toFixed(1)} kg`;

  const statusEl = $('#statStatus');
  statusEl.className = 'stat-value ' + (
    items.length === 0 ? 'stat-ok' :
    volPct > 100       ? 'stat-danger' :
    volPct > 90        ? 'stat-warn' : 'stat-ok'
  );
  statusEl.textContent =
    items.length === 0 ? 'Empty' :
    volPct > 100       ? 'Over capacity' :
    volPct > 90        ? 'Near full' : 'OK';

  $('#cargoCountHint').textContent = items.length === 0 ? 'Step 2' : `${items.length} placed`;
}

// ============================================================
// RIGHT-PANEL LIST / EDIT STRIP
// ============================================================
function renderCargoList() {
  const list = $('#cargoList');
  $('#listCount').textContent = items.length;

  if (items.length === 0) {
    list.innerHTML = '<div class="list-empty">No items yet. Add cargo above and it drops into the container.</div>';
    return;
  }

  list.innerHTML = items.map(i => `
    <div class="cargo-row ${i.id === selectedItemId ? 'selected' : ''}" data-id="${i.id}">
      <span class="cargo-swatch" style="background:${i.color}"></span>
      <div class="cargo-meta">
        <b>${escapeHtml(i.label)}${i.product_name ? ' · ' + escapeHtml(i.product_name) : ''}</b>
        <small>${i.length_cm} × ${i.width_cm} × ${i.height_cm} cm · ${i.weight_kg || 0} kg · ${i.handling}</small>
      </div>
      <span class="focus-icon" title="Focus camera">⌖</span>
    </div>
  `).join('');

  list.querySelectorAll('.cargo-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const id = row.dataset.id;
      if (e.target.classList.contains('focus-icon')) {
        selectItem(id);
        focusOnItem(id);
      } else {
        selectItem(id);
      }
    });
  });
}

function renderEditStrip() {
  const strip = $('#editStrip');
  const item = items.find(i => i.id === selectedItemId);
  if (!item) { strip.hidden = true; return; }
  strip.hidden = false;
  $('#editStripLabel').textContent = item.label;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ============================================================
// SCENE INPUT — click, drag, orbit routing
// ============================================================
const _mouse    = new THREE.Vector2();
const _hitPoint = new THREE.Vector3();

function updateMouseNormalized(e) {
  const rect = canvas.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

function hitCarton(e) {
  updateMouseNormalized(e);
  raycaster.setFromCamera(_mouse, camera);
  const hits = raycaster.intersectObjects(cartonGroup.children, false);
  if (!hits.length) return null;
  return { itemId: hits[0].object.userData.itemId, point: hits[0].point.clone() };
}

function hitFloor(e) {
  updateMouseNormalized(e);
  raycaster.setFromCamera(_mouse, camera);
  return raycaster.ray.intersectPlane(dragPlane, _hitPoint) ? _hitPoint.clone() : null;
}

function attachSceneInput() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup',   onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
}

function onPointerDown(e) {
  // Right/middle → orbit; Shift/Alt+left → orbit (bypass carton pick)
  if (e.button !== 0) return;
  if (e.shiftKey || e.altKey) return;

  const hit = hitCarton(e);
  if (!hit) {
    deselectAll();
    return;                                             // OrbitControls handles empty drag
  }

  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  selectItem(hit.itemId);

  const item = items.find(i => i.id === hit.itemId);
  const floorPoint = hitFloor(e);
  if (!floorPoint) return;

  const boxSceneX = item.pos_x / 100;
  const boxSceneZ = item.pos_z / 100 - cargoSpace.width / 2;

  dragState = {
    itemId: hit.itemId,
    offsetX: boxSceneX - floorPoint.x,
    offsetZ: boxSceneZ - floorPoint.z,
    startClientX: e.clientX,
    startClientY: e.clientY,
    originalPos: { x: item.pos_x, y: item.pos_y, z: item.pos_z },
    activated: false,                                   // no drag until threshold
    moved: false,
    pointerId: e.pointerId
  };
}

function onPointerMove(e) {
  if (!dragState) return;

  // Drag threshold — small movements stay a click
  if (!dragState.activated) {
    const dx = Math.abs(e.clientX - dragState.startClientX);
    const dy = Math.abs(e.clientY - dragState.startClientY);
    if (dx < 4 && dy < 4) return;
    dragState.activated = true;
    controls.enabled = false;
  }

  const item = items.find(i => i.id === dragState.itemId);
  if (!item) return;

  // Prefer landing on top of another carton (stacking); else, floor
  updateMouseNormalized(e);
  raycaster.setFromCamera(_mouse, camera);

  const others = cartonGroup.children.filter(m => m.userData.itemId !== dragState.itemId);
  const boxHits = raycaster.intersectObjects(others, false);
  const topHit = boxHits.find(h => h.face && h.face.normal.y > 0.7);

  let sceneX, sceneZ, targetSupportTop;
  if (topHit) {
    sceneX = topHit.point.x + dragState.offsetX;
    sceneZ = topHit.point.z + dragState.offsetZ;
    // Convert scene point to item cm coord to compute support properly
  } else {
    const floorHit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(dragPlane, floorHit)) return;
    sceneX = floorHit.x + dragState.offsetX;
    sceneZ = floorHit.z + dragState.offsetZ;
  }

  const newXcm = sceneX * 100;
  const newZcm = (sceneZ + cargoSpace.width / 2) * 100;

  // Auto-stack based on what's beneath the new XZ footprint
  targetSupportTop = findSupportHeight(item, newXcm, newZcm, item.id);

  item.pos_x = newXcm;
  item.pos_z = newZcm;
  item.pos_y = targetSupportTop + item.height_cm / 2;

  clampItemToBounds(item);
  refreshItemMesh(item);
  dragState.moved = true;
}

function onPointerUp(e) {
  if (dragState) {
    if (canvas.hasPointerCapture(dragState.pointerId)) {
      canvas.releasePointerCapture(dragState.pointerId);
    }
    if (dragState.moved) {
      settleAll();
      updateStats();
    }
    dragState = null;
    controls.enabled = true;
  }
}

// ============================================================
// CAMERA / VIEWS
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height);
}
window.addEventListener('resize', onResize);

function setView(view) {
  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  const cx = L / 2, cy = H / 2, cz = 0;
  const distFactor = Math.max(L, W * 4, H * 3);

  const targets = {
    perspective: { pos: [cx + distFactor * 0.8, H * 2.5, W * 4.5], target: [cx, cy, cz] },
    top:         { pos: [cx, H + distFactor * 1.4, 0.01],          target: [cx, 0, cz] },
    side:        { pos: [cx, cy, W * 7],                           target: [cx, cy, cz] }
  };

  const t = targets[view];
  animateCamera(new THREE.Vector3(...t.pos), new THREE.Vector3(...t.target));
}

function focusOnItem(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  const boxX = item.pos_x / 100;
  const boxY = item.pos_y / 100;
  const boxZ = item.pos_z / 100 - cargoSpace.width / 2;
  const distance = Math.max(2.5, item.length_cm / 100 * 3, item.height_cm / 100 * 3);
  animateCamera(
    new THREE.Vector3(boxX + distance * 0.8, boxY + distance * 0.6, boxZ + distance),
    new THREE.Vector3(boxX, boxY, boxZ)
  );
}

function animateCamera(newPos, newTarget) {
  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();
  const duration    = 600;
  const startTime   = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(startPos, newPos, eased);
    controls.target.lerpVectors(startTarget, newTarget, eased);
    controls.update();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function dolly(step) {
  const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  camera.position.addScaledVector(dir, step);
}

// ============================================================
// UI WIRING
// ============================================================
function showToast(msg) {
  toast.innerHTML = msg;
  toast.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => toast.classList.remove('show'), 2400);
}

// Transport mode
$$('.mode-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  transportMode = btn.dataset.mode;
  $('#sceneMode').textContent = MODE_LABELS[transportMode];
}));

// Preset
function applyPresetToInputs(key) {
  const p = PRESETS[key];
  if (!p) return;
  $('#dimLength').value = p.length.toFixed(2);
  $('#dimWidth').value  = p.width.toFixed(2);
  $('#dimHeight').value = p.height.toFixed(2);
}
$('#presetSelect').addEventListener('change', e => applyPresetToInputs(e.target.value));

// Apply cargo-space dimensions
$('#applyDimensions').addEventListener('click', () => {
  const L = parseFloat($('#dimLength').value);
  const W = parseFloat($('#dimWidth').value);
  const H = parseFloat($('#dimHeight').value);
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) {
    return showToast('Enter valid positive dimensions in metres.');
  }
  cargoSpace = { length: L, width: W, height: H };
  buildContainer();
  const dimStr = `${L.toFixed(2)} × ${W.toFixed(2)} × ${H.toFixed(2)} m`;
  $('#sceneDims').textContent = dimStr;
  $$('.view-pill').forEach(p => p.classList.toggle('selected', p.dataset.view === 'perspective'));
  setView('perspective');
  showToast(`<b>Cargo space</b> updated to ${dimStr}.`);
});

// View pills
$$('.view-pill').forEach(pill => pill.addEventListener('click', () => {
  $$('.view-pill').forEach(p => p.classList.remove('selected'));
  pill.classList.add('selected');
  setView(pill.dataset.view);
}));

// Zoom / reset / labels
$('#zoomIn').addEventListener('click',  () => dolly( 1.2));
$('#zoomOut').addEventListener('click', () => dolly(-1.2));
$('#resetView').addEventListener('click', () => {
  $$('.view-pill').forEach(p => p.classList.toggle('selected', p.dataset.view === 'perspective'));
  setView('perspective');
});

$('#toggleLabels').addEventListener('click', () => {
  showLabels = !showLabels;
  $('#toggleLabels').classList.toggle('active', showLabels);
  items.forEach(item => {
    const sprite = item.mesh?.children.find(c => c.userData.isLabel);
    if (sprite) sprite.visible = showLabels;
  });
  showToast(showLabels ? 'Labels <b>on</b>.' : 'Labels <b>off</b>.');
});

// Quantity picker
$('#fQtyMinus').addEventListener('click', () => {
  quantity = Math.max(1, quantity - 1);
  $('#fQty').textContent = quantity;
});
$('#fQtyPlus').addEventListener('click', () => {
  quantity = Math.min(500, quantity + 1);
  $('#fQty').textContent = quantity;
});

// Add cargo
$('#addCargo').addEventListener('click', () => {
  const labelInput   = $('#fLabel').value.trim();
  const productInput = $('#fProduct').value.trim();
  const L = parseFloat($('#fLength').value);
  const W = parseFloat($('#fWidth').value);
  const H = parseFloat($('#fHeight').value);
  const wt = parseFloat($('#fWeight').value) || 0;
  const handling = $('#fHandling').value;

  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) {
    return showToast('Enter valid carton dimensions in cm.');
  }
  if (L > cargoSpace.length * 100 || W > cargoSpace.width * 100 || H > cargoSpace.height * 100) {
    return showToast('Carton is larger than the cargo space.');
  }

  // Base label + color per SKU
  const baseLabel = labelInput || generateBaseLabel();
  const color = pickColorForBase(baseLabel);
  let last;

  for (let n = 0; n < quantity; n++) {
    const suffix = quantity > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
    last = addItem({
      label: baseLabel + suffix,
      base_label: baseLabel,
      product_name: productInput,
      length_cm: L, width_cm: W, height_cm: H,
      weight_kg: wt, handling,
      color
    });
  }

  updateStats();
  renderCargoList();
  if (last) selectItem(last.id);
  showToast(`Added <b>${quantity}</b> ${quantity > 1 ? 'cartons' : 'carton'}${labelInput ? ' of ' + escapeHtml(baseLabel) : ''}.`);

  // Auto-clear label & product for next SKU; keep dims/weight/handling
  $('#fLabel').value = '';
  $('#fProduct').value = '';
  quantity = 1;
  $('#fQty').textContent = 1;
  $('#fLabel').focus();
});

// Edit strip
$('#btnFocus').addEventListener('click', () => {
  if (selectedItemId) focusOnItem(selectedItemId);
});

$('#btnRotate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  item.rot_y = item.rot_y === 90 ? 0 : 90;
  clampItemToBounds(item);
  refreshItemMesh(item);
  refreshItemSprite(item);                              // rebuild sprite scale for new length
  settleAll();
  updateStats();
  showToast(`<b>${escapeHtml(item.label)}</b> rotated 90°.`);
});

$('#btnDuplicate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const clone = addItem({
    label: item.base_label + '·copy',
    base_label: item.base_label,
    product_name: item.product_name,
    length_cm: item.length_cm,
    width_cm: item.width_cm,
    height_cm: item.height_cm,
    weight_kg: item.weight_kg,
    handling: item.handling,
    color: item.color
  });
  selectItem(clone.id);
  updateStats();
  renderCargoList();
  showToast(`Duplicated <b>${escapeHtml(item.label)}</b>.`);
});

$('#btnDelete').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const label = item.label;
  removeItem(item.id);
  settleAll();
  updateStats();
  renderCargoList();
  renderEditStrip();
  showToast(`Deleted <b>${escapeHtml(label)}</b>.`);
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

  if (e.key === 'Escape') {
    // Cancel in-progress drag
    if (dragState && dragState.activated) {
      const item = items.find(i => i.id === dragState.itemId);
      if (item && dragState.originalPos) {
        item.pos_x = dragState.originalPos.x;
        item.pos_y = dragState.originalPos.y;
        item.pos_z = dragState.originalPos.z;
        refreshItemMesh(item);
      }
      dragState = null;
      controls.enabled = true;
      return;
    }
    if (!inField) deselectAll();
    return;
  }

  if (inField) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItemId) {
    e.preventDefault();
    $('#btnDelete').click();
  } else if (e.key === 'r' && selectedItemId) {
    $('#btnRotate').click();
  } else if (e.key === 'd' && selectedItemId && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#btnDuplicate').click();
  } else if (e.key === 'l') {
    $('#toggleLabels').click();
  }
});

// Header stubs
$('#saveDraft').addEventListener('click',   () => showToast('Save wires up in <b>Phase 4</b> (Supabase persistence).'));
$('#publishPlan').addEventListener('click', () => showToast('Publish wires up in <b>Phase 4</b> (Supabase persistence).'));

// ============================================================
// GO
// ============================================================
initScene();
updateStats();
renderCargoList();
renderEditStrip();

requestAnimationFrame(onResize);
setTimeout(onResize, 200);