import * as THREE from './node_modules/three/build/three.module.js';
import { MTLLoader } from './vendor/three/MTLLoader.js';
import { OBJLoader } from './vendor/three/OBJLoader.js';

const MODEL_SCALE = 0.08;
const ATTACHMENT_GAP = 0;
const EYE_HEIGHT = 1.72;
const MOVE_SPEED = 7.6;
const LOOK_DRAG_SENSITIVITY = 0.0024;
const PLAYER_MAX_STEP_HEIGHT = EYE_HEIGHT * 0.5;
const PLAYER_COLLISION_RADIUS = 0.28;
const PLAYER_COLLISION_CLEARANCE = 0.03;
const PLAYER_COLLISION_BINARY_STEPS = 6;
const PLAYER_STEP_SEARCH_PADDING = 0.18;
const PLAYER_SUPPORT_NORMAL_MIN_Y = 0.45;
const PLAYER_PROBE_HEIGHT_OFFSETS = [-1.35, -0.82, -0.26];
const PLAYER_PROBE_LATERAL_OFFSETS = [0, -PLAYER_COLLISION_RADIUS * 0.76, PLAYER_COLLISION_RADIUS * 0.76];
const PLAYER_SUPPORT_FORWARD_OFFSETS = [0, PLAYER_COLLISION_RADIUS * 0.92];
const PREVIEW_IMAGE_WIDTH = 360;
const PREVIEW_IMAGE_HEIGHT = 220;
const PREVIEW_ROTATION_SPEED = 0.42;
const PREVIEW_TILT = 0;
const PREVIEW_FRAME_INTERVAL = 1 / 10;
const MODEL_MANIFEST_URL = './api/models';
const WORLDGEN_FILE_TYPE = 'WorldGen';
const WORLDGEN_FILE_VERSION = '1.0.0';
const WORLDGEN_FILE_PICKER_ID = 'worldgen-scene';
const DEFAULT_ENVIRONMENT = 'Moonbase';

const saveSceneButton = document.querySelector('#save-scene');
const loadSceneButton = document.querySelector('#load-scene');
const sceneFileInput = document.querySelector('#scene-file-input');
const viewport = document.querySelector('#viewport');
const modelStrip = document.querySelector('#model-strip');
const sceneStatus = document.querySelector('#scene-status');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070f);
scene.fog = new THREE.Fog(0x04070f, 90, 280);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, EYE_HEIGHT, 11.5);
camera.rotation.order = 'YXZ';

const clock = new THREE.Clock();
const pointer = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
};
const lookState = {
  isDragging: false,
  lastX: 0,
  lastY: 0,
  pitch: camera.rotation.x,
  pointerId: null,
  yaw: camera.rotation.y,
};
const scenePointer = new THREE.Vector2();
const scenePickRaycaster = new THREE.Raycaster();
const scenePickMeshes = [];

const placementState = {
  placedItems: [],
  lastDirection: new THREE.Vector3(0, 0, -1),
};
const selectionState = {
  helper: null,
  item: null,
};
const sceneFileState = {
  isBusy: false,
  lastHandle: null,
};
const modelLibrary = {
  byId: new Map(),
  byPath: new Map(),
  environment: DEFAULT_ENVIRONMENT,
  models: [],
};

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
const previewCaptureRenderer = safelyCreatePreviewCaptureRenderer();
const previewEntries = [];
const previewEntryByElement = new Map();
let groundMesh = null;
let isAnimating = false;
let previewAccumulator = 0;
let playerSurfaceY = camera.position.y - EYE_HEIGHT;
const previewVisibilityObserver = createPreviewVisibilityObserver();
const playerForward = new THREE.Vector3();
const playerRight = new THREE.Vector3();
const playerStep = new THREE.Vector3();
const playerAttemptDelta = new THREE.Vector3();
const playerMoveDirection = new THREE.Vector3();
const playerProbeSide = new THREE.Vector3();
const playerProbeOrigin = new THREE.Vector3();
const playerTargetPosition = new THREE.Vector3();
const playerSupportOrigin = new THREE.Vector3();
const playerSupportNormal = new THREE.Vector3();
const playerDown = new THREE.Vector3(0, -1, 0);
const playerSurfaceNormalMatrix = new THREE.Matrix3();
const playerSweepBox = new THREE.Box3();
const nearbyCollisionMeshes = [];
const nearbySupportTargets = [];
const playerRayHits = [];
const playerSupportHits = [];
const playerRaycaster = new THREE.Raycaster();
const playerSupportRaycaster = new THREE.Raycaster();

init();

async function init() {
  buildWorld();
  wireControls();
  wireCarousel();
  wireSceneFileActions();
  startAnimationLoop();
  renderer.render(scene, camera);

  try {
    const manifest = await loadModelManifest();
    const textures = await loadTextures(manifest);
    const models = await loadModels(manifest.models, textures);
    registerModelLibrary(models, manifest.environment);
    createPicker(models);
    updateSceneFileActionAvailability();
    setStatus(`Choose a module below to place the first piece at the center of the scene. ${models.length} model${models.length === 1 ? '' : 's'} found.`);
  } catch (error) {
    console.error(error);
    updateSceneFileActionAvailability();
    setStatus(`The moonbase assets could not be loaded. ${error.message || 'Check the browser console for details.'}`);
  }
}

function buildWorld() {
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(320, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x07101c,
      side: THREE.BackSide,
    }),
  );
  scene.add(skyDome);

  const ambient = new THREE.HemisphereLight(0x9fc8ff, 0x1d170f, 1.3);
  scene.add(ambient);

  const rimLight = new THREE.DirectionalLight(0xdde9ff, 1.4);
  rimLight.position.set(-12, 18, 8);
  scene.add(rimLight);

  const keyLight = new THREE.DirectionalLight(0xfff0ce, 1.35);
  keyLight.position.set(14, 26, -10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 80;
  keyLight.shadow.camera.left = -40;
  keyLight.shadow.camera.right = 40;
  keyLight.shadow.camera.top = 40;
  keyLight.shadow.camera.bottom = -40;
  scene.add(keyLight);

  const moonGlow = new THREE.Mesh(
    new THREE.SphereGeometry(4.2, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xc6ddff, transparent: true, opacity: 0.08 }),
  );
  moonGlow.position.set(26, 40, -60);
  scene.add(moonGlow);

  const stars = createStars();
  stars.name = 'starfield';
  scene.add(stars);

  const landingPad = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.55, 56),
    new THREE.MeshBasicMaterial({
      color: 0x86d7ff,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
    }),
  );
  landingPad.rotation.x = -Math.PI / 2;
  landingPad.position.y = 0.03;
  scene.add(landingPad);

  groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x6b6f78,
      roughness: 1,
      metalness: 0.02,
    }),
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.01;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

