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

const GRID_CM = 5;
const CENTER_SNAP_CM = 15;
const EDGE_SNAP_CM = 4;                  // magnetic range for flush faces
const TEMPLATES_KEY = 'smartuna_planner_templates_v1';
const SCENE_MODE_KEY = 'smartuna_planner_scene_mode';
const REALISTIC_MODE_KEY = 'smartuna_planner_realistic_mode';
const DIMS_MODE_KEY = 'smartuna_planner_dims_mode';
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
let last3DView = 'perspective';
let realisticMode = false;              // opt-in realistic container + yard
let showDims = false;                   // opt-in dimension guides

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
  perspControls.minDistance = 3;
  perspControls.maxDistance = 45;
  perspControls.maxPolarAngle = Math.PI / 2 - 0.05;
  perspControls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE
  };

  // Ortho controls (2D) — pan and zoom only
  orthoControls = new OrbitControls(orthoCamera, canvas);
  orthoControls.enableRotate = false;
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

  if (orthoView === 'top') {
    top.textContent   = `L · ${L.toFixed(2)} m`;
    right.textContent = `W · ${W.toFixed(2)} m`;
    doors.textContent = 'DOORS →';
    back.textContent  = '← BACK';
    doors.hidden = false;
    back.hidden = false;
  } else if (orthoView === 'side') {
    top.textContent   = `L · ${L.toFixed(2)} m`;
    right.textContent = `H · ${H.toFixed(2)} m`;
    doors.textContent = 'DOORS →';
    back.textContent  = '← BACK';
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

function snapToGrid(cm) { return Math.round(cm / GRID_CM) * GRID_CM; }

// ---- magnetic edge snapping ----
// Grid snapping moves the box CENTRE, so two boxes whose half-widths aren't
// multiples of the grid can never sit flush. These pull faces together when
// they come close, which is what "push them against each other" actually means.

// Nearest edge along one axis that `v` should snap to, if any is close enough.
function snapEdgeValue(v, axis, excludeId, spaceMax) {
  let best = null;
  const consider = t => {
    const d = Math.abs(t - v);
    if (d <= EDGE_SNAP_CM && (!best || d < best.d)) best = { t, d };
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
  const overlaps = (aMin, aMax, bMin, bMax) => aMin < bMax - 0.5 && aMax > bMin + 0.5;

  let x = xCm, z = zCm;

  // X — snap against neighbours sharing this Z lane
  {
    const zMin = z - halfW, zMax = z + halfW;
    let best = null;
    const push = d => {
      const dist = Math.abs(d);
      if (dist <= EDGE_SNAP_CM && (!best || dist < best.dist)) best = { d, dist };
    };
    push(0 - (x - halfL));
    push(L - (x + halfL));
    for (const o of items) {
      if (o.id === item.id) continue;
      const b = itemBounds(o);
      if (!overlaps(zMin, zMax, b.minZ, b.maxZ)) continue;
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
      if (dist <= EDGE_SNAP_CM && (!best || dist < best.dist)) best = { d, dist };
    };
    push(0 - (z - halfW));
    push(W - (z + halfW));
    for (const o of items) {
      if (o.id === item.id) continue;
      const b = itemBounds(o);
      if (!overlaps(xMin, xMax, b.minX, b.maxX)) continue;
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
    shape:     spec.shape || 'box',
    rot_y: 0, pos_x: 0, pos_y: 0, pos_z: 0, mesh: null,
    contents: spec.contents ? spec.contents.map(c => ({ ...c })) : null
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
    shape:     SHAPES[spec.shape] ? spec.shape : 'box',
    rot_y:     normaliseOrient(spec.rot_y),
    pos_x:     Number(spec.pos_x) || 0,
    pos_y:     Number(spec.pos_y) || 0,
    pos_z:     Number(spec.pos_z) || 0,
    mesh: null,
    contents: spec.contents ? spec.contents.map(c => ({ ...c })) : null
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
  batchCounters = { carton: 0, pallet: 0, slipsheet: 0 };
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
  populateFormFromItem(item);
  setEditMode(true, item);
  renderCargoList();
  renderEditStrip();
}

function deselectAll() {
  const prev = items.find(i => i.id === selectedItemId);
  highlightMesh(prev, false);
  selectedItemId = null;
  setEditMode(false, null);
  renderCargoList();
  renderEditStrip();
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
  setKind(item.kind || 'carton', { autofill: false });
  setShape(item.shape || 'box', { mirror: false });
}

function setEditMode(isEdit, item) {
  const indicator  = $('#modeIndicator');
  const modeText   = $('#modeText');
  const primaryBtn = $('#primaryFormBtn');
  const qtyPicker  = $('#qtyPicker');
  if (isEdit && item) {
    indicator.hidden = false;
    modeText.textContent = `Editing: ${item.label}`;
    primaryBtn.textContent = 'Save changes';
    primaryBtn.classList.add('editing');
    qtyPicker.classList.add('disabled');
    // Surface the options block if this item isn't a plain box carton
    if ((item.kind && item.kind !== 'carton') || (item.shape && item.shape !== 'box')) {
      setOptionsOpen(true);
    }
  } else {
    indicator.hidden = true;             // the "Add" tab already says what mode we're in
    primaryBtn.textContent = 'Add to plan';
    primaryBtn.classList.remove('editing');
    qtyPicker.classList.remove('disabled');
  }
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
  list.innerHTML = items.map(i => {
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
    <div class="cargo-row ${i.id === selectedItemId ? 'selected' : ''}" data-id="${i.id}">
      <span class="cargo-swatch" style="background:${i.color}"></span>
      <div class="cargo-meta">
        <b>${escapeHtml(i.label)}${i.product_name ? ' · ' + escapeHtml(i.product_name) : ''}</b>
        <small>${fromCm(i.length_cm)} × ${fromCm(i.width_cm)} × ${fromCm(i.height_cm)} ${itemUnit} · ${i.weight_kg || 0} kg · ${i.handling}</small>
        ${extra ? `<small class="cargo-contents">${extra}</small>` : ''}
      </div>
      <span class="focus-icon" title="Focus camera">⌖</span>
    </div>`;
  }).join('');
  list.querySelectorAll('.cargo-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const id = row.dataset.id;
      if (e.target.classList.contains('focus-icon')) {
        selectItem(id); focusOnItem(id);
      } else selectItem(id);
    });
  });
}

function renderEditStrip() {
  const strip = $('#editStrip');
  const item = items.find(i => i.id === selectedItemId);
  if (!item) { strip.hidden = true; return; }
  strip.hidden = false;
  $('#editStripLabel').textContent = item.label;
  const orientEl = $('#editStripOrient');
  if (orientEl) orientEl.textContent = ORIENT_NAMES[item.rot_y] || 'Upright';
  const sw = $('#editSwatch');
  if (sw) sw.style.background = item.color;
  const sh = $('#editStripShape');
  if (sh) sh.textContent = SHAPES[item.shape || 'box'].label;
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

  const queue = sortItemsForPacking(items, strategy);
  const placed = [];
  const unplaced = [];
  let points = [{ x: 0, y: 0, z: 0 }];

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
const GROUP_COLORS = ['#1a6fdb', '#38b47a', '#f4a11c', '#8b5cf6', '#ec4899', '#14b8a6'];

// The builder describes three packaging levels. What each level is actually
// called depends on the product — cans in trays on pallets, or loins in
// interleaved blocks in master cartons — so the user names them.
const TERM_DEFAULTS = { product: 'Unit', primary: 'Pack', secondary: 'Pallet' };
const TERM_SUGGESTIONS = {
  product: [
    'Can', 'Tin', 'Pouch', 'Jar', 'Bottle', 'Tub', 'Cup',
    'Loin', 'Fillet', 'Steak', 'Portion', 'Saku block', 'Brick', 'Slab', 'Whole fish',
    'Bag', 'Sachet', 'Vacuum pack', 'Skin pack', 'Piece', 'Unit'
  ],
  primary: [
    'Tray', 'Carton', 'Master carton', 'Inner carton', 'Case', 'Box', 'Shipper',
    'Shrink pack', 'Multipack', 'Bundle', 'Interleaved block', 'Layer pack',
    'Bag', 'Sack', 'Polybag', 'Crate', 'Tote'
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

function pluralise(word, n) {
  const w = String(word || '').trim();
  if (!w || n === 1) return w;
  if (INVARIANT_PLURALS.has(w.toLowerCase())) return w;
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  return w + 's';
}

// term('product', 12) -> "Cans"   term('primary', 1, true) -> "tray"
function term(level, n = 1, lower = false) {
  const raw = (builder?.terms?.[level] || '').trim() || TERM_DEFAULTS[level];
  const out = pluralise(raw, n);
  return lower ? out.toLowerCase() : out;
}

let cartonSpecs = [];
let builderQty = 1;
let builder = null;                      // working spec
let bPreview = null;                     // { renderer, scene, camera, controls, group, raf }

function newGroup(index = 0) {
  return {
    id: 'g_' + Math.random().toString(36).slice(2, 8),
    product_name: '',
    batch_lot: '',
    medium: '',
    shape: 'cylinder',                   // 'cylinder' | 'box'
    unit_d_mm: 73,                       // diameter — cylinder
    unit_l_mm: 73,                       // footprint — box
    unit_w_mm: 73,
    unit_h_mm: 43,
    unit_weight_g: 95,
    cols: 4, rows: 3, layers: 4,
    color: GROUP_COLORS[index % GROUP_COLORS.length]
  };
}

function newBuilderSpec() {
  return {
    name: '',
    terms: { product: 'Can', primary: 'Tray', secondary: 'Pallet' },
    wall_mm: 3,
    gap_mm: 2,
    tare_kg: 0.4,
    groups: [newGroup(0)],
    pallet: {
      enabled: false,
      preset: 'eur1',
      length_cm: 120, width_cm: 80,
      deck_h_cm: 14.5, deck_kg: 25,
      max_h_cm: 180,
      overhang_mm: 0,
      layers: 0,                         // 0 = auto from max height
      pattern: 'block',
      batch_code: '', order_no: '', packer: ''
    }
  };
}

let builderPreviewMode = 'carton';       // 'carton' | 'pallet'

// Footprint of one unit in mm (cylinders occupy their bounding square)
function groupUnitFootprint(g) {
  return g.shape === 'cylinder'
    ? { l: g.unit_d_mm, w: g.unit_d_mm }
    : { l: g.unit_l_mm, w: g.unit_w_mm };
}

function groupUnitCount(g) {
  return Math.max(0, g.cols) * Math.max(0, g.rows) * Math.max(0, g.layers);
}

// Derive carton outer dimensions (cm) and weight (kg) from the spec
function computeCarton(spec) {
  const gap = spec.gap_mm || 0;
  const wall = spec.wall_mm || 0;

  let innerL = 0, innerW = 0, innerH = 0;
  let unitTotal = 0, contentKg = 0;

  spec.groups.forEach(g => {
    const fp = groupUnitFootprint(g);
    const gl = g.cols * fp.l + Math.max(0, g.cols - 1) * gap;
    const gw = g.rows * fp.w + Math.max(0, g.rows - 1) * gap;
    const gh = g.layers * g.unit_h_mm + Math.max(0, g.layers - 1) * gap;
    innerL = Math.max(innerL, gl);
    innerW = Math.max(innerW, gw);
    innerH += gh;
    const n = groupUnitCount(g);
    unitTotal += n;
    contentKg += n * (g.unit_weight_g || 0) / 1000;
  });

  // Gap between stacked groups
  if (spec.groups.length > 1) innerH += gap * (spec.groups.length - 1);

  const outerL_mm = innerL + wall * 2;
  const outerW_mm = innerW + wall * 2;
  const outerH_mm = innerH + wall * 2;

  return {
    length_cm: outerL_mm / 10,
    width_cm:  outerW_mm / 10,
    height_cm: outerH_mm / 10,
    inner: { l: innerL, w: innerW, h: innerH },
    weight_kg: contentKg + (spec.tare_kg || 0),
    content_kg: contentKg,
    units: unitTotal
  };
}

// ---- pallet layout ----
// Lay trays across a pallet deck, trying pure orientations and two-zone
// splits, and keep whichever pattern fits the most trays per layer.
function gridLayout(cols, rows, w, d, offX, offZ, rot) {
  const out = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
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
  const over = (p.overhang_mm || 0) / 10;            // mm → cm, per side
  const deckL = p.length_cm, deckW = p.width_cm;
  const usableL = deckL + over * 2;
  const usableW = deckW + over * 2;

  const layoutBest = computePalletLayout(carton.length_cm, carton.width_cm, usableL, usableW);

  // Interlocking alternates orientation, so capacity falls to the weaker pattern
  const pureA = (() => {
    const c = Math.floor(usableL / carton.length_cm), r = Math.floor(usableW / carton.width_cm);
    return (c > 0 && r > 0) ? gridLayout(c, r, carton.length_cm, carton.width_cm, 0, 0, 0) : [];
  })();
  const pureB = (() => {
    const c = Math.floor(usableL / carton.width_cm), r = Math.floor(usableW / carton.length_cm);
    return (c > 0 && r > 0) ? gridLayout(c, r, carton.width_cm, carton.length_cm, 0, 0, 90) : [];
  })();

  let layouts, perLayer;
  if (p.pattern === 'interlock' && pureA.length && pureB.length) {
    perLayer = Math.min(pureA.length, pureB.length);
    layouts = [pureA.slice(0, perLayer), pureB.slice(0, perLayer)];
  } else {
    perLayer = layoutBest.length;
    layouts = [layoutBest];
  }

  const maxLayers = carton.height_cm > 0
    ? Math.max(0, Math.floor((p.max_h_cm - p.deck_h_cm) / carton.height_cm))
    : 0;
  const layers = p.layers > 0 ? Math.min(p.layers, Math.max(maxLayers, 1)) : maxLayers;

  const trays = perLayer * layers;
  const totalH = p.deck_h_cm + layers * carton.height_cm;
  const weight = p.deck_kg + trays * carton.weight_kg;

  // Actual footprint the trays really use, including overhang
  let extentL = 0, extentW = 0;
  (layouts[0] || []).forEach(t => {
    extentL = Math.max(extentL, t.x + t.w);
    extentW = Math.max(extentW, t.z + t.d);
  });

  return {
    layouts, perLayer, layers, maxLayers, trays,
    length_cm: Math.max(deckL, extentL),
    width_cm:  Math.max(deckW, extentW),
    height_cm: totalH,
    weight_kg: weight,
    units: trays * carton.units,
    overhangs: extentL > deckL + 0.01 || extentW > deckW + 0.01
  };
}

// Factorise a target unit count into a compact cols x rows x layers
function suggestArrangement(g, target) {
  if (!target || target < 1) return null;
  const fp = groupUnitFootprint(g);
  let best = null;
  for (let layers = 1; layers <= target; layers++) {
    if (target % layers !== 0) continue;
    const perLayer = target / layers;
    for (let cols = 1; cols <= perLayer; cols++) {
      if (perLayer % cols !== 0) continue;
      const rows = perLayer / cols;
      const L = cols * fp.l, W = rows * fp.w, H = layers * g.unit_h_mm;
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
  wrap.innerHTML = builder.groups.map((g, idx) => {
    const n = groupUnitCount(g);
    const isCyl = g.shape === 'cylinder';
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
        <label class="field">
          <span>Batch / lot</span>
          <input data-f="batch_lot" type="text" value="${escapeHtml(g.batch_lot)}" placeholder="LOT-TH-26014" />
        </label>
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
          <span>Ø (mm)</span>
          <input data-f="unit_d_mm" type="number" min="1" step="0.5" value="${g.unit_d_mm}" />
        </label>
        <label class="field">
          <span>Height (mm)</span>
          <input data-f="unit_h_mm" type="number" min="1" step="0.5" value="${g.unit_h_mm}" />
        </label>
        <label class="field">
          <span>Weight (g)</span>
          <input data-f="unit_weight_g" type="number" min="0" step="1" value="${g.unit_weight_g}" />
        </label>
      </div>` : `
      <div class="form-row-4">
        <label class="field">
          <span>L (mm)</span>
          <input data-f="unit_l_mm" type="number" min="1" step="0.5" value="${g.unit_l_mm}" />
        </label>
        <label class="field">
          <span>W (mm)</span>
          <input data-f="unit_w_mm" type="number" min="1" step="0.5" value="${g.unit_w_mm}" />
        </label>
        <label class="field">
          <span>H (mm)</span>
          <input data-f="unit_h_mm" type="number" min="1" step="0.5" value="${g.unit_h_mm}" />
        </label>
        <label class="field">
          <span>Wt (g)</span>
          <input data-f="unit_weight_g" type="number" min="0" step="1" value="${g.unit_weight_g}" />
        </label>
      </div>`}

      <div class="form-row-3">
        <label class="field">
          <span>Across L</span>
          <input data-f="cols" type="number" min="1" step="1" value="${g.cols}" />
        </label>
        <label class="field">
          <span>Across W</span>
          <input data-f="rows" type="number" min="1" step="1" value="${g.rows}" />
        </label>
        <label class="field">
          <span>Layers</span>
          <input data-f="layers" type="number" min="1" step="1" value="${g.layers}" />
        </label>
      </div>

      <div class="bsuggest">
        <label class="field">
          <span>Target ${escapeHtml(term('product', 2, true))} per ${escapeHtml(term('primary', 1, true))}</span>
          <input data-f="__target" type="number" min="1" step="1" placeholder="e.g. 48" />
        </label>
        <button type="button" data-suggest="${g.id}">Arrange</button>
      </div>
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
        g[f] = input.type === 'number' ? (parseFloat(input.value) || 0) : input.value;
        // Keep a cylinder's footprint square
        if (f === 'unit_d_mm') { g.unit_l_mm = g.unit_d_mm; g.unit_w_mm = g.unit_d_mm; }
        updateBuilderComputed();
        rebuildBuilderPreview();
        const badge = card.querySelector('.bgroup-count');
        const n = groupUnitCount(g);
        if (badge) badge.textContent = `${n} ${term('product', n, true)}`;
      });
    });
    card.querySelectorAll('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        g.shape = btn.dataset.shape;
        if (g.shape === 'cylinder') { g.unit_l_mm = g.unit_d_mm; g.unit_w_mm = g.unit_d_mm; }
        renderBuilderGroups();
        updateBuilderComputed();
        rebuildBuilderPreview();
      });
    });
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
}

