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
  '40HC':   { name: "40' High Cube",  length: 12.03, width: 2.35, height: 2.69 },
  '40STD':  { name: "40' Standard",   length: 12.03, width: 2.35, height: 2.39 },
  '20STD':  { name: "20' Standard",   length: 5.90,  width: 2.35, height: 2.39 },
  '45HC':   { name: "45' High Cube",  length: 13.55, width: 2.35, height: 2.69 },
  'Custom': { name: 'Custom',         length: 5.00,  width: 2.00, height: 2.10 }
};

const MODE_LABELS = { Sea: 'SEA', Road: 'ROAD', Air: 'AIR', Rail: 'RAIL' };

const CARGO_COLORS = [
  '#1a6fdb', '#38b47a', '#f4a11c', '#e04a4a',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
  '#f97316', '#84cc16', '#6366f1', '#d946ef'
];

const GRID_CM = 5;
const CENTER_SNAP_CM = 15;
const TEMPLATES_KEY = 'smartuna_planner_templates_v1';
const SCENE_MODE_KEY = 'smartuna_planner_scene_mode';
const REALISTIC_MODE_KEY = 'smartuna_planner_realistic_mode';

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
let raycaster;

let cargoSpace = { length: 12.03, width: 2.35, height: 2.69 };
let transportMode = 'Sea';
let containerPreset = '40HC';

let items = [];
let selectedItemId = null;
let quantity = 1;
let batchCounter = 0;
let showLabels = false;
let dragState = null;

let sceneMode = '3d';                   // '3d' | '2d'
let orthoView = 'top';                  // '2d' sub-view: top | side | front
let last3DView = 'perspective';
let realisticMode = false;              // opt-in realistic container + yard

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

  const grid = new THREE.GridHelper(60, 60, 0xc5d0dc, 0xe5eaf0);
  grid.userData.isGrid = true;
  scene.add(grid);

  // Yard — concrete-like ground plane, receives shadows.
  // Visibility toggled by updateContainerVisibility (only shown in realistic 3D).
  yardMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color: 0x8f8b7f, roughness: 0.95, metalness: 0.02
    })
  );
  yardMesh.rotation.x = -Math.PI / 2;
  yardMesh.position.y = -0.02;
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

  if (realisticMode) {
    buildRealisticContainer(L, W, H);
  } else {
    buildSimpleContainer(L, W, H);
  }

  build2DBackdrops(L, W, H);                 // always add — visible only in 2D

  scene.add(containerGroup);

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
  floor.position.set(L / 2, 0.025, 0);
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

// -------- Realistic container — solid corrugated walls, open doors, corner castings --------
function buildRealisticContainer(L, W, H) {
  const wallColor = 0x3a5878;
  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.65, metalness: 0.35, side: THREE.DoubleSide
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x6d5a3d, roughness: 0.9, metalness: 0.05
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x1c1c1c, roughness: 0.4, metalness: 0.6
  });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, 0.05, W), floorMat);
  floor.position.set(L / 2, 0.025, 0);
  floor.receiveShadow = true;
  floor.userData.isContainerFloor = true;
  containerGroup.add(floor);

  // Walls with outward normals for camera-based culling
  function addWall(dims, position, outwardNormal) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...dims), wallMat);
    wall.position.copy(position);
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.isContainerWall = true;
    wall.userData.outwardNormal = outwardNormal;
    containerGroup.add(wall);
  }
  addWall([0.06, H, W], new THREE.Vector3(0, H / 2, 0), new THREE.Vector3(-1, 0, 0));
  addWall([L, H, 0.06], new THREE.Vector3(L / 2, H / 2, -W / 2), new THREE.Vector3(0, 0, -1));
  addWall([L, H, 0.06], new THREE.Vector3(L / 2, H / 2, W / 2), new THREE.Vector3(0, 0, 1));
  addWall([L, 0.06, W], new THREE.Vector3(L / 2, H, 0), new THREE.Vector3(0, 1, 0));

  // Front doors — hinged at outer corners, swung open ~108°
  function addDoor(hingeZ, isRight) {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(L, 0, hingeZ);
    const panelWidth = W / 2;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, panelWidth), wallMat);
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

  // Sky background any time realistic view is on — 2D side/front need it too
  // because the yard is a horizontal plane and disappears in those views.
  // Fog only in 3D (ortho + fog behaves oddly).
  if (realisticMode) {
    scene.background = new THREE.Color(0xd1dae4);
    scene.fog = !in2D ? new THREE.Fog(0xd1dae4, 30, 90) : null;
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
  const rotated = item.rot_y === 90;
  const boxL = rotated ? item.width_cm  : item.length_cm;
  const boxW = rotated ? item.length_cm : item.width_cm;
  const minX = atX - boxL / 2, maxX = atX + boxL / 2;
  const minZ = atZ - boxW / 2, maxZ = atZ + boxW / 2;
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
  const rotated = item.rot_y === 90;
  const halfL = (rotated ? item.width_cm  : item.length_cm) / 2;
  const halfW = (rotated ? item.length_cm : item.width_cm ) / 2;
  const halfH = item.height_cm / 2;
  item.pos_x = Math.max(halfL, Math.min(L - halfL, item.pos_x));
  item.pos_z = Math.max(halfW, Math.min(W - halfW, item.pos_z));
  item.pos_y = Math.max(halfH, Math.min(H - halfH, item.pos_y));
}