async function loadModelManifest() {
  const response = await fetch(`${MODEL_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Manifest request failed with ${response.status}`);
  }

  return response.json();
}

async function loadTextures(manifest) {
  const textureMap = new Map();
  const texturePaths = Array.from(new Set(manifest.models.map((model) => model.texturePath).filter(Boolean)));

  if (manifest.groundTexture) {
    const groundTexture = await textureLoader.loadAsync(manifest.groundTexture);
    prepareTexture(groundTexture);
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(72, 72);

    groundMesh.material.map = groundTexture;
    groundMesh.material.color.set(0xffffff);
    groundMesh.material.needsUpdate = true;
  }

  await Promise.all(
    texturePaths.map(async (texturePath) => {
      const texture = await textureLoader.loadAsync(texturePath);
      prepareTexture(texture);
      textureMap.set(texturePath, texture);
    }),
  );

  return textureMap;
}

async function loadModels(definitions, textures) {
  const models = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    setStatus(`Loading module ${index + 1} of ${definitions.length}: ${definition.label}`);
    let rawObject;
    const objLoader = new OBJLoader(loadingManager);
    let usesMtl = Boolean(definition.mtlPath);

    try {
      if (usesMtl) {
        try {
          const materials = await loadObjMaterials(definition.mtlPath);
          objLoader.setMaterials(materials);
        } catch (error) {
          console.warn(`Failed to load ${definition.mtlPath}, falling back to default material.`, error);
          usesMtl = false;
        }
      }

      rawObject = await objLoader.loadAsync(definition.objPath);
    } catch (error) {
      console.error(`Failed to load ${definition.objPath}`, error);
      continue;
    }

    const material = createMaterial(textures.get(definition.texturePath) ?? null);

    rawObject.traverse((child) => {
      if (!child.isMesh) {
        return;
      }

      remapZUpGeometryToYUp(child.geometry);
      if (!usesMtl) {
        child.material = material;
      } else {
        applyMaterialSettings(child.material);
      }
      child.castShadow = true;
      child.receiveShadow = true;
      child.geometry.computeVertexNormals();
    });

    const rawBox = new THREE.Box3().setFromObject(rawObject);
    const rawCenter = rawBox.getCenter(new THREE.Vector3());

    rawObject.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);

    const normalizedRoot = new THREE.Group();
    normalizedRoot.name = definition.label;
    normalizedRoot.add(rawObject);
    normalizedRoot.scale.setScalar(MODEL_SCALE);

    const normalizedBox = new THREE.Box3().setFromObject(normalizedRoot);
    const size = normalizedBox.getSize(new THREE.Vector3());

    models.push({
      ...definition,
      relativePath: toRelativeModelPath(definition.objPath),
      template: normalizedRoot,
      size,
    });
  }

  return models;
}