function updateBuilderComputed() {
  const c = computeCarton(builder);
  const on = builder.pallet.enabled;
  const p = on ? computePallet(builder, c) : null;

  const PRIM = term('primary', 1, true);
  const SEC  = term('secondary', 1, true);

  // Step 1 -> 2 connector
  $('#bFlow1').textContent = c.units
    ? `${c.units} ${term('product', c.units, true)} per ${PRIM}`
    : `packed into a ${PRIM}`;

  // Step 2 output
  const trayOut = $('#bTrayOut');
  if (c.units === 0) {
    trayOut.className = 'bstep-out bstep-out-idle';
    trayOut.textContent = `Add contents above to size the ${PRIM}`;
  } else {
    trayOut.className = 'bstep-out';
    trayOut.innerHTML = `<b>${c.units}</b> ${escapeHtml(term('product', c.units, true))} · <b>${fromCm(c.length_cm)} × ${fromCm(c.width_cm)} × ${fromCm(c.height_cm)} ${itemUnit}</b> · <b>${c.weight_kg.toFixed(2)} kg</b>`;
  }

  // Step 2 -> 3 connector
  $('#bFlow2').textContent = on && p?.perLayer
    ? `${p.perLayer} ${term('primary', p.perLayer, true)} per layer`
    : `stacked on a ${SEC}`;

  // Step 3 output
  const palletOut = $('#bPalletOut');
  $('#bPalletStep').classList.toggle('bstep-off', !on);
  if (!on) {
    palletOut.className = 'bstep-out bstep-out-idle';
    palletOut.innerHTML = `Skipped — ${escapeHtml(term('primary', 2, true))} load loose into the container`;
  } else if (!p || p.trays === 0) {
    palletOut.className = 'bstep-out bstep-out-warn';
    palletOut.textContent = `No ${term('primary', 2, true)} fit — check the base size and max height`;
  } else {
    palletOut.className = 'bstep-out';
    palletOut.innerHTML = `<b>${p.trays}</b> ${escapeHtml(term('primary', p.trays, true))} · <b>${fromCm(p.length_cm)} × ${fromCm(p.width_cm)} × ${fromCm(p.height_cm)} ${itemUnit}</b> · <b>${p.weight_kg.toFixed(1)} kg</b>`;
  }

  // Final step — what actually goes into the container
  const ship = on && p?.trays
    ? { l: p.length_cm, w: p.width_cm, h: p.height_cm, kg: p.weight_kg, units: p.units, what: SEC }
    : { l: c.length_cm, w: c.width_cm, h: c.height_cm, kg: c.weight_kg, units: c.units, what: PRIM };
  const fits = ship.l <= cargoSpace.length * 100 &&
               ship.w <= cargoSpace.width  * 100 &&
               ship.h <= cargoSpace.height * 100;

  $('#bContainerSub').textContent = `one ${ship.what}`;
  const contOut = $('#bContainerOut');
  if (ship.units === 0) {
    contOut.className = 'bstep-out bstep-out-idle';
    contOut.textContent = 'Nothing to load yet';
  } else if (!fits) {
    contOut.className = 'bstep-out bstep-out-warn';
    contOut.innerHTML = `This ${escapeHtml(ship.what)} is larger than the cargo space`;
  } else {
    contOut.className = 'bstep-out bstep-out-ok';
    contOut.innerHTML = `Each ${escapeHtml(ship.what)} carries <b>${ship.units}</b> ${escapeHtml(term('product', ship.units, true))} at <b>${ship.kg.toFixed(1)} kg</b>`;
  }

  // Right-hand summary panel
  $('#bComputed').innerHTML = `
    <div class="bcomp-row bcomp-hero">
      <span>${escapeHtml(term(on && p?.trays ? 'secondary' : 'primary'))} size</span>
      <b>${fromCm(ship.l)} × ${fromCm(ship.w)} × ${fromCm(ship.h)} ${itemUnit}</b>
    </div>
    ${on && p?.trays ? `
      <div class="bcomp-row"><span>${escapeHtml(term('primary', 2))}</span><b>${p.trays}</b></div>
      <div class="bcomp-row"><span>Per ${escapeHtml(PRIM)}</span><b>${c.units} ${escapeHtml(term('product', c.units, true))} · ${c.weight_kg.toFixed(2)} kg</b></div>
    ` : `
      <div class="bcomp-row"><span>Content weight</span><b>${c.content_kg.toFixed(2)} kg</b></div>
      <div class="bcomp-row"><span>Batch groups</span><b>${builder.groups.length}</b></div>
    `}
    <div class="bcomp-row"><span>Total ${escapeHtml(term('product', 2, true))}</span><b>${ship.units}</b></div>
    <div class="bcomp-row"><span>Gross weight</span><b>${ship.kg.toFixed(1)} kg</b></div>
  `;

  updatePalletFit(c, p);
}

