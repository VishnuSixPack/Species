// ============================================================
// SmarTuna · 3D Load Planner (ST) — Phase 3b
// ------------------------------------------------------------
// New in this revision:
//   · Full 2D orthographic mode alongside 3D (toggle at top)
//   · Resize handles in 2D (4 corners + 4 edges per selected box)
//   · Per-view drag axes (top: X+Z, side: X only, front: Z only)
//   · Container walls hidden in 2D — clean wireframe view
//   · Mode preference persists in localStorage
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================================
// Supabase
// ============================================================
const SUPABASE_URL = 'https://enbdaajcromxmhgcverp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_NxQj3wE3UqijQVwwUNCfxg_f2uFLRz5';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// Constants
// ============================================================
const PRESETS = {
  '40HC':   { name: "40' High Cube",  length: 12.032, width: 2.352, height: 2.698 },
  '40STD':  { name: "40' Standard",   length: 12.032, width: 2.352, height: 2.393 },
  '20STD':  { name: "20' Standard",   length: 5.898,  width: 2.352, height: 2.393 },
  '45HC':   { name: "45' High Cube",  length: 13.556, width: 2.352, height: 2.698 },
  'Custom': { name: 'Custom',         length: 5.000,  width: 2.000, height: 2.100 }
};

// Standard pallet footprints (cm) — height ~14.5cm is typical for wooden pallets
const PALLET_PRESETS = {
  'eur1':   { name: 'EUR1 · 120 × 80 cm',    length: 120,   width: 80,    height: 14.5, weight: 25 },
  'eur2':   { name: 'EUR2 · 120 × 100 cm',   length: 120,   width: 100,   height: 14.5, weight: 25 },
  'us':     { name: 'US · 121.9 × 101.6 cm', length: 121.9, width: 101.6, height: 14.5, weight: 25 },
  'custom': { name: 'Custom',                length: 100,   width: 80,    height: 14.5, weight: 20 }
};

// Slipsheets — flat sheets. Real ones are ~2mm, but at container scale that's
// invisible on screen; using 1cm as the display default keeps them recognisable.
const SLIPSHEET_PRESETS = {
  'sm':     { name: '120 × 80 cm',           length: 120,   width: 80,    height: 1, weight: 1 },
  'md':     { name: '120 × 100 cm',          length: 120,   width: 100,   height: 1, weight: 1 },
  'us':     { name: '121.9 × 101.6 cm',      length: 121.9, width: 101.6, height: 1, weight: 1 },
  'custom': { name: 'Custom',                length: 120,   width: 80,    height: 1, weight: 1 }
};

const KIND_COLORS = {
  pallet:    '#8b6f47',                     // wood brown
  slipsheet: '#e8e0d0'                      // cream — distinct from wood floor
};
const KIND_LABEL_PREFIX = { carton: 'BATCH', pallet: 'PALLET', slipsheet: 'SHEET' };

// Only cartons may be round; everything else is a box whatever was stored.
function normaliseShape(kind, shape) {
  const s = SHAPES[shape] ? shape : 'box';
  return (kind && kind !== 'carton') ? 'box' : s;
}

// Render shapes. Packing always uses the bounding box, so these affect
// display only — a cylinder still occupies its L x W x H envelope.
const SHAPES = {
  box:      { label: 'Box',      round: false },
  cylinder: { label: 'Cylinder', round: true  },
  tube:     { label: 'Tube',     round: true  },
  sack:     { label: 'Sack',     round: true  }
};
const SHAPE_KEYS = Object.keys(SHAPES);

const MODE_LABELS = { Sea: 'SEA', Road: 'ROAD', Air: 'AIR', Rail: 'RAIL' };

const CARGO_COLORS = [
  '#1a6fdb', '#38b47a', '#f4a11c', '#e04a4a',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
  '#f97316', '#84cc16', '#6366f1', '#d946ef'
];

const GRID_CM = 5;                       // default move step
const CENTER_SNAP_CM = 15;
const MIN_SIZE_CM = 0.5;                 // smallest a box can be resized to
const LANE_TOL_CM = 2;                   // boxes this close still count as neighbours
const SNAP_STEP_KEY = 'smartuna_planner_snap_step';

// Selectable move precision, in cm. 0 means free positioning.
const SNAP_STEP_OPTIONS = [0, 0.1, 0.5, 1, 2.5, 5, 10];

// Corrugated board strength scales with box PERIMETER, not footprint area
// (McKee). Roughly 2 kgf of box compression per cm of perimeter for typical
// board; divide by a transit safety factor for sustained stacking, since BCT
// is a short-term dry figure and real loads sit for weeks in humidity.
const BCT_KGF_PER_CM = { carton: 2.0, pallet: 12, slipsheet: 1.5 };
const STACK_SAFETY_FACTOR = 6;
const MIN_SUPPORT_RATIO = 0.6;           // below this, a box is liable to tip
const CONTACT_EPS_CM = 1.0;              // faces this close count as touching
const TEMPLATES_KEY = 'smartuna_planner_templates_v1';
const SCENE_MODE_KEY = 'smartuna_planner_scene_mode';
const REALISTIC_MODE_KEY = 'smartuna_planner_realistic_mode';
const DIMS_MODE_KEY = 'smartuna_planner_dims_mode';
const NUDGE_STEP_KEY = 'smartuna_planner_nudge_step';
const SHOW_CONTENTS_KEY = 'smartuna_planner_show_contents';
const ADDRESSING_KEY = 'smartuna_planner_addressing_v1';
const GRID_STEP_KEY = 'smartuna_planner_grid_step';

// Selectable grid spacings, in metres. 'auto' sizes them to the container.
const GRID_STEP_OPTIONS = [0.1, 0.25, 0.5, 1, 2];
const CONTAINER_UNIT_KEY = 'smartuna_planner_container_unit';
const ITEM_UNIT_KEY = 'smartuna_planner_item_unit';

// Length-unit conversion — everything stored internally in cm (items) or m (cargoSpace);
// display + input use each section's own selected unit.
const TO_MM = { mm: 1, cm: 10, m: 1000 };
const UNIT_DECIMALS = { mm: 0, cm: 1, m: 3 };
const UNIT_STEPS = { mm: '1', cm: '0.1', m: '0.001' };

const HANDLE_TYPES = ['nw','n','ne','e','se','s','sw','w'];

// Per-view resize map: each screen handle → world axis edge(s)
const RESIZE_MAP = {
  top: {
    n:  [{ axis: 'z', side: 'min' }],
    s:  [{ axis: 'z', side: 'max' }],
    e:  [{ axis: 'x', side: 'max' }],
    w:  [{ axis: 'x', side: 'min' }],
    nw: [{ axis: 'x', side: 'min' }, { axis: 'z', side: 'min' }],
    ne: [{ axis: 'x', side: 'max' }, { axis: 'z', side: 'min' }],
    se: [{ axis: 'x', side: 'max' }, { axis: 'z', side: 'max' }],
    sw: [{ axis: 'x', side: 'min' }, { axis: 'z', side: 'max' }]
  },
  side: {
    n:  [{ axis: 'y', side: 'max' }],
    s:  [{ axis: 'y', side: 'min' }],
    e:  [{ axis: 'x', side: 'max' }],
    w:  [{ axis: 'x', side: 'min' }],
    nw: [{ axis: 'x', side: 'min' }, { axis: 'y', side: 'max' }],
    ne: [{ axis: 'x', side: 'max' }, { axis: 'y', side: 'max' }],
    se: [{ axis: 'x', side: 'max' }, { axis: 'y', side: 'min' }],
    sw: [{ axis: 'x', side: 'min' }, { axis: 'y', side: 'min' }]
  },
  front: {
    n:  [{ axis: 'y', side: 'max' }],
    s:  [{ axis: 'y', side: 'min' }],
    // In front view, camera looks from +X toward -X, so screen-right is world -Z.
    // → east handle drags the box's min-Z side; west drags max-Z.
    e:  [{ axis: 'z', side: 'min' }],
    w:  [{ axis: 'z', side: 'max' }],
    nw: [{ axis: 'z', side: 'max' }, { axis: 'y', side: 'max' }],
    ne: [{ axis: 'z', side: 'min' }, { axis: 'y', side: 'max' }],
    se: [{ axis: 'z', side: 'min' }, { axis: 'y', side: 'min' }],
    sw: [{ axis: 'z', side: 'max' }, { axis: 'y', side: 'min' }]
  }
};

// ============================================================
// State
// ============================================================
let scene, renderer;
let perspCamera, orthoCamera;
let perspControls, orthoControls;
let camera, controls;                   // active

let containerGroup;
let cartonGroup;
let yardMesh;                            // concrete ground plane
let measureGroup = null;                 // measurement grid lines
let concreteTexture;                     // yard surface
let skyTexture;                          // scene background gradient
let raycaster;

let cargoSpace = { length: 12.032, width: 2.352, height: 2.698 };
let transportMode = 'Sea';
let containerPreset = '40HC';

let items = [];
let selectedItemId = null;
let quantity = 1;
let batchCounters = { carton: 0, pallet: 0, slipsheet: 0 };
let currentKind = 'carton';              // which "kind" the Cargo form is adding
let currentShape = 'box';                // render shape for new cargo
let containerUnit = 'm';                 // display + input unit for cargo-space fields
let itemUnit = 'cm';                     // display + input unit for cargo-item fields

let autoPackUndo = null;                 // snapshot of positions before the last pack
let isPacking = false;                   // blocks scene interaction during the drop animation
let showLabels = false;
let dragState = null;
let hoveredItemId = null;               // box currently under the cursor (for label-on-hover)

let sceneMode = '3d';                   // '3d' | '2d'
let orthoView = 'top';                  // '2d' sub-view: top | side | front
// Which side of that axis the camera sits on: +1 or -1. Kept separate from
// orthoView so that everything asking "is this the side view?" — drag planes,
// resize handles, rulers — carries on working without caring which wall you
// happen to be standing at.
let orthoSide = 1;

// What each combination is called, from the point of view of someone standing
// at the doors looking in: their right hand points to +Z.
const VIEW_NAMES = {
  'top:1': 'TOP', 'top:-1': 'TOP',
  'side:1': 'RIGHT SIDE', 'side:-1': 'LEFT SIDE',
  'front:1': 'DOOR END', 'front:-1': 'BACK END'
};
const viewName = () => VIEW_NAMES[`${orthoView}:${orthoSide}`] || orthoView.toUpperCase();
let last3DView = 'perspective';
let realisticMode = false;              // opt-in realistic container + yard
let showDims = false;                   // opt-in dimension guides
let gridStepPref = 'auto';              // 'auto' or a spacing in metres
let moveStep = GRID_CM;                 // cm; 0 = free positioning

let resizeState = null;
let handleElements = [];                // 8 DOM elements

let currentPlanId = null;
let planStatus = 'draft';
let isDirty = false;

let templates = [];

// ============================================================
// DOM refs
// ============================================================
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const canvas   = $('#scene-canvas');
const viewport = $('#viewport');
const viewportHead = $('.viewport-head');
const toast    = $('#toast');
const resizeHandlesEl = $('#resizeHandles');

// ============================================================
// SCENE SETUP — two cameras, two controls
// ============================================================
function initScene() {
  scene = new THREE.Scene();
  scene.background = null;

  const rect = viewport.getBoundingClientRect();
  const aspect = rect.width && rect.height ? rect.width / rect.height : 16 / 9;

  // Perspective (3D)
  perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
  perspCamera.position.set(15, 8, 12);

  // Orthographic (2D) — frustum sized in positionOrthoCamera
  orthoCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  orthoCamera.position.set(cargoSpace.length / 2, 30, 0);
  orthoCamera.up.set(0, 0, -1);
  orthoCamera.lookAt(cargoSpace.length / 2, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(rect.width || 800, rect.height || 500);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));

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

  const grid = new THREE.GridHelper(60, 60, 0xc5d0dc, 0xe5eaf0);
  grid.userData.isGrid = true;
  scene.add(grid);

  // Concrete + sky textures for realistic mode
  concreteTexture = createConcreteTexture();
  skyTexture = createSkyTexture();

  // Yard — textured concrete ground, receives shadows.
  yardMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      map: concreteTexture, color: 0xffffff,
      roughness: 0.95, metalness: 0.02
    })
  );
  yardMesh.rotation.x = -Math.PI / 2;
  yardMesh.position.y = -0.055;            // just below the container-floor bottom
  yardMesh.receiveShadow = true;
  scene.add(yardMesh);

  cartonGroup = new THREE.Group();
  scene.add(cartonGroup);

  // Perspective controls (3D)
  perspControls = new OrbitControls(perspCamera, canvas);
  perspControls.enableDamping = true;
  perspControls.dampingFactor = 0.08;
  // Zoom is handled by onWheelZoom below rather than by OrbitControls, which
  // reads deltaY without looking at deltaMode. The near and far limits are
  // set from the container by updateZoomRange().
  perspControls.enableZoom = false;
  perspControls.maxPolarAngle = Math.PI / 2 - 0.05;
  perspControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };

  // Ortho controls (2D) — pan and zoom only
  orthoControls = new OrbitControls(orthoCamera, canvas);
  orthoControls.enableRotate = false;
  orthoControls.enableZoom = false;              // same wheel handler as 3D
  orthoControls.enableDamping = true;
  orthoControls.dampingFactor = 0.15;
  orthoControls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  orthoControls.enabled = false;

  camera = perspCamera;
  controls = perspControls;

  raycaster = new THREE.Raycaster();

  buildContainer();
  createResizeHandles();
  initDimOverlay();
  attachSceneInput();
  animate();
}

// ============================================================
// CONTAINER
// ============================================================
// ============================================================
// TEXTURE GENERATORS (canvas-drawn — no external assets)
// ============================================================
function createCorrugationTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 64; cnv.height = 256;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  // 4 vertical corrugation stripes — subtle shading (peaks near base, valleys ~20% darker)
  const stripes = 4;
  const stripeW = cnv.width / stripes;
  for (let i = 0; i < stripes; i++) {
    const x = i * stripeW;
    const grad = ctx.createLinearGradient(x, 0, x + stripeW, 0);
    grad.addColorStop(0,   'rgba(0,0,0,0.22)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.02)');
    grad.addColorStop(1,   'rgba(0,0,0,0.22)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, stripeW, cnv.height);
  }
  // Subtle structural rails top + bottom
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 0, cnv.width, 10);
  ctx.fillRect(0, cnv.height - 10, cnv.width, 10);
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function createConcreteTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 256;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = '#8f8b7f';
  ctx.fillRect(0, 0, cnv.width, cnv.height);
  // Weathered blotches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * cnv.width;
    const y = Math.random() * cnv.height;
    const r = Math.random() * 25 + 3;
    const alpha = Math.random() * 0.08 + 0.02;
    const dark = Math.random() > 0.4;
    ctx.fillStyle = dark
      ? `rgba(60, 55, 45, ${alpha})`
      : `rgba(190, 185, 170, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Expansion-joint cross
  ctx.strokeStyle = 'rgba(50, 45, 35, 0.32)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cnv.width / 2, 0);
  ctx.lineTo(cnv.width / 2, cnv.height);
  ctx.moveTo(0, cnv.height / 2);
  ctx.lineTo(cnv.width, cnv.height / 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}

function createSkyTexture() {
  const cnv = document.createElement('canvas');
  cnv.width = 2; cnv.height = 512;
  const ctx = cnv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0,    '#e6ecf3');
  grad.addColorStop(0.55, '#c2ccd7');
  grad.addColorStop(1,    '#a4aeb9');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 512);
  return new THREE.CanvasTexture(cnv);
}

function buildContainer() {
  if (containerGroup) {
    scene.remove(containerGroup);
    containerGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  containerGroup = new THREE.Group();

  if (realisticMode) {
    buildRealisticContainer(L, W, H);
  } else {
    buildSimpleContainer(L, W, H);
  }

  build2DBackdrops(L, W, H);                 // always add — visible only in 2D

  scene.add(containerGroup);
  buildMeasureGrid();

  perspControls.target.set(L / 2, H / 2, 0);
  perspControls.update();
  updateZoomRange();              // the limits follow the container's size

  updateContainerVisibility();

  items.forEach(clampItemToBounds);
  items.forEach(refreshItemMesh);
  updateStats();
}

// Filled "blueprint" planes that give 2D views a defined silhouette
// instead of just showing an outline.
function build2DBackdrops(L, W, H) {
  const mkMat = () => new THREE.MeshBasicMaterial({
    color: 0xdae7f5, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    depthWrite: false
  });

  // Top view backdrop — horizontal plane on the floor
  const bpTop = new THREE.Mesh(new THREE.PlaneGeometry(L, W), mkMat());
  bpTop.rotation.x = -Math.PI / 2;
  bpTop.position.set(L / 2, 0.008, 0);
  bpTop.userData.is2DBackdrop = 'top';
  bpTop.visible = false;
  bpTop.raycast = () => {};                  // don't intercept clicks
  containerGroup.add(bpTop);

  // Side view backdrop — vertical plane at the back (Z = -W/2 side)
  const bpSide = new THREE.Mesh(new THREE.PlaneGeometry(L, H), mkMat());
  bpSide.position.set(L / 2, H / 2, -W / 2 + 0.008);
  bpSide.userData.is2DBackdrop = 'side';
  bpSide.visible = false;
  bpSide.raycast = () => {};
  containerGroup.add(bpSide);

  // Front view backdrop — vertical plane at the back wall (X = 0)
  const bpFront = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mkMat());
  bpFront.rotation.y = Math.PI / 2;
  bpFront.position.set(0.008, H / 2, 0);
  bpFront.userData.is2DBackdrop = 'front';
  bpFront.visible = false;
  bpFront.raycast = () => {};
  containerGroup.add(bpFront);
}

// -------- Simple container (default) — clean wireframe with translucent walls --------
function buildSimpleContainer(L, W, H) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(L, 0.05, W),
    new THREE.MeshStandardMaterial({ color: 0xdae2ec, roughness: 0.9, metalness: 0.05 })
  );
  floor.position.set(L / 2, -0.025, 0);    // top of floor at world Y=0
  floor.receiveShadow = true;
  floor.userData.isContainerFloor = true;
  containerGroup.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xeaf0f7, roughness: 0.85, metalness: 0.05,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide
  });

  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
  back.position.set(0, H / 2, 0);
  back.rotation.y = Math.PI / 2;
  back.userData.isContainerWall = true;
  containerGroup.add(back);

  const left = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  left.position.set(L / 2, H / 2, -W / 2);
  left.userData.isContainerWall = true;
  containerGroup.add(left);

  const right = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
  right.position.set(L / 2, H / 2, W / 2);
  right.rotation.y = Math.PI;
  right.userData.isContainerWall = true;
  containerGroup.add(right);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshStandardMaterial({
      color: 0xf3f6fa, roughness: 0.95, transparent: true, opacity: 0.15, side: THREE.DoubleSide
    })
  );
  ceil.position.set(L / 2, H, 0);
  ceil.rotation.x = Math.PI / 2;
  ceil.userData.isContainerWall = true;
  containerGroup.add(ceil);

  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W));
  const wire = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x1a6fdb })
  );
  wire.position.set(L / 2, H / 2, 0);
  wire.userData.isContainerWire = true;
  containerGroup.add(wire);

  // Dashed front-door line marker
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
  door.userData.isContainerWire = true;
  containerGroup.add(door);
}

// -------- Realistic container — corrugated walls, open doors, corner castings --------
function buildRealisticContainer(L, W, H) {
  const wallColor = 0x4a6a8a;                     // medium container blue (was too dark before)

  // Per-wall corrugated material — repeat scaled to wall length so stripe
  // density stays consistent across different wall sizes.
  function makeWallMat(spanMeters) {
    const tex = createCorrugationTexture();
    tex.repeat.set(Math.max(3, spanMeters * 4), 1);         // ~25cm per stripe
    return new THREE.MeshStandardMaterial({
      color: wallColor, map: tex,
      roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide
    });
  }

  const backWallMat = makeWallMat(W);
  const sideWallMat = makeWallMat(L);
  const doorMat     = makeWallMat(W / 2);
  const roofMat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x8b7040, roughness: 0.9, metalness: 0.05
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a, roughness: 0.3, metalness: 0.7
  });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, W), floorMat);
  floor.position.set(L / 2, -0.025, 0);    // top of floor at world Y=0
  floor.receiveShadow = true;
  floor.userData.isContainerFloor = true;
  containerGroup.add(floor);

  // Walls with outward normals for camera-based culling
  function addWall(dims, position, outwardNormal, mat) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...dims), mat);
    wall.position.copy(position);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.isContainerWall = true;
    wall.userData.outwardNormal = outwardNormal;
    containerGroup.add(wall);
  }
  addWall([0.06, H, W], new THREE.Vector3(0, H / 2, 0),        new THREE.Vector3(-1, 0, 0), backWallMat);
  addWall([L, H, 0.06], new THREE.Vector3(L / 2, H / 2, -W/2), new THREE.Vector3(0, 0, -1), sideWallMat);
  addWall([L, H, 0.06], new THREE.Vector3(L / 2, H / 2, W/2),  new THREE.Vector3(0, 0, 1),  sideWallMat);
  addWall([L, 0.06, W], new THREE.Vector3(L / 2, H, 0),        new THREE.Vector3(0, 1, 0),  roofMat);

  // Front doors — hinged at outer corners, swung open ~108°
  function addDoor(hingeZ, isRight) {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(L, 0, hingeZ);
    const panelWidth = W / 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, panelWidth), doorMat);
    panel.position.set(0, H / 2, isRight ? -panelWidth / 2 : panelWidth / 2);
    panel.castShadow = true;
    panel.receiveShadow = true;
    doorGroup.add(panel);
    doorGroup.rotation.y = isRight ? -Math.PI * 0.6 : Math.PI * 0.6;
    doorGroup.userData.isContainerDoor = true;
    containerGroup.add(doorGroup);
  }
  addDoor(-W / 2, false);
  addDoor(W / 2, true);

  // Corner castings (iconic container detail)
  const cornerSize = 0.16;
  const cornerPositions = [
    [0, 0, -W / 2], [0, 0, W / 2], [L, 0, -W / 2], [L, 0, W / 2],
    [0, H, -W / 2], [0, H, W / 2], [L, H, -W / 2], [L, H, W / 2]
  ];
  cornerPositions.forEach(([x, y, z]) => {
    const c = new THREE.Mesh(
      new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize),
      darkMat
    );
    c.position.set(x, y, z);
    c.castShadow = true;
    c.userData.isCornerCasting = true;
    containerGroup.add(c);
  });

  // Subtle wire outline for measurement clarity
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W));
  const wire = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x1a2536, transparent: true, opacity: 0.25 })
  );
  wire.position.set(L / 2, H / 2, 0);
  wire.userData.isContainerWire = true;
  containerGroup.add(wire);
}

// Camera-based wall culling — hides walls whose outward normal points
// toward the camera, so cargo is always visible from any angle.
// Works for both perspective and orthographic cameras.
const _camDir = new THREE.Vector3();
function updateContainerCulling() {
  if (!containerGroup || !realisticMode) return;
  const cx = cargoSpace.length / 2;
  const cy = cargoSpace.height / 2;
  const dx = camera.position.x - cx;
  const dy = camera.position.y - cy;
  const dz = camera.position.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.01) return;
  _camDir.set(dx / len, dy / len, dz / len);

  containerGroup.traverse(obj => {
    if (!obj.userData.outwardNormal) return;
    const n = obj.userData.outwardNormal;
    const dot = n.x * _camDir.x + n.y * _camDir.y + n.z * _camDir.z;
    obj.visible = dot < 0.3;
  });
}

// Container elements are hidden in simple 2D (clean wireframe look).
// In realistic mode, walls/doors/corners/floor stay visible in both 2D and 3D;
// updateContainerCulling then handles which walls to hide per camera angle.
function updateContainerVisibility() {
  if (!containerGroup) return;
  const in2D = sceneMode === '2d';
  const in2DSimple = in2D && !realisticMode;

  containerGroup.traverse(obj => {
    if (obj.userData.isContainerWall)   obj.visible = !in2DSimple;
    if (obj.userData.isContainerDoor)   obj.visible = !in2DSimple;
    if (obj.userData.isCornerCasting)   obj.visible = !in2DSimple;
    if (obj.userData.isContainerFloor)  obj.visible = !in2DSimple;
    if (obj.userData.is2DBackdrop) {
      // Backdrops only in simple 2D — realistic mode uses real walls instead
      obj.visible = in2DSimple && obj.userData.is2DBackdrop === orthoView;
      // The backdrop belongs behind the load, so it moves to the far wall
      // when the camera crosses to the other side.
      if (obj.visible) {
        const W = cargoSpace.width, L = cargoSpace.length;
        if (obj.userData.is2DBackdrop === 'side') {
          obj.position.z = orthoSide > 0 ? -W / 2 + 0.008 : W / 2 - 0.008;
        } else if (obj.userData.is2DBackdrop === 'front') {
          obj.position.x = orthoSide > 0 ? 0.008 : L - 0.008;
        }
      }
    }
  });

  // Yard visible in realistic mode (both 2D top and 3D)
  if (yardMesh) yardMesh.visible = realisticMode;

  // Ground grid only in simple 3D — CSS grid handles 2D backgrounds
  scene.traverse(obj => {
    if (obj.userData.isGrid) obj.visible = !in2D && !realisticMode;
  });

  // Sky-gradient background whenever realistic view is on — 2D side/front need it too
  // because the yard is a horizontal plane and disappears in those views.
  // Fog only in 3D (ortho + fog behaves oddly).
  if (realisticMode) {
    scene.background = skyTexture;
    scene.fog = !in2D ? new THREE.Fog(0xa4aeb9, 30, 90) : null;
  } else {
    scene.background = null;
    scene.fog = null;
  }
}

// Update the 2D dimension labels + orientation indicators
function updateAnnotations() {
  const ann = $('#viewport2DLabels');
  if (sceneMode !== '2d') {
    if (!ann.hidden) ann.hidden = true;
    return;
  }
  if (ann.hidden) ann.hidden = false;

  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  const top   = $('#v2dTop');
  const right = $('#v2dRight');
  const doors = $('#v2dDoors');
  const back  = $('#v2dBack');

  // doorsRight: are the container doors on the right of the screen?
  // The right-hand label is .v2d-doors by position only — the word and the
  // amber treatment move to whichever end is actually the door end.
  const setEndLabels = (doorsRight) => {
    const rightEl = doors, leftEl = back;
    rightEl.textContent = doorsRight ? 'DOORS →' : 'BACK →';
    leftEl.textContent  = doorsRight ? '← BACK'  : '← DOORS';
    rightEl.classList.toggle('is-doors', doorsRight);
    rightEl.classList.toggle('is-back',  !doorsRight);
    leftEl.classList.toggle('is-doors',  !doorsRight);
    leftEl.classList.toggle('is-back',   doorsRight);
  };

  if (orthoView === 'top') {
    top.textContent   = `L · ${L.toFixed(2)} m`;
    right.textContent = `W · ${W.toFixed(2)} m`;
    setEndLabels(true);
    doors.hidden = false;
    back.hidden = false;
  } else if (orthoView === 'side') {
    top.textContent   = `L · ${L.toFixed(2)} m`;
    right.textContent = `H · ${H.toFixed(2)} m`;
    // Seen from the left wall the container is mirrored, so the doors are now
    // at the other end of the screen. The two labels keep their positions and
    // swap which end they name — colour included.
    setEndLabels(orthoSide > 0);
    doors.hidden = false;
    back.hidden = false;
  } else {
    top.textContent   = `W · ${W.toFixed(2)} m`;
    right.textContent = `H · ${H.toFixed(2)} m`;
    doors.hidden = true;
    back.hidden = true;
  }
}

// ============================================================
// GEOMETRY HELPERS
// ============================================================
// A box has six distinct resting orientations: three choices of which
// dimension points up, each with two yaw positions. `rot_y` stores that
// index (0-5). Legacy plans stored 0 or 90 for yaw only, so 90 maps to 1.
const ORIENTATIONS = [
  { x: 'length_cm', y: 'height_cm', z: 'width_cm'  },   // 0 upright
  { x: 'width_cm',  y: 'height_cm', z: 'length_cm' },   // 1 upright, yawed
  { x: 'length_cm', y: 'width_cm',  z: 'height_cm' },   // 2 on side
  { x: 'height_cm', y: 'width_cm',  z: 'length_cm' },   // 3 on side, yawed
  { x: 'width_cm',  y: 'length_cm', z: 'height_cm' },   // 4 on end
  { x: 'height_cm', y: 'length_cm', z: 'width_cm'  }    // 5 on end, yawed
];
const ORIENT_NAMES = ['Upright', 'Upright', 'On side', 'On side', 'On end', 'On end'];

function normaliseOrient(raw) {
  const n = Number(raw);
  if (n === 90) return 1;                      // legacy yaw value
  return (Number.isInteger(n) && n >= 0 && n <= 5) ? n : 0;
}

// World-axis extents (cm) for an item in a given orientation
function extentFor(item, orientIdx) {
  const o = ORIENTATIONS[orientIdx] || ORIENTATIONS[0];
  return { l: item[o.x], h: item[o.y], w: item[o.z] };
}
function itemExtent(item) { return extentFor(item, item.rot_y); }

function itemBounds(item) {
  const e = itemExtent(item);
  return {
    minX: item.pos_x - e.l / 2, maxX: item.pos_x + e.l / 2,
    minY: item.pos_y - e.h / 2, maxY: item.pos_y + e.h / 2,
    minZ: item.pos_z - e.w / 2, maxZ: item.pos_z + e.w / 2
  };
}

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

function findSupportHeight(item, atX, atZ, excludeId) {
  const e = itemExtent(item);
  const minX = atX - e.l / 2, maxX = atX + e.l / 2;
  const minZ = atZ - e.w / 2, maxZ = atZ + e.w / 2;
  const eps = 0.5;
  let top = 0, supportId = null;
  for (const other of items) {
    if (other.id === excludeId) continue;
    const b = itemBounds(other);
    if (minX + eps < b.maxX && maxX - eps > b.minX &&
        minZ + eps < b.maxZ && maxZ - eps > b.minZ) {
      if (b.maxY > top) { top = b.maxY; supportId = other.id; }
    }
  }
  return { top, supportId };
}

function clampItemToBounds(item) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;
  const rotatedE = itemExtent(item);
  const halfL = rotatedE.l / 2;
  const halfW = rotatedE.w / 2;
  const halfH = rotatedE.h / 2;
  item.pos_x = Math.max(halfL, Math.min(L - halfL, item.pos_x));
  item.pos_z = Math.max(halfW, Math.min(W - halfW, item.pos_z));
  item.pos_y = Math.max(halfH, Math.min(H - halfH, item.pos_y));
}

function snapToGrid(cm) {
  if (!moveStep) return cm;              // free positioning
  return Math.round(cm / moveStep) * moveStep;
}

// The magnets must never be coarser than the step the user chose, or they
// would drag a carefully placed millimetre position back out again.
function edgeSnapRange() {
  return moveStep ? Math.min(4, Math.max(0.5, moveStep * 2)) : 0.5;
}
function centerSnapRange() {
  return moveStep ? Math.min(CENTER_SNAP_CM, Math.max(1, moveStep * 3)) : 1;
}

// ---- magnetic edge snapping ----
// Grid snapping moves the box CENTRE, so two boxes whose half-widths aren't
// multiples of the grid can never sit flush. These pull faces together when
// they come close, which is what "push them against each other" actually means.

// Nearest edge along one axis that `v` should snap to, if any is close enough.
function snapEdgeValue(v, axis, excludeId, spaceMax) {
  let best = null;
  const consider = t => {
    const d = Math.abs(t - v);
    if (d <= edgeSnapRange() && (!best || d < best.d)) best = { t, d };
  };
  consider(0);
  consider(spaceMax);
  for (const o of items) {
    if (o.id === excludeId) continue;
    const b = itemBounds(o);
    if (axis === 'x')      { consider(b.minX); consider(b.maxX); }
    else if (axis === 'y') { consider(b.minY); consider(b.maxY); }
    else                   { consider(b.minZ); consider(b.maxZ); }
  }
  return best ? best.t : v;
}

// Nudge a proposed position so the box sits flush with, or aligned to, a
// neighbour. Only boxes sharing the perpendicular lane are considered, so a
// crate on the far side of the container doesn't tug the one you're dragging.
function applyEdgeSnap(item, xCm, zCm) {
  const e = itemExtent(item);
  const halfL = e.l / 2, halfW = e.w / 2;
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width * 100;
  const range = edgeSnapRange();
  // Boxes that merely touch on the other axis are still neighbours — without
  // this tolerance, two cartons sitting flush end-to-end can never be pushed
  // together across their width.
  const inLane = (aMin, aMax, bMin, bMax) =>
    aMin < bMax + LANE_TOL_CM && aMax > bMin - LANE_TOL_CM;

  let x = xCm, z = zCm;

  // X — snap against neighbours sharing this Z lane
  {
    const zMin = z - halfW, zMax = z + halfW;
    let best = null;
    const push = d => {
      const dist = Math.abs(d);
      if (dist <= range && (!best || dist < best.dist)) best = { d, dist };
    };
    push(0 - (x - halfL));
    push(L - (x + halfL));
    for (const o of items) {
      if (o.id === item.id) continue;
      const b = itemBounds(o);
      if (!inLane(zMin, zMax, b.minZ, b.maxZ)) continue;
      push(b.minX - (x + halfL));      // our right face meets their left
      push(b.maxX - (x - halfL));      // our left face meets their right
      push(b.minX - (x - halfL));      // left faces aligned
      push(b.maxX - (x + halfL));      // right faces aligned
    }
    if (best) x += best.d;
  }

  // Z — snap against neighbours sharing this X lane
  {
    const xMin = x - halfL, xMax = x + halfL;
    let best = null;
    const push = d => {
      const dist = Math.abs(d);
      if (dist <= range && (!best || dist < best.dist)) best = { d, dist };
    };
    push(0 - (z - halfW));
    push(W - (z + halfW));
    for (const o of items) {
      if (o.id === item.id) continue;
      const b = itemBounds(o);
      if (!inLane(xMin, xMax, b.minX, b.maxX)) continue;
      push(b.minZ - (z + halfW));
      push(b.maxZ - (z - halfW));
      push(b.minZ - (z - halfW));
      push(b.maxZ - (z + halfW));
    }
    if (best) z += best.d;
  }

  return { x, z };
}

// ============================================================
// AUTO-PLACEMENT
// ============================================================
function findFreeSlot(item) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;
  const e = itemExtent(item);
  const boxL = e.l, boxW = e.w;
  const halfH = e.h / 2;

  if (boxL > L || boxW > W || e.h > H) {
    return { pos_x: boxL / 2, pos_y: halfH, pos_z: boxW / 2 };
  }

  const step = Math.max(GRID_CM, Math.min(boxL, boxW) / 3);
  for (let x = boxL / 2; x <= L - boxL / 2; x += step) {
    for (let z = boxW / 2; z <= W - boxW / 2; z += step) {
      const test = {
        pos_x: snapToGrid(x), pos_y: halfH, pos_z: snapToGrid(z),
        length_cm: item.length_cm, width_cm: item.width_cm,
        height_cm: item.height_cm, rot_y: item.rot_y
      };
      if (!collidesWithAny(test, item.id)) {
        return { pos_x: test.pos_x, pos_y: halfH, pos_z: test.pos_z };
      }
    }
  }

  const candidates = items
    .filter(o => o.id !== item.id)
    .sort((a, b) => (a.pos_y + itemExtent(a).h / 2) - (b.pos_y + itemExtent(b).h / 2));

  for (const other of candidates) {
    const supportTop = other.pos_y + itemExtent(other).h / 2;
    if (supportTop + e.h > H) continue;
    const test = {
      pos_x: other.pos_x, pos_y: supportTop + halfH, pos_z: other.pos_z,
      length_cm: item.length_cm, width_cm: item.width_cm,
      height_cm: item.height_cm, rot_y: item.rot_y
    };
    if (!collidesWithAny(test, item.id)) {
      return { pos_x: other.pos_x, pos_y: supportTop + halfH, pos_z: other.pos_z };
    }
  }
  return { pos_x: boxL / 2, pos_y: halfH, pos_z: boxW / 2 };
}

// ============================================================
// COLOUR
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
// ITEMS
// ============================================================
function uid() { return 'i_' + Math.random().toString(36).slice(2, 10); }

function generateBaseLabel(kind = 'carton') {
  batchCounters[kind] = (batchCounters[kind] || 0) + 1;
  const prefix = KIND_LABEL_PREFIX[kind] || 'BATCH';
  return `${prefix}-${String(batchCounters[kind]).padStart(2, '0')}`;
}

function recomputeBatchCounter() {
  batchCounters = { carton: 0, pallet: 0, slipsheet: 0 };
  const rx = {
    carton:    /^BATCH-(\d+)$/,
    pallet:    /^PALLET-(\d+)$/,
    slipsheet: /^SHEET-(\d+)$/
  };
  items.forEach(i => {
    const kind = i.kind || 'carton';
    const m = rx[kind]?.exec(i.base_label || '');
    if (m) batchCounters[kind] = Math.max(batchCounters[kind], parseInt(m[1], 10));
  });
}

// Build the display geometry for an item in its current orientation.
// Round shapes take their axis from the item's height_cm dimension, so
// flipping a drum lays it on its side the way a real one would.
function buildItemGeometry(item) {
  const e = itemExtent(item);
  const l = e.l / 100, h = e.h / 100, w = e.w / 100;
  const shape = item.shape || 'box';

  if (shape === 'box') return new THREE.BoxGeometry(l, h, w);

  let geo;
  if (shape === 'sack') {
    geo = new THREE.SphereGeometry(0.5, 20, 14);
  } else if (shape === 'tube') {
    geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28, 1, true);   // open-ended
  } else {
    geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
  }

  if (shape !== 'sack') {
    // Unit geometry has its axis along Y — turn it to match the world axis
    // that height_cm currently occupies, then scale into the bounding box.
    const o = ORIENTATIONS[item.rot_y] || ORIENTATIONS[0];
    if (o.x === 'height_cm')      geo.rotateZ(Math.PI / 2);
    else if (o.z === 'height_cm') geo.rotateX(Math.PI / 2);
  }
  geo.scale(l, h, w);
  return geo;
}

// ============================================================
// CARTON CONTENTS — a carton built in the builder knows exactly what is in
// it, so the plan can show the cans rather than a brown box.
// ============================================================

// Rotations that put a pack's own axes (length→X, height→Y, width→Z) onto the
// world axes for each of the six orientations. These must agree with the
// ORIENTATIONS table exactly or the contents will point the wrong way inside
// their own carton; there is a test that checks every one against itemExtent.
const CONTENT_EULER = [
  [0, 0, 0],                               // 0 upright
  [0, Math.PI / 2, 0],                     // 1 upright, yawed
  [Math.PI / 2, 0, 0],                     // 2 on side
  [Math.PI / 2, Math.PI / 2, 0],           // 3 on side, yawed  (Y applied after X)
  [Math.PI / 2, 0, Math.PI / 2],           // 4 on end          (Z applied after X)
  [0, 0, Math.PI / 2]                      // 5 on end, yawed
];

function contentQuaternion(rot_y) {
  const [x, y, z] = CONTENT_EULER[normaliseOrient(rot_y)] || CONTENT_EULER[0];
  const q = new THREE.Quaternion();
  // Each entry is a sequence of quarter turns applied in order X, then Y, then Z
  if (x) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x));
  if (y) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), y));
  if (z) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), z));
  return q;
}

let showContents = true;                 // viewport toggle
// Drawing every can of every carton can run to tens of thousands of meshes.
// Past this many the plan falls back to plain boxes and says why.
const MAX_CONTENT_UNITS = 12000;
let contentsBudgetHit = false;

// How many unit meshes an item would contribute
function itemContentCount(item) {
  const b = ensureBuild(item);
  return b ? b.cells.length : 0;
}

// Build the little meshes that sit inside one carton. Positions come out of
// the builder's own maths, in the pack's local axes and in centimetres.
function buildContentsGroup(item) {
  const b = ensureBuild(item);
  if (!b || !b.cells.length) return null;

  const g = new THREE.Group();
  g.userData.isContents = true;
  g.raycast = () => {};
  g.quaternion.copy(contentQuaternion(item.rot_y));

  // One instanced mesh per group, so colour per batch costs nothing extra
  const byGroup = new Map();
  b.cells.forEach(c => {
    if (!byGroup.has(c.g)) byGroup.set(c.g, []);
    byGroup.get(c.g).push(c);
  });

  byGroup.forEach((cells, gi) => {
    const grp = b.groups[gi];
    if (!grp) return;
    const S = 0.01;                                   // cm → world metres
    const geo = grp.round
      ? new THREE.CylinderGeometry(grp.d / 2 * S, grp.d / 2 * S, grp.h * S, 16)
      : new THREE.BoxGeometry(grp.l * S, grp.h * S, grp.w * S);
    const mat = new THREE.MeshStandardMaterial({
      color: grp.color, roughness: 0.55, metalness: 0.12
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.raycast = () => {};
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(grp.euler || [0, 0, 0])));
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    cells.forEach((c, i) => {
      pos.set(c.x * S, c.y * S, c.z * S);
      m.compose(pos, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    g.add(mesh);
  });

  return g;
}

function removeContentsGroup(item) {
  if (!item.mesh) return;
  const old = item.mesh.children.find(c => c.userData.isContents);
  if (!old) return;
  item.mesh.remove(old);
  old.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// Add or drop the contents of one carton, and make its shell see-through
// while they are showing so the contents are actually visible.
function applyContents(item, budget) {
  if (!item.mesh) return 0;
  // A ghosted carton is deliberately faded; the contents toggle does not get
  // to put its opacity back.
  if (item.mesh.userData.ghost) { removeContentsGroup(item); return 0; }
  removeContentsGroup(item);
  const count = itemContentCount(item);
  const want = showContents && count > 0;

  if (!want || count > budget.left) {
    item.mesh.material.transparent = false;
    item.mesh.material.opacity = 1;
    item.mesh.material.needsUpdate = true;
    return 0;
  }
  const grp = buildContentsGroup(item);
  if (grp) item.mesh.add(grp);
  item.mesh.material.transparent = true;
  item.mesh.material.opacity = 0.22;
  item.mesh.material.depthWrite = false;
  item.mesh.material.needsUpdate = true;
  budget.left -= count;
  return count;
}

function refreshAllContents() {
  const budget = { left: MAX_CONTENT_UNITS };
  const wanted = items.reduce((s, i) => s + itemContentCount(i), 0);
  items.forEach(i => applyContents(i, budget));
  contentsBudgetHit = showContents && wanted > MAX_CONTENT_UNITS;
  const btn = $('#toggleContents');
  if (btn) btn.classList.toggle('active', showContents);
  updateContentsHint(wanted);
}

function updateContentsHint(wanted) {
  const el = $('#viewportHint');
  if (!el) return;
  el.classList.toggle('hint-warn', contentsBudgetHit);
  if (contentsBudgetHit) {
    el.textContent = `TOO MANY UNITS TO DRAW (${wanted.toLocaleString()}) — SHOWING PLAIN CARTONS`;
  } else {
    el.textContent = 'DRAG CARTON TO MOVE · SHIFT-DRAG OR RIGHT-DRAG TO ORBIT · SCROLL TO ZOOM';
  }
}

function createItemMesh(item) {
  const isRound = SHAPES[item.shape || 'box']?.round;

  const geo = buildItemGeometry(item);
  const mat = new THREE.MeshStandardMaterial({
    color: item.color, roughness: 0.75, metalness: 0.05,
    side: item.shape === 'tube' ? THREE.DoubleSide : THREE.FrontSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.itemId = item.id;

  // Only boxes get an edge cage — on a 28-segment cylinder it reads as noise.
  if (!isRound) {
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({
      color: 0x1a2536, transparent: true, opacity: 0.45
    }));
    wire.userData.isEdge = true;
    wire.raycast = () => {};
    mesh.add(wire);
  }

  const sprite = createLabelSprite(item);
  sprite.userData.isLabel = true;
  sprite.raycast = () => {};
  sprite.visible = false;                // managed by updateLabelVisibility
  mesh.add(sprite);

  return mesh;
}

function createLabelSprite(item) {
  const cnv = document.createElement('canvas');
  const width = 512, height = 160;
  cnv.width = width; cnv.height = height;
  const ctx = cnv.getContext('2d');
  const pad = 8, radius = 24;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.roundRect(pad, pad, width - pad * 2, height - pad * 2, radius);
  ctx.fill();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 5;
  ctx.stroke();
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
    map: texture, transparent: true, depthTest: false, depthWrite: false
  });
  const sprite = new THREE.Sprite(mat);
  const baseW = Math.min(1.4, Math.max(0.7, item.length_cm / 100 * 1.1));
  sprite.scale.set(baseW, baseW * (height / width), 1);
  sprite.position.set(0, itemExtent(item).h / 200 + 0.18, 0);
  return sprite;
}

function truncate(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function refreshItemMesh(item) {
  if (!item.mesh) return;
  const e = itemExtent(item);
  const isRound = SHAPES[item.shape || 'box']?.round;
  const hasWire = !!item.mesh.children.find(c => c.userData.isEdge);

  // Switching between a box and a round shape changes which children the mesh
  // needs, so rebuild the whole thing rather than patching it.
  if (isRound === hasWire) {
    rebuildItemMesh(item);
    return;
  }

  item.mesh.geometry.dispose();
  item.mesh.geometry = buildItemGeometry(item);
  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (wire) {
    wire.geometry.dispose();
    wire.geometry = new THREE.EdgesGeometry(item.mesh.geometry);
  }
  const sprite = item.mesh.children.find(c => c.userData.isLabel);
  if (sprite) sprite.position.y = e.h / 200 + 0.18;
  // Contents are drawn in the pack's own axes, so turning the carton has to
  // turn what is inside it by the same amount.
  const inner = item.mesh.children.find(c => c.userData.isContents);
  if (inner) inner.quaternion.copy(contentQuaternion(item.rot_y));
  item.mesh.position.set(
    item.pos_x / 100,
    item.pos_y / 100,
    item.pos_z / 100 - cargoSpace.width / 2
  );
}

// Swap in a fresh mesh, preserving selection highlight
function rebuildItemMesh(item) {
  const wasSelected = item.id === selectedItemId;
  if (item.mesh) {
    cartonGroup.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
    item.mesh.children.forEach(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) { c.material.map?.dispose(); c.material.dispose(); }
    });
  }
  item.mesh = createItemMesh(item);
  cartonGroup.add(item.mesh);
  item.mesh.position.set(
    item.pos_x / 100,
    item.pos_y / 100,
    item.pos_z / 100 - cargoSpace.width / 2
  );
  if (wasSelected) highlightMesh(item, true);
  // A fresh mesh has no contents yet; put them back unless the plan has
  // already given up on drawing them.
  if (!contentsBudgetHit) applyContents(item, { left: MAX_CONTENT_UNITS });
  updateLabelVisibility();
}

function highlightMesh(item, isSelected) {
  if (!item?.mesh) return;
  const mat = item.mesh.material;
  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);
  if (isSelected) {
    mat.emissive.set(0x1a6fdb);
    mat.emissiveIntensity = wire ? 0.25 : 0.45;   // round shapes lean on glow
    if (wire) { wire.material.color.set(0x1a6fdb); wire.material.opacity = 1; }
  } else {
    mat.emissiveIntensity = 0;
    if (wire) { wire.material.color.set(0x1a2536); wire.material.opacity = 0.45; }
  }
}

// Highlight for a box that's the auto-stack target during a drag
function setStackHighlight(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item?.mesh) return;
  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (wire) {
    wire.material.color.set(0x22c07a);   // stack-target green
    wire.material.opacity = 1;
  } else {
    const mat = item.mesh.material;
    if (!mat.emissive) mat.emissive = new THREE.Color(0x000000);
    mat.emissive.set(0x22c07a);
    mat.emissiveIntensity = 0.45;
  }
}
function restoreWireframe(itemId) {
  const item = items.find(i => i.id === itemId);
  if (!item?.mesh) return;
  const wire = item.mesh.children.find(c => c.userData.isEdge);
  if (!wire) { highlightMesh(item, itemId === selectedItemId); return; }
  if (itemId === selectedItemId) {
    wire.material.color.set(0x1a6fdb);
    wire.material.opacity = 1;
  } else {
    wire.material.color.set(0x1a2536);
    wire.material.opacity = 0.45;
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
  newSprite.visible = false;             // managed by updateLabelVisibility
  item.mesh.add(newSprite);
  updateLabelVisibility();
}

// Show only the label of the box under the cursor (or the one being dragged).
// Called on hover changes, selection changes, drag start/end, and label toggle.
function updateLabelVisibility() {
  const targetId = dragState ? dragState.itemId : hoveredItemId;
  items.forEach(item => {
    const sprite = item.mesh?.children.find(c => c.userData.isLabel);
    if (sprite) {
      sprite.visible = showLabels && item.id === targetId;
    }
  });
}

function addItem(spec) {
  const item = {
    id: uid(),
    label: spec.label, base_label: spec.base_label,
    product_name: spec.product_name || '',
    kind: spec.kind || 'carton',
    length_cm: Number(spec.length_cm),
    width_cm:  Number(spec.width_cm),
    height_cm: Number(spec.height_cm),
    weight_kg: Number(spec.weight_kg) || 0,
    handling:  spec.handling || 'standard',
    color:     spec.color,
    shape:     normaliseShape(spec.kind, spec.shape),
    max_stack_kg: spec.max_stack_kg ?? null,
    // Pinned in place: nothing that changes where it sits or which way it
    // faces will touch it until it is unlocked.
    locked: !!spec.locked,
    rot_y: 0, pos_x: 0, pos_y: 0, pos_z: 0, mesh: null,
    contents: spec.contents ? spec.contents.map(c => ({ ...c })) : null,
    // What the carton builder made this from, so the plan can draw the real
    // contents. Small enough to store; the unit positions are derived.
    build_ref: spec.build_ref || null,
    build: undefined
  };
  item.mesh = createItemMesh(item);
  cartonGroup.add(item.mesh);
  const slot = findFreeSlot(item);
  item.pos_x = slot.pos_x; item.pos_y = slot.pos_y; item.pos_z = slot.pos_z;
  clampItemToBounds(item);
  refreshItemMesh(item);
  items.push(item);
  markDirty();
  return item;
}

function restoreItem(spec) {
  const item = {
    id: uid(),
    label: spec.label,
    base_label: spec.base_label || spec.label,
    product_name: spec.product_name || '',
    kind: spec.kind || 'carton',
    length_cm: Number(spec.length_cm),
    width_cm:  Number(spec.width_cm),
    height_cm: Number(spec.height_cm),
    weight_kg: Number(spec.weight_kg) || 0,
    handling:  spec.handling || 'standard',
    color:     spec.color,
    shape:     normaliseShape(spec.kind, spec.shape),
    max_stack_kg: spec.max_stack_kg ?? null,
    locked:    !!spec.locked,
    rot_y:     normaliseOrient(spec.rot_y),
    pos_x:     Number(spec.pos_x) || 0,
    pos_y:     Number(spec.pos_y) || 0,
    pos_z:     Number(spec.pos_z) || 0,
    mesh: null,
    contents: spec.contents ? spec.contents.map(c => ({ ...c })) : null,
    build_ref: spec.build_ref || spec.build_spec || null,
    build: undefined
  };
  item.mesh = createItemMesh(item);
  cartonGroup.add(item.mesh);
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
    if (c.material) { c.material.map?.dispose(); c.material.dispose(); }
  });
  items.splice(idx, 1);
  if (selectedItemId === id) selectedItemId = null;
  // A deleted item must not keep contributing to the selection total
  multiSelect.delete(id);
  if (lastListClickId === id) lastListClickId = null;
  renderSelectionSummary();
  markDirty();
}

function settleAll() {
  // Process bottom-up, only considering items already placed in this pass as
  // potential supports. Without this, a stacked pair finds each other as
  // "supports" and both end up climbing to the ceiling on every settle.
  const sorted = [...items].sort((a, b) =>
    (a.pos_y - itemExtent(a).h / 2) - (b.pos_y - itemExtent(b).h / 2)
  );
  const placed = [];
  for (const item of sorted) {
    // A locked carton is where somebody put it on purpose. It still counts as
    // a support for anything above, it just never gets moved itself.
    if (item.locked) { placed.push(item); continue; }
    const e = itemExtent(item);
    const minX = item.pos_x - e.l / 2, maxX = item.pos_x + e.l / 2;
    const minZ = item.pos_z - e.w / 2, maxZ = item.pos_z + e.w / 2;
    const eps = 0.5;
    let top = 0;
    for (const other of placed) {
      const b = itemBounds(other);
      if (minX + eps < b.maxX && maxX - eps > b.minX &&
          minZ + eps < b.maxZ && maxZ - eps > b.minZ) {
        if (b.maxY > top) top = b.maxY;
      }
    }
    item.pos_y = top + e.h / 2;
    clampItemToBounds(item);
    refreshItemMesh(item);
    placed.push(item);
  }
}

function clearScene() {
  items.forEach(i => {
    if (!i.mesh) return;
    cartonGroup.remove(i.mesh);
    i.mesh.geometry.dispose();
    i.mesh.material.dispose();
    i.mesh.children.forEach(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) { c.material.map?.dispose(); c.material.dispose(); }
    });
  });
  items = [];
  selectedItemId = null;
  multiSelect.clear();
  lastListClickId = null;
  contentsBudgetHit = false;
  renderSelectionSummary();
  batchCounters = { carton: 0, pallet: 0, slipsheet: 0 };
}

// ============================================================
// SELECTION
// ============================================================
// ============================================================
// SELECTION — one item drives the inspector, but any number can be marked
// so a part load can be weighed without adding the rows up by hand.
// ============================================================
const multiSelect = new Set();          // ids marked alongside the inspector one
let lastListClickId = null;             // anchor for shift-range picking

// Everything currently counted: the inspector item plus anything marked
function selectionIds() {
  const ids = new Set(multiSelect);
  if (selectedItemId) ids.add(selectedItemId);
  return ids;
}

function isSelected(id) { return id === selectedItemId || multiSelect.has(id); }

// `keepList` leaves the items list on screen instead of swapping in the
// inspector. Building a selection means clicking several rows in a row, and
// the inspector hides the very list being clicked.
function selectItem(id, { keepList = false } = {}) {
  const prev = items.find(i => i.id === selectedItemId);
  highlightMesh(prev, false);
  selectedItemId = id;
  const item = items.find(i => i.id === id);
  highlightMesh(item, true);
  populateFormFromItem(item);
  if (!keepList) setEditMode(true, item);
  renderCargoList();
  renderEditStrip();
  updateNudgeReadout();
  renderSelectionSummary();
  renderLockButton();
  applyIsolate();              // the fade follows whatever is picked
}

// Ctrl/Cmd-click: add or remove one item from the marked set
function toggleInSelection(id, keepList = true) {
  if (id === selectedItemId) {
    // Unpicking the inspector item hands the lead to another marked one
    const next = [...multiSelect][0] || null;
    if (next) multiSelect.delete(next);
    highlightMesh(items.find(i => i.id === id), false);
    if (next) selectItem(next, { keepList }); else deselectAll();
    refreshMultiHighlights();
    renderCargoList();
    renderSelectionSummary();
    return;
  }
  if (multiSelect.has(id)) multiSelect.delete(id);
  else multiSelect.add(id);
  if (!selectedItemId && multiSelect.size) {
    const first = [...multiSelect][0];
    multiSelect.delete(first);
    selectItem(first, { keepList });
    return;
  }
  refreshMultiHighlights();
  renderCargoList();
  renderSelectionSummary();
}

// Shift-click in the list: everything between the anchor and here
function selectRangeTo(id) {
  const order = items.map(i => i.id);
  const a = order.indexOf(lastListClickId ?? selectedItemId);
  const b = order.indexOf(id);
  if (a < 0 || b < 0) return selectItem(id);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  multiSelect.clear();
  for (let i = lo; i <= hi; i++) multiSelect.add(order[i]);
  const lead = order[b];
  multiSelect.delete(lead);
  selectItem(lead, { keepList: true });
  refreshMultiHighlights();
  renderCargoList();
  renderSelectionSummary();
}

function selectAllItems() {
  if (!items.length) return;
  multiSelect.clear();
  items.forEach(i => multiSelect.add(i.id));
  const lead = items[0].id;
  multiSelect.delete(lead);
  selectItem(lead, { keepList: true });
  setPanelTab('items');                  // show what was just picked
  refreshMultiHighlights();
  renderCargoList();
  renderSelectionSummary();
}

function refreshMultiHighlights() {
  applyIsolate();              // picking or unpicking changes what is faded
  items.forEach(i => {
    if (!i.mesh) return;
    const marked = multiSelect.has(i.id);
    i.mesh.userData.multi = marked;
    // Marked-but-not-inspected items get a softer emissive than the lead
    if (i.id !== selectedItemId) {
      i.mesh.material.emissive?.set(marked ? 0x1a6fdb : 0x000000);
      i.mesh.material.emissiveIntensity = marked ? 0.35 : 0;
    }
  });
}

// What the marked items add up to
function selectionTotals() {
  const ids = selectionIds();
  const picked = items.filter(i => ids.has(i.id));
  let weight = 0, volume_cm3 = 0, units = 0;
  const lots = new Set();
  picked.forEach(i => {
    weight += Number(i.weight_kg) || 0;
    volume_cm3 += i.length_cm * i.width_cm * i.height_cm;
    (i.contents || []).forEach(c => {
      units += Number(c.quantity) || 0;
      if (c.batch_lot) lots.add(c.batch_lot);
    });
  });
  return { count: picked.length, weight, volume_m3: volume_cm3 / 1e6, units, lots: [...lots], picked };
}

function renderSelectionSummary() {
  const bar = $('#selSummary');
  if (!bar) return;
  const t = selectionTotals();
  // One item is what the inspector is for; the bar earns its place from two up.
  // The figures are written either way, so nothing stale is left behind it.
  bar.hidden = t.count < 2;
  $('#selCount').textContent  = `${t.count} items`;
  $('#selWeight').textContent = `${t.weight.toFixed(1)} kg`;
  $('#selVolume').textContent = `${t.volume_m3.toFixed(3)} m³`;
  $('#selUnits').textContent  = t.units ? String(t.units) : '—';
  $('#selUnitsLabel').textContent = t.lots.length
    ? `units · ${t.lots.length} batch${t.lots.length === 1 ? '' : 'es'}`
    : 'units inside';
  renderLockButton();
}

function deselectAll() {
  const prev = items.find(i => i.id === selectedItemId);
  highlightMesh(prev, false);
  selectedItemId = null;
  contentDraft = null;                  // the half-typed product row goes with it
  multiSelect.clear();
  refreshMultiHighlights();
  setEditMode(false, null);
  renderCargoList();
  renderEditStrip();
  renderSelectionSummary();
  applyIsolate();
}

// ============================================================
// MOVING THINGS — one place decides what is allowed to move, so the lock
// cannot be forgotten on one route and honoured on another.
// ============================================================
let nudgeStepCm = 5;

// Which way is which, in centimetres of world space
const NUDGE_AXIS = { x: 'pos_x', y: 'pos_y', z: 'pos_z' };
const AXIS_EXTENT = { x: 'l', y: 'h', z: 'w' };

// Everything currently picked that is actually allowed to move
function movableSelection() {
  const ids = selectionIds();
  return items.filter(i => ids.has(i.id) && !i.locked);
}

const lockedCount = () => items.filter(i => selectionIds().has(i.id) && i.locked).length;

// The container size along one axis, in cm
const spaceAlong = axis =>
  ({ x: cargoSpace.length, y: cargoSpace.height, z: cargoSpace.width }[axis]) * 100;

// How far a whole group may shift on one axis before any member would leave
// the container. Clamping each member separately would squash the formation,
// so the tightest member governs the lot.
function clampGroupDelta(group, origins, axis, delta) {
  const limit = spaceAlong(axis);
  let allowed = delta;
  group.forEach((it, i) => {
    const half = itemExtent(it)[AXIS_EXTENT[axis]] / 2;
    const from = origins[i][axis];
    if (delta < 0) allowed = Math.max(allowed, half - from);
    else if (delta > 0) allowed = Math.min(allowed, (limit - half) - from);
  });
  return allowed;
}

// Shift a whole group by one rigid delta
function shiftGroup(group, origins, d) {
  group.forEach((it, i) => {
    const o = origins[i];
    it.pos_x = o.x + (d.x || 0);
    it.pos_y = o.y + (d.y || 0);
    it.pos_z = o.z + (d.z || 0);
    clampItemToBounds(it);               // belt and braces; the delta is already clamped
    refreshItemMesh(it);
  });
}

const snapshotPositions = group => group.map(i => ({ x: i.pos_x, y: i.pos_y, z: i.pos_z }));

// Something moved. The list, the inspector and the nudge readout all say
// where things are, so they are redrawn together rather than one at a time —
// an address left over from before the move is worse than no address.
function refreshPositionReadouts() {
  renderCargoList();
  renderEditStrip();
  updateNudgeReadout();
}

// ============================================================
// ISOLATE
// ------------------------------------------------------------
// A full container is a wall of boxes. Working on one carton inside it means
// fighting every carton in front of it — you cannot see it, and clicking near
// it grabs a neighbour. Isolate fades everything that is not picked down to a
// ghost and makes those ghosts deaf to the mouse, so the only thing you can
// see or grab is the thing you are working on.
// ============================================================
let isolateOn = false;
const GHOST_OPACITY = 0.06;

const isolateActive = () => isolateOn && selectionIds().size > 0;
const isGhosted = id => isolateActive() && !selectionIds().has(id);

function applyIsolate() {
  const btn = $('#toggleIsolate');
  if (btn) {
    btn.classList.toggle('active', isolateOn);
    btn.title = isolateOn
      ? 'Showing only what you picked (I)'
      : 'Fade everything except what you pick (I)';
  }
  // The selection changes constantly. Doing nothing when there is nothing to
  // undo keeps that free.
  const anyGhost = items.some(i => i.mesh?.userData.ghost);
  if (!isolateOn && !anyGhost) return;

  const active = isolateActive();
  const keep = selectionIds();
  items.forEach(i => {
    if (!i.mesh) return;
    const ghost = active && !keep.has(i.id);
    i.mesh.userData.ghost = ghost;
    const wire = i.mesh.children.find(c => c.userData.isEdge);
    if (wire) wire.visible = !ghost;
    if (ghost) {
      i.mesh.material.transparent = true;
      i.mesh.material.opacity = GHOST_OPACITY;
      i.mesh.material.depthWrite = false;
      i.mesh.material.needsUpdate = true;
    }
  });
  // Anything that is not a ghost gets whatever opacity the contents toggle
  // wants; applyContents leaves the ghosts alone.
  refreshAllContents();
  updateLabelVisibility();
}

function setIsolate(on) {
  isolateOn = !!on;
  applyIsolate();
  if (isolateOn && !selectionIds().size) {
    showToast('Isolate is on. Pick a carton and the rest will fade.');
  } else if (isolateOn) {
    showToast('Showing only what you picked. Press <b>I</b> to bring the rest back.');
  }
}

function nudgeSelected(axis, dir, step = nudgeStepCm) {
  const group = movableSelection();
  const key = NUDGE_AXIS[axis];
  if (!key) return false;
  if (!group.length) {
    const blocked = lockedCount();
    showToast(blocked
      ? `${blocked === 1 ? 'That carton is' : `All ${blocked} are`} locked — unlock to move.`
      : 'Nothing selected.');
    return false;
  }

  const origins = snapshotPositions(group);
  const allowed = clampGroupDelta(group, origins, axis, dir * step);

  // Hard against a wall: say so rather than silently doing nothing
  if (Math.abs(allowed) < 0.001) {
    showToast(`Already against the ${axis === 'y' ? (dir > 0 ? 'roof' : 'floor') : 'wall'}.`);
    return false;
  }

  shiftGroup(group, origins, { [axis]: allowed });
  evaluateStability();
  refreshPositionReadouts();
  updateStats();
  updateDimOverlay?.();
  if (sceneMode === '2d') updateResizeHandlesPosition?.();
  markDirty();
  return true;
}

// Where the item currently sits, so a nudge has a frame of reference
function updateNudgeReadout() {
  const el = $('#nudgePos');
  if (!el) return;
  const item = items.find(i => i.id === selectedItemId);
  if (!item) { el.textContent = ''; return; }
  const e = itemExtent(item);
  // Measured from the back-left-floor corner of the cargo space, which is
  // what a loading plan actually refers to.
  el.innerHTML =
    `From the corner: <b>${fromCm(item.pos_x - e.l / 2)}</b> × ` +
    `<b>${fromCm(item.pos_z - e.w / 2)}</b> · ` +
    `<b>${fromCm(item.pos_y - e.h / 2)}</b> up`;
}

function populateFormFromItem(item) {
  if (!item) return;
  $('#fLabel').value    = item.base_label || '';
  $('#fProduct').value  = item.product_name || '';
  $('#fLength').value   = fromCm(item.length_cm);
  $('#fWidth').value    = fromCm(item.width_cm);
  $('#fHeight').value   = fromCm(item.height_cm);
  $('#fWeight').value   = item.weight_kg || '';
  $('#fHandling').value = item.handling || 'standard';
  $('#fMaxStack').value = item.max_stack_kg ?? '';
  setKind(item.kind || 'carton', { autofill: false });
  setShape(item.shape || 'box', { mirror: false });
}

// Selecting an item swaps the whole panel over to an inspector rather than
// populating the Add form and stacking a second editor underneath it. The
// field set is one set of DOM nodes that physically moves between the two,
// so every existing handler and id keeps working.
function setEditMode(isEdit, item) {
  const fields  = $('#cargoFields');
  const inspect = $('#paneInspect');
  const tabs    = $('#panelTabs');

  if (isEdit && item) {
    $('#inspectFieldSlot').appendChild(fields);
    $('#paneAdd').hidden = true;
    $('#paneItems').hidden = true;
    inspect.hidden = false;
    tabs.hidden = true;
    // Surface the options block if this item isn't a plain box carton
    if ((item.kind && item.kind !== 'carton') || (item.shape && item.shape !== 'box')) {
      setOptionsOpen(true);
    }
  } else {
    $('#addFieldSlot').appendChild(fields);
    inspect.hidden = true;
    tabs.hidden = false;
    setPanelTab(lastPanelTab);
  }
  refreshSegments();
}

// ============================================================
// STABILITY
// ------------------------------------------------------------
// Works out what each item is resting on, pushes the weight above it down
// through the stack, and flags anything that would crush, tip or float.
// Nothing here blocks the user — it only warns.
// ============================================================
function bearingCapacity(item) {
  if (item.max_stack_kg > 0) return Number(item.max_stack_kg);   // user's own figure
  const e = itemExtent(item);
  const perimeter = 2 * (e.l + e.w);
  const k = BCT_KGF_PER_CM[item.kind] ?? BCT_KGF_PER_CM.carton;
  return perimeter * k / STACK_SAFETY_FACTOR;
}

function evaluateStability() {
  items.forEach(i => { i.issues = []; });
  if (items.length === 0) return;

  // Who rests on whom, and over how much contact area
  const supportsOf = new Map();
  for (const item of items) {
    const b = itemBounds(item);
    if (b.minY < 0.5) { supportsOf.set(item.id, null); continue; }   // on the floor
    const list = [];
    for (const other of items) {
      if (other.id === item.id) continue;
      const ob = itemBounds(other);
      if (Math.abs(ob.maxY - b.minY) > CONTACT_EPS_CM) continue;
      const ox = Math.min(b.maxX, ob.maxX) - Math.max(b.minX, ob.minX);
      const oz = Math.min(b.maxZ, ob.maxZ) - Math.max(b.minZ, ob.minZ);
      if (ox > 0.1 && oz > 0.1) list.push({ id: other.id, area: ox * oz });
    }
    supportsOf.set(item.id, list);
  }

  // Push weight down the stack, highest first, split by contact area
  const carried = new Map(items.map(i => [i.id, 0]));
  const topDown = [...items].sort((a, b) => b.pos_y - a.pos_y);
  for (const item of topDown) {
    const sup = supportsOf.get(item.id);
    if (!sup || !sup.length) continue;
    const total = sup.reduce((s, x) => s + x.area, 0);
    if (total <= 0) continue;
    const passing = (item.weight_kg || 0) + carried.get(item.id);
    sup.forEach(s => carried.set(s.id, carried.get(s.id) + passing * (s.area / total)));
  }

  for (const item of items) {
    const e = itemExtent(item);
    const footprint = e.l * e.w;
    const sup = supportsOf.get(item.id);
    const load = carried.get(item.id) || 0;

    // Kept on the item so the panel can show the numbers even when all is well
    item.carried_kg = load;
    item.capacity_kg = bearingCapacity(item);
    item.capacity_is_default = !(item.max_stack_kg > 0);

    // Floating or poorly supported
    if (sup !== null) {
      if (!sup.length) {
        item.issues.push({ level: 'danger', text: 'Floating with nothing underneath' });
      } else {
        const area = sup.reduce((s, x) => s + x.area, 0);
        const ratio = footprint > 0 ? area / footprint : 1;
        if (ratio < MIN_SUPPORT_RATIO) {
          item.issues.push({
            level: ratio < 0.3 ? 'danger' : 'warn',
            text: `Only ${Math.round(ratio * 100)}% of its base is supported — tipping risk`
          });
        }
      }
    }

    // Crushing
    if (load > 0.05) {
      const cap = item.capacity_kg;
      if (load > cap) {
        item.issues.push({
          level: 'danger',
          text: `Carrying ${load.toFixed(1)} kg against roughly ${cap.toFixed(0)} kg capacity — likely to crush`
        });
      } else if (load > cap * 0.8) {
        item.issues.push({
          level: 'warn',
          text: `Carrying ${load.toFixed(1)} kg, close to its ${cap.toFixed(0)} kg capacity`
        });
      }
      if (item.handling === 'fragile') {
        item.issues.push({ level: 'warn', text: `Marked fragile with ${load.toFixed(1)} kg stacked on it` });
      }
    }

    // Orientation rule
    if (item.handling === 'this_side_up' && item.rot_y > 1) {
      item.issues.push({ level: 'warn', text: 'Marked this side up but resting on another face' });
    }

    item.issueLevel = item.issues.some(x => x.level === 'danger') ? 'danger'
                    : item.issues.length ? 'warn' : null;
  }
}

function issueCounts() {
  let danger = 0, warn = 0;
  items.forEach(i => {
    if (i.issueLevel === 'danger') danger++;
    else if (i.issueLevel === 'warn') warn++;
  });
  return { danger, warn, total: danger + warn };
}

// ============================================================
// STATS + STATUS CHIP
// ============================================================
function updateStats() {
  const spaceVol = cargoSpace.length * cargoSpace.width * cargoSpace.height * 1000000;
  const itemVol  = items.reduce((s, i) => s + i.length_cm * i.width_cm * i.height_cm, 0);
  const weight   = items.reduce((s, i) => s + (i.weight_kg || 0), 0);
  const volPct   = spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0;

  $('#statVolume').textContent = `${volPct.toFixed(1)}%`;
  $('#statItems').textContent  = `${items.length}`;
  $('#statWeight').textContent = `${weight.toFixed(1)} kg`;

  evaluateStability();
  const iss = issueCounts();

  const statusEl = $('#statStatus');
  let cls, txt;
  if (items.length === 0)      { cls = 'stat-ok';     txt = 'Empty'; }
  else if (iss.danger)         { cls = 'stat-danger'; txt = `⚠ ${iss.danger} unsafe`; }
  else if (volPct > 100)       { cls = 'stat-danger'; txt = 'Over capacity'; }
  else if (iss.warn)           { cls = 'stat-warn';   txt = `⚠ ${iss.warn} to check`; }
  else if (volPct > 90)        { cls = 'stat-warn';   txt = 'Near full'; }
  else                         { cls = 'stat-ok';     txt = 'OK'; }
  statusEl.className = 'stat-value ' + cls;
  statusEl.textContent = txt;
}

function markDirty() { isDirty = true; updateStatusChip(); }
function markClean() { isDirty = false; updateStatusChip(); }

function updateStatusChip() {
  const chip = $('#statusChip');
  chip.classList.remove('dirty', 'saved', 'published');
  if (planStatus === 'published') {
    chip.classList.add('published');
    chip.textContent = isDirty ? 'Published · Unsaved edits' : 'Published';
  } else if (isDirty || !currentPlanId) {
    chip.classList.add('dirty');
    chip.textContent = currentPlanId ? 'Draft · Unsaved edits' : 'Draft · Unsaved';
  } else {
    chip.classList.add('saved');
    chip.textContent = 'Draft · Saved';
  }
}

// ============================================================
// CARGO LIST + EDIT STRIP
// ============================================================
function renderCargoList() {
  const list = $('#cargoList');
  $('#tabItemsCount').textContent = items.length;
  if (items.length === 0) {
    list.innerHTML = '<div class="list-empty">No items yet. Add cargo in the <b>Add</b> tab and it drops into the container.</div>';
    return;
  }
  const addrs = addressesFor();
  list.innerHTML = items.map(i => {
    const addr = addrs.get(i.id);
    const units = i.contents?.reduce((s, c) => s + (c.quantity || 0), 0) || 0;
    const lots = [...new Set((i.contents || []).map(c => c.batch_lot).filter(Boolean))];
    const pm = i.pallet_meta;
    const t = i.terms || TERM_DEFAULTS;
    const unitWord = pluralise(t.product || 'unit', units).toLowerCase();
    const packWord = pm ? pluralise(t.primary || 'pack', pm.trays).toLowerCase() : '';
    const extra = pm
      ? `${pm.trays} ${escapeHtml(packWord)} · ${units} ${escapeHtml(unitWord)}${lots.length ? ' · ' + lots.map(escapeHtml).join(', ') : ''}${pm.order_no ? ' · #' + escapeHtml(pm.order_no) : ''}`
      : (units ? `${units} ${escapeHtml(unitWord)}${lots.length ? ' · ' + lots.map(escapeHtml).join(', ') : ''}` : '');
    return `
    <div class="cargo-row ${i.id === selectedItemId ? 'selected' : ''}${multiSelect.has(i.id) ? ' marked' : ''}" data-id="${i.id}">
      <button type="button" class="cargo-pick${isSelected(i.id) ? ' on' : ''}" data-pick="${i.id}"
              title="Count this one in the selection total"
              aria-pressed="${isSelected(i.id)}">✓</button>
      <span class="cargo-swatch" style="background:${i.color}"></span>
      <div class="cargo-meta">
        <b>${escapeHtml(i.label)}${i.product_name ? ' · ' + escapeHtml(i.product_name) : ''}</b>
        <small>${fromCm(i.length_cm)} × ${fromCm(i.width_cm)} × ${fromCm(i.height_cm)} ${itemUnit} · ${i.weight_kg || 0} kg${
          (i.shape && i.shape !== 'box') ? ` · <span class="row-shape">${escapeHtml(SHAPES[i.shape].label)}</span>` : ''}</small>
        ${extra ? `<small class="cargo-contents">${extra}</small>` : ''}
      </div>
      <span class="row-addr" title="Where it sits — ${escapeHtml(addressLegend())}">${addr.text}</span>
      ${i.locked ? '<span class="row-lock" title="Locked — cannot be moved">🔒</span>' : ''}
      ${i.issueLevel ? `<span class="row-warn lvl-${i.issueLevel}" title="${escapeHtml(i.issues.map(x => x.text).join(' · '))}">!</span>` : ''}
      <span class="focus-icon" title="Focus camera">⌖</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.cargo-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const id = row.dataset.id;
      if (e.target.classList.contains('focus-icon')) {
        selectItem(id); focusOnItem(id); lastListClickId = id; return;
      }
      // The tick box builds a selection without opening the inspector, which
      // would hide the very list the next row has to be picked from.
      if (e.target.closest('.cargo-pick')) {
        e.stopPropagation();
        toggleInSelection(id);
        lastListClickId = id;
        return;
      }
      // Ctrl/Cmd adds one, Shift takes the run, a plain click starts over
      if (e.ctrlKey || e.metaKey) { toggleInSelection(id); lastListClickId = id; return; }
      if (e.shiftKey) { selectRangeTo(id); return; }
      multiSelect.clear();
      refreshMultiHighlights();
      selectItem(id);
      lastListClickId = id;
    });
  });
}

function renderEditStrip() {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;                     // setEditMode handles hiding the pane
  $('#editStripLabel').textContent = item.label;
  const orientEl = $('#editStripOrient');
  if (orientEl) orientEl.textContent = ORIENT_NAMES[item.rot_y] || 'Upright';
  const sw = $('#editSwatch');
  if (sw) sw.style.background = item.color;
  const sh = $('#editStripShape');
  if (sh) sh.textContent = SHAPES[item.shape || 'box'].label;

  // Where it sits, in words someone in the container can use
  const ad = $('#editStripAddr');
  if (ad) {
    const a = addressOf(item);
    ad.textContent = a ? a.text : '—';
    ad.title = addressLegend();
  }

  renderResizeReadout();

  // What is inside this carton. A builder carton knows already; one added
  // by hand starts empty and is filled in here.
  renderInspContents(item);

  // Bearing readout — shown even when nothing is wrong, so the check is visible
  const bear = $('#editBearing');
  if (bear) {
    const cap = item.capacity_kg || bearingCapacity(item);
    const load = item.carried_kg || 0;
    const pct = cap > 0 ? load / cap : 0;
    bear.hidden = false;
    $('#bearingVal').textContent = `${load.toFixed(1)} / ${cap.toFixed(0)} kg`;
    const fill = $('#bearingFill');
    fill.style.width = `${Math.min(100, pct * 100).toFixed(1)}%`;
    fill.className = pct > 1 ? 'lvl-danger' : pct > 0.7 ? 'lvl-warn' : '';
    $('#bearingNote').textContent = item.capacity_is_default === false
      ? 'Capacity set manually'
      : `Estimated from a ${Math.round(2 * (itemExtent(item).l + itemExtent(item).w))} cm perimeter — set Max stack load if you know the real figure`;
  }

  const box = $('#editIssues');
  if (box) {
    if (!item.issues?.length) {
      box.hidden = true;
      box.innerHTML = '';
    } else {
      box.hidden = false;
      box.innerHTML = item.issues
        .map(x => `<div class="edit-issue lvl-${x.level}"><span>!</span>${escapeHtml(x.text)}</div>`)
        .join('');
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// ============================================================
// AUTO-PACK
// ------------------------------------------------------------
// Extreme-point first-fit heuristic with a back-bottom-left bias,
// so the pack builds a full-height wall at the closed end and then
// advances toward the doors — the way containers are really loaded.
//
// Constraints:
//   · every box needs >= SUPPORT_RATIO of its base resting on something
//   · 'heavy' sorts first (lands low), 'fragile' sorts last (lands high)
//   · nothing may rest on a 'fragile' item
// ============================================================
const SUPPORT_RATIO = 0.7;
const PACK_EPS = 0.01;
const MAX_POINTS = 2400;

function packVolume(it) { return it.length_cm * it.width_cm * it.height_cm; }

function handlingRank(h) {
  if (h === 'heavy') return 0;
  if (h === 'fragile') return 2;
  return 1;
}

function sortItemsForPacking(list, strategy) {
  const arr = [...list];
  if (strategy === 'sku') {
    // Keep same-label items adjacent so they unload as a unit.
    const order = new Map();
    arr.forEach(i => {
      if (!order.has(i.base_label)) order.set(i.base_label, order.size);
    });
    return arr.sort((a, b) =>
      handlingRank(a.handling) - handlingRank(b.handling) ||
      order.get(a.base_label) - order.get(b.base_label) ||
      packVolume(b) - packVolume(a)
    );
  }
  return arr.sort((a, b) =>
    handlingRank(a.handling) - handlingRank(b.handling) ||
    packVolume(b) - packVolume(a)
  );
}

function packCollides(placed, x, y, z, dl, dh, dw) {
  for (const r of placed) {
    if (x + dl - PACK_EPS <= r.minX || r.minX + r.dl - PACK_EPS <= x) continue;
    if (y + dh - PACK_EPS <= r.minY || r.minY + r.dh - PACK_EPS <= y) continue;
    if (z + dw - PACK_EPS <= r.minZ || r.minZ + r.dw - PACK_EPS <= z) continue;
    return true;
  }
  return false;
}

// Total contact area directly beneath (x,y,z) plus whether any of it is fragile
function packSupportInfo(placed, x, y, z, dl, dw) {
  let area = 0, onFragile = false;
  for (const r of placed) {
    if (Math.abs(r.minY + r.dh - y) > 0.5) continue;          // top face must meet our base
    const ox = Math.min(x + dl, r.minX + r.dl) - Math.max(x, r.minX);
    const oz = Math.min(z + dw, r.minZ + r.dw) - Math.max(z, r.minZ);
    if (ox > PACK_EPS && oz > PACK_EPS) {
      area += ox * oz;
      if (r.handling === 'fragile') onFragile = true;
    }
  }
  return { area, onFragile };
}

function prunePackPoints(points, placed) {
  const seen = new Set();
  const out = [];
  for (const p of points) {
    const key = `${p.x.toFixed(1)}|${p.y.toFixed(1)}|${p.z.toFixed(1)}`;
    if (seen.has(key)) continue;
    // Drop points swallowed by an already-placed box
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

function computeAutoPack(strategy) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;

  // Locked cartons are not candidates — they are obstacles. Seeding them into
  // `placed` means every collision and support check already knows about them,
  // so the packer fills in around whatever has been pinned down.
  const locked = items.filter(i => i.locked);
  const queue = sortItemsForPacking(items.filter(i => !i.locked), strategy);
  const placed = locked.map(i => {
    const e = itemExtent(i);
    return {
      id: i.id, handling: i.handling, rot: i.rot_y, locked: true,
      minX: i.pos_x - e.l / 2, minY: i.pos_y - e.h / 2, minZ: i.pos_z - e.w / 2,
      dl: e.l, dw: e.w, dh: e.h
    };
  });
  const unplaced = [];
  // Corners of the locked cartons are candidate spots too, otherwise nothing
  // could ever be stacked on one or butted up against it.
  let points = [{ x: 0, y: 0, z: 0 }];
  placed.forEach(r => {
    points.push({ x: r.minX + r.dl, y: r.minY, z: r.minZ });
    points.push({ x: r.minX, y: r.minY + r.dh, z: r.minZ });
    points.push({ x: r.minX, y: r.minY, z: r.minZ + r.dw });
  });
  points = prunePackPoints(points, placed);

  for (const item of queue) {
    let hit = null;
    // 'This side up' may only yaw; everything else can rest on any face.
    const allowed = item.handling === 'this_side_up' ? [0, 1] : [0, 1, 2, 3, 4, 5];

    search:
    for (const p of points) {
      for (const oi of allowed) {
        const ext = extentFor(item, oi);
        const dl = ext.l, dw = ext.w, dh = ext.h;

        if (p.x + dl > L + PACK_EPS) continue;
        if (p.y + dh > H + PACK_EPS) continue;
        if (p.z + dw > W + PACK_EPS) continue;
        if (packCollides(placed, p.x, p.y, p.z, dl, dh, dw)) continue;

        if (p.y > 0.5) {
          const sup = packSupportInfo(placed, p.x, p.y, p.z, dl, dw);
          if (sup.onFragile) continue;                         // never crush a fragile item
          if (sup.area < dl * dw * SUPPORT_RATIO) continue;    // needs a stable base
        }

        hit = { p, rot: oi, dl, dw, dh };
        break search;
      }
    }

    if (!hit) { unplaced.push(item); continue; }

    placed.push({
      id: item.id, handling: item.handling,
      minX: hit.p.x, minY: hit.p.y, minZ: hit.p.z,
      dl: hit.dl, dw: hit.dw, dh: hit.dh, rot: hit.rot
    });

    points = points.filter(q => q !== hit.p);
    points.push({ x: hit.p.x + hit.dl, y: hit.p.y,           z: hit.p.z });
    points.push({ x: hit.p.x,          y: hit.p.y + hit.dh,  z: hit.p.z });
    points.push({ x: hit.p.x,          y: hit.p.y,           z: hit.p.z + hit.dw });
    points = prunePackPoints(points, placed);
  }

  return { placed, unplaced };
}

// Fore/aft weight balance — positive means weight sits toward the doors
function packBalance(placed) {
  const L = cargoSpace.length * 100;
  let totalW = 0, moment = 0;
  for (const r of placed) {
    const item = items.find(i => i.id === r.id);
    const w = item?.weight_kg || 0;
    totalW += w;
    moment += w * (r.minX + r.dl / 2);
  }
  if (totalW <= 0) return 0;
  return ((moment / totalW) - L / 2) / (L / 2) * 100;
}

// ---- drop animation ----
function dropEase(p) {
  if (p < 0.78) { const q = p / 0.78; return q * q; }        // gravity
  const q = (p - 0.78) / 0.22;                                // settle bounce
  return 1 - Math.sin(q * Math.PI) * 0.08 * (1 - q * 0.6);
}

function runAutoPackAnimation(placed, onComplete) {
  const dropTopCm = cargoSpace.height * 100 + 140;
  const n = placed.length;
  const STAGGER = n > 0 ? Math.max(4, Math.min(26, 1400 / n)) : 0;
  const FALL = 460;

  const anims = [];
  placed.forEach((pl, i) => {
    if (pl.locked) return;               // seeded as an obstacle; never moved
    const item = items.find(x => x.id === pl.id);
    if (!item) return;
    item.rot_y = pl.rot;
    item.pos_x = pl.minX + pl.dl / 2;
    item.pos_z = pl.minZ + pl.dw / 2;
    const fromY = dropTopCm + item.height_cm / 2;
    item.pos_y = fromY;
    refreshItemMesh(item);
    anims.push({ item, fromY, toY: pl.minY + pl.dh / 2, start: i * STAGGER });
  });

  const t0 = performance.now();
  function tick(now) {
    const t = now - t0;
    let running = false;
    for (const a of anims) {
      const local = t - a.start;
      if (local < 0) { running = true; continue; }
      if (local >= FALL) { a.item.pos_y = a.toY; refreshItemMesh(a.item); continue; }
      running = true;
      a.item.pos_y = a.fromY + (a.toY - a.fromY) * dropEase(local / FALL);
      refreshItemMesh(a.item);
    }
    if (running) requestAnimationFrame(tick);
    else onComplete?.();
  }
  requestAnimationFrame(tick);
}

// ---- plan checks ----
function setCheck(id, state, text) {
  const li = $(id);
  if (!li) return;
  li.classList.remove('check-pass', 'check-fail');
  if (state === 'pass') li.classList.add('check-pass');
  if (state === 'fail') li.classList.add('check-fail');
  const icon = li.querySelector('.check-icon');
  if (icon) icon.textContent = state === 'pass' ? '✓' : state === 'fail' ? '!' : '○';
  const label = li.querySelector('.check-text');
  if (label && text) label.textContent = text;
}

function evaluatePlanChecks(result) {
  const spaceVol = cargoSpace.length * cargoSpace.width * cargoSpace.height * 1000000;
  const itemVol = items.reduce((s, i) => s + packVolume(i), 0);
  const volPct = spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0;
  const balance = packBalance(result.placed);

  setCheck('#chkVolume', volPct <= 100 ? 'pass' : 'fail',
    `Within cargo volume — ${volPct.toFixed(1)}%`);
  setCheck('#chkBalance', Math.abs(balance) <= 10 ? 'pass' : 'fail',
    `Load balance — ${balance >= 0 ? '+' : ''}${balance.toFixed(1)}% ${balance >= 0 ? 'toward doors' : 'toward back'}`);
  setCheck('#chkHandling', 'pass', 'Handling rules respected');
  setCheck('#chkFit', result.unplaced.length === 0 ? 'pass' : 'fail',
    result.unplaced.length === 0 ? 'All items loaded'
                                 : `${result.unplaced.length} item${result.unplaced.length > 1 ? 's' : ''} left out`);
}

// ---- entry point ----
function runAutoPack() {
  if (isPacking) return;
  if (items.length === 0) return showToast('Add some cargo before packing.');

  const strategy = $('#packStrategy')?.value || 'best';

  // Snapshot for undo
  autoPackUndo = items.map(i => ({
    id: i.id, pos_x: i.pos_x, pos_y: i.pos_y, pos_z: i.pos_z, rot_y: i.rot_y
  }));

  const result = computeAutoPack(strategy);

  isPacking = true;
  deselectAll();
  $('#autoPackBtn').disabled = true;

  runAutoPackAnimation(result.placed, () => {
    isPacking = false;
    $('#autoPackBtn').disabled = false;
    $('#autoPackUndoBtn').hidden = false;

    updateStats();
    renderCargoList();
    evaluatePlanChecks(result);
    markDirty();

    const spaceVol = cargoSpace.length * cargoSpace.width * cargoSpace.height * 1000000;
    const itemVol = result.placed.reduce((s, r) => s + r.dl * r.dw * r.dh, 0);
    const fill = spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0;
    const balance = packBalance(result.placed);

    const box = $('#autoPackResult');
    box.hidden = false;
    box.innerHTML = `
      <div class="pack-stat"><span>Loaded</span><b>${result.placed.length} / ${items.length}</b></div>
      <div class="pack-stat"><span>Space used</span><b>${fill.toFixed(1)}%</b></div>
      <div class="pack-stat"><span>Balance</span><b>${balance >= 0 ? '+' : ''}${balance.toFixed(1)}%</b></div>
      ${result.unplaced.length
        ? `<div class="pack-warn">${result.unplaced.length} item${result.unplaced.length > 1 ? 's' : ''} didn't fit and stayed put.</div>`
        : ''}
    `;

    showToast(result.unplaced.length
      ? `Packed <b>${result.placed.length}</b> — ${result.unplaced.length} didn't fit.`
      : `Packed all <b>${result.placed.length}</b> items · ${fill.toFixed(1)}% used.`);
  });
}

function undoAutoPack() {
  if (!autoPackUndo || isPacking) return;
  autoPackUndo.forEach(snap => {
    const item = items.find(i => i.id === snap.id);
    if (!item) return;
    item.pos_x = snap.pos_x; item.pos_y = snap.pos_y; item.pos_z = snap.pos_z;
    item.rot_y = snap.rot_y;
    refreshItemMesh(item);
    refreshItemSprite(item);
  });
  autoPackUndo = null;
  $('#autoPackUndoBtn').hidden = true;
  $('#autoPackResult').hidden = true;
  ['#chkVolume', '#chkBalance', '#chkHandling', '#chkFit'].forEach(id => setCheck(id, 'idle'));
  updateStats();
  renderCargoList();
  markDirty();
  showToast('Auto-pack reverted.');
}

// ============================================================
// CARTON BUILDER (BETA)
// ------------------------------------------------------------
// A carton is defined by its CONTENTS rather than by outer dimensions.
// Each content group carries its own product, batch lot, medium, unit
// geometry and a cols x rows x layers arrangement. Groups stack bottom
// to top; the carton's outer size and weight are derived from them.
//
// Everything here is additive — the simple Cargo form is untouched.
// ============================================================
const CARTON_SPECS_KEY = 'smartuna_planner_carton_specs_v1';
const BUILDER_UNIT_KEY = 'smartuna_planner_builder_unit';
const BATCH_CODES_KEY  = 'smartuna_planner_batch_codes';
const GROUP_COLORS = ['#1a6fdb', '#38b47a', '#f4a11c', '#8b5cf6', '#ec4899', '#14b8a6'];

// The builder describes four packaging levels, the middle one optional:
//
//   product    the thing itself in its own pack       a can
//   primary    the pack that holds the products       a tray of 12 cans
//   outer      an optional box that holds the packs   a carton of 4 trays
//   secondary  the base the whole lot stacks onto     a pallet
//
// What each level is called depends on the product — cans in trays in cartons
// on pallets, or loins in interleaved blocks in master cartons — so the user
// names them and every heading follows their word.
//
// The keys 'primary' and 'secondary' predate the 'outer' level and are kept so
// saved specs and saved plan items keep loading. Read them by role, not by
// name: 'secondary' is the base, not the second level.
// Only ever used as a stand-in in prose until the user names a level. They are
// deliberately generic: nothing here should suggest the builder expects cans,
// trays and pallets rather than whatever the user actually ships.
const TERM_DEFAULTS = { product: 'Unit', primary: 'Pack', outer: 'Outer box', secondary: 'Base' };

// Shown as the heading until the user has named that level. Each one names
// the level below it rather than saying "those", which told nobody anything.
function unnamedHeading(level) {
  const below = (lvl) => isNamed(lvl)
    ? term(lvl, 2, true)                 // their own word, plural: "trays"
    : (lvl === 'product' ? 'the products' : 'the packs');
  switch (level) {
    case 'product':   return 'What are you shipping?';
    case 'primary':   return `What do ${below('product')} go into?`;
    case 'outer':     return `What do ${below('primary')} go into?`;
    case 'secondary': return 'What does it all stack on?';
    default:          return 'Name this level';
  }
}

// Printed under each step heading, so no heading relies on jargon.
// The level number is prefixed at render time from the levels actually
// switched on, so the words never disagree with the badge beside them.
const TERM_ROLES = {
  product:   'what you are shipping, in its own pack. Measure one of these.',
  primary:   'the pack the products go into. Sized from the products, or to a size you already have.',
  outer:     'optional. A bigger box holding several of the packs below. Skip it if the packs ship as they are.',
  secondary: 'the base the whole lot stacks onto.'
};

const TERM_SUGGESTIONS = {
  product: [
    'Can', 'Tin', 'Pouch', 'Jar', 'Bottle', 'Tub', 'Cup',
    'Loin', 'Fillet', 'Steak', 'Portion', 'Saku block', 'Brick', 'Slab', 'Whole fish',
    'Bag', 'Sachet', 'Vacuum pack', 'Skin pack', 'Piece', 'Unit'
  ],
  primary: [
    'Tray', 'Inner carton', 'Shrink pack', 'Multipack', 'Bundle', 'Sleeve',
    'Case', 'Box', 'Interleaved block', 'Layer pack',
    'Bag', 'Sack', 'Polybag', 'Crate', 'Tote'
  ],
  outer: [
    'Carton', 'Master carton', 'Outer carton', 'Shipper', 'Case',
    'Export carton', 'Combo bin', 'Crate', 'Box'
  ],
  secondary: [
    'Pallet', 'Euro pallet', 'Half pallet', 'Slipsheet', 'Skid',
    'Cage', 'Roll cage', 'Crate', 'Bin', 'Gaylord', 'Stillage', 'Dolly', 'IBC'
  ]
};

// Nouns that don't change in the plural. Common in seafood, where a user is
// as likely to type "Whole fish" or "Tuna" as they are "Can".
const INVARIANT_PLURALS = new Set([
  'fish', 'whole fish', 'tuna', 'salmon', 'cod', 'shrimp', 'squid',
  'mackerel', 'trout', 'herring', 'swordfish', 'bass', 'perch'
]);

const capitalise = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

function pluralise(word, n) {
  const w = String(word || '').trim();
  if (!w || n === 1) return w;
  if (INVARIANT_PLURALS.has(w.toLowerCase())) return w;
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

// term('product', 12) -> "Cans"   term('primary', 1, true) -> "tray"
// Falls back to a generic stand-in while a level is still unnamed.
function term(level, n = 1, lower = false) {
  const raw = (builder?.terms?.[level] || '').trim() || TERM_DEFAULTS[level];
  const out = pluralise(raw, n);
  return lower ? out.toLowerCase() : out;
}

// Has the user actually named this level, or are we still standing in for them?
const isNamed = level => !!String(builder?.terms?.[level] || '').trim();

let cartonSpecs = [];
let builderQty = 1;
let builderUnit = 'mm';                  // units for every length field in the builder
let batchCodes = [];                     // codes used before, most recent first

// Targeting a lot later only works if the same code is written the same way
// every time. Trim and collapse whitespace, and if it matches a code already
// in use apart from case, adopt that code's spelling.
function normaliseBatchCode(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const known = knownBatchCodes().find(c => c.toLowerCase() === s.toLowerCase());
  return known || s;
}

function loadBatchCodes() {
  try { batchCodes = JSON.parse(localStorage.getItem(BATCH_CODES_KEY)) || []; }
  catch (e) { batchCodes = []; }
}

function rememberBatchCode(code) {
  const s = String(code || '').trim().replace(/\s+/g, ' ');
  if (!s) return;
  batchCodes = [s, ...batchCodes.filter(c => c.toLowerCase() !== s.toLowerCase())].slice(0, 300);
  try { localStorage.setItem(BATCH_CODES_KEY, JSON.stringify(batchCodes)); } catch (e) {}
}

// Everything we could offer: codes typed before, codes already in this plan,
// and codes inside saved carton specs.
function knownBatchCodes() {
  const seen = new Map();                // lowercase -> canonical spelling
  const add = c => {
    const s = String(c || '').trim();
    if (s && !seen.has(s.toLowerCase())) seen.set(s.toLowerCase(), s);
  };
  batchCodes.forEach(add);
  items.forEach(i => (i.contents || []).forEach(c => add(c.batch_lot)));
  items.forEach(i => add(i.pallet_meta?.batch_code));
  cartonSpecs.forEach(s => {
    (s.groups || []).forEach(g => add(g.batch_lot));
    add(s.pallet?.batch_code);
  });
  if (builder) {
    (builder.groups || []).forEach(g => add(g.batch_lot));
    add(builder.pallet?.batch_code);
  }
  return [...seen.values()];
}

// The spec stores small geometry in mm and pallet decks in cm, whatever the
// user is typing in. These convert between the two.
//
// Builder values need finer display precision than the planner's: a can is
// 73.5 mm, and at the planner's 3 decimals that would round to 0.073 m and
// read back as 73. These give 0.1 mm resolution in every unit.
const B_DECIMALS = { mm: 1, cm: 2, m: 4 };
const B_STEPS    = { mm: '0.1', cm: '0.01', m: '0.0001' };
function bFormat(v, unit) {
  const s = (Number(v) || 0).toFixed(B_DECIMALS[unit]);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
function bFromMm(mm) { return bFormat((Number(mm) || 0) / TO_MM[builderUnit], builderUnit); }
function bToMm(v)    { return (parseFloat(v) || 0) * TO_MM[builderUnit]; }
function bFromCm(cm) { return bFromMm((Number(cm) || 0) * 10); }
function bToCm(v)    { return bToMm(v) / 10; }
const bUnit = () => builderUnit;
let builder = null;                      // working spec
let bPreview = null;                     // { renderer, scene, camera, controls, group, raf }

function newGroup(index = 0) {
  return {
    id: 'g_' + Math.random().toString(36).slice(2, 8),
    product_name: '',
    batch_lot: '',
    medium: '',
    shape: 'cylinder',                   // 'cylinder' | 'box'
    // Measurements start empty. A builder that opens pre-filled with
    // somebody else's can invites a plan built on numbers nobody checked.
    unit_d_mm: 0,                        // diameter — cylinder
    unit_l_mm: 0,                        // footprint — box
    unit_w_mm: 0,
    unit_h_mm: 0,
    unit_weight_g: 0,
    // Counts stay at one so the first measurement typed shows something in
    // the preview straight away.
    cols: 1, rows: 1, layers: 1,
    orient: 'upright',                   // how the product sits: upright | side | end
    inverted: false,                     // packed upside down
    align_l: 'center',                   // where the block sits in the pack,
    align_w: 'center',                   // across the length and the width
    color: GROUP_COLORS[index % GROUP_COLORS.length]
  };
}

// The optional level-3 box. Holds a grid of level-2 packs.
function newOuter() {
  return {
    enabled: false,
    sizing: 'contents',                  // 'contents' = size it around the packs
                                         // 'fixed'    = known box, fit packs into it
    fixed_l_mm: 0, fixed_w_mm: 0, fixed_h_mm: 0,
    cols: 1, rows: 1, layers: 1,         // packs across L, across W, stacked high
    wall_mm: 0, gap_mm: 0, layer_gap_mm: 0, tare_kg: 0,
    open_top: false,
    wrap: { enabled: false, thickness_mm: 0.1, weight_g: 25 }
  };
}

function newBuilderSpec() {
  return {
    name: '',
    // Left blank on purpose. What these levels are called depends entirely on
    // the product, so the user picks from the suggestion list rather than
    // finding "Tray" and "Pallet" already filled in for them.
    terms: { product: '', primary: '', outer: '', secondary: '' },
    // Every level above the product is opt-in, so the builder opens on the
    // bare product and the user adds one layer at a time.
    pack_enabled: false,
    group_mode: 'separate',              // 'separate' = a pack per group
                                         // 'shared'   = every group in one pack
    // Spacing belongs to the products, not the box, so it applies with or
    // without a pack. Side-to-side and layer-to-layer are different things:
    // cans sit shoulder to shoulder with a little air, but stack directly on
    // each other unless there is a layer pad between them.
    layer_gap_mm: 0,
    // Zero too: a wall thickness and a tare weight are things only the user
    // knows, and a guessed 3 mm quietly changes every size downstream.
    wall_mm: 0,
    gap_mm: 0,
    tare_kg: 0,
    sizing: 'contents',                  // 'contents' = size the tray from what's in it
                                         // 'fixed'    = tray is a known size, fit units into it
    fixed_l_mm: 0, fixed_w_mm: 0, fixed_h_mm: 0,
    open_top: false,                     // no lid: contents may stand above the rim
    wrap: { enabled: false, thickness_mm: 0, weight_g: 0 },
    groups: [newGroup(0)],
    outer: newOuter(),
    pallet: {
      enabled: false,
      base_type: 'pallet',               // pallet | slipsheet | none
      preset: 'eur1',
      length_cm: 120, width_cm: 80,
      deck_h_cm: 14.5, deck_kg: 25,
      max_h_cm: 180,
      overhang_mm: 0,
      per_layer: 0,                      // 0 = as many as fit on the base
      layers: 0,                         // 0 = as many as fit under the height limit
      wrap: { enabled: false, thickness_mm: 0, weight_g: 0 },
      pattern: 'block',
      batch_code: '', order_no: '', packer: ''
    }
  };
}

let builderPreviewMode = 'carton';       // 'carton' | 'outer' | 'pallet'

// Bring a spec written by an older build up to the current shape. Called on
// every load so one place covers every past version.
function normaliseSpec(spec) {
  const fresh = newBuilderSpec();
  if (!spec.pallet) spec.pallet = fresh.pallet;              // before pallets
  if (!spec.terms)  spec.terms  = { ...fresh.terms };        // before named levels
  if (spec.terms.outer === undefined) spec.terms.outer = '';
  if (!spec.group_mode) spec.group_mode = 'separate';        // before separate packs
  // Specs saved before the pack level could be switched off always had one
  if (spec.pack_enabled === undefined) spec.pack_enabled = true;
  // One gap used to do both jobs, so keep those specs the height they were
  if (spec.layer_gap_mm === undefined) spec.layer_gap_mm = spec.gap_mm || 0;
  if (spec.outer && spec.outer.layer_gap_mm === undefined) {
    spec.outer.layer_gap_mm = spec.outer.gap_mm || 0;
  }
  if (!spec.sizing) {                                        // before fixed sizing
    spec.sizing = 'contents';
    spec.fixed_l_mm = fresh.fixed_l_mm;
    spec.fixed_w_mm = fresh.fixed_w_mm;
    spec.fixed_h_mm = fresh.fixed_h_mm;
  }
  if (!spec.wrap) spec.wrap = { ...fresh.wrap };
  if (!spec.outer) spec.outer = newOuter();                  // before the outer level
  if (!spec.outer.wrap) spec.outer.wrap = { ...newOuter().wrap };
  if (!spec.pallet.base_type) spec.pallet.base_type = 'pallet';
  // before the base could be wrapped, and before per-layer was the loader's call
  if (!spec.pallet.wrap) spec.pallet.wrap = { enabled: false, thickness_mm: 0, weight_g: 0 };
  if (spec.pallet.per_layer === undefined) spec.pallet.per_layer = 0;
  (spec.groups || []).forEach(g => {                         // before move / flip
    if (!g.orient) g.orient = 'upright';
    if (typeof g.inverted !== 'boolean') g.inverted = false;
    if (!g.align_l) g.align_l = 'center';
    if (!g.align_w) g.align_w = 'center';
  });
  return spec;
}

// ---- how a product sits ----
// 'upright' is the product as measured. 'side' tips it over so what was its
// height runs along the pack's length. 'end' stands it on one end. A round
// product has no distinct end, so it only offers upright and side.
const ORIENT_LABELS = { upright: 'Upright', side: 'On its side', end: 'On its end' };
const orientOptions = g => g.shape === 'cylinder'
  ? ['upright', 'side']
  : ['upright', 'side', 'end'];

// Where a group's block sits in the pack, in words rather than CSS keywords
const ALIGN_L_NAMES = { start: 'Left', center: 'Centred', end: 'Right' };
const ALIGN_W_NAMES = { start: 'Front', center: 'Middle', end: 'Back' };

// One line for the collapsed "Adjust how they sit" summary
function arrangeSummary(g) {
  const bits = [ORIENT_LABELS[g.orient] || ORIENT_LABELS.upright];
  if (g.inverted) bits.push('upside down');
  if (g.align_l !== 'center' || g.align_w !== 'center') {
    bits.push(`${ALIGN_W_NAMES[g.align_w].toLowerCase()} ${ALIGN_L_NAMES[g.align_l].toLowerCase()}`);
  }
  return bits.join(' · ');
}

// The product as measured, before any tipping
function groupNaturalDims(g) {
  return g.shape === 'cylinder'
    ? { l: g.unit_d_mm, w: g.unit_d_mm, h: g.unit_h_mm }
    : { l: g.unit_l_mm, w: g.unit_w_mm, h: g.unit_h_mm };
}

// The space one product takes up once it is sitting the way the user chose.
// 'side' tips it away from you, so its height ends up across the width.
// 'end' stands it up, so its length ends up vertical — meaningless for a
// round product, which has no distinct end, so that falls back to upright.
function groupUnitDims(g) {
  const n = groupNaturalDims(g);
  const o = (g.shape === 'cylinder' && g.orient === 'end') ? 'upright' : g.orient;
  switch (o) {
    case 'side': return { l: n.l, w: n.h, h: n.w };
    case 'end':  return { l: n.h, w: n.w, h: n.l };
    default:     return n;
  }
}

// Footprint of one unit in mm (a round product occupies its bounding square)
function groupUnitFootprint(g) {
  const d = groupUnitDims(g);
  return { l: d.l, w: d.w };
}

// Height of one unit in mm, as it is sitting
const groupUnitHeight = g => groupUnitDims(g).h;

// Where a block of width `span` sits inside a cavity of width `inner`
function alignOffset(mode, span, inner) {
  const free = Math.max(0, inner - span);
  if (mode === 'start') return 0;
  if (mode === 'end')   return free;
  return free / 2;
}

function groupUnitCount(g) {
  return Math.max(0, g.cols) * Math.max(0, g.rows) * Math.max(0, g.layers);
}

// Derive carton outer dimensions (cm) and weight (kg) from the spec
// Is there a pack around the products at all, or do they ship as they are?
const hasPack = spec => spec.pack_enabled !== false;

// Does each group get a pack of its own, or do they all share one?
// One group is one pack either way, and with no pack there is nothing to
// share, so the groups are inherently separate.
const isSeparate = spec =>
  (spec.groups?.length || 0) > 1 &&
  (!hasPack(spec) || (spec.group_mode || 'separate') === 'separate');

// Deal n shipping units out across the packs, round-robin, and total up what
// they carry. Two batches across three cartons is two of one and one of the
// other — never one and a half of each.
function tallyPacks(packs, n) {
  const list = packs && packs.length ? packs : [];
  const alloc = list.map(() => 0);
  const count = Math.max(0, Math.floor(n));
  for (let i = 0; i < count && list.length; i++) alloc[i % list.length]++;
  let units = 0, weight_kg = 0;
  list.forEach((p, i) => {
    units     += alloc[i] * (p.units || 0);
    weight_kg += alloc[i] * (p.weight_kg || 0);
  });
  return { alloc, units, weight_kg };
}

// The block of product one group forms: how many fit, and the space it takes.
// `gap` separates neighbours side to side; `lgap` separates one layer from
// the next, which is a layer pad rather than air and is usually zero.
function groupBlock(spec, g, gap, lgap, fixed) {
  const fp = groupUnitFootprint(g);
  const uh = groupUnitHeight(g);
  // A fixed pack dictates how many fit across; the user still chooses layers.
  const cols = fixed ? Math.max(0, Math.floor((spec.fixed_l_mm + gap) / (fp.l + gap))) : Math.max(0, g.cols);
  const rows = fixed ? Math.max(0, Math.floor((spec.fixed_w_mm + gap) / (fp.w + gap))) : Math.max(0, g.rows);
  const layers = Math.max(0, g.layers);
  const n = cols * rows * layers;
  return {
    id: g.id, group: g, cols, rows, layers, n,
    fp, uh,
    l: cols * fp.l + Math.max(0, cols - 1) * gap,
    w: rows * fp.w + Math.max(0, rows - 1) * gap,
    h: layers * uh + Math.max(0, layers - 1) * lgap,
    kg: n * (g.unit_weight_g || 0) / 1000
  };
}

function computeCarton(spec) {
  // With no pack there is no board, no tare and no film — just the products
  // standing in their arrangement. Gaps between products still apply, since
  // those are about the products, not the box.
  const pack = hasPack(spec);
  const gap  = spec.gap_mm || 0;                     // side to side
  const lgap = spec.layer_gap_mm || 0;               // layer to layer
  const wall = pack ? (spec.wall_mm || 0) : 0;
  const fixed = pack && spec.sizing === 'fixed';
  const wrapOn = pack && !!spec.wrap?.enabled;
  const separate = isSeparate(spec);

  const blocks = (spec.groups || []).map(g => groupBlock(spec, g, gap, lgap, fixed));
  const maxOf = pick => blocks.length ? Math.max(...blocks.map(pick)) : 0;

  // What the contents occupy inside ONE pack. Separate packs are all built to
  // the same outside size so they interchange in the carton and on the pallet,
  // so that size comes from the largest group.
  const usedL = maxOf(b => b.l);
  const usedW = maxOf(b => b.w);
  const usedH = separate
    ? maxOf(b => b.h)
    : blocks.reduce((s, b) => s + b.h, 0) + lgap * Math.max(0, blocks.length - 1);

  // Inner cavity: the contents in contents-mode, the stated pack in fixed mode
  const innerL = fixed ? spec.fixed_l_mm : usedL;
  const innerW = fixed ? spec.fixed_w_mm : usedW;
  const innerH = fixed ? spec.fixed_h_mm : usedH;

  // An open tray has a floor but no lid, and contents can stand proud of the rim
  let outerL = innerL + wall * 2;
  let outerW = innerW + wall * 2;
  let outerH = (spec.open_top || !pack)
    ? Math.max(innerH, usedH) + wall
    : innerH + wall * 2;

  let wrapKg = 0;
  if (wrapOn) {
    const t = Math.max(0, spec.wrap.thickness_mm || 0);
    outerL += t * 2; outerW += t * 2; outerH += t * 2;
    wrapKg = (spec.wrap.weight_g || 0) / 1000;
  }

  const tare = (pack ? (spec.tare_kg || 0) : 0) + wrapKg;

  // One entry per actual pack. Separate mode gives a pack per group; shared
  // mode gives a single pack holding every group.
  const packs = separate
    ? blocks.map(b => ({
        id: b.id, group_ids: [b.id], color: b.group.color,
        batch_lot: b.group.batch_lot || '',
        units: b.n, content_kg: b.kg, weight_kg: b.kg + tare,
        blocks: [b]
      }))
    : [{
        id: 'all', group_ids: blocks.map(b => b.id),
        color: blocks[0]?.group.color || '#1a6fdb',
        batch_lot: blocks.length === 1 ? (blocks[0].group.batch_lot || '') : '',
        units: blocks.reduce((s, b) => s + b.n, 0),
        content_kg: blocks.reduce((s, b) => s + b.kg, 0),
        weight_kg: blocks.reduce((s, b) => s + b.kg, 0) + tare,
        blocks
      }];

  // Headline figures describe ONE pack. With packs of differing weight the
  // fullest one is quoted, so every fit and crush check stays conservative.
  const lead = packs.reduce((a, b) => (!a || b.weight_kg > a.weight_kg) ? b : a, null);

  return {
    length_cm: outerL / 10,
    width_cm:  outerW / 10,
    height_cm: outerH / 10,
    inner: { l: innerL, w: innerW, h: innerH },
    used:  { l: usedL,  w: usedW,  h: usedH },
    separate, packs, blocks,
    boxed: pack,                         // is there actually a box around it
    pack_count: packs.length,
    fit: blocks.map(b => ({ id: b.id, cols: b.cols, rows: b.rows, layers: b.layers, n: b.n })),
    headroom_mm: fixed ? spec.fixed_h_mm - usedH : 0,
    free_mm: fixed
      ? { l: spec.fixed_l_mm - usedL, w: spec.fixed_w_mm - usedW }
      : { l: 0, w: 0 },
    overflows: fixed && (usedH > spec.fixed_h_mm + 0.01 ||
                         usedL > spec.fixed_l_mm + 0.01 ||
                         usedW > spec.fixed_w_mm + 0.01),
    weight_kg: lead ? lead.weight_kg : tare,
    content_kg: lead ? lead.content_kg : 0,
    units: lead ? lead.units : 0,
    total_units: packs.reduce((s, p) => s + p.units, 0),
    wrap_kg: wrapKg
  };
}

// Effective per-group counts, which differ from the typed cols/rows in fixed mode
function groupFit(spec, groupId) {
  const c = computeCarton(spec);
  return c.fit.find(f => f.id === groupId) || { cols: 0, rows: 0, layers: 0, n: 0 };
}

// ---- the optional level-3 box ----
// Takes the finished level-2 pack and fits a grid of them into a bigger box.
// Same two sizing directions as the pack: build the box around the packs, or
// state the box and see how many packs land in it.
function computeOuter(spec, pack) {
  const o = spec.outer;
  const gap  = o.gap_mm || 0;                        // side to side
  const lgap = o.layer_gap_mm || 0;                  // layer to layer
  const wall = o.wall_mm || 0;
  const fixed = o.sizing === 'fixed';

  const pL = pack.length_cm * 10, pW = pack.width_cm * 10, pH = pack.height_cm * 10;
  const can = pL > 0 && pW > 0 && pH > 0;

  const fitAcross = (span, size, g) =>
    can ? Math.max(0, Math.floor((span + g) / (size + g))) : 0;

  const cols   = fixed ? fitAcross(o.fixed_l_mm, pL, gap)  : Math.max(0, o.cols);
  const rows   = fixed ? fitAcross(o.fixed_w_mm, pW, gap)  : Math.max(0, o.rows);
  const layers = fixed ? fitAcross(o.fixed_h_mm, pH, lgap) : Math.max(0, o.layers);

  const usedL = cols   * pL + Math.max(0, cols   - 1) * gap;
  const usedW = rows   * pW + Math.max(0, rows   - 1) * gap;
  const usedH = layers * pH + Math.max(0, layers - 1) * lgap;

  const innerL = fixed ? o.fixed_l_mm : usedL;
  const innerW = fixed ? o.fixed_w_mm : usedW;
  const innerH = fixed ? o.fixed_h_mm : usedH;

  let outerL = innerL + wall * 2;
  let outerW = innerW + wall * 2;
  let outerH = o.open_top ? Math.max(innerH, usedH) + wall : innerH + wall * 2;

  let wrapKg = 0;
  if (o.wrap?.enabled) {
    const t = Math.max(0, o.wrap.thickness_mm || 0);
    outerL += t * 2; outerW += t * 2; outerH += t * 2;
    wrapKg = (o.wrap.weight_g || 0) / 1000;
  }

  // Slots are dealt out across the packs, so a carton of two batches really
  // holds some of each rather than a multiple of an averaged pack.
  const slots = cols * rows * layers;
  const t = tallyPacks(pack.packs, slots);
  const tare = (o.tare_kg || 0) + wrapKg;

  return {
    length_cm: outerL / 10,
    width_cm:  outerW / 10,
    height_cm: outerH / 10,
    inner: { l: innerL, w: innerW, h: innerH },
    used:  { l: usedL,  w: usedW,  h: usedH },
    grid: { cols, rows, layers },
    slots,                               // how many level-2 packs this box holds
    alloc: t.alloc,                      // how many of each pack landed in here
    pack_list: pack.packs,
    // One filled outer box is itself a single shipping unit from here on
    packs_out: [{ id: 'outer', color: pack.packs[0]?.color || '#1a6fdb',
                  units: t.units, weight_kg: t.weight_kg + tare }],
    units: t.units,
    weight_kg: t.weight_kg + tare,
    wrap_kg: wrapKg,
    headroom_mm: fixed ? o.fixed_h_mm - usedH : 0,
    free_mm: fixed
      ? { l: o.fixed_l_mm - usedL, w: o.fixed_w_mm - usedW }
      : { l: 0, w: 0 },
    overflows: !fixed && false,
    fit: pack.fit
  };
}

// The thing that actually gets stacked or loaded: the outer box when there is
// one, otherwise the pack itself. Everything downstream reads this, so the
// pallet and the container never need to know how many levels are in play.
function computeShip(spec) {
  const pack = computeCarton(spec);
  if (!spec.outer?.enabled) {
    return { ...pack, level: 'primary', pack, pack_count: pack.packs.length };
  }
  const out = computeOuter(spec, pack);
  // Downstream only ever asks "what does one of these carry", so present the
  // filled outer box under the same `packs` name the pack result uses.
  return { ...out, level: 'outer', pack, packs: out.packs_out, pack_count: 1 };
}

// ---- pallet layout ----
// Lay trays across a pallet deck, trying pure orientations and two-zone
// splits, and keep whichever pattern fits the most trays per layer.
function gridLayout(cols, rows, w, d, offX, offZ, rot) {
  // A zero-sized item divides into a deck Infinity times. Every caller should
  // catch that first, but this is the function that would actually hang, so
  // it refuses the impossible rather than trusting them.
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return [];
  const out = [];
  const maxC = Math.min(cols, 2000), maxR = Math.min(rows, 2000);
  for (let i = 0; i < maxC; i++)
    for (let j = 0; j < maxR; j++)
      out.push({ x: offX + i * w, z: offZ + j * d, w, d, rot });
  return out;
}

function computePalletLayout(tL, tW, pL, pW) {
  if (tL <= 0 || tW <= 0 || pL <= 0 || pW <= 0) return [];
  const EPS = 0.001;
  const cands = [];

  const aCols = Math.floor((pL + EPS) / tL), aRows = Math.floor((pW + EPS) / tW);
  if (aCols > 0 && aRows > 0) cands.push(gridLayout(aCols, aRows, tL, tW, 0, 0, 0));

  const bCols = Math.floor((pL + EPS) / tW), bRows = Math.floor((pW + EPS) / tL);
  if (bCols > 0 && bRows > 0) cands.push(gridLayout(bCols, bRows, tW, tL, 0, 0, 90));

  // Main block of A, remaining strip filled with B — across the width
  for (let rows = 1; rows <= aRows; rows++) {
    const remW = pW - rows * tW;
    const sCols = Math.floor((pL + EPS) / tW), sRows = Math.floor((remW + EPS) / tL);
    if (aCols > 0 && sCols > 0 && sRows > 0) {
      cands.push([
        ...gridLayout(aCols, rows, tL, tW, 0, 0, 0),
        ...gridLayout(sCols, sRows, tW, tL, 0, rows * tW, 90)
      ]);
    }
  }
  // ...and along the length
  for (let cols = 1; cols <= aCols; cols++) {
    const remL = pL - cols * tL;
    const sCols = Math.floor((remL + EPS) / tW), sRows = Math.floor((pW + EPS) / tL);
    if (aRows > 0 && sCols > 0 && sRows > 0) {
      cands.push([
        ...gridLayout(cols, aRows, tL, tW, 0, 0, 0),
        ...gridLayout(sCols, sRows, tW, tL, cols * tL, 0, 90)
      ]);
    }
  }

  return cands.reduce((best, c) => (!best || c.length > best.length) ? c : best, null) || [];
}

function computePallet(spec, carton) {
  const p = spec.pallet;
  const baseType = p.base_type || 'pallet';
  const over = (p.overhang_mm || 0) / 10;            // mm → cm, per side
  const deckL = p.length_cm, deckW = p.width_cm;
  const usableL = deckL + over * 2;
  const usableW = deckW + over * 2;

  // A pack with no contents and no box has zero size. Dividing the deck by
  // that gives Infinity, and laying out Infinity of anything never returns,
  // so bail out before the arithmetic rather than after it.
  const sized = carton.length_cm > 0 && carton.width_cm > 0 && carton.height_cm > 0;

  const layoutBest = sized
    ? computePalletLayout(carton.length_cm, carton.width_cm, usableL, usableW)
    : [];

  // Interlocking alternates orientation, so capacity falls to the weaker pattern
  const pureA = (() => {
    if (!sized) return [];
    const c = Math.floor(usableL / carton.length_cm), r = Math.floor(usableW / carton.width_cm);
    return (c > 0 && r > 0) ? gridLayout(c, r, carton.length_cm, carton.width_cm, 0, 0, 0) : [];
  })();
  const pureB = (() => {
    if (!sized) return [];
    const c = Math.floor(usableL / carton.width_cm), r = Math.floor(usableW / carton.length_cm);
    return (c > 0 && r > 0) ? gridLayout(c, r, carton.width_cm, carton.length_cm, 0, 0, 90) : [];
  })();

  let layouts, fitPerLayer;
  if (p.pattern === 'interlock' && pureA.length && pureB.length) {
    fitPerLayer = Math.min(pureA.length, pureB.length);
    layouts = [pureA.slice(0, fitPerLayer), pureB.slice(0, fitPerLayer)];
  } else {
    fitPerLayer = layoutBest.length;
    layouts = [layoutBest];
  }

  // How many actually go on a layer is the loader's call, not the geometry's.
  // Blank means "as many as fit"; a number means that many, and asking for
  // more than the base holds is reported rather than silently granted.
  const wantPerLayer = Math.max(0, Math.floor(p.per_layer || 0));
  const perLayer = wantPerLayer > 0 ? Math.min(wantPerLayer, fitPerLayer) : fitPerLayer;
  layouts = layouts.map(l => l.slice(0, perLayer));

  const maxLayers = carton.height_cm > 0
    ? Math.max(0, Math.floor((p.max_h_cm - p.deck_h_cm) / carton.height_cm))
    : 0;
  const wantLayers = Math.max(0, Math.floor(p.layers || 0));
  const layers = wantLayers > 0 ? Math.min(wantLayers, Math.max(maxLayers, 1)) : maxLayers;

  const trays = perLayer * layers;
  const totalH = p.deck_h_cm + layers * carton.height_cm;
  // Same round-robin as the outer box: a pallet of mixed packs carries what
  // those actual packs weigh, not a count times an averaged pack.
  const tally = tallyPacks(carton.packs || [{ units: carton.units, weight_kg: carton.weight_kg }], trays);

  // Stretch wrap round the finished load: a skin on every side and over the top
  const wrapOn = !!p.wrap?.enabled;
  const wrapT  = wrapOn ? Math.max(0, p.wrap.thickness_mm || 0) / 10 : 0;   // cm per side
  const wrapKg = wrapOn ? (p.wrap.weight_g || 0) / 1000 : 0;
  const weight = p.deck_kg + tally.weight_kg + wrapKg;

  // Actual footprint the trays really use, including overhang
  let extentL = 0, extentW = 0;
  (layouts[0] || []).forEach(t => {
    extentL = Math.max(extentL, t.x + t.w);
    extentW = Math.max(extentW, t.z + t.d);
  });

  return {
    layouts, perLayer, layers, maxLayers, trays,
    fitPerLayer,                         // what the base geometrically holds
    wantPerLayer, wantLayers,            // what was typed, 0 meaning "as many as fit"
    length_cm: Math.max(deckL, extentL) + wrapT * 2,
    width_cm:  Math.max(deckW, extentW) + wrapT * 2,
    height_cm: totalH + wrapT,           // film over the top; the deck is the floor
    weight_kg: weight,
    wrap_kg: wrapKg,
    wrapped: wrapOn,
    units: tally.units,
    alloc: tally.alloc,                  // how many of each pack ended up on here
    overhangs: extentL > deckL + 0.01 || extentW > deckW + 0.01
  };
}

// Factorise a target unit count into a compact cols x rows x layers
function suggestArrangement(g, target) {
  if (!target || target < 1) return null;
  const fp = groupUnitFootprint(g);
  const uh = groupUnitHeight(g);
  let best = null;
  for (let layers = 1; layers <= target; layers++) {
    if (target % layers !== 0) continue;
    const perLayer = target / layers;
    for (let cols = 1; cols <= perLayer; cols++) {
      if (perLayer % cols !== 0) continue;
      const rows = perLayer / cols;
      const L = cols * fp.l, W = rows * fp.w, H = layers * uh;
      // Prefer a compact, slightly oblong footprint that isn't a tall tower
      const ratio = Math.max(L, W) / Math.min(L, W);
      const score = ratio * 1.0 + Math.abs(H - Math.max(L, W) * 0.7) / 100;
      if (!best || score < best.score) best = { cols, rows, layers, score };
    }
  }
  return best;
}

// ---- rendering the group cards ----
function renderBuilderGroups() {
  const wrap = $('#bGroups');
  const fixedMode = builder.sizing === 'fixed';
  const packed = computeCarton(builder);
  const fitAll = packed.fit;
  wrap.innerHTML = builder.groups.map((g, idx) => {
    const gf = fitAll.find(f => f.id === g.id) || { cols: g.cols, rows: g.rows, layers: g.layers, n: 0 };
    const n = fixedMode ? gf.n : groupUnitCount(g);
    const isCyl = g.shape === 'cylinder';
    // Moving the block only shows up when its footprint is smaller than the
    // cavity — a fixed pack with room left, or a narrower group beside a wider one.
    const fp = groupUnitFootprint(g);
    const spanL = gf.cols * fp.l + Math.max(0, gf.cols - 1) * (builder.gap_mm || 0);
    const spanW = gf.rows * fp.w + Math.max(0, gf.rows - 1) * (builder.gap_mm || 0);
    const hasSpare = packed.inner.l - spanL > 0.5 || packed.inner.w - spanW > 0.5;
    return `
    <div class="bgroup" data-gid="${g.id}">
      <div class="bgroup-head">
        <span class="bgroup-swatch" style="background:${g.color}"></span>
        Group ${idx + 1}
        <span class="bgroup-count">${n} ${escapeHtml(term('product', n, true))}</span>
        ${builder.groups.length > 1 ? `<button type="button" class="bgroup-remove" data-remove="${g.id}">Remove</button>` : ''}
      </div>

      <div class="form-row">
        <label class="field">
          <span>Product</span>
          <input data-f="product_name" type="text" value="${escapeHtml(g.product_name)}" placeholder="Tuna in olive oil" />
        </label>
        <div class="field">
          <span>Batch / lot</span>
          <div class="combo combo-batch">
            <input data-f="batch_lot" data-batch type="text" autocomplete="off"
                   value="${escapeHtml(g.batch_lot)}" placeholder="B2DE1" />
            <div class="combo-menu" hidden></div>
          </div>
        </div>
      </div>

      <div class="form-row">
        <label class="field">
          <span>Medium</span>
          <input data-f="medium" type="text" value="${escapeHtml(g.medium)}" placeholder="Olive oil" />
        </label>
        <div class="field">
          <span>${escapeHtml(term('product'))} shape</span>
          <div class="shape-toggle">
            <button type="button" class="shape-btn ${isCyl ? 'active' : ''}" data-shape="cylinder">Round</button>
            <button type="button" class="shape-btn ${!isCyl ? 'active' : ''}" data-shape="box">Box</button>
          </div>
        </div>
      </div>

      ${isCyl ? `
      <div class="form-row-3">
        <label class="field">
          <span>Ø (${bUnit()})</span>
          <input data-f="unit_d_mm" data-len type="number" min="0" step="${B_STEPS[bUnit()]}" value="${bFromMm(g.unit_d_mm)}" />
        </label>
        <label class="field">
          <span>Height (${bUnit()})</span>
          <input data-f="unit_h_mm" data-len type="number" min="0" step="${B_STEPS[bUnit()]}" value="${bFromMm(g.unit_h_mm)}" />
        </label>
        <label class="field">
          <span>Weight (g)</span>
          <input data-f="unit_weight_g" type="number" min="0" step="1" value="${g.unit_weight_g}" />
        </label>
      </div>` : `
      <div class="form-row-4">
        <label class="field">
          <span>L (${bUnit()})</span>
          <input data-f="unit_l_mm" data-len type="number" min="0" step="${B_STEPS[bUnit()]}" value="${bFromMm(g.unit_l_mm)}" />
        </label>
        <label class="field">
          <span>W (${bUnit()})</span>
          <input data-f="unit_w_mm" data-len type="number" min="0" step="${B_STEPS[bUnit()]}" value="${bFromMm(g.unit_w_mm)}" />
        </label>
        <label class="field">
          <span>H (${bUnit()})</span>
          <input data-f="unit_h_mm" data-len type="number" min="0" step="${B_STEPS[bUnit()]}" value="${bFromMm(g.unit_h_mm)}" />
        </label>
        <label class="field">
          <span>Wt (g)</span>
          <input data-f="unit_weight_g" type="number" min="0" step="1" value="${g.unit_weight_g}" />
        </label>
      </div>`}

      <div class="form-row-3">
        <label class="field">
          <span>Across L${fixedMode ? ' \u00b7 auto' : ''}</span>
          <input data-f="cols" type="number" min="1" step="1"
                 value="${fixedMode ? gf.cols : g.cols}" ${fixedMode ? 'disabled' : ''} />
        </label>
        <label class="field">
          <span>Across W${fixedMode ? ' \u00b7 auto' : ''}</span>
          <input data-f="rows" type="number" min="1" step="1"
                 value="${fixedMode ? gf.rows : g.rows}" ${fixedMode ? 'disabled' : ''} />
        </label>
        <label class="field">
          <span>Layers</span>
          <input data-f="layers" type="number" min="1" step="1" value="${g.layers}" />
        </label>
      </div>

      <div class="bsuggest" ${fixedMode ? 'hidden' : ''}>
        <label class="field">
          <span>Target ${escapeHtml(term('product', 2, true))} per ${escapeHtml(term('primary', 1, true))}</span>
          <input data-f="__target" type="number" min="1" step="1" placeholder="e.g. 48" />
        </label>
        <button type="button" data-suggest="${g.id}">Arrange</button>
      </div>

      <details class="barrange" ${g.orient !== 'upright' || g.inverted ||
                                  g.align_l !== 'center' || g.align_w !== 'center' ? 'open' : ''}>
        <summary>Adjust how they sit <span class="barrange-now">${escapeHtml(arrangeSummary(g))}</span></summary>
        <div class="barrange-body">
          <div class="barrange-col">
            <span class="barrange-label">Which way up</span>
            <div class="orient-toggle">
              ${orientOptions(g).map(o => `
                <button type="button" class="orient-btn ${g.orient === o ? 'active' : ''}"
                        data-orient="${o}">${ORIENT_LABELS[o]}</button>`).join('')}
            </div>
            <label class="switch switch-sm">
              <input type="checkbox" data-flip ${g.inverted ? 'checked' : ''} />
              <span class="switch-track"><span class="switch-thumb"></span></span>
              <span class="switch-label">Upside down</span>
            </label>
            <span class="barrange-dims">One ${escapeHtml(term('product', 1, true))} takes
              <b>${bFromMm(groupUnitDims(g).l)} × ${bFromMm(groupUnitDims(g).w)} × ${bFromMm(groupUnitDims(g).h)} ${bUnit()}</b></span>
          </div>

          <div class="barrange-col">
            <span class="barrange-label">Where in the ${escapeHtml(term('primary', 1, true))}</span>
            <div class="align-pad" role="group" aria-label="Position in the pack">
              ${['start', 'center', 'end'].map(w => ['start', 'center', 'end'].map(l => `
                <button type="button" class="align-cell ${g.align_l === l && g.align_w === w ? 'active' : ''}"
                        data-align-l="${l}" data-align-w="${w}"
                        title="${ALIGN_W_NAMES[w]}, ${ALIGN_L_NAMES[l]}"></button>`).join('')).join('')}
            </div>
            <span class="barrange-dims">${escapeHtml(ALIGN_W_NAMES[g.align_w])}, ${escapeHtml(ALIGN_L_NAMES[g.align_l].toLowerCase())}${
              hasSpare ? '' : ' · no spare room to move into yet'}</span>
          </div>
        </div>
      </details>
    </div>`;
  }).join('');

  // Field edits
  wrap.querySelectorAll('.bgroup').forEach(card => {
    const gid = card.dataset.gid;
    const g = builder.groups.find(x => x.id === gid);
    card.querySelectorAll('input[data-f]').forEach(input => {
      input.addEventListener('input', () => {
        const f = input.dataset.f;
        if (f === '__target') return;
        g[f] = input.dataset.len !== undefined
          ? bToMm(input.value)                       // length field, stored in mm
          : (input.type === 'number' ? (parseFloat(input.value) || 0) : input.value);
        // Keep a cylinder's footprint square
        if (f === 'unit_d_mm') { g.unit_l_mm = g.unit_d_mm; g.unit_w_mm = g.unit_d_mm; }
        updateBuilderComputed();
        rebuildBuilderPreview();
        const badge = card.querySelector('.bgroup-count');
        const n = builder.sizing === 'fixed'
          ? groupFit(builder, g.id).n
          : groupUnitCount(g);
        if (badge) badge.textContent = `${n} ${term('product', n, true)}`;
      });
    });
    card.querySelectorAll('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        g.shape = btn.dataset.shape;
        if (g.shape === 'cylinder') {
          g.unit_l_mm = g.unit_d_mm; g.unit_w_mm = g.unit_d_mm;
          // A round product has no distinct end to stand on
          if (g.orient === 'end') g.orient = 'upright';
        }
        renderBuilderGroups();
        updateBuilderComputed();
        rebuildBuilderPreview();
      });
    });

    // ---- adjust how they sit ----
    const reArrange = () => {
      renderBuilderGroups();
      updateBuilderComputed();
      rebuildBuilderPreview();
      // Keep the panel the user was working in open
      const reopened = $('#bGroups').querySelector(`.bgroup[data-gid="${gid}"] .barrange`);
      if (reopened) reopened.open = true;
    };
    card.querySelectorAll('.orient-btn').forEach(btn => {
      btn.addEventListener('click', () => { g.orient = btn.dataset.orient; reArrange(); });
    });
    const flip = card.querySelector('input[data-flip]');
    if (flip) flip.addEventListener('change', () => { g.inverted = flip.checked; reArrange(); });
    card.querySelectorAll('.align-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        g.align_l = cell.dataset.alignL;
        g.align_w = cell.dataset.alignW;
        reArrange();
      });
    });
    const lotInput = card.querySelector('input[data-batch]');
    if (lotInput) {
      initTermCombo(lotInput, knownBatchCodes, () => {
        g.batch_lot = lotInput.value;
        updateBuilderComputed();
      });
    }

    const sug = card.querySelector('[data-suggest]');
    if (sug) sug.addEventListener('click', () => {
      const target = parseInt(card.querySelector('[data-f="__target"]').value, 10);
      const arr = suggestArrangement(g, target);
      if (!arr) return showToast('Enter a target unit count first.');
      g.cols = arr.cols; g.rows = arr.rows; g.layers = arr.layers;
      renderBuilderGroups();
      updateBuilderComputed();
      rebuildBuilderPreview();
      showToast(`Arranged as <b>${arr.cols} × ${arr.rows} × ${arr.layers}</b>.`);
    });
    const rm = card.querySelector('[data-remove]');
    if (rm) rm.addEventListener('click', () => {
      builder.groups = builder.groups.filter(x => x.id !== gid);
      renderBuilderGroups();
      updateBuilderComputed();
      rebuildBuilderPreview();
    });
  });

  $('#bAddCopyHint').textContent = builder.groups.length
    ? `Same ${term('product', 1, true)}, same size, blank batch code`
    : 'Same product and size, blank batch code';
  refreshSegments();                     // the cards carry segmented controls
}

function updateBuilderComputed() {
  const c = computeCarton(builder);                  // the level-2 pack
  const outerOn = !!builder.outer?.enabled;
  // computeShip gives the base a uniform `packs` list whichever level it is
  // stacking, so the pallet maths never has to know how many levels are on.
  const ship = computeShip(builder);
  const o = outerOn ? ship : null;
  const on = builder.pallet.enabled;
  const p = on ? computePallet(builder, ship) : null;

  const PRIM = term('primary', 1, true);
  const OUT  = term('outer', 1, true);
  const SEC  = term('secondary', 1, true);

  renderStepHeads();

  const packOn = c.boxed;
  renderGroupMode(c);

  // Step 1 -> 2 connector
  const counts = [...new Set(c.packs.map(p => p.units))];
  $('#bFlow1').textContent = !packOn
    ? `no ${PRIM} — the ${term('product', 2, true)} go in as they are`
    : !c.total_units
      ? `packed into a ${PRIM}`
      : c.separate
        ? (counts.length === 1
            ? `${c.packs.length} separate ${term('primary', c.packs.length, true)}, ${counts[0]} ${term('product', counts[0], true)} in each`
            : `${c.packs.length} separate ${term('primary', c.packs.length, true)}, ${c.total_units} ${term('product', c.total_units, true)} in all`)
        : `${c.units} ${term('product', c.units, true)} per ${PRIM}`;

  // Step 2 output — one line per pack when the groups are kept apart
  const trayOut = $('#bTrayOut');
  $('#bPrimaryStep').classList.toggle('bstep-off', !packOn);
  $('#bPrimaryFields').hidden = !packOn;
  const size = `${fromCm(c.length_cm)} × ${fromCm(c.width_cm)} × ${fromCm(c.height_cm)} ${itemUnit}`;
  if (!packOn) {
    trayOut.className = 'bstep-out bstep-out-idle';
    trayOut.innerHTML = c.total_units
      ? `Skipped — <b>${c.total_units}</b> ${escapeHtml(term('product', c.total_units, true))} ` +
        `standing in a <b>${size}</b> block`
      : 'Skipped — nothing around the products yet';
  } else if (!c.total_units) {
    trayOut.className = 'bstep-out bstep-out-idle';
    trayOut.textContent = `Add contents above to size the ${PRIM}`;
  } else if (c.separate) {
    trayOut.className = 'bstep-out';
    trayOut.innerHTML =
      `<div class="bpack-head"><b>${c.packs.length}</b> ${escapeHtml(term('primary', c.packs.length, true))}, ` +
      `each <b>${size}</b></div>` +
      c.packs.map((pk, i) => `
        <div class="bpack-line">
          <span class="bpack-dot" style="background:${pk.color}"></span>
          ${escapeHtml(packName(pk, i))}
          <b>${pk.units}</b> ${escapeHtml(term('product', pk.units, true))}
          · <b>${pk.weight_kg.toFixed(2)} kg</b>
        </div>`).join('');
  } else {
    trayOut.className = 'bstep-out';
    trayOut.innerHTML = `<b>${c.units}</b> ${escapeHtml(term('product', c.units, true))} ` +
      `in one ${escapeHtml(PRIM)} · <b>${size}</b> · <b>${c.weight_kg.toFixed(2)} kg</b>`;
  }

  // Step 2 -> 3 connector
  $('#bFlow2').textContent = outerOn
    ? (o.slots ? `${o.slots} ${term('primary', o.slots, true)} per ${OUT}` : `packed into a ${OUT}`)
    : `no ${OUT} — the ${PRIM} ships as it is`;

  // Step 3 output — the optional outer box
  const outerOut = $('#bOuterOut');
  $('#bOuterStep').classList.toggle('bstep-off', !outerOn);
  if (!outerOn) {
    outerOut.className = 'bstep-out bstep-out-idle';
    outerOut.innerHTML = `Skipped — the ${escapeHtml(PRIM)} goes straight onto the ${escapeHtml(SEC)}`;
  } else if (!o.slots) {
    outerOut.className = 'bstep-out bstep-out-warn';
    outerOut.textContent = `No ${term('primary', 2, true)} fit in this ${OUT} — it is smaller than one ${PRIM}`;
  } else {
    outerOut.className = 'bstep-out';
    outerOut.innerHTML = `<b>${o.slots}</b> ${escapeHtml(term('primary', o.slots, true))} ` +
      `(${o.grid.cols} × ${o.grid.rows}${o.grid.layers > 1 ? ` × ${o.grid.layers} high` : ''}) · ` +
      `<b>${o.units}</b> ${escapeHtml(term('product', o.units, true))} · ` +
      `<b>${fromCm(o.length_cm)} × ${fromCm(o.width_cm)} × ${fromCm(o.height_cm)} ${itemUnit}</b> · ` +
      `<b>${o.weight_kg.toFixed(2)} kg</b>` +
      (c.separate ? `<div class="bpack-split">${c.packs.map((pk, i) =>
        `<span><span class="bpack-dot" style="background:${pk.color}"></span>${o.alloc[i]} × ${escapeHtml(packName(pk, i))}</span>`
      ).join('')}</div>` : '');
  }

  // Step 4 -> base connector
  const STACKED = outerOn ? 'outer' : 'primary';
  $('#bFlow3').textContent = on && p?.perLayer
    ? `${p.perLayer} ${term(STACKED, p.perLayer, true)} per layer`
    : `stacked on a ${SEC}`;

  // Step 4 output
  const palletOut = $('#bPalletOut');
  $('#bPalletStep').classList.toggle('bstep-off', !on);
  if (!on) {
    palletOut.className = 'bstep-out bstep-out-idle';
    palletOut.innerHTML = `Skipped — ${escapeHtml(term(STACKED, 2, true))} load loose into the container`;
  } else if (!p || p.trays === 0) {
    palletOut.className = 'bstep-out bstep-out-warn';
    palletOut.textContent = `No ${term(STACKED, 2, true)} fit — check the base size and max height`;
  } else {
    palletOut.className = 'bstep-out';
    palletOut.innerHTML = `<b>${p.trays}</b> ${escapeHtml(term(STACKED, p.trays, true))} · <b>${fromCm(p.length_cm)} × ${fromCm(p.width_cm)} × ${fromCm(p.height_cm)} ${itemUnit}</b> · <b>${p.weight_kg.toFixed(1)} kg</b>`;
  }

  // Final step — what actually goes into the container. With separate packs
  // and nothing above them, each pack is its own item in the plan, so the
  // figures below cover the whole set rather than pretending it is one box.
  const loose = !on && !outerOn && c.separate;
  const load = on && p?.trays
    ? { l: p.length_cm, w: p.width_cm, h: p.height_cm, kg: p.weight_kg,
        units: p.units, what: SEC, pieces: 1 }
    : { l: ship.length_cm, w: ship.width_cm, h: ship.height_cm,
        kg: loose ? c.packs.reduce((s, pk) => s + pk.weight_kg, 0) : ship.weight_kg,
        units: loose ? c.total_units : ship.units,
        what: outerOn ? OUT : (packOn ? PRIM : `${term('product', 2, true)} block`),
        pieces: loose ? c.packs.length : 1 };
  const fits = load.l <= cargoSpace.length * 100 &&
               load.w <= cargoSpace.width  * 100 &&
               load.h <= cargoSpace.height * 100;

  $('#bContainerSub').textContent = load.pieces > 1
    ? `${load.pieces} ${term('primary', load.pieces, true)}`
    : `one ${load.what}`;
  const contOut = $('#bContainerOut');
  if (load.units === 0) {
    contOut.className = 'bstep-out bstep-out-idle';
    contOut.textContent = 'Nothing to load yet';
  } else if (!fits) {
    contOut.className = 'bstep-out bstep-out-warn';
    contOut.innerHTML = `This ${escapeHtml(load.what)} is larger than the cargo space`;
  } else {
    contOut.className = 'bstep-out bstep-out-ok';
    contOut.innerHTML = load.pieces > 1
      ? `<b>${load.pieces}</b> separate ${escapeHtml(term('primary', load.pieces, true))} carrying <b>${load.units}</b> ${escapeHtml(term('product', load.units, true))} between them, <b>${load.kg.toFixed(1)} kg</b> in all`
      : `Each ${escapeHtml(load.what)} carries <b>${load.units}</b> ${escapeHtml(term('product', load.units, true))} at <b>${load.kg.toFixed(1)} kg</b>`;
  }

  // Right-hand summary panel — one row per level that is actually in play
  const perPack = c.separate
    ? `${c.packs.length} × ${c.total_units} ${escapeHtml(term('product', c.total_units, true))} in all`
    : `${c.units} ${escapeHtml(term('product', c.units, true))} · ${c.weight_kg.toFixed(2)} kg`;
  $('#bComputed').innerHTML = `
    <div class="bcomp-row bcomp-hero">
      <span>${escapeHtml(load.what)} size</span>
      <b>${fromCm(load.l)} × ${fromCm(load.w)} × ${fromCm(load.h)} ${itemUnit}</b>
    </div>
    <div class="bcomp-row"><span>${c.separate ? escapeHtml(capitalise(term('primary', 2, true))) : 'Per ' + escapeHtml(PRIM)}</span><b>${perPack}</b></div>
    ${outerOn ? `
      <div class="bcomp-row"><span>Per ${escapeHtml(OUT)}</span><b>${o.slots} ${escapeHtml(term('primary', o.slots, true))} · ${o.units} ${escapeHtml(term('product', o.units, true))} · ${o.weight_kg.toFixed(2)} kg</b></div>
    ` : ''}
    ${on && p?.trays ? `
      <div class="bcomp-row"><span>Per ${escapeHtml(SEC)}</span><b>${p.trays} ${escapeHtml(term(STACKED, p.trays, true))} · ${p.layers} layer${p.layers === 1 ? '' : 's'}</b></div>
    ` : `
      <div class="bcomp-row"><span>Batch groups</span><b>${builder.groups.length}</b></div>
    `}
    <div class="bcomp-row"><span>Total ${escapeHtml(term('product', 2, true))}</span><b>${load.units}</b></div>
    <div class="bcomp-row"><span>Gross weight</span><b>${load.kg.toFixed(1)} kg</b></div>
  `;

  updateFitNote(c);
  updateOuterFitNote(c, o);
  updatePalletFit(ship, p, STACKED);
}

// The outer box in fixed mode: what landed in it and what is left over
function updateOuterFitNote(c, o) {
  const el = $('#bOuterFitNote');
  if (!el) return;
  const on = !!builder.outer?.enabled;
  if (!on || builder.outer.sizing !== 'fixed' || !o) {
    el.hidden = true; el.innerHTML = ''; return;
  }
  el.hidden = false;
  const PRIM = term('primary', 1, true);
  if (!o.slots) {
    el.className = 'bfit-note warn';
    el.innerHTML = `Nothing fits — one ${escapeHtml(PRIM)} is ` +
      `<b>${fromCm(c.length_cm)} × ${fromCm(c.width_cm)} × ${fromCm(c.height_cm)} ${itemUnit}</b>, ` +
      `bigger than the box you have described.`;
    return;
  }
  el.className = 'bfit-note';
  el.innerHTML = `Fits <b>${o.grid.cols} × ${o.grid.rows}</b> per layer × <b>${o.grid.layers}</b> ` +
    `layer${o.grid.layers === 1 ? '' : 's'} = <b>${o.slots}</b> ${escapeHtml(term('primary', o.slots, true))} · ` +
    `<b>${bFromMm(o.headroom_mm)} ${bUnit()}</b> head space, ` +
    `<b>${bFromMm(o.free_mm.l)} × ${bFromMm(o.free_mm.w)} ${bUnit()}</b> spare on the floor.`;
}

// In fixed mode, say plainly what fits and what is left over
function updateFitNote(c) {
  const el = $('#bFitNote');
  if (!el) return;
  if (builder.sizing !== 'fixed') { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const u = term('product', 2, true);
  // Per layer in ONE pack: separate packs each hold one group, so summing
  // across every group would describe a pack that does not exist.
  const perLayer = c.separate
    ? Math.max(0, ...c.fit.map(f => f.cols * f.rows))
    : c.fit.reduce((s, f) => s + f.cols * f.rows, 0);
  if (!c.total_units) {
    el.className = 'bfit-note warn';
    el.innerHTML = `Nothing fits \u2014 the ${escapeHtml(term('product', 1, true))} is larger than this tray.`;
    return;
  }
  el.className = 'bfit-note' + (c.overflows ? ' warn' : '');
  el.innerHTML = c.overflows
    ? `Contents exceed the tray by <b>${bFromMm(Math.abs(c.headroom_mm))} ${bUnit()}</b> \u2014 reduce layers or make the tray taller.`
    : `Fits <b>${perLayer}</b> per layer \u00b7 <b>${c.units}</b> ${escapeHtml(u)} ` +
      `${c.separate ? 'per ' + escapeHtml(term('primary', 1, true)) : 'total'} \u00b7 ` +
      `<b>${bFromMm(c.headroom_mm)} ${bUnit()}</b> head space, ` +
      `<b>${bFromMm(c.free_mm.l)} \u00d7 ${bFromMm(c.free_mm.w)} ${bUnit()}</b> spare on the floor.`;
}

function updatePalletFit(ship, p, stacked = 'primary') {
  const box = $('#bPalletFit');
  if (!box) return;
  if (!builder.pallet.enabled) { box.innerHTML = ''; return; }
  if (!p || p.perLayer === 0) {
    // "...for this base base" when the level is still unnamed
    const baseWord = isNamed('secondary') ? term('secondary', 1, true) : 'base';
    box.innerHTML = `<div class="pf-warn">${escapeHtml(term(stacked))} is too large for this ${escapeHtml(baseWord)}.</div>`;
    return;
  }
  const pat = builder.pallet.pattern === 'interlock' ? 'interlocked' : 'block';
  const what = term(stacked, 1, true);
  const whats = term(stacked, 2, true);
  const base = builder.pallet;
  const over = (base.overhang_mm || 0) / 10;

  // Say where each number came from. "4 outer boxes" on its own looks like it
  // was invented; it is the footprint and the height limit doing their jobs.
  // Both counts are the loader's to set. Say which were typed, which were
  // worked out, and — the part that matters — when a typed number could not
  // be honoured, rather than quietly substituting a different one.
  const perLayerTyped = p.wantPerLayer > 0;
  const perLayerCut   = perLayerTyped && p.wantPerLayer > p.fitPerLayer;
  const layersTyped   = p.wantLayers > 0;
  const layersCut     = layersTyped && p.wantLayers > p.maxLayers;

  box.innerHTML = `
    <div>${p.perLayer} per layer × ${p.layers} layer${p.layers === 1 ? '' : 's'} = <b>${p.trays}</b> ${escapeHtml(whats)}</div>

    <div class="pf-why">
      ${perLayerTyped
        ? `<b>${p.perLayer}</b> per layer because you typed it.`
        : `<b>${p.perLayer}</b> per layer because <b>Per layer</b> is blank — that is as many as fit.`}
      A base of <b>${fromCm(base.length_cm)} × ${fromCm(base.width_cm)} ${itemUnit}</b>${over ? ` (+${fromCm(over)} overhang each side)` : ''}
      holds <b>${p.fitPerLayer}</b>, because one ${escapeHtml(what)} is
      <b>${fromCm(ship.length_cm)} × ${fromCm(ship.width_cm)} ${itemUnit}</b> on the floor.
    </div>
    ${perLayerCut ? `<div class="pf-warn">You asked for ${p.wantPerLayer} per layer; only ${p.fitPerLayer} fit on this base.
      Widen the base, allow overhang, or lower the number.</div>` : ''}

    <div class="pf-why">
      ${layersTyped
        ? `<b>${p.layers}</b> high because you typed it.`
        : `<b>${p.layers}</b> high because <b>Layers</b> is blank — that is as many as fit.`}
      <b>${p.maxLayers}</b> fit under your <b>${fromCm(base.max_h_cm)} ${itemUnit}</b> height limit
      (${fromCm(base.max_h_cm)} − ${fromCm(base.deck_h_cm)} base ÷ ${fromCm(ship.height_cm)} each).
    </div>
    ${layersCut ? `<div class="pf-warn">You asked for ${p.wantLayers} layers; only ${p.maxLayers} fit under
      ${fromCm(base.max_h_cm)} ${itemUnit}. Raise the height limit or lower the number.</div>` : ''}

    <div class="pf-why">${pat} pattern${p.perLayer === 1 ? ' · only one per layer, so the pattern makes no difference' : ''}${
      p.wrapped ? ` · stretch wrapped, adding ${p.wrap_kg.toFixed(2)} kg` : ''}</div>
    ${p.overhangs ? `<div class="pf-warn">${escapeHtml(capitalise(whats))} overhang the base.</div>` : ''}
  `;
}

// How a pack is referred to in the readouts: its batch code if it has one,
// else the product name, else just the group number.
function packName(pack, index) {
  const g = builder.groups.find(x => x.id === pack.id);
  return (g?.batch_lot || '').trim()
      || (g?.product_name || '').trim()
      || `Group ${index + 1}`;
}

// One pack per group, or everything in one? Only a question once there is
// more than one group, so the control stays hidden until then.
function renderGroupMode(c) {
  const row  = $('#bGroupMode');
  const why  = $('#bGroupModeWhy');
  // Only a question when there is both more than one group and a box to
  // share — with no pack there is nothing for them to be inside together.
  const many = builder.groups.length > 1 && hasPack(builder);
  row.hidden = !many;
  why.hidden = !many;
  if (!many) return;

  const sep = (builder.group_mode || 'separate') === 'separate';
  $$('#bGroupMode .group-mode-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.gmode === 'separate') === sep));
  const PRIM = term('primary', 1, true);
  why.textContent = sep
    ? `Every group gets a ${PRIM} of its own, all the same size so they interchange. ` +
      `Batches stay apart and can be traced separately.`
    : `All ${builder.groups.length} groups go into one ${PRIM}, stacked in the order listed, ` +
      `with a divider between them. Use this for a genuinely mixed ${PRIM}.`;
  // the buttons name the level too, so neither option is abstract
  const btns = $$('#bGroupMode .group-mode-btn');
  btns[0].textContent = `One ${PRIM} each`;
  btns[1].textContent = `All in one ${PRIM}`;
  refreshSegments();
}

// ---- headings ----
// Every step is titled with whatever the user calls that level, so no heading
// depends on knowing what "primary packaging" means. The number comes from the
// levels actually in play, so skipping the outer box renumbers the base.
function renderStepHeads() {
  // Numbers count only the levels actually switched on, so turning one off
  // renumbers the rest instead of leaving a gap.
  const live = {
    product: true,
    primary: hasPack(builder),
    outer: !!builder.outer?.enabled,
    secondary: !!builder.pallet?.enabled
  };
  // A level that is switched off gets a dash rather than a number. Giving it
  // the next number meant two steps on screen both claiming to be "3".
  const nums = {};
  let seq = 0;
  ['product', 'primary', 'outer', 'secondary'].forEach(level => {
    nums[level] = live[level] ? String(++seq) : '–';
  });

  ['product', 'primary', 'outer', 'secondary'].forEach(level => {
    const title = document.querySelector(`[data-step-title="${level}"]`);
    const num   = document.querySelector(`[data-step-num="${level}"]`);
    const role  = document.querySelector(`[data-step-role="${level}"]`);
    const named = isNamed(level);
    if (title) {
      title.textContent = named ? term(level) : unnamedHeading(level);
      title.classList.toggle('bstep-unnamed', !named);
    }
    if (num)   num.textContent = nums[level];
    if (role)  role.textContent = live[level]
      ? `Level ${nums[level]} · ${TERM_ROLES[level]}`
      : `Not in use · ${TERM_ROLES[level]}`;
  });

  // Why the two sizing choices exist, in the user's own words
  const why = $('#bSizeWhy');
  if (why) {
    why.textContent = builder.sizing === 'fixed'
      ? `You have a ${term('primary', 1, true)} of a known size — type its inside measurements and ` +
        `we work out how many ${term('product', 2, true).toLowerCase()} land in it.`
      : `We build the ${term('primary', 1, true)} around the arrangement below — ` +
        `change the counts and it resizes.`;
  }
}

// Static builder fields carry their unit in the label; the group cards are
// re-rendered so they pick it up on their own.
function refreshBuilderUnitUI() {
  $$('[data-bunit-label]').forEach(el => {
    el.textContent = `${el.dataset.bunitLabel} (${builderUnit})`;
  });
  const step = B_STEPS[builderUnit];
  ['#bWall', '#bGap', '#bLayerGap', '#bPalletL', '#bPalletW', '#bPalletH', '#bPalletMaxH',
   '#bPalletOver', '#bOuterWall', '#bOuterGap', '#bOuterLayerGap',
   '#bOuterFixL', '#bOuterFixW', '#bOuterFixH']
    .forEach(sel => { const el = $(sel); if (el) el.step = step; });
  $$('.unit-mini[data-unit-target="builder"] .unit-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.bunit === builderUnit));
}

function setBuilderUnit(unit) {
  if (unit === builderUnit || !TO_MM[unit]) return;
  builderUnit = unit;
  try { localStorage.setItem(BUILDER_UNIT_KEY, unit); } catch (e) {}
  // Repaint every field from the stored spec rather than converting the
  // text in place, so rounding never compounds across switches.
  writeBuilderFields();
  renderBuilderGroups();
  refreshBuilderUnitUI();
  updateBuilderComputed();
  refreshSegments();
}

// Push the working spec into the static inputs
function writeBuilderFields() {
  $('#bName').value   = builder.name;
  $('#bWall').value     = bFromMm(builder.wall_mm);
  $('#bGap').value      = bFromMm(builder.gap_mm);
  $('#bLayerGap').value = bFromMm(builder.layer_gap_mm);
  $('#bTare').value     = builder.tare_kg;
  $('#bFixedL').value = bFromMm(builder.fixed_l_mm);
  $('#bFixedW').value = bFromMm(builder.fixed_w_mm);
  $('#bFixedH').value = bFromMm(builder.fixed_h_mm);
  $('#bWrapT').value  = bFromMm(builder.wrap.thickness_mm);
  $('#bWrapKg').value = builder.wrap.weight_g;
  $('#bOpenTop').checked = !!builder.open_top;
  $('#bWrapOn').checked  = !!builder.wrap.enabled;
  $('#bPackOn').checked  = hasPack(builder);
  $('#bPrimaryFields').hidden = !hasPack(builder);
  writeOuterFields();
  renderSizingMode();
  renderPalletFields();
}

function writeOuterFields() {
  const o = builder.outer;
  $('#bOuterOn').checked      = !!o.enabled;
  $('#bOuterFixL').value      = bFromMm(o.fixed_l_mm);
  $('#bOuterFixW').value      = bFromMm(o.fixed_w_mm);
  $('#bOuterFixH').value      = bFromMm(o.fixed_h_mm);
  $('#bOuterCols').value      = o.cols;
  $('#bOuterRows').value      = o.rows;
  $('#bOuterLayers').value    = o.layers;
  $('#bOuterWall').value      = bFromMm(o.wall_mm);
  $('#bOuterGap').value       = bFromMm(o.gap_mm);
  $('#bOuterLayerGap').value  = bFromMm(o.layer_gap_mm);
  $('#bOuterTare').value      = o.tare_kg;
  $('#bOuterOpenTop').checked = !!o.open_top;
  $('#bOuterWrapOn').checked  = !!o.wrap.enabled;
  $('#bOuterWrapT').value     = bFromMm(o.wrap.thickness_mm);
  $('#bOuterWrapKg').value    = o.wrap.weight_g;
  renderOuterFields();
}

// Which outer rows are live, and labels that name the level being counted
function renderOuterFields() {
  const o = builder.outer;
  const fixed = o.sizing === 'fixed';
  $('#bOuterFields').hidden      = !o.enabled;
  $('#bOuterFixedRow').hidden    = !fixed;
  $('#bOuterGridRow').hidden     = fixed;      // in fixed mode the grid is worked out
  $('#bOuterWrapRow').hidden     = !o.wrap.enabled;
  $$('#bOuterSizeMode .size-mode-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.osizing === 'fixed') === fixed));

  const PRIM = term('primary', 2, true);
  $('#bOuterColsLabel').textContent   = `${capitalise(PRIM)} across the length`;
  $('#bOuterRowsLabel').textContent   = `${capitalise(PRIM)} across the width`;
  $('#bOuterLayersLabel').textContent = `${capitalise(PRIM)} stacked high`;

  const pill = $('#bPreviewOuter');
  if (pill) { pill.hidden = !o.enabled; pill.textContent = term('outer'); }
  renderOuterShape();
  refreshSegments();
}

// Which sizing mode is live, and which extra rows it needs
function renderSizingMode() {
  renderPreviewPills();
  const fixed = builder.sizing === 'fixed';
  // Scoped to this step: the outer box has its own pair of buttons, and an
  // unscoped query would light both of them up from the pack's setting.
  $$('#bSizeMode .size-mode-btn').forEach(b =>
    b.classList.toggle('active', (b.dataset.sizing === 'fixed') === fixed));
  $('#bFixedRow').hidden = !fixed;
  $('#bWrapRow').hidden  = !builder.wrap.enabled;
  $$('.base-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.base === (builder.pallet.base_type || 'pallet')));
  refreshSegments();
}

function readTrayFields() {
  builder.pack_enabled = $('#bPackOn').checked;
  builder.sizing     = builder.sizing || 'contents';
  builder.fixed_l_mm = bToMm($('#bFixedL').value);
  builder.fixed_w_mm = bToMm($('#bFixedW').value);
  builder.fixed_h_mm = bToMm($('#bFixedH').value);
  builder.open_top   = $('#bOpenTop').checked;
  builder.wrap.enabled      = $('#bWrapOn').checked;
  builder.wrap.thickness_mm = bToMm($('#bWrapT').value);
  builder.wrap.weight_g     = parseFloat($('#bWrapKg').value) || 0;
  $('#bWrapRow').hidden = !builder.wrap.enabled;
}

function readOuterFields() {
  const o = builder.outer;
  o.enabled    = $('#bOuterOn').checked;
  o.sizing     = o.sizing || 'contents';
  o.fixed_l_mm = bToMm($('#bOuterFixL').value);
  o.fixed_w_mm = bToMm($('#bOuterFixW').value);
  o.fixed_h_mm = bToMm($('#bOuterFixH').value);
  o.cols       = Math.max(1, parseInt($('#bOuterCols').value, 10)   || 1);
  o.rows       = Math.max(1, parseInt($('#bOuterRows').value, 10)   || 1);
  o.layers     = Math.max(1, parseInt($('#bOuterLayers').value, 10) || 1);
  o.wall_mm      = bToMm($('#bOuterWall').value);
  o.gap_mm       = bToMm($('#bOuterGap').value);
  o.layer_gap_mm = bToMm($('#bOuterLayerGap').value);
  o.tare_kg      = parseFloat($('#bOuterTare').value) || 0;
  o.open_top   = $('#bOuterOpenTop').checked;
  o.wrap.enabled      = $('#bOuterWrapOn').checked;
  o.wrap.thickness_mm = bToMm($('#bOuterWrapT').value);
  o.wrap.weight_g     = parseFloat($('#bOuterWrapKg').value) || 0;
}

function renderTermInputs() {
  $('#bTermProduct').value   = builder.terms.product;
  $('#bTermPrimary').value   = builder.terms.primary;
  // Left empty when unnamed, like the other three. Writing the fallback in
  // here made the next keystroke anywhere read it back as a real choice, so
  // the level named itself without anyone typing a word.
  $('#bTermOuter').value     = builder.terms.outer || '';
  $('#bTermSecondary').value = builder.terms.secondary;
  renderPreviewPills();
  renderStepHeads();
  refreshSegments();                   // pill widths changed
}

// The first pill shows whichever thing it is actually drawing: the pack when
// there is one, otherwise the bare products.
function renderPreviewPills() {
  $('#bPreviewPrimary').textContent =
    hasPack(builder) ? term('primary') : term('product', 2);
  $('#bPreviewOuter').textContent     = term('outer');
  $('#bPreviewSecondary').textContent = term('secondary');
}

// Typeable input with a styled suggestion list. The native <datalist> popup is
// drawn by the browser and can't be themed, so this replaces it.
function initTermCombo(input, getList, onPick) {
  const combo = input.closest('.combo');
  const menu  = combo.querySelector('.combo-menu');
  const level = combo.dataset.term;
  const list  = getList || (() => TERM_SUGGESTIONS[level] || []);
  const after = onPick || onTermChange;
  let cursor = -1;

  const options = () => [...menu.querySelectorAll('.combo-option')];

  const paint = () => {
    options().forEach((o, i) => o.classList.toggle('active', i === cursor));
    const active = options()[cursor];
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    const list_ = list().filter(t => !q || t.toLowerCase().includes(q));
    cursor = -1;
    if (!list_.length) { menu.innerHTML = ''; menu.hidden = true; return; }
    menu.innerHTML = list_
      .map(t => `<div class="combo-option" data-v="${escapeHtml(t)}">${escapeHtml(t)}</div>`)
      .join('');
    options().forEach(o => {
      // mousedown fires before blur, so the click isn't lost to the menu closing
      o.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = o.dataset.v;
        after();
        close();
      });
    });
  };

  const open  = () => { render(); if (menu.innerHTML) menu.hidden = false; };
  const close = () => { menu.hidden = true; cursor = -1; };

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { after(); open(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    const opts = options();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (menu.hidden) { open(); return; }
      cursor = Math.min(cursor + 1, opts.length - 1); paint();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0); paint();
    } else if (e.key === 'Enter') {
      if (!menu.hidden && opts[cursor]) {
        e.preventDefault();
        input.value = opts[cursor].dataset.v;
        after();
      }
      close();
    } else if (e.key === 'Escape') {
      if (!menu.hidden) { e.stopPropagation(); close(); }   // don't close the modal too
    }
  });
}

function onTermChange() {
  builder.terms.product   = $('#bTermProduct').value;
  builder.terms.primary   = $('#bTermPrimary').value;
  builder.terms.outer     = $('#bTermOuter').value;
  builder.terms.secondary = $('#bTermSecondary').value;
  renderPreviewPills();
  refreshSegments();
  renderOuterFields();                 // its field labels name the level being counted
  renderBuilderGroups();               // group cards carry term-dependent labels
  updateBuilderComputed();
}

function renderPalletFields() {
  const p = builder.pallet;
  $('#bPalletOn').checked = p.enabled;
  $('#bPalletFields').hidden = !p.enabled;
  $('#bPalletPreset').value  = p.preset;
  $('#bPalletPattern').value = p.pattern;
  $('#bPalletL').value       = bFromCm(p.length_cm);
  $('#bPalletW').value       = bFromCm(p.width_cm);
  $('#bPalletH').value       = bFromCm(p.deck_h_cm);
  $('#bPalletKg').value      = p.deck_kg;
  $('#bPalletMaxH').value    = bFromCm(p.max_h_cm);
  $('#bPalletOver').value    = bFromMm(p.overhang_mm);
  $('#bPalletPerLayer').value = p.per_layer || '';
  $('#bPalletLayers').value  = p.layers || '';
  $('#bPalletWrapOn').checked = !!p.wrap?.enabled;
  $('#bPalletWrapT').value    = bFromMm(p.wrap?.thickness_mm || 0);
  $('#bPalletWrapKg').value   = p.wrap?.weight_g || 0;
  $('#bPalletWrapRow').hidden = !p.wrap?.enabled;
  $('#bPalletBatch').value   = p.batch_code;
  $('#bPalletOrder').value   = p.order_no;
  $('#bPalletPacker').value  = p.packer;
}

function readPalletFields() {
  const p = builder.pallet;
  p.enabled     = $('#bPalletOn').checked;
  p.preset      = $('#bPalletPreset').value;
  p.pattern     = $('#bPalletPattern').value;
  p.length_cm   = bToCm($('#bPalletL').value);
  p.width_cm    = bToCm($('#bPalletW').value);
  p.deck_h_cm   = bToCm($('#bPalletH').value);
  p.deck_kg     = parseFloat($('#bPalletKg').value) || 0;
  p.max_h_cm    = bToCm($('#bPalletMaxH').value);
  p.overhang_mm = bToMm($('#bPalletOver').value);
  p.per_layer   = parseInt($('#bPalletPerLayer').value, 10) || 0;
  p.layers      = parseInt($('#bPalletLayers').value, 10) || 0;
  p.wrap.enabled      = $('#bPalletWrapOn').checked;
  p.wrap.thickness_mm = bToMm($('#bPalletWrapT').value);
  p.wrap.weight_g     = parseFloat($('#bPalletWrapKg').value) || 0;
  $('#bPalletWrapRow').hidden = !p.wrap.enabled;
  p.batch_code  = $('#bPalletBatch').value;
  p.order_no    = $('#bPalletOrder').value;
  p.packer      = $('#bPalletPacker').value;
}

// ---- 3D preview ----
function initBuilderPreview() {
  if (bPreview) return;
  const canvas = $('#builderCanvas');
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(1.2, 2, 1.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd6e4f5, 0.3);
  fill.position.set(-1, 0.6, -1.2);
  scene.add(fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.enablePan = false;

  const group = new THREE.Group();
  scene.add(group);

  bPreview = { renderer, scene, camera, controls, group, raf: null };
}

function disposeBuilderGroup() {
  if (!bPreview) return;
  const g = bPreview.group;
  while (g.children.length) {
    const child = g.children[0];
    g.remove(child);
    child.traverse?.(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m.dispose());
      }
    });
  }
}

function rebuildBuilderPreview() {
  if (!bPreview) return;
  disposeBuilderGroup();
  if (builderPreviewMode === 'pallet' && builder.pallet.enabled) buildPalletPreview();
  else if (builderPreviewMode === 'outer' && builder.outer?.enabled) buildOuterPreview();
  else buildCartonPreview();
}

function frameBuilderCamera(radius) {
  bPreview.camera.position.set(radius * 1.5, radius * 1.15, radius * 1.7);
  bPreview.camera.lookAt(0, 0, 0);
  bPreview.controls.target.set(0, 0, 0);
  bPreview.controls.minDistance = radius * 0.6;
  bPreview.controls.maxDistance = radius * 6;
  bPreview.controls.update();
}

function buildPalletPreview() {
  const c = computeShip(builder);                     // the outer box if there is one
  const p = computePallet(builder, c);
  const S = 0.01;                                     // cm → preview metres
  const deckL = builder.pallet.length_cm * S;
  const deckW = builder.pallet.width_cm * S;
  const deckH = builder.pallet.deck_h_cm * S;
  const totalH = p.height_cm * S;

  // Pallet deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(deckL, deckH, deckW),
    new THREE.MeshStandardMaterial({ color: 0x8b6f47, roughness: 0.92, metalness: 0.03 })
  );
  deck.position.set(0, -totalH / 2 + deckH / 2, 0);
  bPreview.group.add(deck);

  if (p.trays > 0) {
    // Collect every position, then colour them in the same round-robin order
    // the maths dealt the packs out in, so a mixed-batch pallet looks mixed.
    const slots = [];
    for (let layer = 0; layer < p.layers; layer++) {
      const layout = p.layouts[layer % p.layouts.length];
      const y = -totalH / 2 + deckH + (layer + 0.5) * c.height_cm * S;
      layout.forEach(t => {
        if (slots.length >= p.trays) return;
        slots.push({
          x: (t.x + t.w / 2) * S - deckL / 2, y,
          z: (t.z + t.d / 2) * S - deckW / 2,
          w: t.w * S * 0.98, d: t.d * S * 0.98
        });
      });
    }

    const list = (c.packs && c.packs.length) ? c.packs : [{ color: builder.groups[0]?.color || '#1a6fdb' }];
    const byPack = list.map(() => []);
    slots.forEach((s, i) => byPack[i % list.length].push(s));

    byPack.forEach((group, pi) => {
      if (!group.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: list[pi].color, roughness: 0.6, metalness: 0.1 }),
        group.length
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      const pos = new THREE.Vector3();
      group.forEach((s, i) => {
        pos.set(s.x, s.y, s.z);
        scl.set(s.w, c.height_cm * S * 0.98, s.d);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      bPreview.group.add(mesh);
    });
  }

  // Stretch-wrap shell over the stack. It used to be drawn whether or not
  // anything was wrapped, which showed film on a load that had none.
  if (p.wrapped && p.layers > 0) {
    const wrapH = p.layers * c.height_cm * S;
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(deckL, p.length_cm * S) * 1.02, wrapH, Math.max(deckW, p.width_cm * S) * 1.02),
      new THREE.MeshStandardMaterial({
        color: 0xbfe0ea, roughness: 0.25, metalness: 0.1,
        transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false
      })
    );
    wrap.position.set(0, -totalH / 2 + deckH + wrapH / 2, 0);
    bPreview.group.add(wrap);
  }

  frameBuilderCamera(Math.max(deckL, deckW, totalH));
}

// Board colours for the pack itself, so a tray reads as a tray
const BOARD = 0xc2a06a;
const BOARD_DARK = 0x8a6d3f;

// One pack, drawn at the origin: a real floor, real side walls, the products
// standing in it, a lid if it is closed, and film if it is wrapped. Returns a
// THREE.Group the caller can position.
function buildPackGroup(c, blocks, S) {
  const g3 = new THREE.Group();
  const boxed = c.boxed;                              // is there a pack at all
  const wall = boxed ? (builder.wall_mm || 0) : 0;
  const gap  = builder.gap_mm || 0;                   // side to side
  const lgap = builder.layer_gap_mm || 0;             // layer to layer
  const open = !!builder.open_top;
  const outerL = c.length_cm * 10 * S;
  const outerW = c.width_cm  * 10 * S;
  const outerH = c.height_cm * 10 * S;
  const innerL = c.inner.l, innerW = c.inner.w;
  const wallT = boxed ? Math.max(wall, 1.2) * S : 0;  // never thinner than a hairline

  const boardMat = () => new THREE.MeshStandardMaterial({
    color: BOARD, roughness: 0.95, metalness: 0.01
  });

  if (boxed) {
    // Floor — the thing that was missing: a tray you can actually see
    const floor = new THREE.Mesh(new THREE.BoxGeometry(outerL, wallT, outerW), boardMat());
    floor.position.y = -outerH / 2 + wallT / 2;
    g3.add(floor);

    // Side walls. An open tray gets a low lip like the photo; a closed box
    // gets full-height walls, with the two nearest the camera left translucent
    // so the contents stay visible.
    const contentH = Math.max(c.used.h, 1) * S;
    const lip = open
      ? Math.max(Math.min(contentH * 0.35, contentH), 6 * S)
      : outerH - wallT;
    const wallY = -outerH / 2 + wallT + lip / 2;
    const ghost = () => new THREE.MeshStandardMaterial({
      color: BOARD, roughness: 0.95, metalness: 0.01,
      transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false
    });
    const addWall = (w, h, d, x, z, solid) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), solid ? boardMat() : ghost());
      m.position.set(x, wallY, z);
      g3.add(m);
    };
    // far and left walls solid, near and right see-through, so you can look in
    addWall(outerL, lip, wallT, 0, -outerW / 2 + wallT / 2, true);
    addWall(outerL, lip, wallT, 0,  outerW / 2 - wallT / 2, false);
    addWall(wallT, lip, outerW, -outerL / 2 + wallT / 2, 0, true);
    addWall(wallT, lip, outerW,  outerL / 2 - wallT / 2, 0, false);

    if (!open) {                                      // lid
      const lid = new THREE.Mesh(new THREE.BoxGeometry(outerL, wallT, outerW), ghost());
      lid.position.y = outerH / 2 - wallT / 2;
      g3.add(lid);
    }

    g3.add(new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(outerL, outerH, outerW)),
      new THREE.LineBasicMaterial({ color: BOARD_DARK, transparent: true, opacity: 0.6 })
    ));
  }

  // Contents, block by block, stacking up from the floor
  let yCursor = -outerH / 2 + wallT;
  blocks.forEach((b, bi) => {
    const g = b.group;
    const { fp, uh, cols, rows, layers } = b;

    // A divider pad between stacked groups sharing one pack — the layer card
    // that really does sit between them. Not needed when each group has its
    // own pack, or when there is no pack, because then there is nothing to
    // divide.
    if (boxed && bi > 0 && lgap > 0) {
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(innerL * S, Math.max(lgap * 0.5, 0.8) * S, innerW * S),
        new THREE.MeshStandardMaterial({ color: BOARD, roughness: 0.95, metalness: 0.01 })
      );
      pad.position.y = yCursor - lgap * S / 2;
      g3.add(pad);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: g.color, roughness: 0.55, metalness: 0.15
    });
    // Geometry is always built in the product's own measured axes; the
    // instance rotation is what tips it over.
    const nat = groupNaturalDims(g);
    const geo = g.shape === 'cylinder'
      ? new THREE.CylinderGeometry(g.unit_d_mm / 2 * S, g.unit_d_mm / 2 * S, nat.h * S, 20)
      : new THREE.BoxGeometry(nat.l * S, nat.h * S, nat.w * S);

    const spanL = cols * fp.l + Math.max(0, cols - 1) * gap;
    const spanW = rows * fp.w + Math.max(0, rows - 1) * gap;
    const startX = (-innerL / 2 + alignOffset(g.align_l, spanL, innerL) + fp.l / 2) * S;
    const startZ = (-innerW / 2 + alignOffset(g.align_w, spanW, innerW) + fp.w / 2) * S;

    const count = cols * rows * layers;
    if (count > 0 && count <= 4000) {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      const m = new THREE.Matrix4();
      const q = unitQuaternion(g);
      const one = new THREE.Vector3(1, 1, 1);
      const pos = new THREE.Vector3();
      let i = 0;
      for (let ly = 0; ly < layers; ly++) {
        const y = yCursor + (uh / 2 + ly * (uh + lgap)) * S;
        for (let cx = 0; cx < cols; cx++) {
          for (let rz = 0; rz < rows; rz++) {
            pos.set(startX + cx * (fp.l + gap) * S, y, startZ + rz * (fp.w + gap) * S);
            m.compose(pos, q, one);
            mesh.setMatrixAt(i++, m);
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      g3.add(mesh);
    } else {
      geo.dispose(); mat.dispose();
    }

    yCursor += (layers * uh + Math.max(0, layers - 1) * lgap + lgap) * S;
  });

  // Shrink wrap over the finished pack
  if (boxed && builder.wrap?.enabled) {
    const film = new THREE.Mesh(
      new THREE.BoxGeometry(outerL * 1.012, outerH * 1.012, outerW * 1.012),
      new THREE.MeshStandardMaterial({
        color: 0xbfe0ea, roughness: 0.2, metalness: 0.1,
        transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
      })
    );
    g3.add(film);
  }

  return g3;
}

function buildCartonPreview() {
  const c = computeCarton(builder);
  const S = 0.001;                                    // mm → preview metres
  const outerL = c.length_cm * 10 * S;
  const outerW = c.width_cm  * 10 * S;
  const outerH = c.height_cm * 10 * S;

  // Separate packs are drawn side by side with a visible space between them,
  // because the whole point is that they are not one box.
  const spacing = outerL * 1.18;
  const n = c.packs.length;
  c.packs.forEach((pk, i) => {
    const g3 = buildPackGroup(c, pk.blocks, S);
    g3.position.x = (i - (n - 1) / 2) * spacing;
    bPreview.group.add(g3);
  });

  frameBuilderCamera(Math.max(outerL * Math.max(1, n * 1.18), outerW, outerH));
}

// The rotation that puts a product the way the user asked for. Geometry is
// authored upright, so these must match groupUnitDims exactly or the preview
// shows one thing while the maths reserves space for another:
//   side -> quarter turn about X, height ends up across the width (Z)
//   end  -> quarter turn about Z, length ends up vertical
// Returned as a plain triple so it can be stored and replayed in the plan
// scene without carrying a THREE object around.
function unitEulerTriple(g) {
  const orient = (g.shape === 'cylinder' && g.orient === 'end') ? 'upright' : g.orient;
  const e = orient === 'side' ? [Math.PI / 2, 0, 0]
          : orient === 'end'  ? [0, 0, Math.PI / 2]
          : [0, 0, 0];
  // Upside down is a half turn about whichever axis is still horizontal.
  // Both turns are about the same axis, so they simply add.
  if (g.inverted) {
    if (orient === 'end') e[2] += Math.PI;
    else                  e[0] += Math.PI;
  }
  return e;
}

function unitQuaternion(g) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(...unitEulerTriple(g)));
}

// ---- turning a spec into drawable unit positions ----
// Positions come out in the pack's own axes (X = length, Y = height,
// Z = width), in centimetres, measured from the centre of the finished item.
// Everything downstream just places little meshes at these points.

const MAX_CELLS_PER_ITEM = 4000;

function buildGroupGeometryList(spec) {
  return spec.groups.map(g => {
    const nat = groupNaturalDims(g);
    return {
      round: g.shape === 'cylinder',
      d: g.unit_d_mm / 10,
      l: nat.l / 10, w: nat.w / 10, h: nat.h / 10,
      color: g.color,
      euler: unitEulerTriple(g)
    };
  });
}

// Unit positions inside one level-2 pack
function packCells(spec, c, blocks) {
  const gap  = spec.gap_mm || 0;
  const lgap = spec.layer_gap_mm || 0;
  const wall = hasPack(spec) ? (spec.wall_mm || 0) : 0;
  const outerH = c.height_cm * 10;                   // mm
  const innerL = c.inner.l, innerW = c.inner.w;
  const index = new Map(spec.groups.map((g, i) => [g.id, i]));
  const cells = [];
  let yCursor = -outerH / 2 + wall;
  blocks.forEach(b => {
    const gi = index.get(b.id) ?? 0;
    const { fp, uh, cols, rows, layers } = b;
    const spanL = cols * fp.l + Math.max(0, cols - 1) * gap;
    const spanW = rows * fp.w + Math.max(0, rows - 1) * gap;
    const startX = -innerL / 2 + alignOffset(b.group.align_l, spanL, innerL) + fp.l / 2;
    const startZ = -innerW / 2 + alignOffset(b.group.align_w, spanW, innerW) + fp.w / 2;
    for (let ly = 0; ly < layers; ly++) {
      const y = yCursor + uh / 2 + ly * (uh + lgap);
      for (let cx = 0; cx < cols; cx++) {
        for (let rz = 0; rz < rows; rz++) {
          cells.push({
            g: gi,
            x: (startX + cx * (fp.l + gap)) / 10,
            y: y / 10,
            z: (startZ + rz * (fp.w + gap)) / 10
          });
        }
      }
    }
    yCursor += layers * uh + Math.max(0, layers - 1) * lgap + lgap;
  });
  return cells;
}

// Shift a set of cells to a new centre
const offsetCells = (cells, dx, dy, dz) =>
  cells.map(c => ({ g: c.g, x: c.x + dx, y: c.y + dy, z: c.z + dz }));

// Every unit inside whatever this plan item actually is
function flattenBuild(ref) {
  const { spec, level, pack_index } = ref;
  if (!spec || !spec.groups?.length) return null;
  const groups = buildGroupGeometryList(spec);
  const c = computeCarton(spec);
  if (!c.total_units) return null;

  // One cell list per pack kind
  const perPack = c.packs.map(p => packCells(spec, c, p.blocks));

  if (level === 'primary') {
    const idx = Number.isInteger(pack_index) ? pack_index : 0;
    const cells = perPack[idx] || perPack[0] || [];
    return cells.length <= MAX_CELLS_PER_ITEM ? { groups, cells } : null;
  }

  // Level 3: a grid of packs inside the outer box
  const o = computeOuter(spec, c);
  const packL = c.length_cm, packW = c.width_cm, packH = c.height_cm;
  const gap  = (spec.outer.gap_mm || 0) / 10;
  const lgap = (spec.outer.layer_gap_mm || 0) / 10;
  const wall = (spec.outer.wall_mm || 0) / 10;
  const spanL = o.grid.cols * packL + Math.max(0, o.grid.cols - 1) * gap;
  const spanW = o.grid.rows * packW + Math.max(0, o.grid.rows - 1) * gap;
  const innerL = o.inner.l / 10, innerW = o.inner.w / 10;
  const startX = -innerL / 2 + (innerL - spanL) / 2 + packL / 2;
  const startZ = -innerW / 2 + (innerW - spanW) / 2 + packW / 2;
  const floorY = -o.height_cm / 2 + wall;

  const slots = [];
  for (let ly = 0; ly < o.grid.layers; ly++)
    for (let cx = 0; cx < o.grid.cols; cx++)
      for (let rz = 0; rz < o.grid.rows; rz++)
        slots.push([
          startX + cx * (packL + gap),
          floorY + packH / 2 + ly * (packH + lgap),
          startZ + rz * (packW + gap)
        ]);

  const outerCells = [];
  slots.forEach((s, i) => {
    const src = perPack[i % perPack.length] || [];
    if (outerCells.length + src.length > MAX_CELLS_PER_ITEM) return;
    outerCells.push(...offsetCells(src, s[0], s[1], s[2]));
  });
  if (!outerCells.length) return null;

  if (level === 'outer') return { groups, cells: outerCells };

  // Level 4: the whole pallet. Usually far past the budget, and a pallet of
  // identical cartons reads fine as cartons, so this is left to the cap.
  return null;
}

// Cells are derived, not stored: the saved spec is small, the cell list is not
function ensureBuild(item) {
  if (item.build !== undefined) return item.build;
  item.build = item.build_ref ? flattenBuild(item.build_ref) : null;
  return item.build;
}

// The optional level-3 box, with the level-2 packs laid out inside it
function buildOuterPreview() {
  const c = computeCarton(builder);
  const o = computeOuter(builder, c);
  const S = 0.001;                                    // mm → preview metres
  const wall = builder.outer.wall_mm || 0;
  const gap  = builder.outer.gap_mm || 0;             // side to side
  const lgap = builder.outer.layer_gap_mm || 0;       // layer to layer
  const outerL = o.length_cm * 10 * S;
  const outerW = o.width_cm  * 10 * S;
  const outerH = o.height_cm * 10 * S;

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(outerL, outerH, outerW),
    new THREE.MeshStandardMaterial({
      color: 0xb98c2a, roughness: 0.9, metalness: 0.02,
      transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false
    })
  );
  bPreview.group.add(shell);

  bPreview.group.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(outerL, outerH, outerW)),
    new THREE.LineBasicMaterial({ color: 0x7a5f18, transparent: true, opacity: 0.6 })
  ));

  const packL = c.length_cm * 10, packW = c.width_cm * 10, packH = c.height_cm * 10;
  const count = o.slots;
  if (count > 0 && count <= 4000 && packL > 0) {
    const spanL = o.grid.cols * packL + Math.max(0, o.grid.cols - 1) * gap;
    const spanW = o.grid.rows * packW + Math.max(0, o.grid.rows - 1) * gap;
    const startX = (-o.inner.l / 2 + (o.inner.l - spanL) / 2 + packL / 2) * S;
    const startZ = (-o.inner.w / 2 + (o.inner.w - spanW) / 2 + packW / 2) * S;
    const floorY = -outerH / 2 + wall * S;

    // Work out every slot first, then hand them to the packs in the same
    // round-robin order the maths used, so the colours in here match the
    // batch split printed underneath.
    const slots = [];
    for (let ly = 0; ly < o.grid.layers; ly++)
      for (let cx = 0; cx < o.grid.cols; cx++)
        for (let rz = 0; rz < o.grid.rows; rz++)
          slots.push([
            startX + cx * (packL + gap) * S,
            floorY + (packH / 2 + ly * (packH + lgap)) * S,
            startZ + rz * (packW + gap) * S
          ]);

    const list = c.packs.length ? c.packs : [{ color: '#1a6fdb' }];
    const byPack = list.map(() => []);
    slots.forEach((s, i) => byPack[i % list.length].push(s));

    const scl = new THREE.Vector3(packL * S * 0.985, packH * S * 0.985, packW * S * 0.985);
    byPack.forEach((group, pi) => {
      if (!group.length) return;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: list[pi].color, roughness: 0.6, metalness: 0.12 }),
        group.length
      );
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      group.forEach((s, i) => {
        pos.set(s[0], s[1], s[2]);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      bPreview.group.add(mesh);
    });
  }

  if (builder.outer.wrap?.enabled) {
    bPreview.group.add(new THREE.Mesh(
      new THREE.BoxGeometry(outerL * 1.012, outerH * 1.012, outerW * 1.012),
      new THREE.MeshStandardMaterial({
        color: 0xbfe0ea, roughness: 0.2, metalness: 0.1,
        transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
      })
    ));
  }

  frameBuilderCamera(Math.max(outerL, outerW, outerH));
}

function resizeBuilderPreview() {
  if (!bPreview) return;
  const wrap = $('.builder-canvas-wrap');
  const r = wrap.getBoundingClientRect();
  if (!r.width || !r.height) return;
  bPreview.camera.aspect = r.width / r.height;
  bPreview.camera.updateProjectionMatrix();
  bPreview.renderer.setSize(r.width, r.height);
}

function startBuilderLoop() {
  if (!bPreview || bPreview.raf) return;
  const loop = () => {
    bPreview.controls.update();
    bPreview.renderer.render(bPreview.scene, bPreview.camera);
    bPreview.raf = requestAnimationFrame(loop);
  };
  bPreview.raf = requestAnimationFrame(loop);
}
function stopBuilderLoop() {
  if (bPreview?.raf) { cancelAnimationFrame(bPreview.raf); bPreview.raf = null; }
}

// ---- saved carton specs ----
function loadCartonSpecs() {
  try { cartonSpecs = JSON.parse(localStorage.getItem(CARTON_SPECS_KEY)) || []; }
  catch (e) { cartonSpecs = []; }
}
function persistCartonSpecs() {
  try { localStorage.setItem(CARTON_SPECS_KEY, JSON.stringify(cartonSpecs)); } catch (e) {}
}
function renderCartonSpecDropdown() {
  const sel = $('#bSpecSelect');
  sel.innerHTML = '<option value="">— Load a saved carton —</option>' +
    cartonSpecs.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  $('#bDeleteSpec').hidden = true;
}

// ---- open / close ----
// ============================================================
// RECENT BUILDS — a carton added to the plan is worth offering back. Saving
// one by name is a deliberate act; this is the undeliberate version.
// ============================================================
const RECENT_BUILDS_KEY = 'smartuna_planner_recent_builds';
const MAX_RECENT_BUILDS = 8;
let recentBuilds = [];

function loadRecentBuilds() {
  try { recentBuilds = JSON.parse(localStorage.getItem(RECENT_BUILDS_KEY)) || []; }
  catch (e) { recentBuilds = []; }
}

function rememberBuild(spec, label) {
  const copy = JSON.parse(JSON.stringify(spec));
  delete copy._done;                     // a recalled build is not a finished one
  const c = computeCarton(copy);
  const ship = computeShip(copy);
  const entry = {
    id: 'r_' + Math.random().toString(36).slice(2, 9),
    name: (spec.name || label || '').trim() || 'Untitled build',
    at: Date.now(),
    summary: `${ship.units} ${term('product', ship.units, true)} · ` +
             `${fromCm(ship.length_cm)} × ${fromCm(ship.width_cm)} × ${fromCm(ship.height_cm)} ${itemUnit}`,
    spec: copy
  };
  // Same name rebuilt replaces the older entry rather than filling the list
  recentBuilds = [entry, ...recentBuilds.filter(r => r.name !== entry.name)]
    .slice(0, MAX_RECENT_BUILDS);
  try { localStorage.setItem(RECENT_BUILDS_KEY, JSON.stringify(recentBuilds)); } catch (e) {}
  renderRecentBuilds();
}

function renderRecentBuilds() {
  const wrap = $('#bRecent');
  if (!wrap) return;
  wrap.hidden = !recentBuilds.length;
  if (!recentBuilds.length) return;
  wrap.innerHTML =
    `<span class="brecent-label">Recent</span>` +
    recentBuilds.map(r => `
      <button type="button" class="brecent-chip" data-recent="${r.id}"
              title="${escapeHtml(r.summary)}">
        ${escapeHtml(r.name)}<small>${escapeHtml(r.summary)}</small>
      </button>`).join('') +
    `<button type="button" class="brecent-clear" id="bRecentClear" title="Forget these">Clear</button>`;

  wrap.querySelectorAll('[data-recent]').forEach(btn => btn.addEventListener('click', () => {
    const r = recentBuilds.find(x => x.id === btn.dataset.recent);
    if (!r) return;
    builder = normaliseSpec(JSON.parse(JSON.stringify(r.spec)));
    delete builder._done;
    writeBuilderFields();
    renderTermInputs();
    renderBuilderGroups();
    updateBuilderComputed();
    rebuildBuilderPreview();
    showToast(`Loaded <b>${escapeHtml(r.name)}</b>.`);
  }));
  $('#bRecentClear').addEventListener('click', () => {
    recentBuilds = [];
    try { localStorage.removeItem(RECENT_BUILDS_KEY); } catch (e) {}
    renderRecentBuilds();
  });
}

function openBuilder() {
  // A finished build does not carry over into the next one. Pick it off the
  // Recent row instead, where it is a deliberate choice.
  if (!builder || builder._done) builder = newBuilderSpec();
  normaliseSpec(builder);
  writeBuilderFields();
  refreshBuilderUnitUI();
  renderTermInputs();
  renderBuilderGroups();
  renderCartonSpecDropdown();
  renderRecentBuilds();
  $('#bHelp').hidden = true;
  if (builderPreviewMode === 'pallet' && !builder.pallet.enabled) builderPreviewMode = 'carton';
  if (builderPreviewMode === 'outer'  && !builder.outer.enabled)  builderPreviewMode = 'carton';
  $$('#bPreviewPills .view-pill').forEach(b =>
    b.classList.toggle('selected', b.dataset.preview === builderPreviewMode));
  $('#builderModal').hidden = false;

  initBuilderPreview();
  requestAnimationFrame(() => {
    resizeBuilderPreview();
    rebuildBuilderPreview();
    updateBuilderComputed();
    startBuilderLoop();
    refreshSegments();
  });
}

function closeBuilder() {
  $('#builderModal').hidden = true;
  $('#bHelp').hidden = true;
  closeHint();
  closeAddMenu();
  stopBuilderLoop();
}

// ---- push the built carton into the plan ----
function addBuiltCartonToPlan() {
  const c = computeCarton(builder);
  if (!c.total_units) return showToast('Add some contents first.');

  const outerOn = !!builder.outer?.enabled;
  const shipUnit = computeShip(builder);              // the outer box, or the pack
  const onPallet = builder.pallet.enabled;
  const p = onPallet ? computePallet(builder, shipUnit) : null;
  const OUT  = term('outer', 1, true);
  const SEC  = term('secondary', 1, true);
  const STACKED = outerOn ? 'outer' : 'primary';

  if (outerOn && shipUnit.slots === 0) {
    return showToast(`No ${term('primary', 2, true)} fit in this ${OUT} — check its size.`);
  }
  if (onPallet && p.trays === 0) {
    return showToast(`No ${term(STACKED, 2, true)} fit on this ${SEC} — check the base size and max height.`);
  }

  const ship = onPallet
    ? { l: p.length_cm, w: p.width_cm, h: p.height_cm, kg: p.weight_kg, units: p.units }
    : { l: shipUnit.length_cm, w: shipUnit.width_cm, h: shipUnit.height_cm,
        kg: shipUnit.weight_kg, units: shipUnit.units };

  if (ship.l > cargoSpace.length * 100 ||
      ship.w > cargoSpace.width  * 100 ||
      ship.h > cargoSpace.height * 100) {
    return showToast(`${onPallet ? term('secondary') : term(STACKED)} is larger than the cargo space.`);
  }

  const baseLabel = ($('#bName').value.trim()) || generateBaseLabel(onPallet ? 'pallet' : 'carton');
  const palletLot = normaliseBatchCode(builder.pallet.batch_code);
  const kind = onPallet ? 'pallet' : 'carton';

  // Separate packs with nothing stacked above them really are separate
  // pieces of cargo, so each one becomes its own item carrying only its own
  // batch. Anything above them merges the packs into one piece, so that gets
  // a single item listing every batch inside it.
  const loose = !onPallet && !outerOn && c.separate;

  // How many of each pack end up inside one finished piece
  const perPiece = loose
    ? c.packs.map(() => 1)
    : outerOn
      ? shipUnit.alloc.map(n => n * (onPallet ? p.trays : 1))
      : tallyPacks(c.packs, onPallet ? p.trays : 1).alloc;

  const contentsFor = packIdxs => {
    const rows = [];
    packIdxs.forEach(pi => {
      c.packs[pi].blocks.forEach(b => {
        const lot = normaliseBatchCode(b.group.batch_lot) || palletLot || null;
        const qty = b.n * perPiece[pi];
        if (!qty) return;
        // One row per batch, even when the same batch appears in two packs
        const same = rows.find(r => r.batch_lot === lot &&
                                    r.product_name === (b.group.product_name || ''));
        if (same) same.quantity += qty;
        else rows.push({
          product_name: b.group.product_name || '',
          batch_lot: lot,
          medium: b.group.medium || null,
          quantity: qty
        });
      });
    });
    return rows;
  };

  // A snapshot of what this was built from, so the plan can draw the real
  // contents rather than a brown box. Cheap: the unit positions are worked
  // out again from this, not stored.
  const specSnapshot = JSON.parse(JSON.stringify(builder));
  const buildLevel = onPallet ? 'pallet' : (outerOn ? 'outer' : 'primary');

  // One piece per pack when loose, otherwise a single piece holding them all
  const pieces = loose
    ? c.packs.map((pk, i) => ({
        idxs: [i], color: pk.color,
        suffix: '-' + (packName(pk, i).replace(/\s+/g, '').slice(0, 10) || (i + 1)),
        productName: builder.groups.find(g => g.id === pk.id)?.product_name || '',
        buildRef: { level: 'primary', pack_index: i, spec: specSnapshot }
      }))
    : [{
        idxs: c.packs.map((_, i) => i),
        color: null,
        suffix: '',
        productName: builder.groups[0]?.product_name || '',
        buildRef: { level: buildLevel, pack_index: null, spec: specSnapshot }
      }];

  let added = 0;
  pieces.forEach(piece => {
    const contents = contentsFor(piece.idxs);
    contents.forEach(r => rememberBatchCode(r.batch_lot));

    // Keep the plan visually continuous with the preview: reuse an existing
    // SKU's colour if there is one, else the pack's own colour, else the
    // colour of the batch group contributing the most units.
    const label = baseLabel + piece.suffix;
    const twin = items.find(i => i.base_label === label);
    const dominant = builder.groups.reduce(
      (best, g) => (!best || groupUnitCount(g) > groupUnitCount(best)) ? g : best, null);
    const color = twin ? twin.color
      : (piece.color || dominant?.color || pickColorForBase(label));

    for (let n = 0; n < builderQty; n++) {
      const suffix = builderQty > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
      const item = addItem({
        label: label + suffix,
        base_label: label,
        product_name: piece.productName,
        kind,
        length_cm: Number(ship.l.toFixed(2)),
        width_cm:  Number(ship.w.toFixed(2)),
        height_cm: Number(ship.h.toFixed(2)),
        weight_kg: Number((loose ? c.packs[piece.idxs[0]].weight_kg : ship.kg).toFixed(3)),
        handling: 'standard',
        color,
        build_ref: piece.buildRef
      });
      item.contents = contents.map(x => ({ ...x }));
      item.terms = { ...builder.terms };
      if (onPallet) {
        item.pallet_meta = {
          batch_code: palletLot,
          order_no: builder.pallet.order_no.trim(),
          packer: builder.pallet.packer.trim(),
          trays: p.trays, per_layer: p.perLayer, layers: p.layers
        };
      }
      added++;
    }
  });
  rememberBatchCode(palletLot);

  updateStats();
  renderCargoList();
  refreshAllContents();
  rememberBuild(builder, baseLabel);
  builder._done = true;                  // next open starts fresh
  closeBuilder();
  const totalUnits = pieces.reduce((s, piece) =>
    s + contentsFor(piece.idxs).reduce((t, r) => t + r.quantity, 0), 0) * builderQty;
  showToast(onPallet
    ? `Added <b>${added}</b> ${escapeHtml(term('secondary', added, true))} — ${p.trays} ${escapeHtml(term(STACKED, p.trays, true))}, ${totalUnits} ${escapeHtml(term('product', totalUnits, true))}.`
    : loose
      ? `Added <b>${added}</b> separate ${escapeHtml(term('primary', added, true))} — ${totalUnits} ${escapeHtml(term('product', totalUnits, true))}, batches kept apart.`
      : `Added <b>${added}</b> × ${escapeHtml(baseLabel)} — ${totalUnits} ${escapeHtml(term('product', totalUnits, true))}.`);
}

// ============================================================
// RIGHT PANEL — Add / Items tabs and collapsible options
// ============================================================
let lastPanelTab = 'add';                // restored when the inspector closes

function setPanelTab(pane) {
  lastPanelTab = pane;
  $$('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
  $('#paneAdd').hidden   = pane !== 'add';
  $('#paneItems').hidden = pane !== 'items';
  refreshSegments();
}

function updateOptionsSummary() {
  const kindLabel = { carton: 'Carton', pallet: 'Pallet', slipsheet: 'Slipsheet' }[currentKind] || 'Carton';
  const bits = [kindLabel, SHAPES[currentShape].label];
  const tpl = $('#templateSelect');
  if (tpl?.value) {
    const opt = tpl.options[tpl.selectedIndex];
    if (opt) bits.push(opt.textContent);
  }
  $('#optSummary').textContent = bits.join(' · ');
}

function setOptionsOpen(open) {
  $('#optBody').hidden = !open;
  $('#optToggle').classList.toggle('open', open);
  $('#paneAdd').classList.toggle('opt-open', open);
  $('#optToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) refreshSegments();           // kind tabs and shape picker just became measurable
}

$$('.panel-tab').forEach(btn =>
  btn.addEventListener('click', () => setPanelTab(btn.dataset.pane)));

$('#optToggle').addEventListener('click', () =>
  setOptionsOpen($('#optBody').hidden));

// ============================================================
// CARGO KIND (carton / pallet / slipsheet) — form UI
// ============================================================
function setKind(kind, opts = {}) {
  currentKind = kind;
  $$('.kind-tab').forEach(t => t.classList.toggle('active', t.dataset.kind === kind));

  const presetRow = $('#kindPresetRow');
  const presetSelect = $('#fKindPreset');

  // Only cartons can be round — a pallet deck or a slipsheet is a rectangle.
  // Without this, picking Cylinder for a carton and then switching kind left
  // a round slipsheet behind.
  const canBeRound = kind === 'carton';
  $('#shapeRow').hidden = !canBeRound;
  if (!canBeRound && currentShape !== 'box') setShape('box', { mirror: false });

  if (kind === 'carton') {
    presetRow.hidden = true;
    updateOptionsSummary();
    return;
  }
  presetRow.hidden = false;
  const presets = kind === 'pallet' ? PALLET_PRESETS : SLIPSHEET_PRESETS;
  presetSelect.innerHTML = Object.entries(presets)
    .map(([id, p]) => `<option value="${id}">${escapeHtml(p.name)}</option>`).join('');
  if (opts.autofill !== false) {
    const firstId = Object.keys(presets)[0];
    presetSelect.value = firstId;
    applyKindPreset(firstId);
  }
  updateOptionsSummary();
}

function applyKindPreset(presetId) {
  const presets = currentKind === 'pallet' ? PALLET_PRESETS
                : currentKind === 'slipsheet' ? SLIPSHEET_PRESETS
                : null;
  if (!presets) return;
  const p = presets[presetId];
  if (!p) return;
  $('#fLength').value = fromCm(p.length);
  $('#fWidth').value  = fromCm(p.width);
  $('#fHeight').value = fromCm(p.height);
  $('#fWeight').value = p.weight;
}

// ============================================================
// UNIT CONVERSION (cm / mm / m) — split per section
// ============================================================
function formatDimValue(val, unit) {
  const d = UNIT_DECIMALS[unit];
  const s = val.toFixed(d);
  if (d === 0) return s;
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
// Item helpers use itemUnit; container helpers use containerUnit.
function fromCm(cm)  { return formatDimValue(cm * 10 / TO_MM[itemUnit], itemUnit); }
function fromM(m)    { return formatDimValue(m * 1000 / TO_MM[containerUnit], containerUnit); }
function toCm(val)   { return val * TO_MM[itemUnit] / 10; }
function toM(val)    { return val * TO_MM[containerUnit] / 1000; }

function updateDimLabels() {
  $$('[data-unit-label]').forEach(el => {
    const scope = el.dataset.unitScope || 'item';
    const unit  = scope === 'container' ? containerUnit : itemUnit;
    el.textContent = `${el.dataset.unitLabel} (${unit})`;
  });
}
function updateFieldSteps() {
  const cStep = UNIT_STEPS[containerUnit];
  const iStep = UNIT_STEPS[itemUnit];
  ['#dimLength', '#dimWidth', '#dimHeight'].forEach(sel => { const el = $(sel); if (el) el.step = cStep; });
  ['#fLength',   '#fWidth',   '#fHeight'  ].forEach(sel => { const el = $(sel); if (el) el.step = iStep; });
}
function updateSceneDimsDisplay() {
  $('#sceneDims').textContent =
    `${fromM(cargoSpace.length)} × ${fromM(cargoSpace.width)} × ${fromM(cargoSpace.height)} ${containerUnit}`;
  // The collapsed rail shows the same thing, so one call keeps both honest
  // whichever route changed the container — preset, units, or loading a plan.
  updateRailSummary();
}

// Generic setter used by both switchers
function setSectionUnit({ scope, newUnit }) {
  const isContainer = scope === 'container';
  const oldUnit = isContainer ? containerUnit : itemUnit;
  if (newUnit === oldUnit) return;

  const fields = isContainer
    ? ['#dimLength', '#dimWidth', '#dimHeight']
    : ['#fLength',   '#fWidth',   '#fHeight'  ];

  fields.forEach(sel => {
    const el = $(sel);
    if (!el || el.value === '') return;
    const val = parseFloat(el.value);
    if (!isNaN(val)) el.value = formatDimValue(val * TO_MM[oldUnit] / TO_MM[newUnit], newUnit);
  });

  if (isContainer) containerUnit = newUnit;
  else             itemUnit      = newUnit;

  updateDimLabels();
  updateFieldSteps();
  if (isContainer) { updateSceneDimsDisplay(); renderGridOptions(); }
  else             { renderCargoList(); renderSnapOptions(); }

  $$(`.unit-mini[data-unit-target="${scope}"] .unit-btn`).forEach(b =>
    b.classList.toggle('active', b.dataset.unit === newUnit));

  try { localStorage.setItem(isContainer ? CONTAINER_UNIT_KEY : ITEM_UNIT_KEY, newUnit); } catch (e) {}
}
function setContainerUnit(u) { setSectionUnit({ scope: 'container', newUnit: u }); }
function setItemUnit(u)      { setSectionUnit({ scope: 'item',      newUnit: u }); }

// ============================================================
// SCENE INPUT — drag / select
// ============================================================
const _mouse = new THREE.Vector2();
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
  // While isolating, the faded ones are not there as far as the mouse is
  // concerned — that is the whole point of getting them out of the way.
  const hit = hits.find(h => !h.object.userData.ghost);
  if (!hit) return null;
  return { itemId: hit.object.userData.itemId, point: hit.point.clone() };
}

// Drag plane depends on scene mode + ortho view.
// In 3D and 2D-top: horizontal floor plane (Y=0).
// In 2D-side/front: the box's own plane, so drag is confined to the visible plane.
function getDragPlane(item) {
  if (sceneMode === '3d' || orthoView === 'top') {
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }
  if (orthoView === 'side') {
    const z = item.pos_z / 100 - cargoSpace.width / 2;
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  }
  // front
  const x = item.pos_x / 100;
  return new THREE.Plane(new THREE.Vector3(1, 0, 0), -x);
}

function raycastDragPlane(e, plane) {
  updateMouseNormalized(e);
  raycaster.setFromCamera(_mouse, camera);
  return raycaster.ray.intersectPlane(plane, _hitPoint) ? _hitPoint.clone() : null;
}

function attachSceneInput() {
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup',   onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  // passive:false — the handler stops the page scrolling behind the scene
  canvas.addEventListener('wheel', onWheelZoom, { passive: false });
}

function onPointerLeave() {
  if (hoveredItemId !== null) {
    hoveredItemId = null;
    updateLabelVisibility();
  }
}

let shiftPick = null;                    // tracks a shift-click that isn't an orbit drag

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (isPacking) return;                 // scene is animating

  // Shift lets OrbitControls run, so a shift-click only counts as a
  // measurement pick if the pointer barely moves before release.
  if (e.shiftKey) {
    const hit = hitCarton(e);
    shiftPick = hit ? { itemId: hit.itemId, x: e.clientX, y: e.clientY } : null;
    return;
  }
  if (e.altKey) return;

  const hit = hitCarton(e);
  if (!hit) { deselectAll(); return; }

  // Ctrl/Cmd-click marks a carton for the running total instead of grabbing
  // it, so a part load can be weighed without dragging anything by accident.
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    toggleInSelection(hit.itemId);
    return;
  }

  e.preventDefault();
  // Grabbing something already in the picked set keeps the set, so the whole
  // block can be dragged. Grabbing anything else starts a fresh selection.
  // isSelected, not multiSelect: the inspector item counts as picked too, and
  // it is the one most likely to be grabbed.
  if (!isSelected(hit.itemId)) { multiSelect.clear(); refreshMultiHighlights(); }
  selectItem(hit.itemId);

  // A locked carton still selects, so it can be inspected or unlocked —
  // it just refuses to be dragged, which is the whole point of the lock.
  const lead = items.find(i => i.id === hit.itemId);
  if (lead?.locked) {
    showToast('That carton is locked. Unlock it to move it.');
    return;
  }
  canvas.setPointerCapture(e.pointerId);

  const item = items.find(i => i.id === hit.itemId);
  const plane = getDragPlane(item);
  const startWorld = raycastDragPlane(e, plane);
  if (!startWorld) return;

  // Anything else ticked travels with it, as one rigid block
  const group = movableSelection().filter(i => i.id !== hit.itemId);

  dragState = {
    itemId: hit.itemId,
    plane,
    startWorld,
    origPos: { x: item.pos_x, y: item.pos_y, z: item.pos_z },
    followers: group,
    followerOrigins: snapshotPositions(group),
    startClientX: e.clientX,
    startClientY: e.clientY,
    activated: false,
    moved: false,
    pointerId: e.pointerId
  };
  updateLabelVisibility();               // show the dragged box's label
}

function onPointerMove(e) {
  // Hover detection when idle — drives the on-hover label
  if (!dragState && !resizeState) {
    const hit = showLabels ? hitCarton(e) : null;
    const newHover = hit ? hit.itemId : null;
    if (newHover !== hoveredItemId) {
      hoveredItemId = newHover;
      updateLabelVisibility();
    }
  }

  if (!dragState) return;

  if (!dragState.activated) {
    const dx = Math.abs(e.clientX - dragState.startClientX);
    const dy = Math.abs(e.clientY - dragState.startClientY);
    if (dx < 4 && dy < 4) return;
    dragState.activated = true;
    controls.enabled = false;
  }

  const item = items.find(i => i.id === dragState.itemId);
  if (!item) return;

  const currentWorld = raycastDragPlane(e, dragState.plane);
  if (!currentWorld) return;

  // World delta (metres) → cm
  const dxCm = (currentWorld.x - dragState.startWorld.x) * 100;
  const dyCm = (currentWorld.y - dragState.startWorld.y) * 100;
  const dzCm = (currentWorld.z - dragState.startWorld.z) * 100;

  // A multi-selection travels as one rigid block. Stack-snapping, dropping
  // onto supports and the edge magnet all act on a single carton, and would
  // pull the formation apart, so a group drag skips them.
  if (dragState.followers.length) {
    const all = [item, ...dragState.followers];
    const origins = [dragState.origPos, ...dragState.followerOrigins];
    const axes = (sceneMode === '3d' || orthoView === 'top')
      ? [['x', dxCm], ['z', dzCm]]
      : orthoView === 'side' ? [['x', dxCm], ['y', dyCm]]
                             : [['z', dzCm], ['y', dyCm]];
    const d = {};
    // The delta is snapped, not each position, so the spacing between the
    // cartons survives the move exactly.
    axes.forEach(([axis, raw]) => {
      d[axis] = clampGroupDelta(all, origins, axis, snapToGrid(raw));
    });
    shiftGroup(all, origins, d);
    dragState.moved = true;
    return;
  }

  let newXcm = dragState.origPos.x;
  let newYcm = dragState.origPos.y;
  let newZcm = dragState.origPos.z;
  let useSupport = true;

  if (sceneMode === '3d' || orthoView === 'top') {
    // Follow the pointer. Stacking is handled by findSupportHeight below —
    // a box rides up automatically once its footprint covers another. Driving
    // the position from a raycast instead made a box leap onto its neighbour
    // the instant the cursor crossed that neighbour's top face, which stopped
    // you ever nudging two boxes flush.
    newXcm = snapToGrid(dragState.origPos.x + dxCm);
    newZcm = snapToGrid(dragState.origPos.z + dzCm);

    // Line a stack up with whatever it has actually landed on
    const sup = findSupportHeight(item, newXcm, newZcm, item.id);
    if (sup.supportId) {
      const base = items.find(i => i.id === sup.supportId);
      const r = centerSnapRange();
      if (base) {
        if (Math.abs(newXcm - base.pos_x) < r) newXcm = base.pos_x;
        if (Math.abs(newZcm - base.pos_z) < r) newZcm = base.pos_z;
      }
    }
  } else {
    // Side + front views: raycast → auto-stack.
    // Sticky: once you hover a valid target the drag "locks" onto it
    // until you hover a different one or press Escape.
    updateMouseNormalized(e);
    raycaster.setFromCamera(_mouse, camera);
    const others = cartonGroup.children.filter(m => m.userData.itemId !== dragState.itemId);
    const hits = raycaster.intersectObjects(others, false);

    let stackTarget = null;
    if (hits.length > 0) {
      const t = items.find(i => i.id === hits[0].object.userData.itemId);
      if (t) {
        const spaceH = cargoSpace.height * 100;
        const proposedTop = t.pos_y + itemExtent(t).h / 2 + itemExtent(item).h;
        if (proposedTop <= spaceH) stackTarget = t;
      }
    }

    // Sticky bookkeeping + wire highlight
    const prevStackId = dragState.stackTargetId;
    if (stackTarget && stackTarget.id !== prevStackId) {
      if (prevStackId) restoreWireframe(prevStackId);
      setStackHighlight(stackTarget.id);
      dragState.stackTargetId = stackTarget.id;
    } else if (!stackTarget && prevStackId) {
      // No new hit this frame — keep the last target so we don't fall off mid-drag
      stackTarget = items.find(i => i.id === prevStackId) || null;
      if (!stackTarget) dragState.stackTargetId = null;
    }

    if (stackTarget) {
      newXcm = stackTarget.pos_x;
      newYcm = stackTarget.pos_y + itemExtent(stackTarget).h / 2 + itemExtent(item).h / 2;
      newZcm = stackTarget.pos_z;
    } else if (orthoView === 'side') {
      newXcm = snapToGrid(dragState.origPos.x + dxCm);
      newYcm = snapToGrid(dragState.origPos.y + dyCm);
      newZcm = dragState.origPos.z;
    } else {                             // front
      newXcm = dragState.origPos.x;
      newYcm = snapToGrid(dragState.origPos.y + dyCm);
      newZcm = snapToGrid(dragState.origPos.z + dzCm);
    }
    useSupport = false;
  }

  if (useSupport) {
    const s = findSupportHeight(item, newXcm, newZcm, item.id);
    item.pos_y = s.top + itemExtent(item).h / 2;
  } else {
    item.pos_y = newYcm;
  }

  // Pull faces flush with neighbours unless the user is holding Ctrl/Cmd
  if (!(e.ctrlKey || e.metaKey)) {
    const snapped = applyEdgeSnap(item, newXcm, newZcm);
    newXcm = snapped.x;
    newZcm = snapped.z;
    if (useSupport) {
      const s2 = findSupportHeight(item, newXcm, newZcm, item.id);
      item.pos_y = s2.top + itemExtent(item).h / 2;
    }
  }

  item.pos_x = newXcm;
  item.pos_z = newZcm;

  clampItemToBounds(item);
  refreshItemMesh(item);
  dragState.moved = true;
}

function onPointerUp(e) {
  if (shiftPick) {
    const moved = Math.abs(e.clientX - shiftPick.x) > 4 || Math.abs(e.clientY - shiftPick.y) > 4;
    if (!moved) setMeasureTarget(shiftPick.itemId);
    shiftPick = null;
  }

  if (dragState) {
    if (canvas.hasPointerCapture(dragState.pointerId)) {
      canvas.releasePointerCapture(dragState.pointerId);
    }
    if (dragState.stackTargetId) restoreWireframe(dragState.stackTargetId);
    if (dragState.moved) {
      settleAll();
      updateStats();
      refreshPositionReadouts();
      markDirty();
    }
    dragState = null;
    controls.enabled = true;
    updateLabelVisibility();             // drop the drag-label back to hover
  }
}

// ============================================================
// RESIZE HANDLES (2D mode)
// ============================================================
function createResizeHandles() {
  HANDLE_TYPES.forEach(type => {
    const h = document.createElement('div');
    h.className = `resize-handle handle-${type}`;
    h.dataset.handle = type;
    h.style.display = 'none';
    h.addEventListener('pointerdown', onHandlePointerDown);
    resizeHandlesEl.appendChild(h);
    handleElements.push(h);
  });
}

function itemBoundsWorld(item) {
  // Same as itemBounds but in metres (world coords, Z shifted to scene frame)
  const b = itemBounds(item);
  const shift = cargoSpace.width / 2;
  return {
    minX: b.minX / 100, maxX: b.maxX / 100,
    minY: b.minY / 100, maxY: b.maxY / 100,
    minZ: b.minZ / 100 - shift, maxZ: b.maxZ / 100 - shift
  };
}

function handleWorldPoints(item) {
  const b = itemBoundsWorld(item);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const midZ = (b.minZ + b.maxZ) / 2;
  const nudge = 0.01;                  // lift slightly above face so handles are visible

  if (orthoView === 'top') {
    const y = b.maxY + nudge;
    return [
      new THREE.Vector3(b.minX, y, b.minZ),  // nw
      new THREE.Vector3(midX,   y, b.minZ),  // n
      new THREE.Vector3(b.maxX, y, b.minZ),  // ne
      new THREE.Vector3(b.maxX, y, midZ),    // e
      new THREE.Vector3(b.maxX, y, b.maxZ),  // se
      new THREE.Vector3(midX,   y, b.maxZ),  // s
      new THREE.Vector3(b.minX, y, b.maxZ),  // sw
      new THREE.Vector3(b.minX, y, midZ),    // w
    ];
  }
  if (orthoView === 'side') {
    const z = b.maxZ + nudge;
    return [
      new THREE.Vector3(b.minX, b.maxY, z),  // nw
      new THREE.Vector3(midX,   b.maxY, z),  // n
      new THREE.Vector3(b.maxX, b.maxY, z),  // ne
      new THREE.Vector3(b.maxX, midY,   z),  // e
      new THREE.Vector3(b.maxX, b.minY, z),  // se
      new THREE.Vector3(midX,   b.minY, z),  // s
      new THREE.Vector3(b.minX, b.minY, z),  // sw
      new THREE.Vector3(b.minX, midY,   z),  // w
    ];
  }
  // front (camera at +X, screen-right = world -Z)
  const x = b.maxX + nudge;
  return [
    new THREE.Vector3(x, b.maxY, b.maxZ),  // nw (screen left/up = world +Z/+Y)
    new THREE.Vector3(x, b.maxY, midZ),    // n
    new THREE.Vector3(x, b.maxY, b.minZ),  // ne (screen right/up = world -Z/+Y)
    new THREE.Vector3(x, midY,   b.minZ),  // e
    new THREE.Vector3(x, b.minY, b.minZ),  // se
    new THREE.Vector3(x, b.minY, midZ),    // s
    new THREE.Vector3(x, b.minY, b.maxZ),  // sw
    new THREE.Vector3(x, midY,   b.maxZ),  // w
  ];
}

function updateResizeHandlesPosition() {
  const show = sceneMode === '2d' && selectedItemId && !dragState && !resizeState;
  const item = show ? items.find(i => i.id === selectedItemId) : null;

  if (!show || !item) {
    // Fix: also toggle the parent's `hidden` attribute — without this, the
    // container stays display:none from its HTML `hidden` attribute and no
    // amount of setting individual handle display:block can make them show.
    resizeHandlesEl.hidden = true;
    handleElements.forEach(h => h.style.display = 'none');
    return;
  }

  resizeHandlesEl.hidden = false;
  const rect = canvas.getBoundingClientRect();
  const worldPts = handleWorldPoints(item);
  worldPts.forEach((wp, i) => {
    const proj = wp.clone().project(camera);
    const x = (proj.x * 0.5 + 0.5) * rect.width;
    const y = (-proj.y * 0.5 + 0.5) * rect.height;
    const h = handleElements[i];
    h.style.display = 'block';
    h.style.left = `${x}px`;
    h.style.top = `${y}px`;
  });
}

function onHandlePointerDown(e) {
  if (!selectedItemId || sceneMode !== '2d') return;
  e.preventDefault();
  e.stopPropagation();
  const handleType = e.currentTarget.dataset.handle;
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  if (item.locked) { showToast('That carton is locked. Unlock it to resize it.'); return; }

  e.currentTarget.setPointerCapture(e.pointerId);
  controls.enabled = false;

  // Use the box's current plane for the view
  const plane = getResizePlane(item);
  const startWorld = raycastDragPlane(e, plane);

  resizeState = {
    handleEl: e.currentTarget,
    handleType,
    itemId: item.id,
    plane,
    startWorld: startWorld ? startWorld.clone() : null,
    orig: {
      length_cm: item.length_cm, width_cm: item.width_cm, height_cm: item.height_cm,
      pos_x: item.pos_x, pos_y: item.pos_y, pos_z: item.pos_z
    },
    pointerId: e.pointerId
  };

  document.addEventListener('pointermove', onHandlePointerMove);
  document.addEventListener('pointerup',   onHandlePointerUp);
  document.addEventListener('pointercancel', onHandlePointerUp);
}

function getResizePlane(item) {
  if (orthoView === 'top')  return new THREE.Plane(new THREE.Vector3(0, 1, 0), -(item.pos_y / 100));
  if (orthoView === 'side') return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(item.pos_z / 100 - cargoSpace.width / 2));
  // front
  return new THREE.Plane(new THREE.Vector3(1, 0, 0), -(item.pos_x / 100));
}

function onHandlePointerMove(e) {
  if (!resizeState || !resizeState.startWorld) return;
  const item = items.find(i => i.id === resizeState.itemId);
  if (!item) return;

  const current = raycastDragPlane(e, resizeState.plane);
  if (!current) return;

  const worldDelta = {
    x: (current.x - resizeState.startWorld.x) * 100,
    y: (current.y - resizeState.startWorld.y) * 100,
    z: (current.z - resizeState.startWorld.z) * 100
  };

  const edges = RESIZE_MAP[orthoView][resizeState.handleType];
  applyResize(item, resizeState.orig, edges, worldDelta);

  refreshItemMesh(item);
  refreshItemSprite(item);
  populateFormFromItem(item);          // live form update
}

function onHandlePointerUp(e) {
  if (!resizeState) return;
  const item = items.find(i => i.id === resizeState.itemId);
  if (resizeState.handleEl.hasPointerCapture(e.pointerId)) {
    resizeState.handleEl.releasePointerCapture(e.pointerId);
  }
  document.removeEventListener('pointermove', onHandlePointerMove);
  document.removeEventListener('pointerup',   onHandlePointerUp);
  document.removeEventListener('pointercancel', onHandlePointerUp);
  resizeState = null;
  controls.enabled = true;

  if (item) {
    settleAll();
    updateStats();
    renderCargoList();
    markDirty();
  }
}

// Apply per-edge resize. Snap the moving edge to grid, recompute size + centre.
function applyResize(item, orig, edges, worldDelta) {
  for (const edge of edges) {
    const { axis, side } = edge;

    // Which size property to update (axis + rotation aware)
    // Which stored dimension currently lies along this world axis
    const o = ORIENTATIONS[item.rot_y] || ORIENTATIONS[0];
    const sizeProp = o[axis];
    const posProp = 'pos_' + axis;

    const origSize = orig[sizeProp];
    const origCenter = orig[posProp];
    const origMin = origCenter - origSize / 2;
    const origMax = origCenter + origSize / 2;
    const delta = worldDelta[axis];

    let newMin, newMax;
    const spaceMax = axis === 'x' ? cargoSpace.length * 100
                   : axis === 'y' ? cargoSpace.height * 100
                   : cargoSpace.width * 100;
    if (side === 'max') {
      newMax = snapEdgeValue(snapToGrid(origMax + delta), axis, item.id, spaceMax);
      newMin = origMin;
    } else {
      newMin = snapEdgeValue(snapToGrid(origMin + delta), axis, item.id, spaceMax);
      newMax = origMax;
    }

    let newSize = newMax - newMin;
    if (newSize < MIN_SIZE_CM) newSize = MIN_SIZE_CM;
    // Fix drift if we clamped size — keep the fixed edge
    if (side === 'max') newMax = newMin + newSize;
    else                newMin = newMax - newSize;

    // Clamp to container
    if (newMin < 0) { newMin = 0; newMax = newMin + newSize; }
    if (newMax > spaceMax) { newMax = spaceMax; newMin = newMax - newSize; if (newMin < 0) newMin = 0; }

    const finalSize = newMax - newMin;
    const finalCenter = (newMax + newMin) / 2;

    item[sizeProp] = finalSize;
    item[posProp] = finalCenter;
  }
}

// ============================================================
// MEASUREMENT GRID
// ------------------------------------------------------------
// Reference lines ruled across the cargo space, like a camera's
// framing grid but to scale, so you can read where anything sits
// rather than only how big the container is.
// ============================================================
function niceStep(raw) {
  const opts = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
  return opts.find(s => s >= raw) ?? 10;
}

let gridTicks = { step: 0.5, majorEvery: 2, x: [], z: [], y: [] };

function buildMeasureGrid() {
  if (measureGroup) {
    scene.remove(measureGroup);
    measureGroup.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  measureGroup = new THREE.Group();

  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  const step = gridStepPref === 'auto'
    ? Math.max(0.25, niceStep(L / 28))
    : Number(gridStepPref);
  // At 1 m or coarser every line is worth labelling; finer grids get majors
  const majorEvery = step >= 1 ? 1 : Math.max(2, Math.round(1 / step));
  const EPS = 1e-6;

  // Rule out to the span, then close on the exact edge so the grid doesn't
  // stop short of the container wall.
  const ticksFor = span => {
    const out = [];
    for (let v = 0; v <= span + EPS; v += step) out.push(v);
    const last = out[out.length - 1];
    if (span - last > step * 0.15) out.push(span);
    return out;
  };
  const xs = ticksFor(L), zs = ticksFor(W), ys = ticksFor(H);
  gridTicks = { step, majorEvery, x: xs, z: zs, y: ys };

  const minor = [], major = [];
  const bucket = i => (i % majorEvery === 0 ? major : minor);

  // Floor plane — length x width
  const fy = 0.004;
  xs.forEach((x, i) => bucket(i).push(
    new THREE.Vector3(x, fy, -W / 2), new THREE.Vector3(x, fy, W / 2)));
  zs.forEach((z, i) => bucket(i).push(
    new THREE.Vector3(0, fy, z - W / 2), new THREE.Vector3(L, fy, z - W / 2)));

  // Far side wall — length x height (read in Side view)
  const sz = -W / 2 + 0.004;
  xs.forEach((x, i) => bucket(i).push(
    new THREE.Vector3(x, 0, sz), new THREE.Vector3(x, H, sz)));
  ys.forEach((y, i) => bucket(i).push(
    new THREE.Vector3(0, y, sz), new THREE.Vector3(L, y, sz)));

  // Back wall — width x height (read in Front view)
  const bx = 0.004;
  zs.forEach((z, i) => bucket(i).push(
    new THREE.Vector3(bx, 0, z - W / 2), new THREE.Vector3(bx, H, z - W / 2)));
  ys.forEach((y, i) => bucket(i).push(
    new THREE.Vector3(bx, y, -W / 2), new THREE.Vector3(bx, y, W / 2)));

  const mk = (pts, color, opacity) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineSegments(g, m);
  };
  if (minor.length) measureGroup.add(mk(minor, 0x1a6fdb, 0.16));
  if (major.length) measureGroup.add(mk(major, 0x1a6fdb, 0.42));

  measureGroup.visible = showDims;
  scene.add(measureGroup);
}

// Move precision, labelled in whatever unit cartons use
function renderSnapOptions() {
  const sel = $('#snapStep');
  if (!sel) return;
  sel.innerHTML = SNAP_STEP_OPTIONS.map(cm =>
    cm === 0
      ? '<option value="0">Free</option>'
      : `<option value="${cm}">${fromCm(cm)} ${itemUnit}</option>`
  ).join('');
  sel.value = String(moveStep);
}

function setSnapStep(cm) {
  moveStep = Number(cm) || 0;
  try { localStorage.setItem(SNAP_STEP_KEY, String(moveStep)); } catch (e) {}
  showToast(moveStep
    ? `Cartons move in <b>${fromCm(moveStep)} ${itemUnit}</b> steps.`
    : 'Cartons move <b>freely</b>.');
}

// Options are physical spacings, labelled in whatever unit the container uses
function renderGridOptions() {
  const sel = $('#gridStep');
  if (!sel) return;
  sel.innerHTML = '<option value="auto">Auto</option>' +
    GRID_STEP_OPTIONS.map(m =>
      `<option value="${m}">${fromM(m)} ${containerUnit}</option>`).join('');
  sel.value = String(gridStepPref);
}

function setGridStep(pref) {
  gridStepPref = pref === 'auto' ? 'auto' : Number(pref);
  try { localStorage.setItem(GRID_STEP_KEY, String(gridStepPref)); } catch (e) {}
  buildMeasureGrid();
}

// ============================================================
// DIMENSION GUIDES
// ------------------------------------------------------------
// An SVG overlay rather than in-scene sprites, so the numbers stay crisp at
// any zoom and use the app's own typography. World points are projected to
// screen each frame, exactly as the resize handles are.
// ============================================================
const DIM_KEYS = ['cL', 'cW', 'cH', 'iL', 'iW', 'iH'];
const SVG_NS = 'http://www.w3.org/2000/svg';
let dimOverlay = null;
const _dimV = new THREE.Vector3();

function initDimOverlay() {
  const svg = $('#dimOverlay');
  const parts = {};
  DIM_KEYS.forEach(key => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `dim-group ${key[0] === 'c' ? 'dim-container' : 'dim-item'}`);
    const line = document.createElementNS(SVG_NS, 'line');
    const t1   = document.createElementNS(SVG_NS, 'line');
    const t2   = document.createElementNS(SVG_NS, 'line');
    const bg   = document.createElementNS(SVG_NS, 'rect');
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    g.append(line, t1, t2, bg, text);
    svg.appendChild(g);
    parts[key] = { g, line, t1, t2, bg, text };
  });
  dimOverlay = { svg, parts };
}

function projectToScreen(x, y, z, rect) {
  _dimV.set(x, y, z).project(camera);
  return {
    x: (_dimV.x * 0.5 + 0.5) * rect.width,
    y: (-_dimV.y * 0.5 + 0.5) * rect.height,
    behind: _dimV.z > 1
  };
}

function setDimLine(key, a, b, label) {
  const p = dimOverlay.parts[key];
  // Hide when off-camera or too short on screen to read
  if (!a || !b || a.behind || b.behind) { p.g.style.display = 'none'; return; }
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 34) { p.g.style.display = 'none'; return; }
  p.g.style.display = '';

  p.line.setAttribute('x1', a.x); p.line.setAttribute('y1', a.y);
  p.line.setAttribute('x2', b.x); p.line.setAttribute('y2', b.y);

  // End ticks, perpendicular to the run
  const nx = (-dy / len) * 5, ny = (dx / len) * 5;
  p.t1.setAttribute('x1', a.x - nx); p.t1.setAttribute('y1', a.y - ny);
  p.t1.setAttribute('x2', a.x + nx); p.t1.setAttribute('y2', a.y + ny);
  p.t2.setAttribute('x1', b.x - nx); p.t2.setAttribute('y1', b.y - ny);
  p.t2.setAttribute('x2', b.x + nx); p.t2.setAttribute('y2', b.y + ny);

  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  p.text.textContent = label;
  p.text.setAttribute('x', mx);
  p.text.setAttribute('y', my);

  // Estimate the label box rather than calling getBBox every frame
  const w = label.length * 5.9 + 12, h = 16;
  p.bg.setAttribute('x', mx - w / 2); p.bg.setAttribute('y', my - h / 2);
  p.bg.setAttribute('width', w);      p.bg.setAttribute('height', h);
}

// ---- ruler labels along the grid (pooled, count varies with grid density) ----
let rulerPool = [];

function getRuler(i) {
  if (rulerPool[i]) return rulerPool[i];
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'dim-group dim-ruler');
  const bg = document.createElementNS(SVG_NS, 'rect');
  const text = document.createElementNS(SVG_NS, 'text');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  g.append(bg, text);
  $('#dimOverlay').appendChild(g);
  const obj = { g, bg, text };
  rulerPool[i] = obj;
  return obj;
}

function setRuler(i, pt, label) {
  const r = getRuler(i);
  if (!pt || pt.behind) { r.g.style.display = 'none'; return; }
  r.g.style.display = '';
  r.text.textContent = label;
  r.text.setAttribute('x', pt.x);
  r.text.setAttribute('y', pt.y);
  const w = label.length * 5.4 + 9, h = 14;
  r.bg.setAttribute('x', pt.x - w / 2); r.bg.setAttribute('y', pt.y - h / 2);
  r.bg.setAttribute('width', w);        r.bg.setAttribute('height', h);
}

// Mark the major grid lines with their distance from the back wall / near side
function drawRulers(rect) {
  const L = cargoSpace.length, W = cargoSpace.width;
  const P = (x, y, z) => projectToScreen(x, y, z, rect);
  const { majorEvery, x: xs, z: zs, y: ys } = gridTicks;
  const cu = containerUnit;
  let n = 0;

  const along = (ticks, fn) => {
    ticks.forEach((v, i) => {
      if (i === 0 || i % majorEvery !== 0) return;      // majors only, skip zero
      setRuler(n++, fn(v), `${fromM(v)} ${cu}`);
    });
  };

  // Rulers hug the wall furthest from the camera, so they sit behind the load
  // rather than across it, and they follow the camera to the other side.
  if (sceneMode === '2d' && orthoView === 'front') {
    const x = orthoSide > 0 ? 0.02 : L - 0.02;
    along(zs, z => P(x, 0, z - W / 2 - 0.16));
    along(ys, y => P(x, y, W / 2 + 0.16));
  } else if (sceneMode === '2d' && orthoView === 'side') {
    const z = orthoSide > 0 ? -W / 2 + 0.02 : W / 2 - 0.02;
    along(xs, x => P(x, -0.16, z));
    along(ys, y => P(orthoSide > 0 ? L + 0.16 : -0.16, y, z));
  } else {
    along(xs, x => P(x, 0, W / 2 + 0.16));             // length, along the near edge
    along(zs, z => P(L + 0.16, 0, z - W / 2));         // width, along the door end
  }

  for (let i = n; i < rulerPool.length; i++) rulerPool[i].g.style.display = 'none';
}

function updateDimOverlay() {
  const svg = $('#dimOverlay');
  const ctrl = $('#gridControl');
  if (measureGroup) measureGroup.visible = showDims;
  if (ctrl.hidden === showDims) ctrl.hidden = !showDims;
  if (!showDims) { if (!svg.hidden) svg.hidden = true; return; }
  if (!dimOverlay) return;
  if (svg.hidden) svg.hidden = false;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  svg.setAttribute('width', rect.width);
  svg.setAttribute('height', rect.height);

  drawRulers(rect);

  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  const off = 0.28;                                  // stand the guides off the box
  const P = (x, y, z) => projectToScreen(x, y, z, rect);
  const cu = containerUnit;

  setDimLine('cL', P(0, 0, W / 2 + off), P(L, 0, W / 2 + off), `${fromM(L)} ${cu}`);
  setDimLine('cW', P(L + off, 0, -W / 2), P(L + off, 0, W / 2), `${fromM(W)} ${cu}`);
  setDimLine('cH', P(L + off, 0, W / 2 + off), P(L + off, H, W / 2 + off), `${fromM(H)} ${cu}`);

  const item = items.find(i => i.id === selectedItemId);
  if (!item) {
    ['iL', 'iW', 'iH'].forEach(k => dimOverlay.parts[k].g.style.display = 'none');
    return;
  }

  const b = itemBounds(item);
  const shift = W / 2;
  const x0 = b.minX / 100, x1 = b.maxX / 100;
  const y0 = b.minY / 100, y1 = b.maxY / 100;
  const z0 = b.minZ / 100 - shift, z1 = b.maxZ / 100 - shift;
  const e = itemExtent(item);
  const io = 0.07;
  const iu = itemUnit;

  setDimLine('iL', P(x0, y1 + io, z1 + io), P(x1, y1 + io, z1 + io), `${fromCm(e.l)} ${iu}`);
  setDimLine('iW', P(x1 + io, y1 + io, z0), P(x1 + io, y1 + io, z1), `${fromCm(e.w)} ${iu}`);
  setDimLine('iH', P(x1 + io, y0, z1 + io),  P(x1 + io, y1, z1 + io), `${fromCm(e.h)} ${iu}`);
}

// ============================================================
// LIVE OVERLAY — warning markers and pair measurement
// ============================================================
let warnPool = [];
let measurePool = [];
let measureIds = [];                     // up to two item ids being compared

function getWarnMarker(i) {
  if (warnPool[i]) return warnPool[i];
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'warn-marker');
  const tri = document.createElementNS(SVG_NS, 'polygon');
  const text = document.createElementNS(SVG_NS, 'text');
  text.textContent = '!';
  g.append(tri, text);
  $('#liveOverlay').appendChild(g);
  const obj = { g, tri, text };
  warnPool[i] = obj;
  return obj;
}

function drawWarnMarkers(rect) {
  let n = 0;
  for (const item of items) {
    if (!item.issueLevel) continue;
    const e = itemExtent(item);
    const p = projectToScreen(
      item.pos_x / 100,
      (item.pos_y + e.h / 2) / 100 + 0.12,
      item.pos_z / 100 - cargoSpace.width / 2,
      rect
    );
    const m = getWarnMarker(n++);
    if (p.behind) { m.g.style.display = 'none'; continue; }
    m.g.style.display = '';
    m.g.setAttribute('class', `warn-marker lvl-${item.issueLevel}`);
    const s = 9;
    m.tri.setAttribute('points',
      `${p.x},${p.y - s} ${p.x + s},${p.y + s * 0.75} ${p.x - s},${p.y + s * 0.75}`);
    m.text.setAttribute('x', p.x);
    m.text.setAttribute('y', p.y + s * 0.3);
  }
  for (let i = n; i < warnPool.length; i++) warnPool[i].g.style.display = 'none';
}

// Clear gap between two boxes on each axis — zero means they touch or overlap
function gapBetween(a, b) {
  const A = itemBounds(a), B = itemBounds(b);
  const axis = (aMin, aMax, bMin, bMax) =>
    Math.max(0, Math.max(aMin - bMax, bMin - aMax));
  return {
    x: axis(A.minX, A.maxX, B.minX, B.maxX),
    y: axis(A.minY, A.maxY, B.minY, B.maxY),
    z: axis(A.minZ, A.maxZ, B.minZ, B.maxZ),
    A, B
  };
}

function getMeasureLine(i) {
  if (measurePool[i]) return measurePool[i];
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'measure-line');
  const line = document.createElementNS(SVG_NS, 'line');
  const t1 = document.createElementNS(SVG_NS, 'line');
  const t2 = document.createElementNS(SVG_NS, 'line');
  const bg = document.createElementNS(SVG_NS, 'rect');
  const text = document.createElementNS(SVG_NS, 'text');
  g.append(line, t1, t2, bg, text);
  $('#liveOverlay').appendChild(g);
  const obj = { g, line, t1, t2, bg, text };
  measurePool[i] = obj;
  return obj;
}

function setMeasureLine(i, a, b, label) {
  const m = getMeasureLine(i);
  if (!a || !b || a.behind || b.behind) { m.g.style.display = 'none'; return; }
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 12) { m.g.style.display = 'none'; return; }
  m.g.style.display = '';
  m.line.setAttribute('x1', a.x); m.line.setAttribute('y1', a.y);
  m.line.setAttribute('x2', b.x); m.line.setAttribute('y2', b.y);
  const nx = (-dy / len) * 5, ny = (dx / len) * 5;
  m.t1.setAttribute('x1', a.x - nx); m.t1.setAttribute('y1', a.y - ny);
  m.t1.setAttribute('x2', a.x + nx); m.t1.setAttribute('y2', a.y + ny);
  m.t2.setAttribute('x1', b.x - nx); m.t2.setAttribute('y1', b.y - ny);
  m.t2.setAttribute('x2', b.x + nx); m.t2.setAttribute('y2', b.y + ny);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  m.text.textContent = label;
  m.text.setAttribute('x', mx); m.text.setAttribute('y', my);
  const w = label.length * 5.9 + 12, h = 16;
  m.bg.setAttribute('x', mx - w / 2); m.bg.setAttribute('y', my - h / 2);
  m.bg.setAttribute('width', w);      m.bg.setAttribute('height', h);
}

function drawMeasurement(rect) {
  const [ia, ib] = measureIds.map(id => items.find(i => i.id === id));
  const panel = $('#measureReadout');
  if (!ia || !ib) {
    if (!panel.hidden) panel.hidden = true;
    measurePool.forEach(m => m.g.style.display = 'none');
    return;
  }
  panel.hidden = false;

  const g = gapBetween(ia, ib);
  const shift = cargoSpace.width / 2;
  const P = (x, y, z) => projectToScreen(x / 100, y / 100, z / 100 - shift, rect);
  const mid = (lo, hi) => (lo + hi) / 2;
  let n = 0;

  // One dimension line per axis that actually has a gap, drawn between the
  // two facing surfaces at the middle of where the boxes overlap.
  if (g.x > 0.05) {
    const left = g.A.maxX <= g.B.minX ? g.A : g.B;
    const right = left === g.A ? g.B : g.A;
    const y = mid(Math.max(g.A.minY, g.B.minY), Math.min(g.A.maxY, g.B.maxY)) ||
              mid(g.A.minY, g.A.maxY);
    const z = mid(Math.max(g.A.minZ, g.B.minZ), Math.min(g.A.maxZ, g.B.maxZ)) ||
              mid(g.A.minZ, g.A.maxZ);
    setMeasureLine(n++, P(left.maxX, y, z), P(right.minX, y, z), `${fromCm(g.x)} ${itemUnit}`);
  }
  if (g.z > 0.05) {
    const near = g.A.maxZ <= g.B.minZ ? g.A : g.B;
    const far = near === g.A ? g.B : g.A;
    const x = mid(Math.max(g.A.minX, g.B.minX), Math.min(g.A.maxX, g.B.maxX)) ||
              mid(g.A.minX, g.A.maxX);
    const y = mid(Math.max(g.A.minY, g.B.minY), Math.min(g.A.maxY, g.B.maxY)) ||
              mid(g.A.minY, g.A.maxY);
    setMeasureLine(n++, P(x, y, near.maxZ), P(x, y, far.minZ), `${fromCm(g.z)} ${itemUnit}`);
  }
  if (g.y > 0.05) {
    const low = g.A.maxY <= g.B.minY ? g.A : g.B;
    const high = low === g.A ? g.B : g.A;
    const x = mid(Math.max(g.A.minX, g.B.minX), Math.min(g.A.maxX, g.B.maxX)) ||
              mid(g.A.minX, g.A.maxX);
    const z = mid(Math.max(g.A.minZ, g.B.minZ), Math.min(g.A.maxZ, g.B.maxZ)) ||
              mid(g.A.minZ, g.A.maxZ);
    setMeasureLine(n++, P(x, low.maxY, z), P(x, high.minY, z), `${fromCm(g.y)} ${itemUnit}`);
  }
  for (let i = n; i < measurePool.length; i++) measurePool[i].g.style.display = 'none';

  // Readout panel
  $('#measurePair').textContent = `${ia.label}  ↔  ${ib.label}`;
  const row = (name, v) => {
    const touching = v < 0.05;
    return `<div class="measure-row ${touching ? 'touching' : ''}">
      <span>${name}</span><b>${touching ? 'flush' : fromCm(v) + ' ' + itemUnit}</b></div>`;
  };
  const centreDist = Math.hypot(ia.pos_x - ib.pos_x, ia.pos_y - ib.pos_y, ia.pos_z - ib.pos_z);
  $('#measureRows').innerHTML =
    row('Along length', g.x) +
    row('Across width', g.z) +
    row('Vertical', g.y) +
    `<div class="measure-row"><span>Centre to centre</span><b>${fromCm(centreDist)} ${itemUnit}</b></div>`;
}

function updateLiveOverlay() {
  const svg = $('#liveOverlay');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  svg.setAttribute('width', rect.width);
  svg.setAttribute('height', rect.height);
  drawWarnMarkers(rect);
  drawMeasurement(rect);
}

function clearMeasurement() {
  measureIds = [];
  $('#measureReadout').hidden = true;
  measurePool.forEach(m => m.g.style.display = 'none');
}

// Shift-click builds the pair: the selected item is the anchor, the clicked
// one is the other end. Shift-clicking a third replaces the far end.
function setMeasureTarget(itemId) {
  const anchor = selectedItemId && selectedItemId !== itemId
    ? selectedItemId
    : (measureIds[0] && measureIds[0] !== itemId ? measureIds[0] : null);
  if (!anchor) {
    showToast('Select a carton first, then shift-click another to measure.');
    return;
  }
  measureIds = [anchor, itemId];
  const a = items.find(i => i.id === anchor);
  const b = items.find(i => i.id === itemId);
  if (a && b) showToast(`Measuring <b>${escapeHtml(a.label)}</b> to <b>${escapeHtml(b.label)}</b>.`);
}

// ============================================================
// SCENE MODE — 3D <-> 2D
// ============================================================
function setSceneMode(mode) {
  if (mode === sceneMode) return;
  sceneMode = mode;

  if (mode === '3d') {
    camera = perspCamera;
    controls = perspControls;
    perspControls.enabled = true;
    orthoControls.enabled = false;
    setView(last3DView);
  } else {
    camera = orthoCamera;
    controls = orthoControls;
    perspControls.enabled = false;
    orthoControls.enabled = true;
    positionOrthoCamera(orthoView);
  }

  updateContainerVisibility();

  // Swap pill sets
  $('.view-pills-3d').hidden = mode !== '3d';
  $('.view-pills-2d').hidden = mode !== '2d';

  viewportHead.dataset.sceneMode = mode;
  viewport.dataset.sceneMode = mode;
  $$('.scene-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.scene === mode));

  // Hint text
  $('#viewportHint').textContent = mode === '3d'
    ? 'DRAG CARTON TO MOVE · SHIFT-DRAG OR RIGHT-DRAG TO ORBIT · SCROLL TO ZOOM'
    : `2D ${viewName()} · DRAG CARTON · DRAG CORNERS/EDGES TO RESIZE · SCROLL TO ZOOM`;

  try { localStorage.setItem(SCENE_MODE_KEY, mode); } catch (e) {}
}

function positionOrthoCamera(view, side = orthoSide) {
  orthoView = view;
  orthoSide = (view === 'top') ? 1 : (side < 0 ? -1 : 1);
  const L = cargoSpace.length;
  const W = cargoSpace.width;
  const H = cargoSpace.height;
  const rect = viewport.getBoundingClientRect();
  const canvasAspect = (rect.width || 800) / (rect.height || 500);

  // Content aspect and framing
  let contentW, contentH, camPos, target, up;
  if (view === 'top') {
    contentW = L * 1.15; contentH = W * 1.15;
    camPos = new THREE.Vector3(L / 2, 30, 0);
    target = new THREE.Vector3(L / 2, 0, 0);
    up = new THREE.Vector3(0, 0, -1);
  } else if (view === 'side') {
    // Outside the +Z wall (right) or the -Z wall (left), looking in
    contentW = L * 1.15; contentH = H * 1.15;
    camPos = new THREE.Vector3(L / 2, H / 2, 30 * orthoSide);
    target = new THREE.Vector3(L / 2, H / 2, 0);
    up = new THREE.Vector3(0, 1, 0);
  } else {
    // Outside the door end (+X) or the far end (-X), looking down the length
    contentW = W * 1.15; contentH = H * 1.15;
    camPos = new THREE.Vector3(orthoSide > 0 ? L + 30 : -30, H / 2, 0);
    target = new THREE.Vector3(L / 2, H / 2, 0);
    up = new THREE.Vector3(0, 1, 0);
  }

  let orthoW, orthoH;
  if (contentW / contentH > canvasAspect) {
    orthoW = contentW;
    orthoH = orthoW / canvasAspect;
  } else {
    orthoH = contentH;
    orthoW = orthoH * canvasAspect;
  }

  orthoCamera.left = -orthoW / 2;
  orthoCamera.right = orthoW / 2;
  orthoCamera.top = orthoH / 2;
  orthoCamera.bottom = -orthoH / 2;
  orthoCamera.zoom = 1;
  orthoCamera.up.copy(up);
  orthoCamera.position.copy(camPos);
  orthoCamera.lookAt(target);
  orthoCamera.updateProjectionMatrix();

  orthoControls.target.copy(target);
  orthoControls.update();

  // Swap backdrops to match the active view
  updateContainerVisibility();

  // Update 2D pill selection
  // Both the axis and the side have to match, or Left and Right would always
  // light up together
  $$('.view-pills-2d .view-pill').forEach(p =>
    p.classList.toggle('selected',
      p.dataset.view === orthoView && Number(p.dataset.side) === orthoSide));

  $('#viewportHint').textContent =
    `2D ${viewName()} · DRAG CARTON · DRAG CORNERS/EDGES TO RESIZE · SCROLL TO ZOOM`;
}

// ============================================================
// CAMERA (3D views)
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateContainerCulling();                // hide walls between camera and interior
  updateResizeHandlesPosition();
  updateDimOverlay();
  updateLiveOverlay();
  updateAnnotations();
  renderer.render(scene, camera);
}

// ============================================================
// LEFT PANEL COLLAPSE — cargo space is a step-one panel, so once the
// container is chosen it folds to a rail and gives its width to the viewport
// ============================================================
const LEFT_COLLAPSED_KEY = 'smartuna_planner_left_collapsed';
const LEFT_PINNED_KEY    = 'smartuna_planner_left_pinned';

let leftCollapsed = false;
// Set once the user reopens the panel by hand. After that we never fold it
// for them again — they have said they want it.
let leftPinned = false;

function setLeftCollapsed(on, remember = true) {
  leftCollapsed = !!on;
  document.querySelector('.workspace').classList.toggle('left-collapsed', leftCollapsed);
  const btn = $('#panelLeftCollapse');
  if (btn) btn.title = leftCollapsed ? 'Show cargo space (Alt+1)' : 'Hide this panel (Alt+1)';
  if (remember) { try { localStorage.setItem(LEFT_COLLAPSED_KEY, leftCollapsed ? '1' : '0'); } catch (e) {} }
  // The viewport just changed width; the renderer has to be told.
  requestAnimationFrame(onResize);
}

function toggleLeftPanel() {
  if (leftCollapsed) {                 // reopening by hand pins it open
    leftPinned = true;
    try { localStorage.setItem(LEFT_PINNED_KEY, '1'); } catch (e) {}
  }
  setLeftCollapsed(!leftCollapsed);
}

// Fold it after the cargo space is applied, but only the first time and only
// if the user has never reopened it themselves.
function autoCollapseLeftPanel() {
  if (leftCollapsed || leftPinned || window.innerWidth <= 1100) return false;
  setLeftCollapsed(true);
  return true;
}

// The rail has room for one line: what the container actually is.
function updateRailSummary() {
  const el = $('#railSummary');
  if (!el || typeof cargoSpace === 'undefined') return;
  el.textContent = `${fromM(cargoSpace.length)} × ${fromM(cargoSpace.width)} × ${fromM(cargoSpace.height)} ${containerUnit}`;
}

function initLeftPanel() {
  try {
    leftPinned    = localStorage.getItem(LEFT_PINNED_KEY) === '1';
    leftCollapsed = localStorage.getItem(LEFT_COLLAPSED_KEY) === '1';
  } catch (e) {}
  if (window.innerWidth <= 1100) leftCollapsed = false;
  setLeftCollapsed(leftCollapsed, false);
  updateRailSummary();
  $('#panelLeftCollapse').addEventListener('click', toggleLeftPanel);
  $('#panelLeftRail').addEventListener('click', toggleLeftPanel);
}

function onResize() {
  const rect = viewport.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  perspCamera.aspect = rect.width / rect.height;
  perspCamera.updateProjectionMatrix();
  renderer.setSize(rect.width, rect.height);
  if (sceneMode === '2d') positionOrthoCamera(orthoView);
}
window.addEventListener('resize', onResize);

function setView(view) {
  if (sceneMode === '2d') {
    positionOrthoCamera(view);
    return;
  }
  last3DView = view;
  const L = cargoSpace.length, W = cargoSpace.width, H = cargoSpace.height;
  const cx = L / 2, cy = H / 2, cz = 0;
  const distFactor = Math.max(L, W * 4, H * 3);
  const targets = {
    perspective: { pos: [cx + distFactor * 0.8, H * 2.5, W * 4.5], target: [cx, cy, cz] },
    top:         { pos: [cx, H + distFactor * 1.4, 0.01],          target: [cx, 0, cz] },
    side:        { pos: [cx, cy, W * 7],                           target: [cx, cy, cz] }
  };
  const t = targets[view] || targets.perspective;
  animateCamera(new THREE.Vector3(...t.pos), new THREE.Vector3(...t.target));
}

function focusOnItem(id) {
  const item = items.find(i => i.id === id);
  if (!item || sceneMode !== '3d') return;
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
  const startPos    = perspCamera.position.clone();
  const startTarget = perspControls.target.clone();
  const duration    = 600;
  const startTime   = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    perspCamera.position.lerpVectors(startPos, newPos, eased);
    perspControls.target.lerpVectors(startTarget, newTarget, eased);
    perspControls.update();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
// ZOOM
// ------------------------------------------------------------
// OrbitControls works its wheel step out from event.deltaY alone and never
// looks at event.deltaMode. A browser is free to report a wheel in lines
// (deltaMode 1, deltaY 3) rather than pixels, and three "pixels" of scroll
// moves the camera by 0.1% — so scrolling appears to do nothing at all, and
// the only views left are wherever the buttons and the view pills put you.
// That is what "only two views" is. So the wheel is read here, in the units
// the browser actually sent.
// ============================================================
// Firefox reports a wheel notch as 3 lines, where Chrome reports 120 px, so
// 40 px a line makes one notch move the same amount in both.
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 400;         // one page
const ZOOM_DECAY     = 0.95;       // per 100 px of scroll, as OrbitControls uses

function wheelPixels(e) {
  const unit = e.deltaMode === 1 ? WHEEL_LINE_PX
             : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  // A free-spinning wheel can report one enormous delta. Capping it keeps a
  // single flick from crossing the whole range in one go.
  return Math.max(-WHEEL_PAGE_PX, Math.min(WHEEL_PAGE_PX, e.deltaY * unit));
}

// px < 0 is a scroll towards the screen, which means closer
function zoomByPixels(px) {
  if (!px) return;
  const factor = Math.pow(ZOOM_DECAY, -px / 100);
  if (sceneMode === '3d') {
    const offset = new THREE.Vector3().subVectors(perspCamera.position, perspControls.target);
    const want = offset.length() * factor;
    const d = Math.max(perspControls.minDistance,
                       Math.min(perspControls.maxDistance, want));
    perspCamera.position.copy(perspControls.target)
      .add(offset.setLength(d));
    perspControls.update();
  } else {
    orthoCamera.zoom = Math.max(0.2, Math.min(10, orthoCamera.zoom / factor));
    orthoCamera.updateProjectionMatrix();
  }
}

function onWheelZoom(e) {
  if (isPacking) return;                 // the scene is mid-animation
  e.preventDefault();
  zoomByPixels(wheelPixels(e));
}

// The +/- buttons move by a fixed share of the current distance, so they step
// the same amount wherever you are. Taking a flat 1.2 m off, as they used to,
// was imperceptible far out and overshot through the target close in.
function dolly(step) {
  zoomByPixels(step > 0 ? -120 : 120);
}

// How near and how far the camera may go, worked out from the container
// rather than fixed. The old 3 m and 45 m were chosen for a 40-footer: in a
// 20-footer, 45 m left the load at a tenth of the viewport and 3 m was close
// enough to be inside it, which is two useless extremes and nothing between.
function updateZoomRange() {
  if (!perspControls) return;
  const span = Math.hypot(cargoSpace.length, cargoSpace.width, cargoSpace.height);
  // Far: the whole container framed with room around it. Near: close enough
  // to read one carton, and never above the distance Focus asks for.
  perspControls.minDistance = Math.max(1.0, span * 0.15);
  perspControls.maxDistance = Math.max(6, span * 2.4);
  // Whatever the camera was doing, bring it inside the new range
  const offset = new THREE.Vector3().subVectors(perspCamera.position, perspControls.target);
  const d = Math.max(perspControls.minDistance,
                     Math.min(perspControls.maxDistance, offset.length()));
  perspCamera.position.copy(perspControls.target).add(offset.setLength(d));
  perspControls.update();
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg) {
  toast.innerHTML = msg;
  toast.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ============================================================
// TEMPLATES
// ============================================================
function loadTemplatesFromStorage() {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    templates = raw ? JSON.parse(raw) : [];
  } catch (e) { templates = []; }
}

function persistTemplates() {
  try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates)); } catch (e) {}
}

function renderTemplateDropdown() {
  const sel = $('#templateSelect');
  sel.innerHTML = '<option value="">— Load a template —</option>' +
    templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  $('#deleteTemplateBtn').hidden = true;
}

function applyTemplate(id) {
  const t = templates.find(x => x.id === id);
  if (!t) return;
  if (t.kind) setKind(t.kind, { autofill: false });
  $('#fProduct').value  = t.product_name || '';
  $('#fLength').value   = fromCm(t.length_cm);
  $('#fWidth').value    = fromCm(t.width_cm);
  $('#fHeight').value   = fromCm(t.height_cm);
  $('#fWeight').value   = t.weight_kg || '';
  $('#fHandling').value = t.handling || 'standard';
  $('#deleteTemplateBtn').hidden = false;
  showToast(`Template <b>${escapeHtml(t.name)}</b> loaded. Add a label and hit Add.`);
}

function openSaveTemplateModal() {
  const L = parseFloat($('#fLength').value);
  const W = parseFloat($('#fWidth').value);
  const H = parseFloat($('#fHeight').value);
  if (!L || !W || !H) return showToast('Fill in dimensions before saving as template.');
  const product = $('#fProduct').value.trim();
  const wt = parseFloat($('#fWeight').value) || 0;
  const handling = $('#fHandling').value;
  $('#tplName').value = product || '';
  $('#tplPreview').textContent = `${L} × ${W} × ${H} ${itemUnit} · ${wt} kg · ${handling}` + (product ? ` · ${product}` : '');
  $('#tplModal').hidden = false;
  setTimeout(() => $('#tplName').focus(), 50);
}

function saveTemplateFromForm() {
  const name = $('#tplName').value.trim();
  if (!name) return showToast('Give the template a name.');
  const L = toCm(parseFloat($('#fLength').value));
  const W = toCm(parseFloat($('#fWidth').value));
  const H = toCm(parseFloat($('#fHeight').value));
  const wt = parseFloat($('#fWeight').value) || 0;
  const handling = $('#fHandling').value;
  const product = $('#fProduct').value.trim();
  if (!L || !W || !H) return showToast('Fill in dimensions first.');
  const tpl = {
    id: 't_' + Math.random().toString(36).slice(2, 10),
    name, length_cm: L, width_cm: W, height_cm: H,
    weight_kg: wt, handling, product_name: product,
    kind: currentKind,
    created_at: new Date().toISOString()
  };
  templates.push(tpl);
  persistTemplates();
  renderTemplateDropdown();
  $('#templateSelect').value = tpl.id;
  $('#deleteTemplateBtn').hidden = false;
  $('#tplModal').hidden = true;
  showToast(`Template <b>${escapeHtml(name)}</b> saved.`);
}

function deleteSelectedTemplate() {
  const id = $('#templateSelect').value;
  if (!id) return;
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;
  if (!confirm(`Delete template "${tpl.name}"?`)) return;
  templates = templates.filter(t => t.id !== id);
  persistTemplates();
  renderTemplateDropdown();
  showToast(`Template deleted.`);
}

// ============================================================
// CUSTOM SELECT — replaces native <select> so the open menu is styled
// The hidden native <select> stays in the DOM, so every existing
// change-handler and .value read/write keeps working unchanged.
// ============================================================
function enhanceSelect(selectEl) {
  if (selectEl.dataset.enhanced === '1') return;
  selectEl.dataset.enhanced = '1';

  const proto = HTMLSelectElement.prototype;
  const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';
  menu.hidden = true;

  const syncTrigger = () => {
    const sel = [...selectEl.options].find(o => o.value === selectEl.value);
    trigger.textContent = sel ? sel.textContent : (selectEl.options[0]?.textContent || '');
    menu.querySelectorAll('.custom-select-option').forEach(item => {
      item.classList.toggle('selected', item.dataset.value === selectEl.value);
    });
  };

  const rebuild = () => {
    menu.innerHTML = '';
    [...selectEl.options].forEach(opt => {
      const item = document.createElement('div');
      item.className = 'custom-select-option';
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      if (opt.value === selectEl.value) item.classList.add('selected');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectEl.value !== opt.value) {
          valueDescriptor.set.call(selectEl, opt.value);
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncTrigger();
        closeMenu();
      });
      menu.appendChild(item);
    });
    syncTrigger();
  };

  const openMenu = () => {
    document.querySelectorAll('.custom-select.open').forEach(cs => {
      if (cs !== wrapper) {
        cs.classList.remove('open');
        cs.querySelector('.custom-select-menu').hidden = true;
      }
    });
    wrapper.classList.add('open');
    menu.hidden = false;
    const sel = menu.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  };

  const closeMenu = () => {
    wrapper.classList.remove('open');
    menu.hidden = true;
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });

  // Intercept programmatic .value assignments so the UI stays in sync
  Object.defineProperty(selectEl, 'value', {
    get() { return valueDescriptor.get.call(this); },
    set(v) { valueDescriptor.set.call(this, v); syncTrigger(); },
    configurable: true
  });

  // If options change (e.g. templates dropdown rebuilt), refresh the menu
  new MutationObserver(() => rebuild()).observe(selectEl, { childList: true });

  // Slot wrapper into the DOM where the select lived
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(trigger);
  wrapper.appendChild(menu);
  wrapper.appendChild(selectEl);
  selectEl.style.display = 'none';

  rebuild();
}

// Click outside → close all open custom-select menus
document.addEventListener('click', () => {
  document.querySelectorAll('.custom-select.open').forEach(cs => {
    cs.classList.remove('open');
    cs.querySelector('.custom-select-menu').hidden = true;
  });
});

// ============================================================
// KEYBOARD SHORTCUTS MODAL
// ============================================================
function renderShortcuts() {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const modKey = isMac ? '⌘' : 'Ctrl';
  const keyboard = [
    { keys: [modKey, 'S'],  desc: 'Save draft' },
    { keys: ['Esc'],        desc: 'Close menu · cancel drag/resize · deselect' },
    { keys: ['Del'],        desc: 'Delete selected carton' },
    { keys: ['R'],          desc: 'Rotate selected item 90°' },
    { keys: ['F'],          desc: 'Flip selected item onto another face' },
    { keys: ['K'],          desc: 'Lock or unlock what is picked — locked cartons cannot be moved' },
    { keys: ['I'],          desc: 'Isolate — fade everything except what you pick, so only it can be clicked' },
    { keys: [modKey, 'D'],  desc: 'Duplicate selected carton' },
    { keys: ['L'],          desc: 'Toggle carton labels' },
    { keys: ['G'],          desc: 'Toggle dimension guides' },
    { keys: ['P'],          desc: 'Auto-pack the plan' },
    { keys: ['2'],          desc: 'Switch to 2D orthographic mode' },
    { keys: ['3'],          desc: 'Switch to 3D perspective mode' },
    { keys: ['Alt', '+', '1'], desc: 'Hide or show the cargo space panel' },
    { keys: ['C'],          desc: 'Show or hide what is inside each carton' },
    { keys: ['←', '→', '↑', '↓'], desc: 'Nudge the selected carton across the floor' },
    { keys: ['Shift', '+', '↑↓'], desc: 'Nudge the selected carton up or down' },
    { keys: ['Alt', '+', 'arrows'], desc: 'Nudge by a fifth of the step' },
    { keys: [modKey, '+', 'A'], desc: 'Select every carton' },
    { keys: [modKey, '+', 'click'], desc: 'Add or remove one carton from the selection' },
    { keys: ['Arrows'],     desc: 'Move every picked carton together, keeping their spacing' },
    { keys: ['?'],          desc: 'Show this shortcuts guide' }
  ];
  const mouse = [
    { keys: ['Left-drag empty'],     desc: 'Orbit scene (3D) or pan (2D)' },
    { keys: ['Left-drag carton'],    desc: 'Move carton — top: X/Z · side: X/Y · front: Y/Z' },
    { keys: ['Drag a picked one'],   desc: 'Drags the whole picked set as one block' },
    { keys: ['Vertical drag (2D)'],  desc: 'Lift a box to stack it (side/front views)' },
    { keys: ['Shift', '+', 'click'], desc: 'Measure the gap to the selected carton' },
    { keys: ['Shift', '+', 'drag'],  desc: 'Orbit even when over a carton' },
    { keys: ['Right-drag'],          desc: 'Orbit (3D) or pan (2D) anywhere' },
    { keys: ['Scroll'],              desc: 'Zoom in / out' },
    { keys: ['Drag handles (2D)'],   desc: 'Resize the selected carton' },
    { keys: [modKey, '+', 'drag'],   desc: 'Move freely — turns off grid and edge snapping' }
  ];
  const rowHtml = ({ keys, desc }) => {
    const keyEls = keys.map(k => k === '+'
      ? '<span class="kbd-plus">+</span>'
      : `<span class="kbd">${escapeHtml(k)}</span>`).join('');
    return `<div class="shortcut-row"><div class="shortcut-keys">${keyEls}</div><div class="shortcut-desc">${escapeHtml(desc)}</div></div>`;
  };
  $('#shortcutsKeyboard').innerHTML = keyboard.map(rowHtml).join('');
  $('#shortcutsMouse').innerHTML    = mouse.map(rowHtml).join('');
}

$('#btnShortcuts').addEventListener('click', () => {
  renderShortcuts();
  $('#shortcutsModal').hidden = false;
});
document.querySelectorAll('[data-close-shortcuts]').forEach(el => {
  el.addEventListener('click', () => $('#shortcutsModal').hidden = true);
});

// ============================================================
// SAVE / LOAD (Supabase)
// ============================================================
// Columns added by later migrations. If a database hasn't had them applied,
// PostgREST rejects the whole insert — so we detect that and retry without
// them rather than failing the save outright.
const OPTIONAL_ITEM_COLS = ['shape', 'max_stack_kg', 'build_spec', 'locked'];

function buildItemsPayload(planId, skip = []) {
  return items.map(i => {
    const row = {
      load_plan_id: planId,
      label: i.label, base_label: i.base_label,
      product_name: i.product_name || null,
      kind: i.kind || 'carton',
      length_cm: i.length_cm, width_cm: i.width_cm, height_cm: i.height_cm,
      weight_kg: i.weight_kg, color: i.color,
      pos_x: i.pos_x, pos_y: i.pos_y, pos_z: i.pos_z, rot_y: i.rot_y,
      handling: i.handling
    };
    if (!skip.includes('shape'))        row.shape = i.shape || 'box';
    if (!skip.includes('max_stack_kg')) row.max_stack_kg = i.max_stack_kg ?? null;
    if (!skip.includes('build_spec'))   row.build_spec = i.build_ref ?? null;
    if (!skip.includes('locked'))       row.locked = !!i.locked;
    return row;
  });
}

// Which optional column, if any, this error is complaining about
function missingColumnFrom(err, candidates) {
  const text = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  if (!/column|schema cache/i.test(text)) return null;
  return candidates.find(col => new RegExp(`\\b${col}\\b`).test(text)) || null;
}

// Supabase errors put the useful part in code/details/hint, not just message
function describeError(err) {
  if (!err) return 'unknown error';
  const bits = [err.message, err.details, err.hint].filter(Boolean);
  const text = bits.join(' · ') || 'unknown error';
  return err.code ? `${text} [${err.code}]` : text;
}

async function savePlan(status) {
  const name = $('#planName').value.trim();
  if (!name) { $('#planName').focus(); showToast('Give the plan a name first.'); return false; }
  const spaceVol = cargoSpace.length * cargoSpace.width * cargoSpace.height * 1000000;
  const itemVol  = items.reduce((s, i) => s + i.length_cm * i.width_cm * i.height_cm, 0);
  const volPct   = spaceVol > 0 ? (itemVol / spaceVol) * 100 : 0;

  const planPayload = {
    name,
    transport_mode: transportMode,
    container_preset: containerPreset,
    space_length_cm: Math.round(cargoSpace.length * 100),
    space_width_cm:  Math.round(cargoSpace.width  * 100),
    space_height_cm: Math.round(cargoSpace.height * 100),
    status,
    total_items: items.length,
    volume_utilization: Number(volPct.toFixed(2)),
    weight_utilization: null
  };

  showToast('Saving…');
  try {
    let planRow;
    let oldItemIds = [];

    if (currentPlanId) {
      const { data, error } = await supabase.from('load_plans').update(planPayload).eq('id', currentPlanId).select().single();
      if (error) throw error;
      planRow = data;
      // Note which rows the old version owns, but don't remove them yet —
      // see below.
      const { data: existing, error: exErr } = await supabase
        .from('load_plan_items').select('id').eq('load_plan_id', currentPlanId);
      if (exErr) throw exErr;
      oldItemIds = (existing || []).map(r => r.id);
    } else {
      const { data, error } = await supabase.from('load_plans').insert(planPayload).select().single();
      if (error) throw error;
      planRow = data;
      currentPlanId = planRow.id;
    }

    let insertedItems = [];
    if (items.length > 0) {
      // Retry without any column the database doesn't have, so a planner
      // running ahead of its migrations still saves.
      const skip = [];
      let iErr = null;
      for (let attempt = 0; attempt <= OPTIONAL_ITEM_COLS.length; attempt++) {
        const res = await supabase
          .from('load_plan_items')
          .insert(buildItemsPayload(currentPlanId, skip))
          .select('id');
        if (!res.error) { insertedItems = res.data || []; iErr = null; break; }
        iErr = res.error;
        const missing = missingColumnFrom(res.error, OPTIONAL_ITEM_COLS.filter(c => !skip.includes(c)));
        if (!missing) break;
        skip.push(missing);
        console.warn(`load_plan_items has no "${missing}" column — saving without it. Run the matching migration to keep this data.`);
      }
      if (iErr) throw iErr;
      if (skip.length) {
        showToast(`Saved, but <b>${skip.join(', ')}</b> not stored — run the pending migration.`);
      }

      // Carton-builder contents — rows come back in insert order, so we can
      // zip them against the local items to get each new row's id.
      if (insertedItems && insertedItems.length === items.length) {
        const contentsPayload = [];
        items.forEach((it, idx) => {
          if (!it.contents || !it.contents.length) return;
          it.contents.forEach(c => contentsPayload.push({
            load_plan_item_id: insertedItems[idx].id,
            product_name: c.product_name || null,
            batch_lot: c.batch_lot || null,
            medium: c.medium || null,
            quantity: c.quantity || 0
          }));
        });
        if (contentsPayload.length) {
          const { error: cErr } = await supabase
            .from('load_plan_item_contents').insert(contentsPayload);
          if (cErr) console.warn('Contents save failed:', cErr);
        }
      }
    }

    // Only now that the new rows are safely in does the old version go.
    // Deleting first meant a failed insert left the plan empty in the
    // database with no way back.
    if (oldItemIds.length) {
      const { error: delErr } = await supabase
        .from('load_plan_items').delete().in('id', oldItemIds);
      if (delErr) throw delErr;
    }

    planStatus = planRow.status;
    markClean();

    const url = new URL(window.location);
    url.searchParams.set('plan', currentPlanId);
    window.history.replaceState({}, '', url);

    showToast(`Plan <b>${escapeHtml(name)}</b> ${status === 'published' ? 'published' : 'saved'}.`);
    return true;
  } catch (err) {
    // Log the fields individually — a bare object logs as "Object" in Chrome
    console.error('Save failed:', describeError(err), {
      message: err?.message, code: err?.code, details: err?.details, hint: err?.hint
    });
    showToast(`Save failed: ${escapeHtml(describeError(err))}`);
    return false;
  }
}

async function loadPlan(planId) {
  showToast('Loading plan…');
  try {
    const { data: plan, error: pErr } = await supabase.from('load_plans').select('*').eq('id', planId).is('deleted_at', null).single();
    if (pErr || !plan) throw pErr || new Error('Plan not found');

    const { data: dbItems, error: iErr } = await supabase.from('load_plan_items').select('*').eq('load_plan_id', planId).order('created_at');
    if (iErr) throw iErr;

    // Carton-builder contents for these items, grouped by item id
    const contentsByItem = {};
    if (dbItems && dbItems.length) {
      const { data: dbContents } = await supabase
        .from('load_plan_item_contents')
        .select('*')
        .in('load_plan_item_id', dbItems.map(i => i.id));
      (dbContents || []).forEach(c => {
        (contentsByItem[c.load_plan_item_id] ||= []).push({
          product_name: c.product_name,
          batch_lot: c.batch_lot,
          medium: c.medium,
          quantity: c.quantity
        });
      });
    }

    clearScene();
    currentPlanId = plan.id;
    planStatus = plan.status || 'draft';

    $('#planName').value = plan.name || '';
    cargoSpace = {
      length: Number(plan.space_length_cm) / 100,
      width:  Number(plan.space_width_cm)  / 100,
      height: Number(plan.space_height_cm) / 100
    };
    transportMode = plan.transport_mode || 'Sea';
    containerPreset = plan.container_preset || 'Custom';

    $('#dimLength').value = fromM(cargoSpace.length);
    $('#dimWidth').value  = fromM(cargoSpace.width);
    $('#dimHeight').value = fromM(cargoSpace.height);
    $('#presetSelect').value = PRESETS[containerPreset] ? containerPreset : 'Custom';
    updateSceneDimsDisplay();
    $('#sceneMode').textContent = MODE_LABELS[transportMode] || 'SEA';
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === transportMode));

    buildContainer();

    (dbItems || []).forEach(it => {
      restoreItem({
        label: it.label,
        base_label: it.base_label || it.label,
        product_name: it.product_name || '',
        kind: it.kind,
        length_cm: it.length_cm, width_cm: it.width_cm, height_cm: it.height_cm,
        weight_kg: it.weight_kg, handling: it.handling,
        color: it.color || CARGO_COLORS[0],
        shape: it.shape || 'box',
        max_stack_kg: it.max_stack_kg ?? null,
        rot_y: it.rot_y || 0,
        pos_x: it.pos_x, pos_y: it.pos_y, pos_z: it.pos_z,
        contents: contentsByItem[it.id] || null,
        build_spec: it.build_spec || null
      });
    });

    recomputeBatchCounter();
    updateStats();
    renderCargoList();
    refreshAllContents();
    setEditMode(false, null);
    markClean();

    const url = new URL(window.location);
    url.searchParams.set('plan', currentPlanId);
    window.history.replaceState({}, '', url);

    if (sceneMode === '3d') setView('perspective');
    else positionOrthoCamera(orthoView);

    showToast(`Loaded <b>${escapeHtml(plan.name)}</b>.`);
  } catch (err) {
    console.error('Load failed:', err);
    showToast(`Load failed: ${err.message || 'not found'}`);
  }
}

function newPlan() {
  if (isDirty && !confirm('Discard unsaved changes and start a new plan?')) return;
  clearScene();
  currentPlanId = null;
  planStatus = 'draft';
  $('#planName').value = '';
  updateStats();
  renderCargoList();
  setEditMode(false, null);
  isDirty = false;
  updateStatusChip();
  const url = new URL(window.location);
  url.searchParams.delete('plan');
  window.history.replaceState({}, '', url);
  showToast('New plan started.');
  setTimeout(() => $('#planName').focus(), 100);
}

async function openPlansModal() {
  const modal = $('#plansModal');
  const listEl = $('#plansList');
  modal.hidden = false;
  listEl.innerHTML = '<div class="plans-empty">Loading…</div>';
  try {
    const { data, error } = await supabase.from('load_plans').select('*').is('deleted_at', null).order('updated_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) {
      listEl.innerHTML = '<div class="plans-empty">No saved plans yet. Create your first one.</div>';
      return;
    }
    listEl.innerHTML = data.map(p => {
      const updated = p.updated_at ? new Date(p.updated_at).toLocaleString() : '—';
      const itemsN = p.total_items || 0;
      const util = p.volume_utilization != null ? `${Number(p.volume_utilization).toFixed(1)}%` : '—';
      const isCurrent = p.id === currentPlanId;
      return `
        <div class="plan-row ${isCurrent ? 'current' : ''}" data-id="${p.id}">
          <div class="plan-meta">
            <b>${escapeHtml(p.name)}</b>
            <small>${itemsN} items · ${util} filled · updated ${updated}</small>
          </div>
          <span class="plan-badge ${p.status}">${p.status}</span>
          <div class="plan-actions">
            <button data-action="open" data-id="${p.id}">${isCurrent ? 'Reload' : 'Open'}</button>
            <button data-action="delete" data-id="${p.id}" class="danger">Delete</button>
          </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (btn.dataset.action === 'open') {
          modal.hidden = true;
          await loadPlan(id);
        } else {
          const row = data.find(r => r.id === id);
          if (!confirm(`Delete plan "${row?.name}"? Soft delete (30-day trash).`)) return;
          const { error } = await supabase.from('load_plans').update({ deleted_at: new Date().toISOString() }).eq('id', id);
          if (error) return showToast(`Delete failed: ${error.message}`);
          showToast('Plan moved to trash.');
          if (id === currentPlanId) newPlan();
          openPlansModal();
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="plans-empty">Failed to load plans: ${escapeHtml(err.message || 'unknown')}</div>`;
  }
}

// ============================================================
// UI WIRING
// ============================================================
$$('.mode-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.mode-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  transportMode = btn.dataset.mode;
  $('#sceneMode').textContent = MODE_LABELS[transportMode];
  markDirty();
}));

function applyPresetToInputs(key) {
  const p = PRESETS[key];
  if (!p) return;
  $('#dimLength').value = fromM(p.length);
  $('#dimWidth').value  = fromM(p.width);
  $('#dimHeight').value = fromM(p.height);
}
$('#presetSelect').addEventListener('change', e => {
  containerPreset = e.target.value;
  applyPresetToInputs(e.target.value);
});

$('#applyDimensions').addEventListener('click', () => {
  const L = toM(parseFloat($('#dimLength').value));
  const W = toM(parseFloat($('#dimWidth').value));
  const H = toM(parseFloat($('#dimHeight').value));
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) return showToast(`Enter valid positive dimensions in ${containerUnit}.`);
  cargoSpace = { length: L, width: W, height: H };
  buildContainer();
  updateSceneDimsDisplay();
  if (sceneMode === '3d') {
    $$('.view-pills-3d .view-pill').forEach(p => p.classList.toggle('selected', p.dataset.view === 'perspective'));
    setView('perspective');
  } else {
    positionOrthoCamera(orthoView);
  }
  markDirty();
  updateRailSummary();
  const tucked = autoCollapseLeftPanel();
  showToast(`<b>Cargo space</b> updated to ${fromM(L)} × ${fromM(W)} × ${fromM(H)} ${containerUnit}.` +
    (tucked ? ' Panel tucked away — click the rail to bring it back.' : ''));
});

$('#planName').addEventListener('input', () => markDirty());

// Scene mode toggle
$$('.scene-toggle-btn').forEach(btn => btn.addEventListener('click', () => setSceneMode(btn.dataset.scene)));

// View pills — 3D
$$('.view-pills-3d .view-pill').forEach(pill => pill.addEventListener('click', () => {
  $$('.view-pills-3d .view-pill').forEach(p => p.classList.remove('selected'));
  pill.classList.add('selected');
  setView(pill.dataset.view);
}));

// View pills — 2D
$$('.view-pills-2d .view-pill').forEach(pill => pill.addEventListener('click', () => {
  positionOrthoCamera(pill.dataset.view, Number(pill.dataset.side) || 1);
}));

// ---- isolate, resize steppers, slip sheet ----
$('#toggleIsolate')?.addEventListener('click', () => setIsolate(!isolateOn));

$('#resizeStep')?.addEventListener('change', e => {
  resizeStepCm = Number(e.target.value) || 1;
});

$$('[data-resize]').forEach(btn => btn.addEventListener('click', () => {
  const m = /^([lwh])(-?\d+)$/.exec(btn.dataset.resize);
  if (m) resizeSelected(m[1], Number(m[2]) > 0 ? 1 : -1);
}));

// Works on the whole picked set, so sheeting a packed container is one click
// rather than one click for every carton. Reachable from the inspector and
// from the selection bar, because building a selection happens in the list
// and the inspector is not open while you do it.
const slipPicked = () =>
  slipSheetUnder(selectionTotals().picked.filter(i => i.kind !== 'slipsheet'));
$('#btnSlipSheet')?.addEventListener('click', slipPicked);
$('#selSlip')?.addEventListener('click', slipPicked);

// ---- position numbering ----
function renderAddressingControls() {
  const from = $('#addrFrom'), bay = $('#addrBay'), row = $('#addrRow');
  // enhanceSelect intercepts .value, so the styled trigger follows along
  if (from) from.value = addressing.from;
  if (bay) bay.value = addressing.bay_cm;
  if (row) row.value = addressing.row_cm;
  const legend = $('#addrLegend');
  if (legend) legend.textContent = addressLegend();
}

function onAddressingChange() {
  addressing.from   = $('#addrFrom')?.value || addressing.from;
  addressing.bay_cm = +$('#addrBay')?.value || addressing.bay_cm;
  addressing.row_cm = +$('#addrRow')?.value || addressing.row_cm;
  normaliseAddressing();
  saveAddressing();
  renderAddressingControls();
  renderCargoList();
  renderEditStrip();
  markDirty();
}
['#addrFrom', '#addrBay', '#addrRow'].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener('change', onAddressingChange);
});

$('#zoomIn').addEventListener('click',  () => dolly( 1.2));
$('#zoomOut').addEventListener('click', () => dolly(-1.2));
$('#resetView').addEventListener('click', () => {
  if (sceneMode === '3d') {
    $$('.view-pills-3d .view-pill').forEach(p => p.classList.toggle('selected', p.dataset.view === 'perspective'));
    setView('perspective');
  } else {
    positionOrthoCamera('top');
  }
});

$('#toggleLabels').addEventListener('click', () => {
  showLabels = !showLabels;
  $('#toggleLabels').classList.toggle('active', showLabels);
  hoveredItemId = null;                  // clear any stale hover state
  updateLabelVisibility();
  showToast(showLabels ? 'Labels shown on <b>hover</b>.' : 'Labels <b>off</b>.');
});

$('#gridStep').addEventListener('change', e => setGridStep(e.target.value));
$('#snapStep').addEventListener('change', e => setSnapStep(e.target.value));
$('#measureClose').addEventListener('click', clearMeasurement);

$('#toggleDims').addEventListener('click', () => {
  showDims = !showDims;
  $('#toggleDims').classList.toggle('active', showDims);
  try { localStorage.setItem(DIMS_MODE_KEY, showDims ? '1' : '0'); } catch (e) {}
  showToast(showDims ? 'Dimension guides <b>on</b>.' : 'Dimension guides <b>off</b>.');
});

$('#toggleRealistic').addEventListener('click', () => {
  realisticMode = !realisticMode;
  $('#toggleRealistic').classList.toggle('active', realisticMode);
  try { localStorage.setItem(REALISTIC_MODE_KEY, realisticMode ? '1' : '0'); } catch (e) {}
  buildContainer();                              // rebuild with the new style
  showToast(realisticMode ? 'Realistic view <b>on</b>.' : 'Realistic view <b>off</b>.');
});

$('#fQtyMinus').addEventListener('click', () => {
  if (selectedItemId) return;
  quantity = Math.max(1, quantity - 1);
  $('#fQty').textContent = quantity;
});
$('#fQtyPlus').addEventListener('click', () => {
  if (selectedItemId) return;
  quantity = Math.min(500, quantity + 1);
  $('#fQty').textContent = quantity;
});


$('#primaryFormBtn').addEventListener('click', addNewItems);
$('#inspectSave').addEventListener('click', updateSelectedItem);
// Back closes the inspector and returns to the list. It deliberately keeps
// anything ticked for the selection total: the tick boxes only exist on the
// list, so wiping them on the way back would make a total impossible to build.
$('#inspectBack').addEventListener('click', () => {
  if (multiSelect.size) {
    setEditMode(false, null);
    setPanelTab('items');
    renderCargoList();
    renderEditStrip();
  } else {
    deselectAll();
  }
});

function readFormValues() {
  return {
    labelInput:   $('#fLabel').value.trim(),
    productInput: $('#fProduct').value.trim(),
    L:  toCm(parseFloat($('#fLength').value)),
    W:  toCm(parseFloat($('#fWidth').value)),
    H:  toCm(parseFloat($('#fHeight').value)),
    wt: parseFloat($('#fWeight').value) || 0,
    handling: $('#fHandling').value,
    kind: currentKind,
    shape: currentShape,
    maxStack: parseFloat($('#fMaxStack').value) || null
  };
}

// Shape picker — round shapes mirror W to L so the diameter stays square
function setShape(shape, opts = {}) {
  currentShape = SHAPES[shape] ? shape : 'box';
  $$('.shape-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === currentShape));
  const hint = $('#shapeHint');
  if (hint) hint.textContent = SHAPES[currentShape].round ? 'L is the diameter' : '';
  if (opts.mirror !== false && SHAPES[currentShape].round) {
    const l = parseFloat($('#fLength').value);
    if (!isNaN(l)) $('#fWidth').value = $('#fLength').value;
  }
  updateOptionsSummary();
  refreshSegments();
}

function validateFormDims(L, W, H) {
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) { showToast('Enter valid carton dimensions in cm.'); return false; }
  if (L > cargoSpace.length * 100 || W > cargoSpace.width * 100 || H > cargoSpace.height * 100) {
    showToast('Carton is larger than the cargo space.'); return false;
  }
  return true;
}

function addNewItems() {
  const { labelInput, productInput, L, W, H, wt, handling, kind, shape, maxStack } = readFormValues();
  if (!validateFormDims(L, W, H)) return;
  const baseLabel = labelInput || generateBaseLabel(kind);
  const color = kind === 'carton' ? pickColorForBase(baseLabel) : KIND_COLORS[kind];
  let last;
  for (let n = 0; n < quantity; n++) {
    const suffix = quantity > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
    last = addItem({
      label: baseLabel + suffix, base_label: baseLabel,
      product_name: productInput,
      kind, shape, max_stack_kg: maxStack,
      length_cm: L, width_cm: W, height_cm: H,
      weight_kg: wt, handling, color
    });
  }
  updateStats();
  renderCargoList();
  showToast(`Added <b>${quantity}</b> ${quantity > 1 ? 'items' : 'item'}${labelInput ? ' of ' + escapeHtml(baseLabel) : ''}.`);
  // Full form reset — use templates for reusable specs
  $('#fLabel').value = '';
  $('#fProduct').value = '';
  $('#fLength').value = '';
  $('#fWidth').value = '';
  $('#fHeight').value = '';
  $('#fWeight').value = '';
  $('#fHandling').value = 'standard';
  $('#fMaxStack').value = '';
  $('#templateSelect').value = '';
  $('#deleteTemplateBtn').hidden = true;
  setKind('carton');                     // back to Carton for the next add
  setShape('box', { mirror: false });
  quantity = 1;
  $('#fQty').textContent = 1;
  $('#fLabel').focus();
}

function updateSelectedItem() {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const { labelInput, productInput, L, W, H, wt, handling, shape, maxStack } = readFormValues();
  if (!validateFormDims(L, W, H)) return;
  const shapeChanged = (item.shape || 'box') !== shape;
  if (labelInput && labelInput !== item.base_label) {
    item.base_label = labelInput;
    item.label = labelInput;
    const twin = items.find(i => i.id !== item.id && i.base_label === labelInput);
    if (twin) item.color = twin.color;
  }
  item.product_name = productInput;
  item.length_cm = L; item.width_cm = W; item.height_cm = H;
  item.weight_kg = wt; item.handling = handling;
  item.shape = normaliseShape(item.kind, shape);
  item.max_stack_kg = maxStack;
  if (shapeChanged) rebuildItemMesh(item);
  item.mesh.material.color.set(item.color);
  clampItemToBounds(item);
  refreshItemMesh(item);
  refreshItemSprite(item);
  settleAll();
  updateStats();
  renderCargoList();
  renderEditStrip();
  markDirty();
  showToast(`Updated <b>${escapeHtml(item.label)}</b>.`);
}

// ---- nudge pad ----
$$('#nudgeBlock [data-nudge]').forEach(btn => btn.addEventListener('click', () => {
  const code = btn.dataset.nudge;                    // e.g. "x-1", "z1", "y1"
  const axis = code[0];
  const dir  = Number(code.slice(1));
  nudgeSelected(axis, dir);
}));
$('#nudgeStep').addEventListener('change', e => {
  nudgeStepCm = parseFloat(e.target.value) || 5;
  try { localStorage.setItem(NUDGE_STEP_KEY, String(nudgeStepCm)); } catch (err) {}
});

// ---- carton contents ----
function setShowContents(on) {
  showContents = !!on;
  try { localStorage.setItem(SHOW_CONTENTS_KEY, showContents ? '1' : '0'); } catch (e) {}
  refreshAllContents();
}
$('#toggleContents').addEventListener('click', () => setShowContents(!showContents));

// ---- selection summary ----
$('#selColor').addEventListener('input', e => applyColorToPicked(e.target.value));
$('#selClear').addEventListener('click', deselectAll);
$('#selFocus').addEventListener('click', () => {
  const t = selectionTotals();
  if (t.picked.length) focusOnItems(t.picked);
});

// Frame a whole selection rather than a single item
function focusOnItems(list) {
  if (!list.length) return;
  if (list.length === 1) return focusOnItem(list[0].id);
  const box = new THREE.Box3();
  list.forEach(i => { if (i.mesh) box.expandByObject(i.mesh); });
  if (box.isEmpty()) return;
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
  controls.target.copy(centre);
  const dir = new THREE.Vector3().subVectors(camera.position, centre).normalize();
  camera.position.copy(centre).add(dir.multiplyScalar(radius * 2.6));
  controls.update();
}

// ============================================================
// WHERE A CARTON IS — the address
// ------------------------------------------------------------
// There is no industry standard for naming a position inside a container.
// Bay/row/tier exists, but for whole containers on a ship, not for what is
// packed inside one. So the planner defines its own, and prints the rule
// next to the numbers so two parties cannot read them differently.
//
//   Bay  — how far in from the datum end, in slices of bay_cm
//   Row  — across the width, in slices of row_cm
//   Tier — how many cartons are underneath this one, plus one
//
// Bay and row come off a fixed grid because the floor is fixed and a grid
// renumbers predictably. Tier is counted rather than measured, because
// carton heights vary and "second one up" is what a person actually means.
//
// The exact centimetres stay the source of truth. This is the label on top.
// ============================================================
const ADDRESSING_DEFAULTS = { bay_cm: 100, row_cm: 80, from: 'doors' };
let addressing = { ...ADDRESSING_DEFAULTS };

function loadAddressing() {
  try {
    const raw = JSON.parse(localStorage.getItem(ADDRESSING_KEY));
    if (raw) addressing = { ...ADDRESSING_DEFAULTS, ...raw };
  } catch (e) { addressing = { ...ADDRESSING_DEFAULTS }; }
  normaliseAddressing();
}

function normaliseAddressing() {
  const n = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
  addressing.bay_cm = n(addressing.bay_cm, ADDRESSING_DEFAULTS.bay_cm);
  addressing.row_cm = n(addressing.row_cm, ADDRESSING_DEFAULTS.row_cm);
  if (addressing.from !== 'nose') addressing.from = 'doors';
}

function saveAddressing() {
  try { localStorage.setItem(ADDRESSING_KEY, JSON.stringify(addressing)); } catch (e) {}
}

// The doors are at the far end of the length axis, and someone standing in
// them looking in has +Z on their right. Both facts are needed to turn a
// measurement into something a person can act on.
const DOORS_AT_FAR_END = true;

function addressLegend() {
  const end = addressing.from === 'doors' ? 'the doors' : 'the closed end';
  return `Bay 1 at ${end}, counting inwards · Row 1 on the left as you look in from the doors · Tier 1 on the floor`;
}

// One carton's address. `ext` is the extent lookup so a whole-list pass does
// not measure every carton again for every other carton.
function computeAddress(item, list, ext) {
  const a = ext.get(item.id);
  const L = cargoSpace.length * 100;
  const along = addressing.from === 'doors' && DOORS_AT_FAR_END
    ? L - item.pos_x : item.pos_x;
  const bay = Math.max(1, Math.floor(along / addressing.bay_cm) + 1);
  const row = Math.max(1, Math.floor(item.pos_z / addressing.row_cm) + 1);

  // Underneath means: overlapping this carton's footprint, and topping out at
  // or below its base. A 1 cm slack keeps touching faces from reading as a
  // miss, and keeps a neighbour alongside from reading as a hit.
  let below = 0;
  list.forEach(other => {
    if (other.id === item.id) return;
    const b = ext.get(other.id);
    const overX = Math.min(item.pos_x + a.l / 2, other.pos_x + b.l / 2)
                - Math.max(item.pos_x - a.l / 2, other.pos_x - b.l / 2);
    const overZ = Math.min(item.pos_z + a.w / 2, other.pos_z + b.w / 2)
                - Math.max(item.pos_z - a.w / 2, other.pos_z - b.w / 2);
    if (overX <= 1 || overZ <= 1) return;
    if (other.pos_y + b.h / 2 <= item.pos_y - a.h / 2 + 1) below++;
  });

  const tier = below + 1;
  return { bay, row, tier, text: `B${bay}·R${row}·T${tier}` };
}

// Every address in one pass, for the list and the plan sheet
function addressesFor(list = items) {
  const ext = new Map(list.map(i => [i.id, itemExtent(i)]));
  return new Map(list.map(i => [i.id, computeAddress(i, list, ext)]));
}

// Just one, for the inspector. Worked out fresh every time rather than
// cached: a cached address that is one drag out of date is worse than none.
function addressOf(item) {
  if (!item) return null;
  const ext = new Map(items.map(i => [i.id, itemExtent(i)]));
  return computeAddress(item, items, ext);
}

// ============================================================
// WHAT IS INSIDE A CARTON
// ------------------------------------------------------------
// A carton from the Carton Builder arrives knowing its own contents, because
// the build says what went in. A carton added by hand starts empty — and an
// empty carton cannot be traced to a lot, which is most of the point. This is
// where the product, the batch and the count go in afterwards.
//
// Builder cartons stay read-only here: their list is worked out from the
// build, so editing it would disagree with the units drawn inside them.
// ============================================================
// The add-row while it is open, kept outside the markup so a re-render
// somewhere else in the inspector cannot quietly throw away what was typed.
let contentDraft = null;           // { itemId, product, lot, medium, qty }

const itemUnits = item =>
  (item.contents || []).reduce((s, c) => s + (Number(c.quantity) || 0), 0);

// A carton is the builder's if it carries the build it was made from
const isBuilt = item => !!(item?.build_ref || item?.pallet_meta);

function renderInspContents(item) {
  const box = $('#inspContents');
  if (!box) return;
  if (!item) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const rows  = item.contents || [];
  const total = itemUnits(item);
  const t     = item.terms || TERM_DEFAULTS;
  const word  = pluralise(t.product || 'unit', total).toLowerCase();
  const built = isBuilt(item);
  const pm    = item.pallet_meta;
  const draft = contentDraft?.itemId === item.id ? contentDraft : null;

  const head = `<div class="ic-head"><span>Inside</span>${
    total ? `<b>${total} ${escapeHtml(word)}</b>` : '<b class="ic-none">empty</b>'}</div>`;

  const body = rows.length
    ? rows.map((c, n) => `
        <div class="ic-row" data-crow="${n}">
          <div>
            <b>${escapeHtml(c.product_name || 'Unnamed')}</b>
            ${c.medium ? `<span class="ic-medium">in ${escapeHtml(c.medium)}</span>` : ''}
            ${c.batch_lot ? `<span class="ic-lot">${escapeHtml(c.batch_lot)}</span>` : ''}
          </div>
          <span class="ic-qty">${c.quantity || 0}</span>
          ${built ? '' : `<button type="button" class="ic-del" data-del="${n}"
                 title="Take this product out of the carton">✕</button>`}
        </div>`).join('')
    : `<div class="ic-empty">${built
        ? 'This build records no units.'
        : 'Nothing recorded inside yet. Add the product and batch, and this carton can be traced back to a lot.'}</div>`;

  // Where the numbers came from, or what is still missing for the totals
  const notes = [];
  if (pm) notes.push(`${pm.trays} ${escapeHtml(pluralise(t.primary || 'pack', pm.trays).toLowerCase())}` +
    ` · ${pm.per_layer} per layer × ${pm.layers} layers` +
    `${pm.order_no ? ` · order ${escapeHtml(pm.order_no)}` : ''}` +
    `${pm.packer ? ` · packed by ${escapeHtml(pm.packer)}` : ''}`);
  if (built) notes.push('Set by the Carton Builder build, so it is not edited here.');
  else if (total && item.weight_kg > 0)
    notes.push(`${item.weight_kg} kg over ${total} ${escapeHtml(word)} is ` +
      `<b>${(item.weight_kg / total).toFixed(3)} kg</b> each.`);
  else if (total)
    notes.push('This carton still weighs 0 kg. Put its weight in above, or the load totals will be short.');

  const form = built ? '' : (draft ? `
    <div class="ic-form">
      <label class="field">
        <span>Product</span>
        <input id="icProduct" type="text" placeholder="Tuna in olive oil"
               value="${escapeHtml(draft.product)}" />
      </label>
      <div class="form-row">
        <label class="field combo" data-term="lot">
          <span>Batch / lot</span>
          <input id="icLot" type="text" placeholder="L2451" autocomplete="off"
                 value="${escapeHtml(draft.lot)}" />
          <div class="combo-menu" hidden></div>
        </label>
        <label class="field">
          <span>Packed in</span>
          <input id="icMedium" type="text" placeholder="Olive oil"
                 value="${escapeHtml(draft.medium)}" />
        </label>
      </div>
      <div class="ic-form-foot">
        <label class="field ic-qty-field">
          <span>How many</span>
          <input id="icQty" type="number" min="1" step="1" value="${escapeHtml(draft.qty)}" />
        </label>
        <button type="button" class="btn-primary" id="icSave">Add</button>
        <button type="button" class="btn-soft" id="icCancel">Cancel</button>
      </div>
    </div>`
    : `<button type="button" class="ic-add" id="icOpen">+ Add product or units</button>`);

  box.innerHTML = head + body +
    notes.map(n => `<div class="ic-note">${n}</div>`).join('') + form;

  if (built) return;

  const open = $('#icOpen');
  if (open) open.addEventListener('click', () => {
    // The carton's own product name is the likely answer, so it starts there
    contentDraft = { itemId: item.id, product: item.product_name || '',
                     lot: '', medium: '', qty: '1' };
    renderInspContents(item);
    $('#icQty')?.select();
  });

  const cancel = $('#icCancel');
  if (cancel) cancel.addEventListener('click', () => {
    contentDraft = null;
    renderInspContents(item);
  });

  const lot = $('#icLot');
  if (lot) initTermCombo(lot, knownBatchCodes, () => { if (draft) draft.lot = lot.value; });

  const save = $('#icSave');
  if (save) {
    const commit = () => addContentRow(item);
    save.addEventListener('click', commit);
    const fields = { icProduct: 'product', icLot: 'lot', icMedium: 'medium', icQty: 'qty' };
    box.querySelectorAll('.ic-form input').forEach(el => {
      el.addEventListener('input', () => { if (draft) draft[fields[el.id]] = el.value; });
      // Enter anywhere in the little form adds the row, Escape backs out
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
      });
    });
  }

  box.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => removeContentRow(item, +btn.dataset.del)));
}

function addContentRow(item) {
  const qty = Math.max(0, Math.round(Number($('#icQty')?.value) || 0));
  if (!qty) return showToast('How many of them? Put a count in first.');
  const product = ($('#icProduct')?.value || '').trim();
  const medium  = ($('#icMedium')?.value || '').trim();
  const lot     = normaliseBatchCode($('#icLot')?.value || '');

  item.contents = item.contents || [];
  // The same product and lot going in twice is one line with a bigger count,
  // not two lines that have to be added up by eye.
  const same = item.contents.find(c =>
    (c.product_name || '') === product &&
    (c.batch_lot || '')    === (lot || '') &&
    (c.medium || '')       === (medium || ''));
  if (same) same.quantity = (Number(same.quantity) || 0) + qty;
  else item.contents.push({
    product_name: product, batch_lot: lot || null,
    medium: medium || null, quantity: qty
  });

  if (lot) rememberBatchCode(lot);
  // A carton with no product name of its own takes the one just typed, so the
  // list and the labels say something useful
  if (product && !item.product_name) {
    item.product_name = product;
    const pf = $('#fProduct');
    if (pf && selectedItemId === item.id) pf.value = product;
  }
  contentDraft = null;
  afterContentsChange(item);
  showToast(`Added <b>${qty}</b>${product ? ' × ' + escapeHtml(product) : ''}${
    lot ? ' · ' + escapeHtml(lot) : ''}.`);
}

function removeContentRow(item, n) {
  if (!item.contents || !item.contents[n]) return;
  const [gone] = item.contents.splice(n, 1);
  if (!item.contents.length) item.contents = null;
  afterContentsChange(item);
  showToast(`Took out <b>${gone.quantity || 0}</b>${
    gone.product_name ? ' × ' + escapeHtml(gone.product_name) : ''}.`);
}

// One place to put the list, the row, the totals and the scene back in step
function afterContentsChange(item) {
  item.build = undefined;              // contents changed, so any cache is stale
  renderInspContents(item);
  renderCargoList();
  renderSelectionSummary();
  refreshAllContents();
  markDirty();
}

// ============================================================
// RESIZE BY THE NUMBER
// ------------------------------------------------------------
// The drag handles only exist in 2D, and dragging a handle in a packed
// container is a fight. These change one dimension by an exact step, in
// either view, and read in whatever unit the inspector is showing.
// ============================================================
const RESIZE_DIMS = { l: 'length_cm', w: 'width_cm', h: 'height_cm' };
let resizeStepCm = 1;

function resizeSelected(dim, dir, step = resizeStepCm) {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return false;
  if (item.locked) { showToast('That carton is locked. Unlock it to resize it.'); return false; }
  const prop = RESIZE_DIMS[dim];
  if (!prop) return false;

  const before = Number(item[prop]) || 0;
  // Which world axis this dimension currently lies along, so the limit is the
  // one it would actually run into
  const o = ORIENTATIONS[item.rot_y] || ORIENTATIONS[0];
  const axis = ['x', 'y', 'z'].find(a => o[a] === prop);
  const limit = axis === 'x' ? cargoSpace.length * 100
              : axis === 'y' ? cargoSpace.height * 100
              : cargoSpace.width * 100;

  const next = Math.min(limit, Math.max(MIN_SIZE_CM,
    Math.round((before + dir * step) * 100) / 100));
  if (Math.abs(next - before) < 0.001) {
    showToast(dir > 0 ? 'That is as big as the space allows.'
                      : `Nothing smaller than ${MIN_SIZE_CM} cm.`);
    return false;
  }

  item[prop] = next;
  // Growing taller grows upward from where it rests, rather than sinking the
  // base into whatever is underneath. Length and width grow about the centre.
  if (axis === 'y') item.pos_y += (next - before) / 2;

  clampItemToBounds(item);
  refreshItemMesh(item);
  refreshItemSprite(item);
  settleAll();
  evaluateStability();
  updateStats();
  refreshPositionReadouts();
  populateFormFromItem(item);
  markDirty();
  return true;
}

function renderResizeReadout() {
  const item = items.find(i => i.id === selectedItemId);
  Object.entries(RESIZE_DIMS).forEach(([dim, prop]) => {
    const el = $(`#rs${dim.toUpperCase()}`);
    if (el) el.textContent = item ? `${fromCm(item[prop])} ${itemUnit}` : '—';
  });
}

// ============================================================
// SLIPPING A SHEET UNDERNEATH
// ------------------------------------------------------------
// Remembering the slip sheets after the container is packed used to mean
// dragging a 1 cm sheet into a gap that is not there, then lifting every
// carton above it by hand. This puts a sheet in under whatever is picked and
// leaves the lifting to the settle pass, which is what it is already for.
// ============================================================
const SHEET_THICKNESS_CM = 1;

function slipSheetUnder(list) {
  if (!list.length) { showToast('Pick a carton first.'); return []; }

  const roof = cargoSpace.height * 100;
  const made = [];
  const tooTall = [];
  const pinned = [];

  list.forEach(item => {
    const e = itemExtent(item);
    const base = item.pos_y - e.h / 2;
    const minX = item.pos_x - e.l / 2, maxX = item.pos_x + e.l / 2;
    const minZ = item.pos_z - e.w / 2, maxZ = item.pos_z + e.w / 2;

    // The column is this carton and everything stacked above it in the same
    // footprint. All of it has to rise by the sheet's thickness.
    const column = items.filter(o => {
      const b = itemBounds(o);
      if (minX + 0.5 >= b.maxX || maxX - 0.5 <= b.minX) return false;
      if (minZ + 0.5 >= b.maxZ || maxZ - 0.5 <= b.minZ) return false;
      return b.minY >= base - 0.5;
    });

    // A locked carton in the column is somebody saying "this one does not
    // move". Lifting it anyway would be exactly the accident the lock exists
    // to prevent.
    if (column.some(o => o.locked)) { pinned.push(item); return; }

    const columnTop = column.reduce((t, o) => Math.max(t, itemBounds(o).maxY), base);
    if (columnTop + SHEET_THICKNESS_CM > roof + 0.01) { tooTall.push(item); return; }

    batchCounters.slipsheet = (batchCounters.slipsheet || 0) + 1;
    const sheet = addItem({
      label: `SHEET-${batchCounters.slipsheet}`,
      base_label: 'SHEET',
      kind: 'slipsheet',
      shape: 'box',
      length_cm: Number(e.l.toFixed(2)),
      width_cm:  Number(e.w.toFixed(2)),
      height_cm: SHEET_THICKNESS_CM,
      weight_kg: 1,
      handling: 'standard',
      color: KIND_COLORS.slipsheet
    });

    // The column goes up by the thickness, and the sheet takes the space that
    // opens up underneath it. Done explicitly rather than left to the settle
    // pass: the sheet and the carton would start at the same height, and
    // which of them settled first would decide which ended up on top.
    column.forEach(o => { o.pos_y += SHEET_THICKNESS_CM; });
    sheet.pos_x = item.pos_x;
    sheet.pos_z = item.pos_z;
    sheet.pos_y = base + SHEET_THICKNESS_CM / 2;
    [sheet, ...column].forEach(o => { clampItemToBounds(o); refreshItemMesh(o); });
    made.push(sheet);
  });

  if (made.length) {
    settleAll();
    evaluateStability();
    updateStats();
    refreshPositionReadouts();
    applyIsolate();
    markDirty();
  }

  const skipped = [];
  if (tooTall.length) skipped.push(`${tooTall.length} already up at the roof`);
  if (pinned.length)  skipped.push(`${pinned.length} with a locked carton above`);

  if (!made.length) {
    showToast(skipped.length
      ? `No sheet went in \u2014 ${skipped.join(', ')}.`
      : 'Nothing to slip a sheet under.');
  } else if (skipped.length) {
    showToast(`Slipped <b>${made.length}</b> underneath. Skipped ${skipped.join(', ')}.`);
  } else {
    showToast(`Slipped <b>${made.length}</b> sheet${made.length === 1 ? '' : 's'} underneath.`);
  }
  return made;
}

// ---- lock ----
function setLocked(list, on) {
  if (!list.length) return;
  list.forEach(i => { i.locked = on; });
  renderCargoList();
  renderEditStrip();
  renderLockButton();
  markDirty();
  showToast(list.length > 1
    ? `${on ? 'Locked' : 'Unlocked'} <b>${list.length}</b> cartons.`
    : `<b>${escapeHtml(list[0].label)}</b> ${on ? 'locked' : 'unlocked'}.`);
}

function renderLockButton() {
  const item = items.find(i => i.id === selectedItemId);
  const btn = $('#btnLock');
  if (btn) {
    btn.textContent = item?.locked ? 'Unlock' : 'Lock';
    btn.classList.toggle('is-locked', !!item?.locked);
  }
  const sel = $('#selLock');
  if (sel) {
    const picked = selectionTotals().picked;
    // One button for the whole set: lock them all unless they already are
    const allLocked = picked.length > 0 && picked.every(i => i.locked);
    sel.textContent = allLocked ? 'Unlock' : 'Lock';
  }
}

$('#btnLock').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (item) setLocked([item], !item.locked);
});

$('#selLock').addEventListener('click', () => {
  const picked = selectionTotals().picked;
  if (!picked.length) return;
  const allLocked = picked.every(i => i.locked);
  setLocked(picked, !allLocked);
});

$('#btnFocus').addEventListener('click', () => { if (selectedItemId) focusOnItem(selectedItemId); });

function reorientSelected(nextOrient, verb) {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  if (item.locked) return showToast('That carton is locked. Unlock it to turn it.');
  item.rot_y = nextOrient;
  clampItemToBounds(item);
  refreshItemMesh(item);
  refreshItemSprite(item);
  settleAll();
  updateStats();
  renderEditStrip();
  markDirty();
  showToast(`<b>${escapeHtml(item.label)}</b> ${verb} — ${ORIENT_NAMES[item.rot_y].toLowerCase()}.`);
}

// Rotate = yaw within the current resting face (0<->1, 2<->3, 4<->5)
$('#btnRotate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  reorientSelected(item.rot_y ^ 1, 'rotated 90°');
});

// Flip = change which dimension points up, keeping the yaw (0->2->4->0)
$('#btnFlip').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  reorientSelected((item.rot_y + 2) % 6, 'flipped');
});

$('#btnDuplicate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const clone = addItem({
    label: item.base_label + '·copy', base_label: item.base_label,
    product_name: item.product_name,
    kind: item.kind, shape: item.shape, max_stack_kg: item.max_stack_kg,
    length_cm: item.length_cm, width_cm: item.width_cm, height_cm: item.height_cm,
    weight_kg: item.weight_kg, handling: item.handling, color: item.color
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
  deselectAll();
  showToast(`Deleted <b>${escapeHtml(label)}</b>.`);
});

// ---- Carton builder (BETA) ----
$('#openBuilder').addEventListener('click', openBuilder);
document.querySelectorAll('[data-close-builder]').forEach(el =>
  el.addEventListener('click', closeBuilder));

['#bWall', '#bGap', '#bLayerGap', '#bTare', '#bName'].forEach(sel => {
  $(sel).addEventListener('input', () => {
    builder.name         = $('#bName').value;
    builder.wall_mm      = bToMm($('#bWall').value);
    builder.gap_mm       = bToMm($('#bGap').value);
    builder.layer_gap_mm = bToMm($('#bLayerGap').value);
    builder.tare_kg      = parseFloat($('#bTare').value) || 0;
    readTrayFields();
    renderBuilderGroups();
    updateBuilderComputed();
    rebuildBuilderPreview();
  });
});

// Tray sizing mode
$$('#bSizeMode .size-mode-btn').forEach(btn => btn.addEventListener('click', () => {
  builder.sizing = btn.dataset.sizing;
  renderSizingMode();
  renderBuilderGroups();                 // fixed mode takes cols/rows out of the user's hands
  updateBuilderComputed();
  rebuildBuilderPreview();
}));

// A pack per group, or everything in one pack
$$('#bGroupMode .group-mode-btn').forEach(btn => btn.addEventListener('click', () => {
  builder.group_mode = btn.dataset.gmode;
  renderBuilderGroups();
  updateBuilderComputed();
  rebuildBuilderPreview();
}));

// Clicking an unnamed heading is the same as reaching for its name box
document.addEventListener('click', e => {
  const title = e.target.closest('.bstep-unnamed');
  if (!title) return;
  const input = title.parentElement?.querySelector('.bstep-term');
  if (input) { input.focus(); input.dispatchEvent(new Event('focus')); }
});

// Base under the trays
$$('.base-type-btn').forEach(btn => btn.addEventListener('click', () => {
  builder.pallet.base_type = btn.dataset.base;
  if (btn.dataset.base === 'slipsheet') {
    // A slipsheet is a sheet, not a deck: no meaningful height or weight
    builder.pallet.deck_h_cm = 0.2;
    builder.pallet.deck_kg   = 0.5;
  } else if (btn.dataset.base === 'none') {
    builder.pallet.deck_h_cm = 0;
    builder.pallet.deck_kg   = 0;
  } else if (builder.pallet.deck_h_cm < 1) {
    const p = PALLET_PRESETS[builder.pallet.preset] || PALLET_PRESETS.eur1;
    builder.pallet.deck_h_cm = p.height;
    builder.pallet.deck_kg   = p.weight;
  }
  renderPalletFields();
  renderSizingMode();
  updateBuilderComputed();
  rebuildBuilderPreview();
}));

['#bFixedL', '#bFixedW', '#bFixedH', '#bOpenTop', '#bWrapOn', '#bWrapT', '#bWrapKg',
 '#bPackOn'].forEach(sel =>
  $(sel).addEventListener('input', () => {
    readTrayFields();
    $('#bPrimaryFields').hidden = !hasPack(builder);
    renderSizingMode();
    renderBuilderGroups();
    updateBuilderComputed();
    rebuildBuilderPreview();
  }));
$('#bPackOn').addEventListener('change', () => {
  readTrayFields();
  $('#bPrimaryFields').hidden = !hasPack(builder);
  renderSizingMode();
  renderBuilderGroups();
  updateBuilderComputed();
  rebuildBuilderPreview();
});

// Pallet batch code — same registry as the group codes
initTermCombo($('#bPalletBatch'), knownBatchCodes, onPalletFieldChange);

// Builder unit switcher
$$('.unit-mini[data-unit-target="builder"] .unit-btn').forEach(btn =>
  btn.addEventListener('click', () => setBuilderUnit(btn.dataset.bunit)));

// Packaging-level names — typeable with a styled suggestion list
['#bTermProduct', '#bTermPrimary', '#bTermOuter', '#bTermSecondary'].forEach(sel =>
  initTermCombo($(sel)));

// ============================================================
// PLAIN-ENGLISH GUIDE — every word on the builder, explained
// ============================================================

// Short answers for the little ? buttons next to the fiddly fields
const FIELD_HINTS = {
  wall: 'How thick the board or plastic of the box itself is. Added to all four sides, so a 3 mm wall makes the box 6 mm wider than its contents. Leave it at 0 if you are measuring the outside already.',
  gap: 'Air left between neighbours standing side by side. Set it to 0 for a tight pack where everything touches.',
  layergap: 'Space between one layer and the layer above it — the thickness of a layer pad, card or sheet. Set it to 0 and each layer sits directly on the one below, which is normal for cans and jars.',
  tare: 'The weight of the empty box, with no product in it. Printed on the carton spec sheet, or just weigh one. We add it to the content weight to get the gross weight.',
  film: 'How thick the shrink-wrap film is. It adds a fraction of a millimetre to every side, and its own weight to the total.',
  perlayer: 'How many go on each layer. Leave it blank and we fit as many as the base holds; type a number and that is what you get. Asking for more than fits is reported rather than granted.',
  layers: 'How many layers high. Leave it blank and we stack as many as fit under the height limit; type a number to stack fewer.'
};

function buildHelpBody() {
  const P   = term('product', 1, true);
  const Ps  = term('product', 2, true);
  const PR  = term('primary', 1, true);
  const PRs = term('primary', 2, true);
  const O   = term('outer', 1, true);
  const S   = term('secondary', 1, true);
  const e   = escapeHtml;

  return `
    <p class="bhelp-lede">This screen builds one shipping unit from the inside out. It starts
      with nothing but the product, and <em>every level above that is a switch you turn on</em>
      — add the pack, then the outer box, then the base, one at a time, and watch the preview
      change. Skip any you do not use. Every heading is named after <em>your</em> word for it:
      change the word in the heading and the whole screen follows.</p>

    <div class="bhelp-chain">
      <div class="bhelp-level">
        <span class="bhelp-num">1</span>
        <div>
          <b>${e(capitalise(P))}</b> <span class="bhelp-tag">primary packaging</span>
          <p>The thing you are shipping, in whatever touches the food — the can, the pouch,
            the vacuum bag. Measure one of these. One ${e(P)} holds one portion of product.</p>
        </div>
      </div>
      <div class="bhelp-level">
        <span class="bhelp-num">2</span>
        <div>
          <b>${e(capitalise(PR))}</b> <span class="bhelp-tag">inner / secondary packaging</span>
          <p>The pack the ${e(Ps)} go into — a tray, a shrink pack, an inner carton.
            You say how many go across the length, across the width, and how many layers high.</p>
        </div>
      </div>
      <div class="bhelp-level">
        <span class="bhelp-num">3</span>
        <div>
          <b>${e(capitalise(O))}</b> <span class="bhelp-tag">outer packaging · optional</span>
          <p>A bigger box that holds several ${e(PRs)}. Switch it off if your ${e(PR)}
            goes straight onto the ${e(S)}.</p>
        </div>
      </div>
      <div class="bhelp-level">
        <span class="bhelp-num">4</span>
        <div>
          <b>${e(capitalise(S))}</b> <span class="bhelp-tag">tertiary / transport packaging</span>
          <p>The base the whole lot stacks onto, and the unit that gets loaded into the
            container. Switch it off to load the boxes in loose.</p>
        </div>
      </div>
    </div>

    <div class="bhelp-worked">
      <h4>Your canned-tuna example, level by level</h4>
      <table>
        <tr><td>1</td><td>One can</td><td>Ø 73 mm × 43 mm high, 95 g</td></tr>
        <tr><td>2</td><td>Tray of 12</td><td>3 across × 2 deep × 2 layers = 12 cans</td></tr>
        <tr><td>3</td><td>Carton of 4 trays</td><td>2 × 2 × 1 = 4 trays = <b>48 cans</b></td></tr>
        <tr><td>4</td><td>Pallet</td><td>as many cartons as fit under your height limit</td></tr>
      </table>
      <p class="bhelp-note">That is the diagram you drew. Levels 1, 2 and 4 are always there;
        level 3 is the one you switch on to get from 12 per tray to 48 per carton.</p>
    </div>

    <h4>The two ways to size a box</h4>
    <dl class="bhelp-dl">
      <dt>Work out the size for me</dt>
      <dd>You describe the arrangement, we build the box around it. Use this when the box is
        made to fit the product.</dd>
      <dt>I know the size</dt>
      <dd>You type the inside measurements of a box you already buy, and we work out how many
        fit in it and how much room is left over. Use this when the box is fixed.</dd>
    </dl>

    <h4>Every other field</h4>
    <dl class="bhelp-dl">
      <dt>Wall</dt><dd>${e(FIELD_HINTS.wall)}</dd>
      <dt>Side to side</dt><dd>${e(FIELD_HINTS.gap)}</dd>
      <dt>Between layers</dt><dd>${e(FIELD_HINTS.layergap)} These two are separate on purpose:
        ${e(Ps)} usually need a little air beside each other but stack directly on top of each
        other, so a single gap setting would put a space under every layer that is not really
        there. Both live with the product rather than with the ${e(PR)}, because the spacing
        is the same whether or not anything is wrapped around them.</dd>
      <dt>Tare</dt><dd>${e(FIELD_HINTS.tare)}</dd>
      <dt>No lid (open tray)</dt>
      <dd>An open tray has a floor and sides but no top, so the contents may stand above the
        rim. We stop adding a lid's thickness to the height.</dd>
      <dt>Shrink wrap</dt>
      <dd>Film pulled tight over the finished box. Adds the film thickness to every side and
        the film weight to the total.</dd>
      <dt>Batch / lot</dt>
      <dd>The code that identifies which production run these ${e(Ps)} came from. Add a group
        per batch. Type a code once and it is offered back to you everywhere else, so the same
        lot is always spelled the same way and can be found again later.</dd>
      <dt>One ${e(PR)} each / All in one ${e(PR)}</dt>
      <dd><em>One ${e(PR)} each</em> gives every group a ${e(PR)} of its own — same outside
        size, so they interchange — and keeps the batches physically apart. That is the normal
        case: four trays in a carton, each tray one batch. <em>All in one</em> stacks every
        group inside a single ${e(PR)} with a divider pad between them, for a genuinely mixed
        pack. When the levels above hold fewer ${e(PRs)} than you have groups, the ${e(PRs)}
        are dealt out in turn, so three slots across two batches is two of one and one of the
        other.</dd>
      <dt>Which way up</dt>
      <dd>Upright is the product as you measured it. <em>On its side</em> tips it over so its
        height runs along the box's length — a lying-down can. <em>On its end</em> stands a box
        product on one end. The footprint and the stack height change to match.</dd>
      <dt>Upside down</dt>
      <dd>The product is packed inverted. It does not change the space it takes, but it is
        recorded so the carton can be marked up correctly.</dd>
      <dt>Where in the ${e(PR)}</dt>
      <dd>The nine-square pad moves this group's block around inside the pack. It only has an
        effect when there is spare room — a fixed-size pack with space left, or a narrow group
        sitting beside a wider one.</dd>
      <dt>Pattern (block / interlocked)</dt>
      <dd>Block stacks every layer identically — simple and stable when the boxes are square
        to each other. Interlocked turns alternate layers so the seams do not line up, which
        binds the stack together but usually fits fewer per layer.</dd>
      <dt>Overhang</dt>
      <dd>How far the boxes are allowed to stick out past the edge of the base, per side.
        Carriers often refuse overhang, so 0 is the safe answer.</dd>
      <dt>Max height</dt>
      <dd>The tallest the finished ${e(S)} may be, base included. We fit as many layers as
        will go under it.</dd>
    </dl>`;
}

function openHelp() {
  $('#bHelpBody').innerHTML = buildHelpBody();
  $('#bHelp').hidden = false;
  $('#bHelpBody').scrollTop = 0;
}

$('#bHelpOpen').addEventListener('click', openHelp);
$('#bHelpClose').addEventListener('click', () => { $('#bHelp').hidden = true; });

// Little ? buttons — one short answer, anchored to the field
let hintPop = null;
function closeHint() { if (hintPop) { hintPop.remove(); hintPop = null; } }

document.addEventListener('click', e => {
  const btn = e.target.closest('.bhint');
  if (!btn) { if (!e.target.closest('.bhint-pop')) closeHint(); return; }
  e.preventDefault();
  const was = hintPop?.dataset.for === btn.dataset.hint;
  closeHint();
  if (was) return;
  const pop = document.createElement('div');
  pop.className = 'bhint-pop';
  pop.dataset.for = btn.dataset.hint;
  pop.textContent = FIELD_HINTS[btn.dataset.hint] || '';
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(r.left - 110, window.innerWidth - pop.offsetWidth - 12))}px`;
  pop.style.top  = `${r.bottom + 8}px`;
  hintPop = pop;
});

// ---- the optional outer box ----
const OUTER_FIELD_IDS = ['#bOuterOn', '#bOuterFixL', '#bOuterFixW', '#bOuterFixH',
  '#bOuterCols', '#bOuterRows', '#bOuterLayers', '#bOuterWall', '#bOuterGap',
  '#bOuterLayerGap', '#bOuterTare', '#bOuterOpenTop', '#bOuterWrapOn',
  '#bOuterWrapT', '#bOuterWrapKg'];

function onOuterFieldChange() {
  const wasOn = builder.outer.enabled;
  readOuterFields();
  renderOuterFields();
  // Switching the level on is the moment to show it; switching it off can't
  // leave the preview pointing at something that no longer exists.
  if (!builder.outer.enabled && builderPreviewMode === 'outer') setBuilderPreviewMode('carton');
  else if (!wasOn && builder.outer.enabled) setBuilderPreviewMode('outer');
  updateBuilderComputed();
  rebuildBuilderPreview();
}

OUTER_FIELD_IDS.forEach(sel => {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('input', onOuterFieldChange);
  el.addEventListener('change', onOuterFieldChange);
});

$$('#bOuterSizeMode .size-mode-btn').forEach(btn => btn.addEventListener('click', () => {
  builder.outer.sizing = btn.dataset.osizing;
  renderOuterFields();
  updateBuilderComputed();
  rebuildBuilderPreview();
}));

// ---- what kind of thing level 3 actually is ----
// "Box" is only one answer. A stack of trays pulled tight in film has no
// walls and no lid, and setting wall to 0 plus two switches to reach that is
// not something anyone would guess.
const OUTER_SHAPES = {
  box:    { open_top: false, wrap: false, zeroWall: false,
            why: 'Walls all round and a lid. Set the board thickness below.' },
  bundle: { open_top: true,  wrap: true,  zeroWall: true,
            why: 'No box at all — the packs are stacked and pulled tight in film. ' +
                 'Nothing is added to the size except the film itself.' },
  tray:   { open_top: true,  wrap: false, zeroWall: false,
            why: 'A tray with low sides and no lid. The packs can stand above the rim.' }
};

function outerShapeOf(o) {
  if (!(o.wall_mm > 0) && o.open_top && o.wrap?.enabled) return 'bundle';
  if (o.open_top) return 'tray';
  return 'box';
}

function applyOuterShape(kind) {
  const s = OUTER_SHAPES[kind];
  if (!s) return;
  const o = builder.outer;
  o.open_top = s.open_top;
  o.wrap.enabled = s.wrap;
  if (s.zeroWall) o.wall_mm = 0;
  writeOuterFields();
  renderOuterShape();
  updateBuilderComputed();
  rebuildBuilderPreview();
}

function renderOuterShape() {
  const row = $('#bOuterShape');
  if (!row) return;
  const kind = outerShapeOf(builder.outer);
  $$('#bOuterShape .bshape-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.oshape === kind));
  $('#bOuterShapeWhy').textContent = OUTER_SHAPES[kind]?.why || '';
  refreshSegments();
}

$$('#bOuterShape .bshape-btn').forEach(btn =>
  btn.addEventListener('click', () => applyOuterShape(btn.dataset.oshape)));

// Pallet section
const PALLET_FIELD_IDS = ['#bPalletOn', '#bPalletPattern', '#bPalletL', '#bPalletW',
  '#bPalletH', '#bPalletKg', '#bPalletMaxH', '#bPalletOver',
  '#bPalletPerLayer', '#bPalletLayers',
  '#bPalletWrapOn', '#bPalletWrapT', '#bPalletWrapKg',
  '#bPalletBatch', '#bPalletOrder', '#bPalletPacker'];

// Editing a base dimension by hand means it is no longer that preset. Leaving
// the dropdown reading "EUR1 · 120 × 80" over a 43 × 65 base is a lie about
// what is being planned.
function syncPalletPreset() {
  const p = builder.pallet;
  if (p.preset === 'custom') return;
  const preset = PALLET_PRESETS[p.preset];
  if (!preset) return;
  const same = Math.abs(p.length_cm - preset.length) < 0.05 &&
               Math.abs(p.width_cm  - preset.width)  < 0.05;
  if (!same) {
    p.preset = 'custom';
    $('#bPalletPreset').value = 'custom';
  }
}

function onPalletFieldChange() {
  const wasOn = builder.pallet.enabled;
  readPalletFields();
  syncPalletPreset();
  $('#bPalletFields').hidden = !builder.pallet.enabled;
  if (!builder.pallet.enabled && builderPreviewMode === 'pallet') setBuilderPreviewMode('carton');
  else if (!wasOn && builder.pallet.enabled) setBuilderPreviewMode('pallet');
  updateBuilderComputed();
  rebuildBuilderPreview();
}

PALLET_FIELD_IDS.forEach(sel => {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('input', onPalletFieldChange);
  el.addEventListener('change', onPalletFieldChange);
});

$('#bPalletPreset').addEventListener('change', e => {
  const preset = PALLET_PRESETS[e.target.value];
  builder.pallet.preset = e.target.value;
  if (preset && e.target.value !== 'custom') {
    builder.pallet.length_cm = preset.length;
    builder.pallet.width_cm  = preset.width;
    builder.pallet.deck_h_cm = preset.height;
    builder.pallet.deck_kg   = preset.weight;
    $('#bPalletL').value  = bFromCm(preset.length);
    $('#bPalletW').value  = bFromCm(preset.width);
    $('#bPalletH').value  = bFromCm(preset.height);
    $('#bPalletKg').value = preset.weight;
  }
  updateBuilderComputed();
  rebuildBuilderPreview();
});

// ---- the preview follows the step being worked on ----
// Filling in the outer box while the preview still shows the pack means
// staring at something that is not changing. Touching a step switches to it;
// clicking a pill by hand always wins and is never blocked.
const STEP_PREVIEW = {
  bProductStep:  'carton',               // the pack view also shows bare product
  bPrimaryStep:  'carton',
  bOuterStep:    'outer',
  bPalletStep:   'pallet'
};

function previewAvailable(mode) {
  if (mode === 'outer')  return !!builder.outer?.enabled;
  if (mode === 'pallet') return !!builder.pallet?.enabled;
  return true;
}

function followStepPreview(stepId) {
  const want = STEP_PREVIEW[stepId];
  if (!want || want === builderPreviewMode) return;
  if (!previewAvailable(want)) return;   // level is switched off; leave it be
  setBuilderPreviewMode(want);
}

function initStepPreviewFollow() {
  Object.keys(STEP_PREVIEW).forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // focusin covers tabbing as well as clicking into a field
    el.addEventListener('focusin', () => followStepPreview(id));
    el.addEventListener('pointerdown', () => followStepPreview(id));
  });
}

function setBuilderPreviewMode(mode) {
  builderPreviewMode = mode;
  $$('#bPreviewPills .view-pill').forEach(b =>
    b.classList.toggle('selected', b.dataset.preview === mode));
  refreshSegments();
  rebuildBuilderPreview();
}

$$('#bPreviewPills .view-pill').forEach(pill => pill.addEventListener('click', () => {
  const want = pill.dataset.preview;
  if (want === 'pallet' && !builder.pallet.enabled) {
    return showToast(`Turn on the <b>${escapeHtml(term('secondary', 1, true))}</b> switch first.`);
  }
  if (want === 'outer' && !builder.outer?.enabled) {
    return showToast(`Turn on the <b>${escapeHtml(term('outer', 1, true))}</b> switch first.`);
  }
  setBuilderPreviewMode(want);
}));

// Adding a group is nearly always one of two things: the same product under a
// different batch code, or a genuinely different product. Ask which, rather
// than guessing and making the user retype four measurements.
function closeAddMenu() {
  $('#bAddMenu').hidden = true;
  $('#bAddGroup').classList.remove('is-open');
}

$('#bAddGroup').addEventListener('click', () => {
  // With nothing to copy yet there is no choice to make
  if (!builder.groups.length) return addGroup('blank');
  const menu = $('#bAddMenu');
  menu.hidden = !menu.hidden;
  $('#bAddGroup').classList.toggle('is-open', !menu.hidden);
});

$$('#bAddMenu [data-add]').forEach(btn => btn.addEventListener('click', () => {
  const how = btn.dataset.add;
  closeAddMenu();
  if (how !== 'cancel') addGroup(how);
}));

function addGroup(how) {
  const idx = builder.groups.length;
  let g;
  if (how === 'copy' && builder.groups[0]) {
    // Everything about the product carries over; the batch code deliberately
    // does not, because that is the one thing that has to differ.
    g = JSON.parse(JSON.stringify(builder.groups[0]));
    g.id = 'g_' + Math.random().toString(36).slice(2, 8);
    g.batch_lot = '';
    g.color = GROUP_COLORS[idx % GROUP_COLORS.length];
  } else {
    g = newGroup(idx);
  }
  builder.groups.push(g);
  renderBuilderGroups();
  updateBuilderComputed();
  rebuildBuilderPreview();

  // Put the cursor straight on the field that has to be filled in
  const card = $('#bGroups').querySelector(`.bgroup[data-gid="${g.id}"]`);
  const focusOn = card?.querySelector(how === 'copy' ? 'input[data-batch]' : 'input[data-f="product_name"]');
  if (focusOn) { focusOn.focus(); focusOn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  if (how === 'copy') {
    showToast(`Copied group 1 — give this ${escapeHtml(term('product', 1, true))} its own batch code.`);
  }
}

// Clicking anywhere else puts the chooser away
document.addEventListener('click', e => {
  if ($('#bAddMenu').hidden) return;
  if (!e.target.closest('.badd')) closeAddMenu();
});

$('#bQtyMinus').addEventListener('click', () => {
  builderQty = Math.max(1, builderQty - 1);
  $('#bQty').textContent = builderQty;
});
$('#bQtyPlus').addEventListener('click', () => {
  builderQty = Math.min(500, builderQty + 1);
  $('#bQty').textContent = builderQty;
});

$('#bAddToPlan').addEventListener('click', addBuiltCartonToPlan);

$('#bSaveSpec').addEventListener('click', () => {
  const name = $('#bName').value.trim();
  if (!name) { $('#bName').focus(); return showToast('Give the carton a name first.'); }
  const spec = JSON.parse(JSON.stringify(builder));
  spec.id = 's_' + Math.random().toString(36).slice(2, 10);
  spec.name = name;
  cartonSpecs.push(spec);
  persistCartonSpecs();
  renderCartonSpecDropdown();
  $('#bSpecSelect').value = spec.id;
  $('#bDeleteSpec').hidden = false;
  showToast(`Carton <b>${escapeHtml(name)}</b> saved.`);
});

$('#bSpecSelect').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) { $('#bDeleteSpec').hidden = true; return; }
  const spec = cartonSpecs.find(s => s.id === id);
  if (!spec) return;
  builder = normaliseSpec(JSON.parse(JSON.stringify(spec)));
  delete builder._done;                  // loading one is a fresh start, not a finished build
  writeBuilderFields();
  renderTermInputs();
  renderBuilderGroups();
  updateBuilderComputed();
  rebuildBuilderPreview();
  $('#bDeleteSpec').hidden = false;
  showToast(`Loaded <b>${escapeHtml(spec.name)}</b>.`);
});

$('#bDeleteSpec').addEventListener('click', () => {
  const id = $('#bSpecSelect').value;
  const spec = cartonSpecs.find(s => s.id === id);
  if (!spec || !confirm(`Delete carton "${spec.name}"?`)) return;
  cartonSpecs = cartonSpecs.filter(s => s.id !== id);
  persistCartonSpecs();
  renderCartonSpecDropdown();
  showToast('Carton deleted.');
});

window.addEventListener('resize', () => {
  if (!$('#builderModal').hidden) resizeBuilderPreview();
});

// ============================================================
// COLOUR PICKER — recolours every item sharing the selected SKU
// ============================================================
// 'one' = the carton in the inspector, or everything ticked when there is a
// selection. 'sku' = every carton sharing this one's SKU — the old behaviour,
// which now has to be asked for rather than being the only option.
let colorScope = 'one';

function colorTargets() {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return [];
  if (colorScope === 'sku') return items.filter(i => i.base_label === item.base_label);
  // Just this carton. Colouring a whole ticked set is a different gesture and
  // lives on the selection bar, because the tick boxes are on the list and
  // this popover is inside the inspector, which hides the list.
  return [item];
}

// Paint every ticked carton at once, from the selection bar
function applyColorToPicked(hex) {
  const t = selectionTotals();
  if (!t.picked.length) return;
  t.picked.forEach(i => {
    i.color = hex;
    if (i.mesh) i.mesh.material.color.set(hex);
    refreshItemSprite(i);
  });
  renderCargoList();
  renderEditStrip();
  markDirty();
  showToast(`Recoloured <b>${t.picked.length}</b> selected.`);
}

// The labels carry the counts, so neither option is a guess about its reach
function renderColorScope() {
  const row = $('#colorScope');
  if (!row) return;
  const item = items.find(i => i.id === selectedItemId);
  const [oneBtn, skuBtn] = $$('#colorScope .color-scope-btn');
  if (!oneBtn || !skuBtn) return;
  oneBtn.textContent = 'This one';
  const sku = item ? items.filter(i => i.base_label === item.base_label).length : 0;
  skuBtn.textContent = `Whole SKU (${sku})`;
  // Nothing to widen to when the SKU is this carton on its own
  skuBtn.disabled = sku <= 1;
  if (skuBtn.disabled && colorScope === 'sku') colorScope = 'one';
  oneBtn.classList.toggle('active', colorScope === 'one');
  skuBtn.classList.toggle('active', colorScope === 'sku');
  refreshSegments();
}

function applyColorToSelection(hex) {
  const targets = colorTargets();
  if (!targets.length) return;
  targets.forEach(i => {
    i.color = hex;
    if (i.mesh) i.mesh.material.color.set(hex);
    refreshItemSprite(i);
  });
  renderCargoList();
  renderEditStrip();
  renderColorGrid();
  markDirty();
  showToast(targets.length > 1
    ? `Recoloured <b>${targets.length}</b> ${colorScope === 'sku'
        ? 'in ' + escapeHtml(targets[0].base_label) : 'selected'}.`
    : `Recoloured <b>${escapeHtml(targets[0].label)}</b>.`);
}

$$('#colorScope .color-scope-btn').forEach(btn => btn.addEventListener('click', e => {
  e.stopPropagation();                   // keep the popover open
  colorScope = btn.dataset.cscope;
  renderColorScope();
}));

function renderColorGrid() {
  const grid = $('#colorGrid');
  const item = items.find(i => i.id === selectedItemId);
  grid.innerHTML = CARGO_COLORS.map(c => `
    <button type="button" class="color-dot ${item && item.color.toLowerCase() === c.toLowerCase() ? 'active' : ''}"
            style="background:${c}" data-color="${c}" title="${c}"></button>
  `).join('');
  grid.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      applyColorToSelection(dot.dataset.color);
      closeColorPop();
    });
  });
  if (item) $('#colorCustom').value = item.color;
}

function openColorPop() {
  if (!selectedItemId) return;
  // Always reopens on the narrow scope. A sticky "whole SKU" would recolour
  // a dozen cartons the next time somebody reached for the swatch.
  colorScope = 'one';
  renderColorScope();
  renderColorGrid();
  $('#colorPop').hidden = false;
}
function closeColorPop() { $('#colorPop').hidden = true; }

$('#editSwatch').addEventListener('click', e => {
  e.stopPropagation();
  $('#colorPop').hidden ? openColorPop() : closeColorPop();
});
$('#colorPop').addEventListener('click', e => e.stopPropagation());
$('#colorCustom').addEventListener('input', e => applyColorToSelection(e.target.value));
document.addEventListener('click', () => closeColorPop());

// Shape picker
$$('.shape-pick-btn').forEach(btn =>
  btn.addEventListener('click', () => setShape(btn.dataset.shape)));

// Keep the diameter square while a round shape is selected
$('#fLength').addEventListener('input', () => {
  if (SHAPES[currentShape].round) $('#fWidth').value = $('#fLength').value;
});

// Auto-pack
$('#autoPackBtn').addEventListener('click', runAutoPack);
$('#autoPackUndoBtn').addEventListener('click', undoAutoPack);

// Kind tabs (Carton / Pallet / Slipsheet)
$$('.kind-tab').forEach(tab => tab.addEventListener('click', () => setKind(tab.dataset.kind)));
$('#fKindPreset').addEventListener('change', e => applyKindPreset(e.target.value));

// Per-section unit switchers (container in cargo-space panel, item in cargo form)
$$('.unit-mini[data-unit-target="container"] .unit-btn').forEach(btn =>
  btn.addEventListener('click', () => setContainerUnit(btn.dataset.unit)));
$$('.unit-mini[data-unit-target="item"] .unit-btn').forEach(btn =>
  btn.addEventListener('click', () => setItemUnit(btn.dataset.unit)));

// Templates
$('#templateSelect').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) { $('#deleteTemplateBtn').hidden = true; updateOptionsSummary(); return; }
  applyTemplate(id);
  updateOptionsSummary();
});
$('#saveTemplateBtn').addEventListener('click', openSaveTemplateModal);
$('#deleteTemplateBtn').addEventListener('click', deleteSelectedTemplate);
$('#tplSaveConfirm').addEventListener('click', saveTemplateFromForm);
document.querySelectorAll('[data-close-tpl]').forEach(el => el.addEventListener('click', () => $('#tplModal').hidden = true));

// Plans / new / save / publish
$('#btnMyPlans').addEventListener('click', openPlansModal);
$('#btnNewPlan').addEventListener('click', newPlan);
$('#saveDraft').addEventListener('click', () => savePlan('draft'));
$('#publishPlan').addEventListener('click', () => savePlan('published'));

document.querySelectorAll('[data-close-modal]').forEach(el => el.addEventListener('click', () => $('#plansModal').hidden = true));

// Keyboard
window.addEventListener('keydown', (e) => {
  const t = e.target;
  const inField = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    savePlan('draft');
    return;
  }

  // Alt+1 folds the cargo-space panel away and back
  if (e.altKey && e.key === '1') {
    e.preventDefault();
    toggleLeftPanel();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inField) {
    e.preventDefault();
    selectAllItems();
    return;
  }

  // Arrow keys nudge the selected carton. Left/right and up/down move it
  // across the floor; holding Shift lifts it instead. Typing in a field
  // still gets its own arrows.
  if (!inField && selectedItemId && e.key.startsWith('Arrow')) {
    const step = e.altKey ? nudgeStepCm / 5 : nudgeStepCm;   // Alt for a fine step
    let axis = null, dir = 0;
    if (e.key === 'ArrowLeft')  { axis = 'x'; dir = -1; }
    if (e.key === 'ArrowRight') { axis = 'x'; dir =  1; }
    if (e.key === 'ArrowUp')    { axis = e.shiftKey ? 'y' : 'z'; dir = e.shiftKey ?  1 : -1; }
    if (e.key === 'ArrowDown')  { axis = e.shiftKey ? 'y' : 'z'; dir = e.shiftKey ? -1 :  1; }
    if (axis) {
      e.preventDefault();
      nudgeSelected(axis, dir, step);
      return;
    }
  }

  if (e.key === 'Escape') {
    // Close any open custom-select menu first
    const openSel = document.querySelector('.custom-select.open');
    if (openSel) {
      openSel.classList.remove('open');
      openSel.querySelector('.custom-select-menu').hidden = true;
      return;
    }
    if (!$('#exitModal').hidden) { closeExitDialog(); return; }
    if (!$('#builderModal').hidden) { closeBuilder(); return; }
    if (!$('#shortcutsModal').hidden) { $('#shortcutsModal').hidden = true; return; }
    if (!$('#plansModal').hidden) { $('#plansModal').hidden = true; return; }
    if (!$('#tplModal').hidden)   { $('#tplModal').hidden = true; return; }
    if (resizeState) {
      // Cancel resize
      const item = items.find(i => i.id === resizeState.itemId);
      if (item && resizeState.orig) {
        Object.assign(item, resizeState.orig);
        refreshItemMesh(item);
        refreshItemSprite(item);
      }
      document.removeEventListener('pointermove', onHandlePointerMove);
      document.removeEventListener('pointerup',   onHandlePointerUp);
      resizeState = null;
      controls.enabled = true;
      return;
    }
    if (dragState && dragState.activated) {
      const item = items.find(i => i.id === dragState.itemId);
      if (item && dragState.origPos) {
        item.pos_x = dragState.origPos.x;
        item.pos_y = dragState.origPos.y;
        item.pos_z = dragState.origPos.z;
        refreshItemMesh(item);
      }
      if (dragState.stackTargetId) restoreWireframe(dragState.stackTargetId);
      dragState = null;
      controls.enabled = true;
      return;
    }
    if (measureIds.length) { clearMeasurement(); return; }
    deselectAll();
    return;
  }

  if (inField) return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedItemId) {
    e.preventDefault();
    $('#btnDelete').click();
  } else if (e.key === 'r' && selectedItemId) {
    $('#btnRotate').click();
  } else if (e.key === 'f' && selectedItemId) {
    $('#btnFlip').click();
  } else if (e.key === 'i') {
    setIsolate(!isolateOn);
  } else if (e.key === 'k' && selectionIds().size) {
    // Locks whatever is picked — the whole Ctrl-selected set, or the one item
    const picked = selectionTotals().picked;
    setLocked(picked, !picked.every(i => i.locked));
  } else if (e.key === 'd' && selectedItemId && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#btnDuplicate').click();
  } else if (e.key === 'l') {
    $('#toggleLabels').click();
  } else if (e.key === 'g') {
    $('#toggleDims').click();
  } else if (e.key === 'c') {
    $('#toggleContents').click();
  } else if (e.key === 'p') {
    runAutoPack();
  } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    $('#btnShortcuts').click();
  } else if (e.key === '2') {
    setSceneMode('2d');
  } else if (e.key === '3') {
    setSceneMode('3d');
  }
});

// ============================================================
// LEAVING THE PLANNER
// ------------------------------------------------------------
// Any link marked data-guarded checks for unsaved work first and
// offers to save, discard, or stay.
// ============================================================
let pendingExitHref = null;

function openExitDialog(href) {
  pendingExitHref = href;
  const named = $('#planName').value.trim();
  $('#exitMsg').innerHTML = named
    ? `<b>${escapeHtml(named)}</b> has unsaved changes.`
    : 'This plan has unsaved changes and has not been named yet.';
  $('#exitModal').hidden = false;
}

function closeExitDialog() {
  $('#exitModal').hidden = true;
  pendingExitHref = null;
}

function leaveNow(href) {
  isDirty = false;                       // stop beforeunload double-prompting
  window.location.href = href;
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-guarded]');
  if (!link) return;
  if (!isDirty) return;                  // nothing to lose — follow the link
  e.preventDefault();
  openExitDialog(link.getAttribute('href'));
});

$('#exitModal').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-exit]')?.dataset.exit;
  if (!act) return;
  const href = pendingExitHref;

  if (act === 'cancel')  { closeExitDialog(); return; }
  if (act === 'discard') { closeExitDialog(); leaveNow(href); return; }

  if (act === 'save') {
    const btn = e.target.closest('[data-exit="save"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const ok = await savePlan(planStatus === 'published' ? 'published' : 'draft');
    btn.disabled = false;
    btn.textContent = 'Save and leave';
    // Only leave if it actually saved — otherwise the dialog stays open
    // with the error toast visible behind it.
    if (ok) { closeExitDialog(); leaveNow(href); }
    else    { closeExitDialog(); }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ============================================================
// SLIDING INDICATORS — moves the pill between segmented options
// ============================================================
let refreshSegments = () => {};

function initSegmentedIndicators() {
  const SELECTOR = '.view-pills, .scene-toggle, .kind-tabs, .unit-mini, .shape-pick, .panel-tabs, .shape-toggle, .size-mode, .base-type, .orient-toggle, .group-mode, .bshape-pick, .color-scope';
  const getContainers = () => document.querySelectorAll(SELECTOR);

  const update = (container) => {
    const active = container.querySelector('.active, .selected');
    if (!active) {
      container.style.setProperty('--indicator-w', '0px');
      return;
    }
    const cRect = container.getBoundingClientRect();
    if (cRect.width === 0) return;                      // hidden — keep last known state
    const aRect = active.getBoundingClientRect();
    container.style.setProperty('--indicator-x', `${aRect.left - cRect.left}px`);
    container.style.setProperty('--indicator-w', `${aRect.width}px`);
  };
  const updateAll = () => getContainers().forEach(update);
  refreshSegments = updateAll;

  // Initial position — suppress the boot animation
  requestAnimationFrame(() => {
    document.body.classList.add('no-segment-anim');
    updateAll();
    requestAnimationFrame(() => document.body.classList.remove('no-segment-anim'));
  });

  // Class changes on buttons + hidden changes on containers → reposition the pill
  const observer = new MutationObserver(mutations => {
    const affected = new Set();
    mutations.forEach(m => {
      let el = m.target;
      while (el && el.matches && !el.matches(SELECTOR)) el = el.parentElement;
      if (el && el.matches) affected.add(el);
    });
    affected.forEach(update);
  });
  getContainers().forEach(container => {
    container.querySelectorAll('button').forEach(btn => {
      observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    });
    observer.observe(container, { attributes: true, attributeFilter: ['hidden'] });
  });

  // Reposition on window resize (debounced)
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateAll, 80);
  });
}

// ============================================================
// BOOT
// ============================================================
async function boot() {
  // Load preferences that affect the first render
  try {
    realisticMode = localStorage.getItem(REALISTIC_MODE_KEY) === '1';
    showDims = localStorage.getItem(DIMS_MODE_KEY) === '1';
    const gs = localStorage.getItem(GRID_STEP_KEY);
    if (gs) gridStepPref = gs === 'auto' ? 'auto' : (Number(gs) || 'auto');
    const ss = localStorage.getItem(SNAP_STEP_KEY);
    if (ss !== null && SNAP_STEP_OPTIONS.includes(Number(ss))) moveStep = Number(ss);
    const bu = localStorage.getItem(BUILDER_UNIT_KEY);
    if (bu && TO_MM[bu]) builderUnit = bu;
    const ns = parseFloat(localStorage.getItem(NUDGE_STEP_KEY));
    if (ns > 0) nudgeStepCm = ns;
    const sc = localStorage.getItem(SHOW_CONTENTS_KEY);
    if (sc !== null) showContents = sc === '1';
  } catch (e) {}
  try {
    const savedC = localStorage.getItem(CONTAINER_UNIT_KEY);
    if (savedC && ['mm', 'cm', 'm'].includes(savedC)) containerUnit = savedC;
    const savedI = localStorage.getItem(ITEM_UNIT_KEY);
    if (savedI && ['mm', 'cm', 'm'].includes(savedI)) itemUnit = savedI;
  } catch (e) {}

  initScene();
  loadTemplatesFromStorage();
  renderTemplateDropdown();
  loadCartonSpecs();
  loadBatchCodes();
  loadRecentBuilds();
  loadAddressing();
  builder = newBuilderSpec();
  renderGridOptions();                      // before enhanceSelect picks them up
  renderSnapOptions();
  $$('select').forEach(enhanceSelect);      // replace native selects with styled ones
  renderAddressingControls();               // after the selects are styled
  updateStats();
  renderCargoList();
  renderEditStrip();
  setEditMode(false, null);
  updateOptionsSummary();
  updateStatusChip();
  initLeftPanel();
  $('#nudgeStep').value = String(nudgeStepCm);
  refreshAllContents();
  renderSelectionSummary();
  initStepPreviewFollow();

  // Sync toggle button state
  $('#toggleRealistic').classList.toggle('active', realisticMode);
  $('#toggleDims').classList.toggle('active', showDims);

  // Apply units to labels/steps/scene header. HTML defaults for cargo space are
  // in m — convert if the saved container unit differs. Item fields are empty
  // at boot so no conversion is needed for them.
  if (containerUnit !== 'm') {
    ['#dimLength', '#dimWidth', '#dimHeight'].forEach(sel => {
      const el = $(sel);
      if (!el || el.value === '') return;
      const v = parseFloat(el.value);
      if (!isNaN(v)) el.value = formatDimValue(v * TO_MM.m / TO_MM[containerUnit], containerUnit);
    });
  }
  updateDimLabels();
  updateFieldSteps();
  updateSceneDimsDisplay();
  $$('.unit-mini[data-unit-target="container"] .unit-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.unit === containerUnit));
  $$('.unit-mini[data-unit-target="item"] .unit-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.unit === itemUnit));

  // Restore scene mode preference
  try {
    const savedMode = localStorage.getItem(SCENE_MODE_KEY);
    if (savedMode === '2d') {
      // Delay so initial layout settles first
      setTimeout(() => setSceneMode('2d'), 50);
    }
  } catch (e) {}

  const planIdFromUrl = new URLSearchParams(window.location.search).get('plan');
  if (planIdFromUrl) await loadPlan(planIdFromUrl);

  initSegmentedIndicators();                 // start the sliding pill for toggles

  requestAnimationFrame(onResize);
  setTimeout(onResize, 200);
}

boot();