function createMaterial(texture) {
  const material = new THREE.MeshStandardMaterial({
    ...(texture ? { map: texture } : {}),
    color: 0xe6edf8,
    emissive: 0x122038,
    emissiveIntensity: 0.16,
    roughness: 0.56,
    metalness: 0.46,
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  applyMaterialSettings(material);
  return material;
}

function createPicker(models) {
  if (models.length === 0) {
    setStatus('The scene loaded, but none of the OBJ modules could be parsed.');
    return;
  }

  for (const model of models) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'picker-card';
    card.setAttribute('role', 'listitem');
    card.dataset.modelId = model.id;

    const previewShell = document.createElement('div');
    previewShell.className = 'preview-shell';
    if (previewCaptureRenderer) {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'preview-canvas';
      previewCanvas.width = PREVIEW_IMAGE_WIDTH;
      previewCanvas.height = PREVIEW_IMAGE_HEIGHT;
      previewCanvas.setAttribute('aria-label', `${model.label} rotating preview`);
      previewShell.append(previewCanvas);

      const previewEntry = createPreviewEntry(model, previewCanvas);
      if (previewEntry) {
        previewEntries.push(previewEntry);
        previewEntryByElement.set(card, previewEntry);
        if (previewVisibilityObserver) {
          previewVisibilityObserver.observe(card);
        }
        renderPreviewEntry(previewEntry, 0);
      }
    }

    const cardMeta = document.createElement('div');
    cardMeta.className = 'card-meta';
    cardMeta.innerHTML = `<p class="card-name">${model.label}</p>`;

    card.append(previewShell, cardMeta);
    modelStrip.append(card);

    card.addEventListener('click', () => {
      const placedItem = addModelToScene(model);
      const count = placementState.placedItems.length;
      setStatus(getSelectedItemStatus(placedItem, `Assembly length: ${count} module${count === 1 ? '' : 's'}.`));
    });
  }

}

function registerModelLibrary(models, environment) {
  modelLibrary.models = models;
  modelLibrary.byId.clear();
  modelLibrary.byPath.clear();

  for (const model of models) {
    modelLibrary.byId.set(model.id, model);
    modelLibrary.byPath.set(normalizeSceneModulePath(model.relativePath), model);
  }

  modelLibrary.environment = environment || inferEnvironmentFromModels(models) || DEFAULT_ENVIRONMENT;
}

function addModelToScene(model, options = {}) {
  const instance = model.template.clone(true);
  let placementDirection = null;

  if (options.position) {
    instance.position.copy(options.position);
    instance.rotation.y = options.rotationY ?? 0;
  } else {
    const anchorItem = getPlacementAnchorItem();
    if (anchorItem) {
      instance.rotation.copy(anchorItem.group.rotation);
      instance.position.y = anchorItem.group.position.y;
    }

    const placement = calculatePlacement(instance, anchorItem);
    instance.position.copy(placement.position);
    placementDirection = placement.direction;
  }

  scene.add(instance);

  const placed = {
    group: instance,
    modelId: model.id,
    label: model.label,
    relativePath: model.relativePath,
    collisionBounds: new THREE.Box3(),
    collisionMeshes: collectCollisionMeshes(instance),
  };

  for (const mesh of placed.collisionMeshes) {
    mesh.userData.placedItem = placed;
  }
  scenePickMeshes.push(...placed.collisionMeshes);
  placementState.placedItems.push(placed);
  refreshPlacedItemCollision(placed);
  if (placementDirection) {
    placementState.lastDirection.copy(placementDirection);
  } else {
    placementState.lastDirection.copy(getDirectionFromYaw(instance.rotation.y));
  }

  if (options.select !== false) {
    setSelectedItem(placed);
  }

  return placed;
}

function calculatePlacement(instance, anchorItem) {
  if (!anchorItem) {
    return {
      position: new THREE.Vector3(0, instance.position.y, 0),
      direction: placementState.lastDirection.clone(),
    };
  }

  const anchorBox = new THREE.Box3().setFromObject(anchorItem.group);
  const anchorPosition = anchorItem.group.position.clone();
  const direction = resolvePlacementDirection(anchorBox.getCenter(new THREE.Vector3()));

  instance.position.copy(anchorPosition);
  instance.updateMatrixWorld(true);
  const instanceBox = new THREE.Box3().setFromObject(instance);

  const separation =
    getDirectionalHalfExtent(anchorBox.getSize(new THREE.Vector3()), direction) +
    getDirectionalHalfExtent(instanceBox.getSize(new THREE.Vector3()), direction) +
    ATTACHMENT_GAP;

  return {
    position: anchorPosition.addScaledVector(direction, separation),
    direction,
  };
}

function getPlacementAnchorItem() {
  return selectionState.item ?? placementState.placedItems[placementState.placedItems.length - 1] ?? null;
}

function resolvePlacementDirection(anchor) {
  const fromCamera = anchor.clone().sub(camera.position);
  fromCamera.y = 0;

  if (fromCamera.lengthSq() < 0.0001) {
    return placementState.lastDirection.clone();
  }

  if (Math.abs(fromCamera.x) >= Math.abs(fromCamera.z)) {
    return new THREE.Vector3(Math.sign(fromCamera.x) || 1, 0, 0);
  }

  return new THREE.Vector3(0, 0, Math.sign(fromCamera.z) || -1);
}

function getDirectionalHalfExtent(size, direction) {
  return (Math.abs(direction.x) * size.x + Math.abs(direction.z) * size.z) * 0.5;
}

function toRelativeModelPath(path) {
  return normalizeSceneModulePath(path);
}

function normalizeSceneModulePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^assets\/models\//i, '')
    .replace(/^models\/+/i, '');
}

function inferEnvironmentFromModels(models) {
  return inferEnvironmentFromPath(models[0]?.relativePath ?? '');
}

function inferEnvironmentFromPath(path) {
  const normalizedPath = normalizeSceneModulePath(path);
  const [environment] = normalizedPath.split('/');
  return environment || DEFAULT_ENVIRONMENT;
}

function getDirectionFromYaw(yawRadians) {
  const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRadians);

  if (Math.abs(direction.x) >= Math.abs(direction.z)) {
    return new THREE.Vector3(Math.sign(direction.x) || 1, 0, 0);
  }

  return new THREE.Vector3(0, 0, Math.sign(direction.z) || -1);
}

function createStars() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(4500 * 3);

  for (let index = 0; index < 4500; index += 1) {
    const radius = THREE.MathUtils.randFloat(100, 280);
    const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));

    positions[index * 3 + 0] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi) * 0.7 + 70;
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xeaf4ff,
      size: 0.75,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.92,
    }),
  );
}

function wireControls() {
  renderer.domElement.addEventListener('contextmenu', handleViewportContextMenu);
  renderer.domElement.addEventListener('pointerdown', handleViewportPointerDown);
  renderer.domElement.addEventListener('click', handleViewportClick);
  window.addEventListener('pointermove', handleViewportPointerMove);
  window.addEventListener('pointerup', handleViewportPointerUp);
  window.addEventListener('pointercancel', handleViewportPointerCancel);
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('resize', handleResize);
}

function handleViewportContextMenu(event) {
  event.preventDefault();
}

function handleViewportPointerDown(event) {
  if (event.button !== 2) {
    return;
  }

  event.preventDefault();
  lookState.isDragging = true;
  lookState.pointerId = event.pointerId;
  lookState.lastX = event.clientX;
  lookState.lastY = event.clientY;
  document.body.classList.add('is-looking');
  renderer.domElement.setPointerCapture(event.pointerId);
}