function updatePalletFit(c, p) {
  const box = $('#bPalletFit');
  if (!box) return;
  if (!builder.pallet.enabled) { box.innerHTML = ''; return; }
  if (!p || p.perLayer === 0) {
    box.innerHTML = `<div class="pf-warn">${escapeHtml(term('primary'))} is too large for this ${escapeHtml(term('secondary', 1, true))} base.</div>`;
    return;
  }
  const pat = builder.pallet.pattern === 'interlock' ? 'interlocked' : 'block';
  box.innerHTML = `
    <div>${p.perLayer} per layer × ${p.layers} layer${p.layers === 1 ? '' : 's'} = <b>${p.trays}</b> ${escapeHtml(term('primary', p.trays, true))}</div>
    <div>${pat} pattern · max ${p.maxLayers} layer${p.maxLayers === 1 ? '' : 's'} under ${fromCm(builder.pallet.max_h_cm)} ${itemUnit}</div>
    ${p.overhangs ? `<div class="pf-warn">${escapeHtml(term('primary', 2))} overhang the base.</div>` : ''}
  `;
}

function renderTermInputs() {
  $('#bTermProduct').value   = builder.terms.product;
  $('#bTermPrimary').value   = builder.terms.primary;
  $('#bTermSecondary').value = builder.terms.secondary;
  $('#bPreviewPrimary').textContent   = term('primary');
  $('#bPreviewSecondary').textContent = term('secondary');
  refreshSegments();                   // pill widths changed
}