function snapToGrid(cm) { return Math.round(cm / GRID_CM) * GRID_CM; }

// ============================================================
// AUTO-PLACEMENT
// ============================================================
function findFreeSlot(item) {
  const L = cargoSpace.length * 100;
  const W = cargoSpace.width  * 100;
  const H = cargoSpace.height * 100;
  const rotated = item.rot_y === 90;
  const boxL = rotated ? item.width_cm  : item.length_cm;
  const boxW = rotated ? item.length_cm : item.width_cm;
  const halfH = item.height_cm / 2;

  if (boxL > L || boxW > W || item.height_cm > H) {
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
    .sort((a, b) => (a.pos_y + a.height_cm / 2) - (b.pos_y + b.height_cm / 2));

  for (const other of candidates) {
    const supportTop = other.pos_y + other.height_cm / 2;
    if (supportTop + item.height_cm > H) continue;
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

function generateBaseLabel() {
  batchCounter += 1;
  return `BATCH-${String(batchCounter).padStart(2, '0')}`;
}

function recomputeBatchCounter() {
  let max = 0;
  items.forEach(i => {
    const m = /^BATCH-(\d+)$/.exec(i.base_label || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  batchCounter = max;
}

function createItemMesh(item) {
  const rotated = item.rot_y === 90;
  const displayL = (rotated ? item.width_cm  : item.length_cm) / 100;
  const displayW = (rotated ? item.length_cm : item.width_cm ) / 100;
  const displayH = item.height_cm / 100;

  const geo = new THREE.BoxGeometry(displayL, displayH, displayW);
  const mat = new THREE.MeshStandardMaterial({
    color: item.color, roughness: 0.75, metalness: 0.05
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.itemId = item.id;

  const edgeGeo = new THREE.EdgesGeometry(geo);
  const wire = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
    color: 0x1a2536, transparent: true, opacity: 0.45
  }));
  wire.userData.isEdge = true;
  wire.raycast = () => {};
  mesh.add(wire);

  const sprite = createLabelSprite(item);
  sprite.userData.isLabel = true;
  sprite.raycast = () => {};
  sprite.visible = showLabels;
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
  if (sprite) sprite.position.y = item.height_cm / 200 + 0.18;
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
    label: spec.label, base_label: spec.base_label,
    product_name: spec.product_name || '',
    kind: 'carton',
    length_cm: Number(spec.length_cm),
    width_cm:  Number(spec.width_cm),
    height_cm: Number(spec.height_cm),
    weight_kg: Number(spec.weight_kg) || 0,
    handling:  spec.handling || 'standard',
    color:     spec.color,
    rot_y: 0, pos_x: 0, pos_y: 0, pos_z: 0, mesh: null
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
    rot_y:     Number(spec.rot_y) || 0,
    pos_x:     Number(spec.pos_x) || 0,
    pos_y:     Number(spec.pos_y) || 0,
    pos_z:     Number(spec.pos_z) || 0,
    mesh: null
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
  const sorted = [...items].sort((a, b) => (a.pos_y - a.height_cm / 2) - (b.pos_y - b.height_cm / 2));
  for (const item of sorted) {
    const s = findSupportHeight(item, item.pos_x, item.pos_z, item.id);
    item.pos_y = s.top + item.height_cm / 2;
    clampItemToBounds(item);
    refreshItemMesh(item);
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
  batchCounter = 0;
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
  $('#fLength').value   = item.length_cm;
  $('#fWidth').value    = item.width_cm;
  $('#fHeight').value   = item.height_cm;
  $('#fWeight').value   = item.weight_kg || '';
  $('#fHandling').value = item.handling || 'standard';
}

function setEditMode(isEdit, item) {
  const indicator  = $('#modeIndicator');
  const modeText   = $('#modeText');
  const modeClear  = $('#modeClear');
  const primaryBtn = $('#primaryFormBtn');
  const qtyPicker  = $('#qtyPicker');
  if (isEdit && item) {
    indicator.dataset.mode = 'edit';
    modeText.textContent = `Editing: ${item.label}`;
    modeClear.hidden = false;
    primaryBtn.textContent = 'Save changes';
    primaryBtn.classList.add('editing');
    qtyPicker.classList.add('disabled');
  } else {
    indicator.dataset.mode = 'add';
    modeText.textContent = 'Add new cargo';
    modeClear.hidden = true;
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

  $('#cargoCountHint').textContent = items.length === 0 ? 'Step 2' : `${items.length} placed`;
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
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

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
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (e.shiftKey || e.altKey) return;

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
}

function onPointerMove(e) {
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
  let newZcm = dragState.origPos.z;

  if (sceneMode === '3d' || orthoView === 'top') {
    // Top view: check for stacking on another carton
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
  } else if (orthoView === 'side') {
    // Side view: drag along X only (horizontal). Z stays.
    newXcm = snapToGrid(dragState.origPos.x + dxCm);
    newZcm = dragState.origPos.z;
  } else if (orthoView === 'front') {
    // Front view: drag along Z only. X stays.
    newXcm = dragState.origPos.x;
    newZcm = snapToGrid(dragState.origPos.z + dzCm);
  }

  const s = findSupportHeight(item, newXcm, newZcm, item.id);
  item.pos_x = newXcm;
  item.pos_z = newZcm;
  item.pos_y = s.top + item.height_cm / 2;

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
      markDirty();
    }
    dragState = null;
    controls.enabled = true;
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
    let sizeProp;
    if (axis === 'y') sizeProp = 'height_cm';
    else {
      const rotated = orig.rot_y === 90 || item.rot_y === 90;  // rot doesn't change during resize
      if (axis === 'x') sizeProp = rotated ? 'width_cm' : 'length_cm';
      else              sizeProp = rotated ? 'length_cm' : 'width_cm';
    }
    const posProp = 'pos_' + axis;

    const origSize = orig[sizeProp];
    const origCenter = orig[posProp];
    const origMin = origCenter - origSize / 2;
    const origMax = origCenter + origSize / 2;
    const delta = worldDelta[axis];

    let newMin, newMax;
    if (side === 'max') {
      newMax = snapToGrid(origMax + delta);
      newMin = origMin;
    } else {
      newMin = snapToGrid(origMin + delta);
      newMax = origMax;
    }

    let newSize = newMax - newMin;
    if (newSize < GRID_CM) newSize = GRID_CM;
    // Fix drift if we clamped size — keep the fixed edge
    if (side === 'max') newMax = newMin + newSize;
    else                newMin = newMax - newSize;

    // Clamp to container
    const spaceMax = axis === 'x' ? cargoSpace.length * 100
                   : axis === 'y' ? cargoSpace.height * 100
                   : cargoSpace.width * 100;
    if (newMin < 0) { newMin = 0; newMax = newMin + newSize; }
    if (newMax > spaceMax) { newMax = spaceMax; newMin = newMax - newSize; if (newMin < 0) newMin = 0; }

    const finalSize = newMax - newMin;
    const finalCenter = (newMax + newMin) / 2;

    item[sizeProp] = finalSize;
    item[posProp] = finalCenter;
  }
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
  $('#fProduct').value  = t.product_name || '';
  $('#fLength').value   = t.length_cm;
  $('#fWidth').value    = t.width_cm;
  $('#fHeight').value   = t.height_cm;
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
  $('#tplPreview').textContent = `${L} × ${W} × ${H} cm · ${wt} kg · ${handling}` + (product ? ` · ${product}` : '');
  $('#tplModal').hidden = false;
  setTimeout(() => $('#tplName').focus(), 50);
}

function saveTemplateFromForm() {
  const name = $('#tplName').value.trim();
  if (!name) return showToast('Give the template a name.');
  const L = parseFloat($('#fLength').value);
  const W = parseFloat($('#fWidth').value);
  const H = parseFloat($('#fHeight').value);
  const wt = parseFloat($('#fWeight').value) || 0;
  const handling = $('#fHandling').value;
  const product = $('#fProduct').value.trim();
  if (!L || !W || !H) return showToast('Fill in dimensions first.');
  const tpl = {
    id: 't_' + Math.random().toString(36).slice(2, 10),
    name, length_cm: L, width_cm: W, height_cm: H,
    weight_kg: wt, handling, product_name: product,
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
    { keys: ['R'],          desc: 'Rotate selected carton 90°' },
    { keys: [modKey, 'D'],  desc: 'Duplicate selected carton' },
    { keys: ['L'],          desc: 'Toggle carton labels' },
    { keys: ['2'],          desc: 'Switch to 2D orthographic mode' },
    { keys: ['3'],          desc: 'Switch to 3D perspective mode' },
    { keys: ['?'],          desc: 'Show this shortcuts guide' }
  ];
  const mouse = [
    { keys: ['Left-drag empty'],     desc: 'Orbit scene (3D) or pan (2D)' },
    { keys: ['Left-drag carton'],    desc: 'Move carton along the floor' },
    { keys: ['Shift', '+', 'drag'],  desc: 'Orbit even when over a carton' },
    { keys: ['Right-drag'],          desc: 'Orbit (3D) or pan (2D) anywhere' },
    { keys: ['Scroll'],              desc: 'Zoom in / out' },
    { keys: ['Drag handles (2D)'],   desc: 'Resize the selected carton' }
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
        weight_kg: i.weight_kg, color: i.color,
        pos_x: i.pos_x, pos_y: i.pos_y, pos_z: i.pos_z, rot_y: i.rot_y,
        handling: i.handling
      }));
      const { error: iErr } = await supabase.from('load_plan_items').insert(itemsPayload);
      if (iErr) throw iErr;
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

    $('#dimLength').value = cargoSpace.length.toFixed(2);
    $('#dimWidth').value  = cargoSpace.width.toFixed(2);
    $('#dimHeight').value = cargoSpace.height.toFixed(2);
    $('#presetSelect').value = PRESETS[containerPreset] ? containerPreset : 'Custom';
    $('#sceneDims').textContent = `${cargoSpace.length.toFixed(2)} × ${cargoSpace.width.toFixed(2)} × ${cargoSpace.height.toFixed(2)} m`;
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
        rot_y: it.rot_y || 0,
        pos_x: it.pos_x, pos_y: it.pos_y, pos_z: it.pos_z
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
  $('#dimLength').value = p.length.toFixed(2);
  $('#dimWidth').value  = p.width.toFixed(2);
  $('#dimHeight').value = p.height.toFixed(2);
}
$('#presetSelect').addEventListener('change', e => {
  containerPreset = e.target.value;
  applyPresetToInputs(e.target.value);
});

$('#applyDimensions').addEventListener('click', () => {
  const L = parseFloat($('#dimLength').value);
  const W = parseFloat($('#dimWidth').value);
  const H = parseFloat($('#dimHeight').value);
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) return showToast('Enter valid positive dimensions in metres.');
  cargoSpace = { length: L, width: W, height: H };
  buildContainer();
  const dimStr = `${L.toFixed(2)} × ${W.toFixed(2)} × ${H.toFixed(2)} m`;
  $('#sceneDims').textContent = dimStr;
  if (sceneMode === '3d') {
    $$('.view-pills-3d .view-pill').forEach(p => p.classList.toggle('selected', p.dataset.view === 'perspective'));
    setView('perspective');
  } else {
    positionOrthoCamera(orthoView);
  }
  markDirty();
  showToast(`<b>Cargo space</b> updated to ${dimStr}.`);
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
  items.forEach(item => {
    const sprite = item.mesh?.children.find(c => c.userData.isLabel);
    if (sprite) sprite.visible = showLabels;
  });
  showToast(showLabels ? 'Labels <b>on</b>.' : 'Labels <b>off</b>.');
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
    L:  parseFloat($('#fLength').value),
    W:  parseFloat($('#fWidth').value),
    H:  parseFloat($('#fHeight').value),
    wt: parseFloat($('#fWeight').value) || 0,
    handling: $('#fHandling').value
  };
}

function validateFormDims(L, W, H) {
  if (!L || !W || !H || L <= 0 || W <= 0 || H <= 0) { showToast('Enter valid carton dimensions in cm.'); return false; }
  if (L > cargoSpace.length * 100 || W > cargoSpace.width * 100 || H > cargoSpace.height * 100) {
    showToast('Carton is larger than the cargo space.'); return false;
  }
  return true;
}

function addNewItems() {
  const { labelInput, productInput, L, W, H, wt, handling } = readFormValues();
  if (!validateFormDims(L, W, H)) return;
  const baseLabel = labelInput || generateBaseLabel();
  const color = pickColorForBase(baseLabel);
  let last;
  for (let n = 0; n < quantity; n++) {
    const suffix = quantity > 1 ? `-${String(n + 1).padStart(2, '0')}` : '';
    last = addItem({
      label: baseLabel + suffix, base_label: baseLabel,
      product_name: productInput,
      length_cm: L, width_cm: W, height_cm: H,
      weight_kg: wt, handling, color
    });
  }
  updateStats();
  renderCargoList();
  showToast(`Added <b>${quantity}</b> ${quantity > 1 ? 'cartons' : 'carton'}${labelInput ? ' of ' + escapeHtml(baseLabel) : ''}.`);
  // Full form reset — use templates for reusable carton specs
  $('#fLabel').value = '';
  $('#fProduct').value = '';
  $('#fLength').value = '';
  $('#fWidth').value = '';
  $('#fHeight').value = '';
  $('#fWeight').value = '';
  $('#fHandling').value = 'standard';
  $('#templateSelect').value = '';
  $('#deleteTemplateBtn').hidden = true;
  quantity = 1;
  $('#fQty').textContent = 1;
  $('#fLabel').focus();
}

function updateSelectedItem() {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const { labelInput, productInput, L, W, H, wt, handling } = readFormValues();
  if (!validateFormDims(L, W, H)) return;
  if (labelInput && labelInput !== item.base_label) {
    item.base_label = labelInput;
    item.label = labelInput;
    const twin = items.find(i => i.id !== item.id && i.base_label === labelInput);
    if (twin) item.color = twin.color;
  }
  item.product_name = productInput;
  item.length_cm = L; item.width_cm = W; item.height_cm = H;
  item.weight_kg = wt; item.handling = handling;
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

$('#btnRotate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  item.rot_y = item.rot_y === 90 ? 0 : 90;
  clampItemToBounds(item);
  refreshItemMesh(item);
  refreshItemSprite(item);
  settleAll();
  updateStats();
  markDirty();
  showToast(`<b>${escapeHtml(item.label)}</b> rotated 90°.`);
});

$('#btnDuplicate').addEventListener('click', () => {
  const item = items.find(i => i.id === selectedItemId);
  if (!item) return;
  const clone = addItem({
    label: item.base_label + '·copy', base_label: item.base_label,
    product_name: item.product_name,
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

// Templates
$('#templateSelect').addEventListener('change', e => {
  const id = e.target.value;
  if (!id) { $('#deleteTemplateBtn').hidden = true; return; }
  applyTemplate(id);
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
  } else if (e.key === 'd' && selectedItemId && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('#btnDuplicate').click();
  } else if (e.key === 'l') {
    $('#toggleLabels').click();
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
// BOOT
// ============================================================
async function boot() {
  // Load preferences that affect the first render
  try {
    realisticMode = localStorage.getItem(REALISTIC_MODE_KEY) === '1';
  } catch (e) {}

  initScene();
  loadTemplatesFromStorage();
  renderTemplateDropdown();
  $$('select').forEach(enhanceSelect);      // replace native selects with styled ones
  updateStats();
  renderCargoList();
  renderEditStrip();
  setEditMode(false, null);
  updateStatusChip();

  // Sync toggle button state
  $('#toggleRealistic').classList.toggle('active', realisticMode);

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

  requestAnimationFrame(onResize);
  setTimeout(onResize, 200);
}

boot();