function handleViewportPointerMove(event) {
  if (!lookState.isDragging || event.pointerId !== lookState.pointerId) {
    return;
  }

  lookState.yaw -= (event.clientX - lookState.lastX) * LOOK_DRAG_SENSITIVITY;
  lookState.pitch = THREE.MathUtils.clamp(
    lookState.pitch - (event.clientY - lookState.lastY) * LOOK_DRAG_SENSITIVITY,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  lookState.lastX = event.clientX;
  lookState.lastY = event.clientY;
  applyCameraLook();
}

function handleViewportPointerUp(event) {
  if (!lookState.isDragging || event.pointerId !== lookState.pointerId || event.button !== 2) {
    return;
  }

  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  stopLookDrag();
}

function handleViewportPointerCancel(event) {
  if (!lookState.isDragging || event.pointerId !== lookState.pointerId) {
    return;
  }

  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  stopLookDrag();
}

function handleViewportClick(event) {
  if (event.button !== 0) {
    return;
  }

  const pickedItem = pickPlacedItem(event);
  setSelectedItem(pickedItem);

  if (pickedItem) {
    setStatus(getSelectedItemStatus(pickedItem));
  }
}

function pickPlacedItem(event) {
  if (scenePickMeshes.length === 0) {
    return null;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  scenePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  scenePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  scenePickRaycaster.setFromCamera(scenePointer, camera);

  const intersections = scenePickRaycaster.intersectObjects(scenePickMeshes, false);
  if (intersections.length === 0) {
    return null;
  }

  return intersections[0].object.userData.placedItem ?? null;
}

function stopLookDrag() {
  lookState.isDragging = false;
  lookState.pointerId = null;
  document.body.classList.remove('is-looking');
}

function applyCameraLook() {
  camera.rotation.x = lookState.pitch;
  camera.rotation.y = lookState.yaw;
  camera.rotation.z = 0;
}

function handleWindowBlur() {
  clearMovementState();
  stopLookDrag();
}

function handleKeyDown(event) {
  const handledMovement = updateMovementState(event.code, true);
  if (handledMovement) {
    event.preventDefault();
  }

  if (event.repeat) {
    return;
  }

  if (handleSelectionTransform(event.code)) {
    event.preventDefault();
  }
}

function handleKeyUp(event) {
  if (updateMovementState(event.code, false)) {
    event.preventDefault();
  }
}

function clearMovementState() {
  pointer.forward = false;
  pointer.back = false;
  pointer.left = false;
  pointer.right = false;
  pointer.sprint = false;
}

function updateMovementState(code, pressed) {
  switch (code) {
    case 'KeyW':
      pointer.forward = pressed;
      return true;
    case 'KeyS':
      pointer.back = pressed;
      return true;
    case 'KeyA':
      pointer.left = pressed;
      return true;
    case 'KeyD':
      pointer.right = pressed;
      return true;
    case 'ShiftLeft':
    case 'ShiftRight':
      pointer.sprint = pressed;
      return true;
    default:
      return false;
  }
}

function wireCarousel() {
  document.querySelectorAll('.scroll-control').forEach((button) => {
    button.addEventListener('click', () => {
      const direction = Number(button.dataset.direction || 0);
      modelStrip.scrollBy({ left: direction * 320, behavior: 'smooth' });
    });
  });

  modelStrip.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      event.preventDefault();
      modelStrip.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
}

function wireSceneFileActions() {
  updateSceneFileActionAvailability();

  saveSceneButton?.addEventListener('click', () => {
    void saveSceneToFile();
  });

  loadSceneButton?.addEventListener('click', () => {
    void loadSceneFromFile();
  });

  sceneFileInput?.addEventListener('change', (event) => {
    void handleSceneFileInputChange(event);
  });
}

function updateSceneFileActionAvailability() {
  if (saveSceneButton) {
    saveSceneButton.disabled = sceneFileState.isBusy;
  }

  if (loadSceneButton) {
    loadSceneButton.disabled = sceneFileState.isBusy || modelLibrary.models.length === 0;
  }
}

function setSceneFileBusy(isBusy) {
  sceneFileState.isBusy = isBusy;
  updateSceneFileActionAvailability();
}

async function saveSceneToFile() {
  if (sceneFileState.isBusy) {
    return;
  }

  const payload = buildSceneFilePayload();
  const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;

  if (typeof window.showSaveFilePicker !== 'function') {
    downloadScenePayload(serializedPayload);
    return;
  }

  setSceneFileBusy(true);

  try {
    const handle = await window.showSaveFilePicker({
      id: WORLDGEN_FILE_PICKER_ID,
      startIn: getScenePickerStartLocation(),
      suggestedName: buildSceneFileName(),
      types: getSceneFilePickerTypes(),
    });
    const writable = await handle.createWritable();
    await writable.write(serializedPayload);
    await writable.close();

    sceneFileState.lastHandle = handle;

    const count = placementState.placedItems.length;
    setStatus(`Scene saved to ${handle.name}. ${count} module${count === 1 ? '' : 's'} written.`);
  } catch (error) {
    if (isPickerAbortError(error)) {
      return;
    }

    console.error(error);
    setStatus(`Scene save failed. ${error.message || 'Check the browser console for details.'}`);
  } finally {
    setSceneFileBusy(false);
  }
}

async function loadSceneFromFile() {
  if (sceneFileState.isBusy) {
    return;
  }

  if (modelLibrary.models.length === 0) {
    setStatus('The module library is still loading. Wait a moment, then try loading the scene again.');
    return;
  }

  if (typeof window.showOpenFilePicker !== 'function') {
    if (sceneFileInput) {
      sceneFileInput.value = '';
      sceneFileInput.click();
    }
    return;
  }

  setSceneFileBusy(true);

  try {
    const [handle] = await window.showOpenFilePicker({
      id: WORLDGEN_FILE_PICKER_ID,
      startIn: getScenePickerStartLocation(),
      multiple: false,
      types: getSceneFilePickerTypes(),
    });
    const file = await handle.getFile();
    const fileText = await file.text();

    await loadSceneFromText(fileText, handle.name);
    sceneFileState.lastHandle = handle;
  } catch (error) {
    if (isPickerAbortError(error)) {
      return;
    }

    console.error(error);
    setStatus(`Scene load failed. ${error.message || 'Check the browser console for details.'}`);
  } finally {
    setSceneFileBusy(false);
  }
}

async function handleSceneFileInputChange(event) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) {
    return;
  }

  setSceneFileBusy(true);

  try {
    const fileText = await file.text();
    await loadSceneFromText(fileText, file.name);
  } catch (error) {
    console.error(error);
    setStatus(`Scene load failed. ${error.message || 'Check the browser console for details.'}`);
  } finally {
    setSceneFileBusy(false);
  }
}

function buildSceneFilePayload() {
  return {
    FileType: WORLDGEN_FILE_TYPE,
    Version: WORLDGEN_FILE_VERSION,
    Environment: modelLibrary.environment || DEFAULT_ENVIRONMENT,
    Scene: placementState.placedItems.map((item) => ({
      Object: 'Module',
      Path: item.relativePath,
      Position: formatScenePosition(item.group.position),
      Rotation: formatSceneRotation(item.group.rotation.y),
    })),
  };
}