// Typeable input with a styled suggestion list. The native <datalist> popup is
// drawn by the browser and can't be themed, so this replaces it.
function initTermCombo(input) {
  const combo = input.closest('.combo');
  const menu  = combo.querySelector('.combo-menu');
  const level = combo.dataset.term;
  let cursor = -1;

  const options = () => [...menu.querySelectorAll('.combo-option')];

  const paint = () => {
    options().forEach((o, i) => o.classList.toggle('active', i === cursor));
    const active = options()[cursor];
    if (active) active.scrollIntoView({ block: 'nearest' });
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    const list = TERM_SUGGESTIONS[level].filter(t => !q || t.toLowerCase().includes(q));
    cursor = -1;
    if (!list.length) { menu.innerHTML = ''; menu.hidden = true; return; }
    menu.innerHTML = list
      .map(t => `<div class="combo-option" data-v="${escapeHtml(t)}">${escapeHtml(t)}</div>`)
      .join('');
    options().forEach(o => {
      // mousedown fires before blur, so the click isn't lost to the menu closing
      o.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = o.dataset.v;
        onTermChange();
        close();
      });
    });
  };

  const open  = () => { render(); if (menu.innerHTML) menu.hidden = false; };
  const close = () => { menu.hidden = true; cursor = -1; };

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { onTermChange(); open(); });
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
        onTermChange();
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
  builder.terms.secondary = $('#bTermSecondary').value;
  $('#bPreviewPrimary').textContent   = term('primary');
  $('#bPreviewSecondary').textContent = term('secondary');
  refreshSegments();
  renderBuilderGroups();               // group cards carry term-dependent labels
  updateBuilderComputed();
}