function downloadScenePayload(serializedPayload) {
  const blob = new Blob([serializedPayload], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = buildSceneFileName();
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  const count = placementState.placedItems.length;
  setStatus(`Scene downloaded as ${link.download}. ${count} module${count === 1 ? '' : 's'} written.`);
}

function buildSceneFileName() {
  const environment = (modelLibrary.environment || DEFAULT_ENVIRONMENT)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${environment || 'worldgen'}-scene.json`;
}

function getScenePickerStartLocation() {
  return sceneFileState.lastHandle ?? 'documents';
}

function getSceneFilePickerTypes() {
  return [
    {
      description: 'WorldGen scene JSON',
      accept: {
        'application/json': ['.json'],
      },
    },
  ];
}

function isPickerAbortError(error) {
  return error?.name === 'AbortError';
}

async function loadSceneFromText(fileText, sourceLabel) {
  const parsedScene = parseSceneFilePayload(fileText);
  const resolvedEntries = parsedScene.scene.map((entry, index) => {
    const resolvedPath = normalizeSceneModulePath(resolveScenePath(entry.path, parsedScene.environment));
    const model = modelLibrary.byPath.get(resolvedPath);

    if (!model) {
      throw new Error(`Module ${index + 1} could not be found: ${resolvedPath}`);
    }

    return {
      model,
      position: entry.position,
      rotationY: THREE.MathUtils.degToRad(entry.rotationDegrees),
    };
  });

  clearPlacedItems();

  let lastPlaced = null;
  for (const entry of resolvedEntries) {
    lastPlaced = addModelToScene(entry.model, {
      position: entry.position,
      rotationY: entry.rotationY,
      select: false,
    });
  }

  setSelectedItem(lastPlaced);
  placementState.lastDirection.copy(lastPlaced ? getDirectionFromYaw(lastPlaced.group.rotation.y) : new THREE.Vector3(0, 0, -1));

  if (lastPlaced) {
    const count = placementState.placedItems.length;
    setStatus(getSelectedItemStatus(lastPlaced, `Scene loaded from ${sourceLabel}. ${count} module${count === 1 ? '' : 's'} restored.`));
    return;
  }

  setStatus(`Scene loaded from ${sourceLabel}. Scene is empty.`);
}

function parseSceneFilePayload(fileText) {
  let payload;
  try {
    payload = JSON.parse(fileText);
  } catch (error) {
    throw new Error('The selected file is not valid JSON.');
  }

  const header = payload && typeof payload.Header === 'object' ? payload.Header : payload;
  if (!header || header.FileType !== WORLDGEN_FILE_TYPE) {
    throw new Error(`The selected file is not a ${WORLDGEN_FILE_TYPE} scene.`);
  }

  const version = String(header.Version ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('The scene file version must use major.minor.debug format.');
  }

  const environment = String(header.Environment ?? payload.Environment ?? '').trim() || DEFAULT_ENVIRONMENT;
  const rawScene =
    Array.isArray(payload.Scene) ? payload.Scene : Array.isArray(payload.Scene?.Objects) ? payload.Scene.Objects : null;

  if (!rawScene) {
    throw new Error('The scene file does not contain a Scene array.');
  }

  return {
    environment,
    scene: rawScene.map((entry, index) => parseSceneEntry(entry, index)),
    version,
  };
}

function parseSceneEntry(entry, index) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Scene entry ${index + 1} is invalid.`);
  }

  const objectType = String(entry.Object ?? 'Module').trim();
  if (objectType !== 'Module') {
    throw new Error(`Scene entry ${index + 1} uses unsupported object type "${objectType}".`);
  }

  return {
    path: String(entry.Path ?? '').trim(),
    position: parseScenePosition(entry.Position, index),
    rotationDegrees: parseSceneRotation(entry.Rotation, index),
  };
}

function resolveScenePath(path, environment) {
  const normalizedPath = normalizeSceneModulePath(path);
  if (!normalizedPath) {
    throw new Error('Every scene module must include a Path value.');
  }

  if (normalizedPath.includes('/')) {
    return normalizedPath;
  }

  return `${environment}/${normalizedPath}`;
}

function parseScenePosition(value, index) {
  if (typeof value === 'string') {
    const parts = value.split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return new THREE.Vector3(parts[0], parts[1], parts[2]);
    }
  }

  if (Array.isArray(value) && value.length === 3 && value.every((part) => Number.isFinite(Number(part)))) {
    return new THREE.Vector3(Number(value[0]), Number(value[1]), Number(value[2]));
  }

  if (value && typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return new THREE.Vector3(x, y, z);
    }
  }

  throw new Error(`Scene entry ${index + 1} has an invalid Position value.`);
}

function parseSceneRotation(value, index) {
  const rotation = Number.parseFloat(String(value ?? '0').trim());
  if (!Number.isFinite(rotation)) {
    throw new Error(`Scene entry ${index + 1} has an invalid Rotation value.`);
  }

  return rotation;
}

function formatScenePosition(position) {
  return [position.x, position.y, position.z].map(formatSceneNumber).join(',');
}

function formatSceneRotation(rotationY) {
  const degrees = THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(rotationY), 360);
  return formatSceneNumber(degrees);
}

function formatSceneNumber(value) {
  const roundedValue = Math.abs(value) < 0.0005 ? 0 : Number(value.toFixed(3));
  return String(Object.is(roundedValue, -0) ? 0 : roundedValue);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  updatePlayer(delta);
  updateSelectionHelper();

  const stars = scene.getObjectByName('starfield');
  if (stars) {
    stars.rotation.y += delta * 0.01;
  }

  updatePreviewAnimation(delta, clock.elapsedTime);

  renderer.render(scene, camera);
}

function startAnimationLoop() {
  if (isAnimating) {
    return;
  }

  isAnimating = true;
  animate();
}