function renderPalletFields() {
  const p = builder.pallet;
  $('#bPalletOn').checked = p.enabled;
  $('#bPalletFields').hidden = !p.enabled;
  $('#bPalletPreset').value  = p.preset;
  $('#bPalletPattern').value = p.pattern;
  $('#bPalletL').value       = p.length_cm;
  $('#bPalletW').value       = p.width_cm;
  $('#bPalletH').value       = p.deck_h_cm;
  $('#bPalletKg').value      = p.deck_kg;
  $('#bPalletMaxH').value    = p.max_h_cm;
  $('#bPalletOver').value    = p.overhang_mm;
  $('#bPalletLayers').value  = p.layers || '';
  $('#bPalletBatch').value   = p.batch_code;
  $('#bPalletOrder').value   = p.order_no;
  $('#bPalletPacker').value  = p.packer;
}

function readPalletFields() {
  const p = builder.pallet;
  p.enabled     = $('#bPalletOn').checked;
  p.preset      = $('#bPalletPreset').value;
  p.pattern     = $('#bPalletPattern').value;
  p.length_cm   = parseFloat($('#bPalletL').value) || 0;
  p.width_cm    = parseFloat($('#bPalletW').value) || 0;
  p.deck_h_cm   = parseFloat($('#bPalletH').value) || 0;
  p.deck_kg     = parseFloat($('#bPalletKg').value) || 0;
  p.max_h_cm    = parseFloat($('#bPalletMaxH').value) || 0;
  p.overhang_mm = parseFloat($('#bPalletOver').value) || 0;
  p.layers      = parseInt($('#bPalletLayers').value, 10) || 0;
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
  const c = computeCarton(builder);
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
    const trayColor = builder.groups[0]?.color || '#1a6fdb';
    const mat = new THREE.MeshStandardMaterial({
      color: trayColor, roughness: 0.6, metalness: 0.1
    });
    const geo = new THREE.BoxGeometry(1, 1, 1);        // scaled per instance
    const mesh = new THREE.InstancedMesh(geo, mat, p.trays);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let i = 0;

    for (let layer = 0; layer < p.layers; layer++) {
      const layout = p.layouts[layer % p.layouts.length];
      const y = -totalH / 2 + deckH + (layer + 0.5) * c.height_cm * S;
      layout.forEach(t => {
        if (i >= p.trays) return;
        pos.set(
          (t.x + t.w / 2) * S - deckL / 2,
          y,
          (t.z + t.d / 2) * S - deckW / 2
        );
        scl.set(t.w * S * 0.98, c.height_cm * S * 0.98, t.d * S * 0.98);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i++, m);
      });
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    bPreview.group.add(mesh);
  }

  // Stretch-wrap shell over the stack
  if (p.layers > 0) {
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

function buildCartonPreview() {
  const c = computeCarton(builder);
  const S = 0.001;                                    // mm → preview metres
  const wall = builder.wall_mm || 0;
  const gap = builder.gap_mm || 0;
  const outerL = c.length_cm * 10 * S;
  const outerW = c.width_cm  * 10 * S;
  const outerH = c.height_cm * 10 * S;

  // Translucent carton shell
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(outerL, outerH, outerW),
    new THREE.MeshStandardMaterial({
      color: 0xc9a227, roughness: 0.9, metalness: 0.02,
      transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false
    })
  );
  bPreview.group.add(shell);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(outerL, outerH, outerW)),
    new THREE.LineBasicMaterial({ color: 0x8a6d1f, transparent: true, opacity: 0.55 })
  );
  bPreview.group.add(edges);

  // Units, group by group, stacking upward from the inner floor
  let yCursor = -outerH / 2 + wall * S;
  builder.groups.forEach(g => {
    const fp = groupUnitFootprint(g);
    const mat = new THREE.MeshStandardMaterial({
      color: g.color, roughness: 0.55, metalness: 0.15
    });
    const geo = g.shape === 'cylinder'
      ? new THREE.CylinderGeometry(g.unit_d_mm / 2 * S, g.unit_d_mm / 2 * S, g.unit_h_mm * S, 20)
      : new THREE.BoxGeometry(g.unit_l_mm * S, g.unit_h_mm * S, g.unit_w_mm * S);

    const spanL = (g.cols * fp.l + Math.max(0, g.cols - 1) * gap) * S;
    const spanW = (g.rows * fp.w + Math.max(0, g.rows - 1) * gap) * S;
    const startX = -spanL / 2 + fp.l * S / 2;
    const startZ = -spanW / 2 + fp.w * S / 2;

    const count = g.cols * g.rows * g.layers;
    if (count > 0 && count <= 4000) {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      const m = new THREE.Matrix4();
      let i = 0;
      for (let ly = 0; ly < g.layers; ly++) {
        const y = yCursor + g.unit_h_mm * S / 2 + ly * (g.unit_h_mm + gap) * S;
        for (let cx = 0; cx < g.cols; cx++) {
          for (let rz = 0; rz < g.rows; rz++) {
            m.makeTranslation(
              startX + cx * (fp.l + gap) * S,
              y,
              startZ + rz * (fp.w + gap) * S
            );
            mesh.setMatrixAt(i++, m);
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      bPreview.group.add(mesh);
    } else {
      geo.dispose(); mat.dispose();
    }

    yCursor += (g.layers * g.unit_h_mm + Math.max(0, g.layers - 1) * gap + gap) * S;
  });

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
function openBuilder() {
  if (!builder) builder = newBuilderSpec();
  if (!builder.terms) builder.terms = { ...newBuilderSpec().terms };
  $('#bName').value = builder.name;
  $('#bWall').value = builder.wall_mm;
  $('#bGap').value  = builder.gap_mm;
  $('#bTare').value = builder.tare_kg;
  renderTermInputs();
  renderBuilderGroups();
  renderPalletFields();
  renderCartonSpecDropdown();
  if (!builder.pallet.enabled) builderPreviewMode = 'carton';
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
  stopBuilderLoop();
}

// ---- push the built carton into the plan ----
function addBuiltCartonToPlan() {
  const c = computeCarton(builder);
  if (c.units === 0) return showToast('Add some contents first.');

  const onPallet = builder.pallet.enabled;
  const p = onPallet ? computePallet(builder, c) : null;
  const PRIM = term('primary', 1, true);
  const SEC  = term('secondary', 1, true);

  if (onPallet && p.trays === 0) {
    return showToast(`No ${term('primary', 2, true)} fit on this ${SEC} — check the base size and max height.`);
  }

  const ship = onPallet
    ? { l: p.length_cm, w: p.width_cm, h: p.height_cm, kg: p.weight_kg, units: p.units }
    : { l: c.length_cm, w: c.width_cm, h: c.height_cm, kg: c.weight_kg, units: c.units };

  if (ship.l > cargoSpace.length * 100 ||
      ship.w > cargoSpace.width  * 100 ||
      ship.h > cargoSpace.height * 100) {
    return showToast(`${onPallet ? term('secondary') : term('primary')} is larger than the cargo space.`);
  }

  const baseLabel = ($('#bName').value.trim()) || generateBaseLabel(onPallet ? 'pallet' : 'carton');
  const productName = builder.groups[0]?.product_name || '';
  const color = pickColorForBase(baseLabel);
  const palletLot = builder.pallet.batch_code.trim();

  // Per-unit contents, multiplied up by the tray count when palletised
  const multiplier = onPallet ? p.trays : 1;
  const contents = builder.groups.map(g => ({
    product_name: g.product_name || productName,
    batch_lot: (g.batch_lot.trim() || palletLot) || null,
    medium: g.medium || null,
    quantity: groupUnitCount(g) * multiplier
  }));

  for (let n = 0; n < builderQty; n++) {
    const suffix = builderQty > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
    const item = addItem({
      label: baseLabel + suffix,
      base_label: baseLabel,
      product_name: productName,
      kind: onPallet ? 'pallet' : 'carton',
      length_cm: Number(ship.l.toFixed(2)),
      width_cm:  Number(ship.w.toFixed(2)),
      height_cm: Number(ship.h.toFixed(2)),
      weight_kg: Number(ship.kg.toFixed(3)),
      handling: 'standard',
      color
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
  }

  updateStats();
  renderCargoList();
  closeBuilder();
  showToast(onPallet
    ? `Added <b>${builderQty}</b> ${escapeHtml(term('secondary', builderQty, true))} — ${p.trays} ${escapeHtml(term('primary', p.trays, true))}, ${ship.units * builderQty} ${escapeHtml(term('product', 2, true))}.`
    : `Added <b>${builderQty}</b> × ${escapeHtml(baseLabel)} — ${c.units * builderQty} ${escapeHtml(term('product', 2, true))}.`);
}

// ============================================================
// RIGHT PANEL — Add / Items tabs and collapsible options
// ============================================================
function setPanelTab(pane) {
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
  if (isContainer) updateSceneDimsDisplay();
  else             renderCargoList();

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
  if (!hits.length) return null;
  return { itemId: hits[0].object.userData.itemId, point: hits[0].point.clone() };
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
}

function onPointerLeave() {
  if (hoveredItemId !== null) {
    hoveredItemId = null;
    updateLabelVisibility();
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (e.shiftKey || e.altKey) return;
  if (isPacking) return;                 // scene is animating

  const hit = hitCarton(e);
  if (!hit) { deselectAll(); return; }

  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  selectItem(hit.itemId);

  const item = items.find(i => i.id === hit.itemId);
  const plane = getDragPlane(item);
  const startWorld = raycastDragPlane(e, plane);
  if (!startWorld) return;

  dragState = {
    itemId: hit.itemId,
    plane,
    startWorld,
    origPos: { x: item.pos_x, y: item.pos_y, z: item.pos_z },
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

  let newXcm = dragState.origPos.x;
  let newYcm = dragState.origPos.y;
  let newZcm = dragState.origPos.z;
  let useSupport = true;

  if (sceneMode === '3d' || orthoView === 'top') {
    // Top view: raycast to another box's top face → stack
    updateMouseNormalized(e);
    raycaster.setFromCamera(_mouse, camera);
    const others = cartonGroup.children.filter(m => m.userData.itemId !== dragState.itemId);
    const boxHits = raycaster.intersectObjects(others, false);
    const topHit = boxHits.find(h => h.face && h.face.normal.y > 0.7);
    let hoverSupportId = null;
    if (topHit) {
      newXcm = topHit.point.x * 100;
      newZcm = (topHit.point.z + cargoSpace.width / 2) * 100;
      hoverSupportId = topHit.object.userData.itemId;
    } else {
      newXcm = dragState.origPos.x + dxCm;
      newZcm = dragState.origPos.z + dzCm;
    }
    newXcm = snapToGrid(newXcm);
    newZcm = snapToGrid(newZcm);
    if (hoverSupportId) {
      const support = items.find(i => i.id === hoverSupportId);
      if (support) {
        if (Math.abs(newXcm - support.pos_x) < CENTER_SNAP_CM) newXcm = support.pos_x;
        if (Math.abs(newZcm - support.pos_z) < CENTER_SNAP_CM) newZcm = support.pos_z;
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
  if (dragState) {
    if (canvas.hasPointerCapture(dragState.pointerId)) {
      canvas.releasePointerCapture(dragState.pointerId);
    }
    if (dragState.stackTargetId) restoreWireframe(dragState.stackTargetId);
    if (dragState.moved) {
      settleAll();
      updateStats();
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
    if (newSize < GRID_CM) newSize = GRID_CM;
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
  const step = Math.max(0.25, niceStep(L / 28));
  const majorEvery = Math.max(2, Math.round(1 / step));
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

  if (sceneMode === '2d' && orthoView === 'front') {
    along(zs, z => P(0.02, 0, z - W / 2 - 0.16));
    along(ys, y => P(0.02, y, W / 2 + 0.16));
  } else if (sceneMode === '2d' && orthoView === 'side') {
    along(xs, x => P(x, -0.16, -W / 2 + 0.02));
    along(ys, y => P(L + 0.16, y, -W / 2 + 0.02));
  } else {
    along(xs, x => P(x, 0, W / 2 + 0.16));             // length, along the near edge
    along(zs, z => P(L + 0.16, 0, z - W / 2));         // width, along the door end
  }

  for (let i = n; i < rulerPool.length; i++) rulerPool[i].g.style.display = 'none';
}

function updateDimOverlay() {
  const svg = $('#dimOverlay');
  if (measureGroup) measureGroup.visible = showDims;
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
    : `2D ${orthoView.toUpperCase()} · DRAG CARTON · DRAG CORNERS/EDGES TO RESIZE · SCROLL TO ZOOM`;

  try { localStorage.setItem(SCENE_MODE_KEY, mode); } catch (e) {}
}

function positionOrthoCamera(view) {
  orthoView = view;
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
    contentW = L * 1.15; contentH = H * 1.15;
    camPos = new THREE.Vector3(L / 2, H / 2, 30);
    target = new THREE.Vector3(L / 2, H / 2, 0);
    up = new THREE.Vector3(0, 1, 0);
  } else {
    // front — camera looks from +X down the length
    contentW = W * 1.15; contentH = H * 1.15;
    camPos = new THREE.Vector3(L + 30, H / 2, 0);
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
  $$('.view-pills-2d .view-pill').forEach(p =>
    p.classList.toggle('selected', p.dataset.view === view));

  $('#viewportHint').textContent =
    `2D ${orthoView.toUpperCase()} · DRAG CARTON · DRAG CORNERS/EDGES TO RESIZE · SCROLL TO ZOOM`;
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
  updateAnnotations();
  renderer.render(scene, camera);
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

function dolly(step) {
  if (sceneMode === '3d') {
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    camera.position.addScaledVector(dir, step);
  } else {
    orthoCamera.zoom = Math.max(0.2, Math.min(10, orthoCamera.zoom * (step > 0 ? 1.15 : 0.87)));
    orthoCamera.updateProjectionMatrix();
  }
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
    { keys: [modKey, 'D'],  desc: 'Duplicate selected carton' },
    { keys: ['L'],          desc: 'Toggle carton labels' },
    { keys: ['G'],          desc: 'Toggle dimension guides' },
    { keys: ['P'],          desc: 'Auto-pack the plan' },
    { keys: ['2'],          desc: 'Switch to 2D orthographic mode' },
    { keys: ['3'],          desc: 'Switch to 3D perspective mode' },
    { keys: ['?'],          desc: 'Show this shortcuts guide' }
  ];
  const mouse = [
    { keys: ['Left-drag empty'],     desc: 'Orbit scene (3D) or pan (2D)' },
    { keys: ['Left-drag carton'],    desc: 'Move carton — top: X/Z · side: X/Y · front: Y/Z' },
    { keys: ['Vertical drag (2D)'],  desc: 'Lift a box to stack it (side/front views)' },
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
async function savePlan(status) {
  const name = $('#planName').value.trim();
  if (!name) { $('#planName').focus(); return showToast('Give the plan a name first.'); }
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
    if (currentPlanId) {
      const { data, error } = await supabase.from('load_plans').update(planPayload).eq('id', currentPlanId).select().single();
      if (error) throw error;
      planRow = data;
      const { error: delErr } = await supabase.from('load_plan_items').delete().eq('load_plan_id', currentPlanId);
      if (delErr) throw delErr;
    } else {
      const { data, error } = await supabase.from('load_plans').insert(planPayload).select().single();
      if (error) throw error;
      planRow = data;
      currentPlanId = planRow.id;
    }

    if (items.length > 0) {
      const itemsPayload = items.map(i => ({
        load_plan_id: currentPlanId,
        label: i.label, base_label: i.base_label,
        product_name: i.product_name || null,
        kind: i.kind || 'carton',
        length_cm: i.length_cm, width_cm: i.width_cm, height_cm: i.height_cm,
        weight_kg: i.weight_kg, color: i.color, shape: i.shape || 'box',
        pos_x: i.pos_x, pos_y: i.pos_y, pos_z: i.pos_z, rot_y: i.rot_y,
        handling: i.handling
      }));
      const { data: insertedItems, error: iErr } = await supabase
        .from('load_plan_items').insert(itemsPayload).select('id');
      if (iErr) throw iErr;

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

    planStatus = planRow.status;
    markClean();

    const url = new URL(window.location);
    url.searchParams.set('plan', currentPlanId);
    window.history.replaceState({}, '', url);

    showToast(`Plan <b>${escapeHtml(name)}</b> ${status === 'published' ? 'published' : 'saved'}.`);
  } catch (err) {
    console.error('Save failed:', err);
    showToast(`Save failed: ${err.message || 'unknown error'}`);
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
        rot_y: it.rot_y || 0,
        pos_x: it.pos_x, pos_y: it.pos_y, pos_z: it.pos_z,
        contents: contentsByItem[it.id] || null
      });
    });

    recomputeBatchCounter();
    updateStats();
    renderCargoList();
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
  showToast(`<b>Cargo space</b> updated to ${fromM(L)} × ${fromM(W)} × ${fromM(H)} ${containerUnit}.`);
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
  $$('.view-pills-2d .view-pill').forEach(p => p.classList.remove('selected'));
  pill.classList.add('selected');
  positionOrthoCamera(pill.dataset.view);
}));

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

$('#modeClear').addEventListener('click', () => deselectAll());

$('#primaryFormBtn').addEventListener('click', () => {
  if (selectedItemId) updateSelectedItem();
  else addNewItems();
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
    shape: currentShape
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
  const { labelInput, productInput, L, W, H, wt, handling, kind, shape } = readFormValues();
  if (!validateFormDims(L, W, H)) return;
  const baseLabel = labelInput || generateBaseLabel(kind);
  const color = kind === 'carton' ? pickColorForBase(baseLabel) : KIND_COLORS[kind];
  let last;
  for (let n = 0; n < quantity; n++) {
    const suffix = quantity > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
    last = addItem({
      label: baseLabel + suffix, base_label: baseLabel,
      product_name: productInput,
      kind, shape,
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
  const { labelInput, productInput, L, W, H, wt, handling, shape } = readFormValues();
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
  item.shape = shape;
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

$('#btnFocus').addEventListener('click', () => { if (selectedItemId) focusOnItem(selectedItemId); });

function reorientSelected(nextOrient, verb) {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
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
    kind: item.kind, shape: item.shape,
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

['#bWall', '#bGap', '#bTare', '#bName'].forEach(sel => {
  $(sel).addEventListener('input', () => {
    builder.name    = $('#bName').value;
    builder.wall_mm = parseFloat($('#bWall').value) || 0;
    builder.gap_mm  = parseFloat($('#bGap').value)  || 0;
    builder.tare_kg = parseFloat($('#bTare').value) || 0;
    updateBuilderComputed();
    rebuildBuilderPreview();
  });
});

// Packaging-level names — typeable with a styled suggestion list
['#bTermProduct', '#bTermPrimary', '#bTermSecondary'].forEach(sel =>
  initTermCombo($(sel)));

// Pallet section
const PALLET_FIELD_IDS = ['#bPalletOn', '#bPalletPattern', '#bPalletL', '#bPalletW',
  '#bPalletH', '#bPalletKg', '#bPalletMaxH', '#bPalletOver', '#bPalletLayers',
  '#bPalletBatch', '#bPalletOrder', '#bPalletPacker'];

function onPalletFieldChange() {
  readPalletFields();
  $('#bPalletFields').hidden = !builder.pallet.enabled;
  if (!builder.pallet.enabled && builderPreviewMode === 'pallet') setBuilderPreviewMode('carton');
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
    $('#bPalletL').value  = preset.length;
    $('#bPalletW').value  = preset.width;
    $('#bPalletH').value  = preset.height;
    $('#bPalletKg').value = preset.weight;
  }
  updateBuilderComputed();
  rebuildBuilderPreview();
});

function setBuilderPreviewMode(mode) {
  builderPreviewMode = mode;
  $$('#bPreviewPills .view-pill').forEach(b =>
    b.classList.toggle('selected', b.dataset.preview === mode));
  refreshSegments();
  rebuildBuilderPreview();
}

$$('#bPreviewPills .view-pill').forEach(pill => pill.addEventListener('click', () => {
  if (pill.dataset.preview === 'pallet' && !builder.pallet.enabled) {
    return showToast(`Turn on the <b>${escapeHtml(term('secondary', 1, true))}</b> switch first.`);
  }
  setBuilderPreviewMode(pill.dataset.preview);
}));

$('#bAddGroup').addEventListener('click', () => {
  builder.groups.push(newGroup(builder.groups.length));
  renderBuilderGroups();
  updateBuilderComputed();
  rebuildBuilderPreview();
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
  builder = JSON.parse(JSON.stringify(spec));
  if (!builder.pallet) builder.pallet = newBuilderSpec().pallet;   // specs saved before pallets
  if (!builder.terms)  builder.terms  = newBuilderSpec().terms;    // ...and before named levels
  $('#bName').value = builder.name;
  $('#bWall').value = builder.wall_mm;
  $('#bGap').value  = builder.gap_mm;
  $('#bTare').value = builder.tare_kg;
  renderTermInputs();
  renderBuilderGroups();
  renderPalletFields();
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
function applyColorToSelection(hex) {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const base = item.base_label;
  const group = items.filter(i => i.base_label === base);
  group.forEach(i => {
    i.color = hex;
    if (i.mesh) i.mesh.material.color.set(hex);
    refreshItemSprite(i);
  });
  renderCargoList();
  renderEditStrip();
  markDirty();
  showToast(group.length > 1
    ? `Recoloured <b>${group.length}</b> items in ${escapeHtml(base)}.`
    : `Recoloured <b>${escapeHtml(item.label)}</b>.`);
}

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

  if (e.key === 'Escape') {
    // Close any open custom-select menu first
    const openSel = document.querySelector('.custom-select.open');
    if (openSel) {
      openSel.classList.remove('open');
      openSel.querySelector('.custom-select-menu').hidden = true;
      return;
    }
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
  } else if (e.key === 'd' && selectedItemId && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#btnDuplicate').click();
  } else if (e.key === 'l') {
    $('#toggleLabels').click();
  } else if (e.key === 'g') {
    $('#toggleDims').click();
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

window.addEventListener('beforeunload', (e) => {
  if (isDirty) { e.preventDefault(); e.returnValue = ''; }
});

// ============================================================
// SLIDING INDICATORS — moves the pill between segmented options
// ============================================================
let refreshSegments = () => {};

function initSegmentedIndicators() {
  const SELECTOR = '.view-pills, .scene-toggle, .kind-tabs, .unit-mini, .shape-pick, .panel-tabs';
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
  builder = newBuilderSpec();
  $$('select').forEach(enhanceSelect);      // replace native selects with styled ones
  updateStats();
  renderCargoList();
  renderEditStrip();
  setEditMode(false, null);
  updateOptionsSummary();
  updateStatusChip();

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