function updatePlayer(delta) {
  const strafeInput = Number(pointer.right) - Number(pointer.left);
  const forwardInput = Number(pointer.forward) - Number(pointer.back);
  const inputLength = Math.hypot(strafeInput, forwardInput);

  if (inputLength > 0) {
    const stepLength = ((pointer.sprint ? MOVE_SPEED * 1.65 : MOVE_SPEED) * delta) / inputLength;
    camera.getWorldDirection(playerForward);
    playerForward.y = 0;

    if (playerForward.lengthSq() < 0.0001) {
      playerForward.set(0, 0, -1);
    } else {
      playerForward.normalize();
    }

    playerRight.crossVectors(playerForward, camera.up);
    if (playerRight.lengthSq() < 0.0001) {
      playerRight.set(1, 0, 0);
    } else {
      playerRight.normalize();
    }

    if (Math.abs(forwardInput) >= Math.abs(strafeInput)) {
      movePlayerAlongAxis(playerForward, forwardInput * stepLength);
      movePlayerAlongAxis(playerRight, strafeInput * stepLength);
    } else {
      movePlayerAlongAxis(playerRight, strafeInput * stepLength);
      movePlayerAlongAxis(playerForward, forwardInput * stepLength);
    }
  }

  camera.position.y = playerSurfaceY + EYE_HEIGHT;
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function createPreviewCaptureRenderer() {
  const previewRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  previewRenderer.setPixelRatio(1);
  previewRenderer.setSize(PREVIEW_IMAGE_WIDTH, PREVIEW_IMAGE_HEIGHT, false);
  previewRenderer.setClearColor(0x000000, 0);
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  previewRenderer.toneMappingExposure = 1.05;
  return previewRenderer;
}

function createPreviewEntry(model, canvas) {
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(40, PREVIEW_IMAGE_WIDTH / PREVIEW_IMAGE_HEIGHT, 0.1, 100);
  const previewLight = new THREE.HemisphereLight(0xa6cbff, 0x20180f, 1.4);
  previewScene.add(previewLight);

  const previewDirectional = new THREE.DirectionalLight(0xfff1d1, 1.2);
  previewDirectional.position.set(4, 5, 6);
  previewScene.add(previewDirectional);

  const pedestal = new THREE.Mesh(
    new THREE.CircleGeometry(Math.max(model.size.x, model.size.z) * 0.66 + 0.45, 40),
    new THREE.MeshBasicMaterial({ color: 0x111a2c, transparent: true, opacity: 0.68 }),
  );
  pedestal.rotation.x = -Math.PI / 2;
  pedestal.position.y = 0.01;
  previewScene.add(pedestal);

  const clone = model.template.clone(true);
  clone.rotation.x = PREVIEW_TILT;
  clone.rotation.y = Math.PI / 5;
  previewScene.add(clone);

  const span = Math.max(model.size.x, model.size.y, model.size.z);
  previewCamera.position.set(span * 1.05, span * 0.7, span * 1.5 + 0.7);
  previewCamera.lookAt(0, model.size.y * 0.45, 0);

  return {
    camera: previewCamera,
    canvas,
    context,
    isVisible: true,
    object: clone,
    scene: previewScene,
  };
}

function safelyCreatePreviewCaptureRenderer() {
  try {
    return createPreviewCaptureRenderer();
  } catch (error) {
    console.warn('Preview renderer unavailable', error);
    return null;
  }
}

function prepareTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
}

async function loadObjMaterials(mtlPath) {
  const mtlLoader = new MTLLoader(loadingManager);
  const basePath = mtlPath.slice(0, mtlPath.lastIndexOf('/') + 1);
  mtlLoader.setMaterialOptions({ side: THREE.DoubleSide });
  mtlLoader.setResourcePath(basePath);

  const materials = await mtlLoader.loadAsync(mtlPath);
  materials.preload();

  Object.values(materials.materials).forEach((material) => {
    applyMaterialSettings(material);
  });

  return materials;
}

function applyMaterialSettings(material) {
  if (Array.isArray(material)) {
    material.forEach((entry) => applyMaterialSettings(entry));
    return;
  }

  if (!material) {
    return;
  }

  material.side = THREE.DoubleSide;
  if ('map' in material && material.map) {
    prepareTexture(material.map);
  }
  material.needsUpdate = true;
}

function createPreviewVisibilityObserver() {
  if (!('IntersectionObserver' in window)) {
    return null;
  }

  return new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const previewEntry = previewEntryByElement.get(entry.target);
        if (!previewEntry) {
          continue;
        }

        previewEntry.isVisible = entry.isIntersecting;
      }
    },
    {
      root: modelStrip,
      threshold: 0.35,
    },
  );
}

function updatePreviewAnimation(delta, elapsedTime) {
  if (!previewCaptureRenderer || previewEntries.length === 0) {
    return;
  }

  previewAccumulator += delta;
  if (previewAccumulator < PREVIEW_FRAME_INTERVAL) {
    return;
  }

  previewAccumulator = 0;

  for (const entry of previewEntries) {
    if (!entry.isVisible) {
      continue;
    }

    renderPreviewEntry(entry, elapsedTime);
  }
}

function renderPreviewEntry(entry, elapsedTime) {
  entry.object.rotation.x = PREVIEW_TILT;
  entry.object.rotation.y = Math.PI / 5 + elapsedTime * PREVIEW_ROTATION_SPEED;
  previewCaptureRenderer.render(entry.scene, entry.camera);
  entry.context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
  entry.context.drawImage(
    previewCaptureRenderer.domElement,
    0,
    0,
    PREVIEW_IMAGE_WIDTH,
    PREVIEW_IMAGE_HEIGHT,
    0,
    0,
    entry.canvas.width,
    entry.canvas.height,
  );
}

function remapZUpGeometryToYUp(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) {
    return;
  }

  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    position.setXYZ(index, x, z, -y);
  }
  position.needsUpdate = true;

  const normal = geometry.getAttribute('normal');
  if (normal) {
    for (let index = 0; index < normal.count; index += 1) {
      const x = normal.getX(index);
      const y = normal.getY(index);
      const z = normal.getZ(index);
      normal.setXYZ(index, x, z, -y);
    }
    normal.needsUpdate = true;
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function setStatus(message) {
  sceneStatus.textContent = message;
}

function handleSelectionTransform(code) {
  if (!selectionState.item) {
    return false;
  }

  switch (code) {
    case 'KeyQ':
      rotateSelectedItem(Math.PI / 4);
      return true;
    case 'KeyE':
      rotateSelectedItem(-Math.PI / 4);
      return true;
    case 'KeyR':
      moveSelectedItemVertically(1);
      return true;
    case 'KeyF':
      moveSelectedItemVertically(-1);
      return true;
    case 'Delete':
      deleteSelectedItem();
      return true;
    default:
      return false;
  }
}

function rotateSelectedItem(deltaRadians) {
  const item = selectionState.item;
  item.group.rotation.y += deltaRadians;
  refreshPlacedItemCollision(item);
  updateSelectionHelper();

  const degrees = THREE.MathUtils.euclideanModulo(
    THREE.MathUtils.radToDeg(item.group.rotation.y),
    360,
  );
  setStatus(getSelectedItemStatus(item, `Rotation ${degrees.toFixed(0)} degrees.`));
}

function moveSelectedItemVertically(direction) {
  const item = selectionState.item;
  const bounds = new THREE.Box3().setFromObject(item.group);
  const size = bounds.getSize(new THREE.Vector3());
  const step = Math.max(size.y * 0.25, 0.05);
  item.group.position.y += step * direction;
  refreshPlacedItemCollision(item);
  updateSelectionHelper();

  setStatus(getSelectedItemStatus(item, `Height ${item.group.position.y.toFixed(2)}.`));
}

function deleteSelectedItem() {
  const item = selectionState.item;
  if (!item) {
    return;
  }

  const removedIndex = placementState.placedItems.indexOf(item);
  if (removedIndex === -1) {
    setSelectedItem(null);
    return;
  }

  placementState.placedItems.splice(removedIndex, 1);
  detachPlacedItem(item);

  const nextSelection =
    placementState.placedItems[removedIndex] ??
    placementState.placedItems[removedIndex - 1] ??
    null;
  setSelectedItem(nextSelection);

  const count = placementState.placedItems.length;
  if (nextSelection) {
    setStatus(`${item.label} deleted. ${getSelectedItemStatus(nextSelection, `Assembly length: ${count} module${count === 1 ? '' : 's'}.`)}`);
    return;
  }

  setStatus(`${item.label} deleted. Scene is empty. Choose a module below to place the next piece.`);
}

function clearPlacedItems() {
  setSelectedItem(null);

  for (const item of placementState.placedItems) {
    detachPlacedItem(item);
  }

  placementState.placedItems.length = 0;
  placementState.lastDirection.set(0, 0, -1);
}

function detachPlacedItem(item) {
  for (const mesh of item.collisionMeshes) {
    const pickIndex = scenePickMeshes.indexOf(mesh);
    if (pickIndex !== -1) {
      scenePickMeshes.splice(pickIndex, 1);
    }
    mesh.userData.placedItem = null;
  }

  scene.remove(item.group);
}

function getSelectedItemStatus(item, detail = '') {
  const detailText = detail ? `${detail} ` : '';
  return `${item.label} selected. ${detailText}Use Q/E to rotate, R/F to raise or lower, and Delete to remove it.`;
}

function setSelectedItem(item) {
  selectionState.item = item;
  updateSelectedCard(item?.modelId ?? null);

  if (selectionState.helper) {
    scene.remove(selectionState.helper);
    selectionState.helper.geometry.dispose();
    selectionState.helper.material.dispose();
    selectionState.helper = null;
  }

  if (!item) {
    return;
  }

  selectionState.helper = new THREE.BoxHelper(item.group, 0x86d7ff);
  selectionState.helper.material.depthTest = false;
  selectionState.helper.material.opacity = 0.95;
  selectionState.helper.material.transparent = true;
  selectionState.helper.renderOrder = 999;
  scene.add(selectionState.helper);
}

function updateSelectedCard(modelId) {
  document.querySelectorAll('.picker-card.is-selected').forEach((selectedCard) => {
    selectedCard.classList.remove('is-selected');
  });

  if (!modelId) {
    return;
  }

  const card = document.querySelector(`.picker-card[data-model-id="${modelId}"]`);
  if (card) {
    card.classList.add('is-selected');
  }
}

function updateSelectionHelper() {
  if (!selectionState.helper || !selectionState.item) {
    return;
  }

  selectionState.helper.update();
}

function collectCollisionMeshes(root) {
  const meshes = [];

  root.traverse((child) => {
    if (child.isMesh) {
      meshes.push(child);
    }
  });

  return meshes;
}

function refreshPlacedItemCollision(item) {
  item.group.updateMatrixWorld(true);
  item.collisionBounds.setFromObject(item.group);
}

function movePlayerAlongAxis(direction, distance) {
  if (Math.abs(distance) < 0.0001) {
    return;
  }

  playerStep.copy(direction).multiplyScalar(distance);
  attemptPlayerMove(playerStep);
}

function attemptPlayerMove(delta) {
  if (delta.lengthSq() < 0.000001) {
    return;
  }

  const resolvedSurfaceY = resolvePlayerMoveSurfaceY(delta);
  if (resolvedSurfaceY !== null) {
    camera.position.add(delta);
    playerSurfaceY = resolvedSurfaceY;
    return;
  }

  let min = 0;
  let max = 1;
  let bestSurfaceY = null;

  for (let iteration = 0; iteration < PLAYER_COLLISION_BINARY_STEPS; iteration += 1) {
    const midpoint = (min + max) * 0.5;
    playerAttemptDelta.copy(delta).multiplyScalar(midpoint);
    const candidateSurfaceY = resolvePlayerMoveSurfaceY(playerAttemptDelta);

    if (candidateSurfaceY === null) {
      max = midpoint;
    } else {
      min = midpoint;
      bestSurfaceY = candidateSurfaceY;
    }
  }

  if (bestSurfaceY !== null && min > 0.0001) {
    camera.position.addScaledVector(delta, min);
    playerSurfaceY = bestSurfaceY;
  }
}

function resolvePlayerMoveSurfaceY(delta) {
  const collisionMeshes = getNearbyCollisionMeshes(delta, PLAYER_MAX_STEP_HEIGHT);
  const candidateSurfaceY = resolvePlayerSurfaceHeight(delta, collisionMeshes);

  if (candidateSurfaceY === null) {
    return null;
  }

  if (isPlayerMovementBlocked(delta, candidateSurfaceY + EYE_HEIGHT, collisionMeshes)) {
    return null;
  }

  return candidateSurfaceY;
}

function resolvePlayerSurfaceHeight(delta, collisionMeshes) {
  const supportTargets = getNearbySupportTargets(collisionMeshes);
  if (supportTargets.length === 0) {
    return playerSurfaceY;
  }

  const searchStartY = playerSurfaceY + PLAYER_MAX_STEP_HEIGHT + PLAYER_STEP_SEARCH_PADDING;
  const searchDepth = PLAYER_MAX_STEP_HEIGHT * 2 + PLAYER_STEP_SEARCH_PADDING * 2;
  let bestSurfaceY = null;

  playerMoveDirection.copy(delta).normalize();
  playerTargetPosition.set(camera.position.x + delta.x, 0, camera.position.z + delta.z);

  playerSupportRaycaster.near = 0;
  playerSupportRaycaster.far = searchDepth;

  for (const forwardOffset of PLAYER_SUPPORT_FORWARD_OFFSETS) {
    playerSupportOrigin.set(
      playerTargetPosition.x + playerMoveDirection.x * forwardOffset,
      searchStartY,
      playerTargetPosition.z + playerMoveDirection.z * forwardOffset,
    );

    playerSupportHits.length = 0;
    playerSupportRaycaster.set(playerSupportOrigin, playerDown);
    playerSupportRaycaster.intersectObjects(supportTargets, false, playerSupportHits);

    for (const hit of playerSupportHits) {
      const surfaceY = hit.point.y;
      const surfaceDelta = surfaceY - playerSurfaceY;

      if (surfaceDelta > PLAYER_MAX_STEP_HEIGHT + PLAYER_COLLISION_CLEARANCE) {
        continue;
      }

      if (surfaceDelta < -PLAYER_MAX_STEP_HEIGHT - PLAYER_COLLISION_CLEARANCE) {
        continue;
      }

      if (!isWalkableSupportHit(hit)) {
        continue;
      }

      if (bestSurfaceY === null || surfaceY > bestSurfaceY) {
        bestSurfaceY = surfaceY;
      }

      break;
    }
  }

  return bestSurfaceY;
}

function getNearbySupportTargets(collisionMeshes) {
  nearbySupportTargets.length = 0;

  if (groundMesh) {
    nearbySupportTargets.push(groundMesh);
  }

  nearbySupportTargets.push(...collisionMeshes);
  return nearbySupportTargets;
}

function isWalkableSupportHit(hit) {
  if (!hit.face) {
    return hit.object === groundMesh;
  }

  playerSupportNormal.copy(hit.face.normal);
  playerSurfaceNormalMatrix.getNormalMatrix(hit.object.matrixWorld);
  playerSupportNormal.applyNormalMatrix(playerSurfaceNormalMatrix).normalize();
  return playerSupportNormal.y >= PLAYER_SUPPORT_NORMAL_MIN_Y;
}

function isPlayerMovementBlocked(delta, eyeY = playerSurfaceY + EYE_HEIGHT, collisionMeshes = getNearbyCollisionMeshes(delta)) {
  if (collisionMeshes.length === 0) {
    return false;
  }

  const travelDistance = delta.length() + PLAYER_COLLISION_RADIUS + PLAYER_COLLISION_CLEARANCE;
  playerMoveDirection.copy(delta).normalize();
  playerProbeSide.set(-playerMoveDirection.z, 0, playerMoveDirection.x);

  playerRaycaster.near = 0;
  playerRaycaster.far = travelDistance;

  for (const heightOffset of PLAYER_PROBE_HEIGHT_OFFSETS) {
    const probeY = eyeY + heightOffset;

    for (const lateralOffset of PLAYER_PROBE_LATERAL_OFFSETS) {
      playerProbeOrigin.set(camera.position.x, probeY, camera.position.z);
      if (lateralOffset !== 0) {
        playerProbeOrigin.addScaledVector(playerProbeSide, lateralOffset);
      }

      playerRayHits.length = 0;
      playerRaycaster.set(playerProbeOrigin, playerMoveDirection);
      playerRaycaster.intersectObjects(collisionMeshes, false, playerRayHits);

      if (playerRayHits.length > 0) {
        return true;
      }
    }
  }

  return false;
}

function getNearbyCollisionMeshes(delta, verticalPadding = 0) {
  nearbyCollisionMeshes.length = 0;

  const currentEyeY = playerSurfaceY + EYE_HEIGHT;
  const minY = currentEyeY + PLAYER_PROBE_HEIGHT_OFFSETS[0] - PLAYER_COLLISION_RADIUS - verticalPadding;
  const maxY = currentEyeY + PLAYER_PROBE_HEIGHT_OFFSETS[PLAYER_PROBE_HEIGHT_OFFSETS.length - 1] + PLAYER_COLLISION_RADIUS + verticalPadding;
  const endX = camera.position.x + delta.x;
  const endZ = camera.position.z + delta.z;
  const padding = PLAYER_COLLISION_RADIUS + PLAYER_COLLISION_CLEARANCE + PLAYER_SUPPORT_FORWARD_OFFSETS[PLAYER_SUPPORT_FORWARD_OFFSETS.length - 1];

  playerSweepBox.min.set(
    Math.min(camera.position.x, endX) - padding,
    minY,
    Math.min(camera.position.z, endZ) - padding,
  );
  playerSweepBox.max.set(
    Math.max(camera.position.x, endX) + padding,
    maxY,
    Math.max(camera.position.z, endZ) + padding,
  );

  for (const item of placementState.placedItems) {
    if (item.collisionBounds.intersectsBox(playerSweepBox)) {
      nearbyCollisionMeshes.push(...item.collisionMeshes);
    }
  }

  return nearbyCollisionMeshes;
}
