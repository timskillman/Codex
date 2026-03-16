import * as THREE from './node_modules/three/build/three.module.js';
import { attachEmissiveBloomShells } from './app/bloom.js';
import {
  loadModels as loadModelLibrary,
  materialContributesToBloom,
  prepareTexture as prepareSceneTexture,
} from './app/model-loading.js';
import { createPlayerController } from './app/player.js';
import { createPreviewSystem } from './app/preview.js';
import {
  buildSceneFileName as buildSceneFileNameFromData,
  buildSceneFilePayload as buildSceneFilePayloadFromData,
  captureSceneFingerprint as captureSceneFingerprintFromData,
  getSceneFilePickerTypes as getSceneFilePickerTypesFromData,
  getScenePickerStartLocation as getScenePickerStartLocationFromData,
  inferEnvironmentFromModels as inferEnvironmentFromModelsFromData,
  isPickerAbortError as isPickerAbortErrorFromData,
  normalizeSceneModulePath as normalizeSceneModulePathFromData,
  parseSceneFilePayload as parseSceneFilePayloadFromData,
  resolveScenePath as resolveScenePathFromData,
} from './app/scene-format.js';
import { buildWorld as buildWorldScene, updateSunSystem as updateSunSystemScene } from './app/world.js';

const MODEL_SCALE = 0.08;
const ATTACHMENT_GAP = 0;
const EYE_HEIGHT = 1.72;
const MOVE_SPEED = 7.6;
const LOOK_DRAG_SENSITIVITY = 0.0024;
const TOUCH_LOOK_DRAG_SENSITIVITY = 0.0032;
const MOBILE_LOOK_SPEED = 2.8;
const MOBILE_LOOK_PAD_RADIUS_RATIO = 0.34;
const MOBILE_MOVE_DEADZONE = 0.14;
const TOUCH_VIEWPORT_TAP_SLOP = 10;
const TOUCH_VIEWPORT_CLICK_SUPPRESSION_MS = 400;
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
const MODEL_LOD_SWITCH_DISTANCE = 24;
const START_CAMERA_POSITION = new THREE.Vector3(0, EYE_HEIGHT, 11.5);
const START_CAMERA_PITCH = 0;
const START_CAMERA_YAW = 0;
const MODULE_INTERIOR_LIGHT_COLOR = 0xfff1d9;
const MODULE_INTERIOR_LIGHT_HEIGHT = EYE_HEIGHT * 0.5;
const MODULE_INTERIOR_LIGHT_INTENSITY = 10;
const MODULE_INTERIOR_LIGHT_MIN_DISTANCE = 13;
const MODULE_INTERIOR_LIGHT_MAX_DISTANCE = 34;
const MODULE_INTERIOR_LIGHT_STICKY_MARGIN = 0.35;
const MODULE_INTERIOR_LIGHT_TOP_CLEARANCE = 0.4;

const newSceneButton = document.querySelector('#new-scene');
const saveSceneButton = document.querySelector('#save-scene');
const loadSceneButton = document.querySelector('#load-scene');
const fullscreenButton = document.querySelector('#toggle-fullscreen');
const sceneFileInput = document.querySelector('#scene-file-input');
const sceneConfirm = document.querySelector('#scene-confirm');
const sceneConfirmTitle = document.querySelector('#scene-confirm-title');
const sceneConfirmMessage = document.querySelector('#scene-confirm-message');
const sceneConfirmSaveButton = document.querySelector('#scene-confirm-save');
const sceneConfirmDiscardButton = document.querySelector('#scene-confirm-discard');
const sceneConfirmCancelButton = document.querySelector('#scene-confirm-cancel');
const viewport = document.querySelector('#viewport');
const modelStrip = document.querySelector('#model-strip');
const sceneStatus = document.querySelector('#scene-status');
const mobileRotateLeftButton = document.querySelector('#mobile-rotate-left');
const mobileRotateRightButton = document.querySelector('#mobile-rotate-right');
const mobileMoveUpButton = document.querySelector('#mobile-move-up');
const mobileMoveDownButton = document.querySelector('#mobile-move-down');
const mobileDeleteSelectionButton = document.querySelector('#mobile-delete-selection');
const mobileMovePad = document.querySelector('#mobile-move-pad');
const mobileMoveThumb = document.querySelector('#mobile-move-thumb');
const mobileLookPad = document.querySelector('#mobile-look-pad');
const mobileLookThumb = document.querySelector('#mobile-look-thumb');

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
camera.position.copy(START_CAMERA_POSITION);
camera.rotation.order = 'YXZ';
camera.rotation.x = START_CAMERA_PITCH;
camera.rotation.y = START_CAMERA_YAW;

const clock = new THREE.Clock();
const pointer = {
  forward: false,
  back: false,
  left: false,
  moveX: 0,
  moveY: 0,
  right: false,
  sprint: false,
};
const lookState = {
  isDragging: false,
  lastX: 0,
  lastY: 0,
  pitch: START_CAMERA_PITCH,
  pointerId: null,
  yaw: START_CAMERA_YAW,
};
const mobileLookState = {
  inputX: 0,
  inputY: 0,
  isActive: false,
  pointerId: null,
};
const mobileMoveState = {
  inputX: 0,
  inputY: 0,
  isActive: false,
  pointerId: null,
};
const touchViewportState = {
  isActive: false,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  pointerId: null,
  suppressClickUntil: 0,
  travel: 0,
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
const sceneDocumentState = {
  baselineFingerprint: '[]',
  displayName: 'New Scene',
  isNewScene: true,
};
const sceneConfirmState = {
  activeElement: null,
  resolver: null,
};
const modelLibrary = {
  byId: new Map(),
  byPath: new Map(),
  environment: DEFAULT_ENVIRONMENT,
  models: [],
};
const moduleInteriorLightState = {
  currentItem: null,
  light: createModuleInteriorLight(),
  moduleCenter: new THREE.Vector3(),
  moduleSize: new THREE.Vector3(),
};
scene.add(moduleInteriorLightState.light);

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);
let groundMesh = null;
let isAnimating = false;
let sunSystem = null;
const previewSystem = createPreviewSystem({
  modelStrip,
  imageHeight: PREVIEW_IMAGE_HEIGHT,
  imageWidth: PREVIEW_IMAGE_WIDTH,
  frameInterval: PREVIEW_FRAME_INTERVAL,
  rotationSpeed: PREVIEW_ROTATION_SPEED,
  tilt: PREVIEW_TILT,
});
const playerController = createPlayerController({
  camera,
  config: {
    collisionBinarySteps: PLAYER_COLLISION_BINARY_STEPS,
    collisionClearance: PLAYER_COLLISION_CLEARANCE,
    collisionRadius: PLAYER_COLLISION_RADIUS,
    eyeHeight: EYE_HEIGHT,
    maxStepHeight: PLAYER_MAX_STEP_HEIGHT,
    moveSpeed: MOVE_SPEED,
    probeHeightOffsets: PLAYER_PROBE_HEIGHT_OFFSETS,
    probeLateralOffsets: PLAYER_PROBE_LATERAL_OFFSETS,
    stepSearchPadding: PLAYER_STEP_SEARCH_PADDING,
    supportForwardOffsets: PLAYER_SUPPORT_FORWARD_OFFSETS,
    supportNormalMinY: PLAYER_SUPPORT_NORMAL_MIN_Y,
  },
  getGroundMesh: () => groundMesh,
  placementState,
});

init();

async function init() {
  const world = buildWorldScene(scene);
  groundMesh = world.groundMesh;
  sunSystem = world.sunSystem;
  wireControls();
  wireMobileControls();
  wireCarousel();
  wireSceneFileActions();
  startAnimationLoop();
  renderer.render(scene, camera);

  try {
    const manifest = await loadModelManifest();
    const textures = await loadTextures(manifest);
    const loadedModels = await loadModelLibrary({
      definitions: manifest.models,
      loadingManager,
      modelScale: MODEL_SCALE,
      onStatus: (message) => setStatus(message),
      renderer,
      textures,
    });
    tagModelTemplatesForBloom(loadedModels);
    const models = buildRenderableModels(loadedModels);
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
    prepareSceneTexture(renderer, groundTexture);
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
      prepareSceneTexture(renderer, texture);
      textureMap.set(texturePath, texture);
    }),
  );

  return textureMap;
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
    if (previewSystem.isEnabled) {
      const previewCanvas = document.createElement('canvas');
      previewCanvas.className = 'preview-canvas';
      previewCanvas.width = previewSystem.imageWidth;
      previewCanvas.height = previewSystem.imageHeight;
      previewCanvas.setAttribute('aria-label', `${model.label} rotating preview`);
      previewShell.append(previewCanvas);
      previewSystem.registerCard(card, model, previewCanvas);
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
    const aliasPaths = Array.isArray(model.pathAliases) && model.pathAliases.length > 0
      ? model.pathAliases
      : [model.relativePath];
    for (const aliasPath of aliasPaths) {
      modelLibrary.byPath.set(normalizeSceneModulePathFromData(aliasPath), model);
    }
  }

  modelLibrary.environment = environment || inferEnvironmentFromModelsFromData(models, DEFAULT_ENVIRONMENT) || DEFAULT_ENVIRONMENT;
}

function tagModelTemplatesForBloom(models) {
  for (const model of models) {
    attachEmissiveBloomShells(model.template, materialContributesToBloom);
  }
}

function buildRenderableModels(models) {
  const groupedModels = new Map();

  for (const model of models) {
    const groupKey = getModelLodGroupKey(model.relativePath);
    const grouped = groupedModels.get(groupKey) ?? { far: null, near: null };

    if (isFarLodModel(model.relativePath)) {
      grouped.far = grouped.far ?? model;
    } else {
      grouped.near = grouped.near ?? model;
    }

    groupedModels.set(groupKey, grouped);
  }

  return Array.from(groupedModels.entries())
    .map(([groupKey, grouped]) => createRenderableModel(groupKey, grouped))
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function createRenderableModel(groupKey, { near, far }) {
  const primaryModel = near ?? far;
  if (!primaryModel) {
    return null;
  }

  const nearModel = near ?? far;
  const farModel = far ?? nearModel;
  const usesDistinctFarModel = Boolean(far) && far !== nearModel;
  const template = usesDistinctFarModel
    ? createLodTemplate(nearModel.template, farModel.template)
    : nearModel.template;

  return {
    ...primaryModel,
    id: primaryModel.id,
    label: stripLodSuffixFromLabel(primaryModel.label),
    pathAliases: Array.from(new Set([nearModel.relativePath, farModel.relativePath].filter(Boolean))),
    previewTemplate: nearModel.template,
    relativePath: nearModel.relativePath,
    size: nearModel.size.clone(),
    template,
    lodGroupKey: groupKey,
  };
}

function createLodTemplate(nearTemplate, farTemplate) {
  const lod = new THREE.LOD();
  lod.name = nearTemplate.name;

  const nearRoot = nearTemplate.clone(true);
  const farRoot = farTemplate.clone(true);
  farRoot.visible = false;
  markFarLodMeshes(farRoot);

  lod.addLevel(nearRoot, 0);
  lod.addLevel(farRoot, MODEL_LOD_SWITCH_DISTANCE);
  lod.updateMatrixWorld(true);
  return lod;
}

function markFarLodMeshes(root) {
  root.traverse((child) => {
    if (!child.isMesh) {
      return;
    }

    child.userData.worldgenIgnoreCollision = true;
  });
}

function isFarLodModel(relativePath) {
  return /(?:[_\s-]?lod0)(?:\.[^./\\]+)?$/i.test(normalizeSceneModulePathFromData(relativePath));
}

function getModelLodGroupKey(relativePath) {
  const normalizedPath = normalizeSceneModulePathFromData(relativePath);
  const lastSlash = normalizedPath.lastIndexOf('/');
  const directory = lastSlash >= 0 ? normalizedPath.slice(0, lastSlash + 1) : '';
  const fileName = lastSlash >= 0 ? normalizedPath.slice(lastSlash + 1) : normalizedPath;
  const extensionIndex = fileName.lastIndexOf('.');
  const stem = extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : '';
  return `${directory}${stripLodSuffix(stem)}${extension}`;
}

function stripLodSuffixFromLabel(label) {
  return stripLodSuffix(String(label ?? '')).trim() || String(label ?? '');
}

function stripLodSuffix(value) {
  return String(value ?? '').replace(/(?:[_\s-]?lod0)$/i, '');
}

function createModuleInteriorLight() {
  const light = new THREE.PointLight(MODULE_INTERIOR_LIGHT_COLOR, MODULE_INTERIOR_LIGHT_INTENSITY, 10, 2);
  light.visible = false;
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = MODULE_INTERIOR_LIGHT_MAX_DISTANCE;
  light.shadow.bias = -0.001;
  light.shadow.normalBias = 0.04;
  light.shadow.radius = 2.4;
  return light;
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

function getDirectionFromYaw(yawRadians) {
  const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRadians);

  if (Math.abs(direction.x) >= Math.abs(direction.z)) {
    return new THREE.Vector3(Math.sign(direction.x) || 1, 0, 0);
  }

  return new THREE.Vector3(0, 0, Math.sign(direction.z) || -1);
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

function wireMobileControls() {
  wireMobileSelectionActions();

  mobileMovePad?.addEventListener('pointerdown', handleMobileMovePointerDown);
  mobileMovePad?.addEventListener('pointermove', handleMobileMovePointerMove);
  mobileMovePad?.addEventListener('pointerup', handleMobileMovePointerUp);
  mobileMovePad?.addEventListener('pointercancel', handleMobileMovePointerUp);
  mobileMovePad?.addEventListener('lostpointercapture', handleMobileMovePointerUp);

  mobileLookPad?.addEventListener('pointerdown', handleMobileLookPointerDown);
  mobileLookPad?.addEventListener('pointermove', handleMobileLookPointerMove);
  mobileLookPad?.addEventListener('pointerup', handleMobileLookPointerUp);
  mobileLookPad?.addEventListener('pointercancel', handleMobileLookPointerUp);
  mobileLookPad?.addEventListener('lostpointercapture', handleMobileLookPointerUp);

  fullscreenButton?.addEventListener('click', () => {
    void toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', updateFullscreenButtonState);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButtonState);
  updateFullscreenButtonState();
  updateMobileSelectionActionAvailability();
}

function wireMobileSelectionActions() {
  wireMobileSelectionAction(mobileRotateLeftButton, () => rotateSelectedItem(Math.PI / 4));
  wireMobileSelectionAction(mobileRotateRightButton, () => rotateSelectedItem(-Math.PI / 4));
  wireMobileSelectionAction(mobileMoveUpButton, () => moveSelectedItemVertically(1));
  wireMobileSelectionAction(mobileMoveDownButton, () => moveSelectedItemVertically(-1));
  wireMobileSelectionAction(mobileDeleteSelectionButton, () => deleteSelectedItem());
}

function wireMobileSelectionAction(button, action) {
  if (!button) {
    return;
  }

  button.addEventListener('click', () => {
    if (!selectionState.item || button.disabled) {
      return;
    }

    action();
  });
}

function updateMobileSelectionActionAvailability() {
  const hasSelection = Boolean(selectionState.item);
  [
    mobileRotateLeftButton,
    mobileRotateRightButton,
    mobileMoveUpButton,
    mobileMoveDownButton,
    mobileDeleteSelectionButton,
  ].forEach((button) => {
    if (button) {
      button.disabled = !hasSelection;
    }
  });
}

function handleMobileMovePointerDown(event) {
  if (event.button !== 0 || mobileMoveState.isActive) {
    return;
  }

  event.preventDefault();
  mobileMoveState.isActive = true;
  mobileMoveState.pointerId = event.pointerId;
  mobileMovePad?.classList.add('is-active');
  mobileMovePad?.setPointerCapture(event.pointerId);
  updateMobileMoveInput(event.clientX, event.clientY);
}

function handleMobileMovePointerMove(event) {
  if (!mobileMoveState.isActive || event.pointerId !== mobileMoveState.pointerId) {
    return;
  }

  event.preventDefault();
  updateMobileMoveInput(event.clientX, event.clientY);
}

function handleMobileMovePointerUp(event) {
  if (event.pointerId !== mobileMoveState.pointerId) {
    return;
  }

  releaseMobileMovePad();
}

function isTouchViewportPointer(event) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

function beginTouchViewportGesture(event) {
  if (event.button !== 0 || touchViewportState.isActive) {
    return;
  }

  event.preventDefault();
  touchViewportState.isActive = true;
  touchViewportState.isDragging = false;
  touchViewportState.lastX = event.clientX;
  touchViewportState.lastY = event.clientY;
  touchViewportState.pointerId = event.pointerId;
  touchViewportState.travel = 0;
  renderer.domElement.setPointerCapture(event.pointerId);
}

function updateTouchViewportGesture(event) {
  if (!touchViewportState.isActive || event.pointerId !== touchViewportState.pointerId) {
    return false;
  }

  event.preventDefault();
  const deltaX = event.clientX - touchViewportState.lastX;
  const deltaY = event.clientY - touchViewportState.lastY;
  touchViewportState.lastX = event.clientX;
  touchViewportState.lastY = event.clientY;
  touchViewportState.travel += Math.hypot(deltaX, deltaY);

  if (!touchViewportState.isDragging && touchViewportState.travel > TOUCH_VIEWPORT_TAP_SLOP) {
    touchViewportState.isDragging = true;
    document.body.classList.add('is-looking');
  }

  if (!touchViewportState.isDragging) {
    return true;
  }

  lookState.yaw -= deltaX * TOUCH_LOOK_DRAG_SENSITIVITY;
  lookState.pitch = THREE.MathUtils.clamp(
    lookState.pitch - deltaY * TOUCH_LOOK_DRAG_SENSITIVITY,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  applyCameraLook();
  return true;
}

function endTouchViewportGesture(pointerId) {
  if (pointerId !== null && renderer.domElement.hasPointerCapture(pointerId)) {
    renderer.domElement.releasePointerCapture(pointerId);
  }

  touchViewportState.isActive = false;
  touchViewportState.isDragging = false;
  touchViewportState.lastX = 0;
  touchViewportState.lastY = 0;
  touchViewportState.pointerId = null;
  touchViewportState.travel = 0;
  document.body.classList.remove('is-looking');
}

function handleViewportSelection(event) {
  const pickedItem = pickPlacedItem(event);
  setSelectedItem(pickedItem);

  if (pickedItem) {
    setStatus(getSelectedItemStatus(pickedItem));
  }
}

function finishTouchViewportGesture(event) {
  if (!touchViewportState.isActive || event.pointerId !== touchViewportState.pointerId) {
    return false;
  }

  event.preventDefault();
  const shouldSelect = !touchViewportState.isDragging && touchViewportState.travel <= TOUCH_VIEWPORT_TAP_SLOP;
  endTouchViewportGesture(event.pointerId);
  touchViewportState.suppressClickUntil = performance.now() + TOUCH_VIEWPORT_CLICK_SUPPRESSION_MS;

  if (shouldSelect) {
    handleViewportSelection(event);
  }

  return true;
}

function cancelTouchViewportGesture(event) {
  if (!touchViewportState.isActive || event.pointerId !== touchViewportState.pointerId) {
    return false;
  }

  endTouchViewportGesture(event.pointerId);
  touchViewportState.suppressClickUntil = performance.now() + TOUCH_VIEWPORT_CLICK_SUPPRESSION_MS;
  return true;
}

function stopTouchViewportGesture() {
  if (!touchViewportState.isActive) {
    return;
  }

  endTouchViewportGesture(touchViewportState.pointerId);
}

function resolveMobilePadInput(pad, clientX, clientY) {
  if (!pad) {
    return {
      deltaX: 0,
      deltaY: 0,
      inputX: 0,
      inputY: 0,
    };
  }

  const rect = pad.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  const radius = Math.min(rect.width, rect.height) * MOBILE_LOOK_PAD_RADIUS_RATIO;

  let deltaX = clientX - centerX;
  let deltaY = clientY - centerY;
  const distance = Math.hypot(deltaX, deltaY);

  if (distance > radius && distance > 0) {
    const clampScale = radius / distance;
    deltaX *= clampScale;
    deltaY *= clampScale;
  }

  return {
    deltaX,
    deltaY,
    inputX: radius > 0 ? deltaX / radius : 0,
    inputY: radius > 0 ? deltaY / radius : 0,
  };
}

function applyRadialDeadzone(inputX, inputY, deadzone) {
  const magnitude = Math.hypot(inputX, inputY);
  if (magnitude <= deadzone || magnitude === 0) {
    return { inputX: 0, inputY: 0 };
  }

  const scaledMagnitude = (magnitude - deadzone) / (1 - deadzone);
  const scale = scaledMagnitude / magnitude;
  return {
    inputX: inputX * scale,
    inputY: inputY * scale,
  };
}

function updateMobileMoveInput(clientX, clientY) {
  const { deltaX, deltaY, inputX, inputY } = resolveMobilePadInput(mobileMovePad, clientX, clientY);
  const adjusted = applyRadialDeadzone(inputX, -inputY, MOBILE_MOVE_DEADZONE);

  mobileMoveState.inputX = adjusted.inputX;
  mobileMoveState.inputY = adjusted.inputY;
  pointer.moveX = adjusted.inputX;
  pointer.moveY = adjusted.inputY;

  if (mobileMoveThumb) {
    mobileMoveThumb.style.transform = `translate(${deltaX.toFixed(1)}px, ${deltaY.toFixed(1)}px)`;
  }
}

function releaseMobileMovePad() {
  if (!mobileMoveState.isActive) {
    return;
  }

  if (mobileMovePad && mobileMoveState.pointerId !== null && mobileMovePad.hasPointerCapture(mobileMoveState.pointerId)) {
    mobileMovePad.releasePointerCapture(mobileMoveState.pointerId);
  }

  mobileMoveState.isActive = false;
  mobileMoveState.pointerId = null;
  mobileMoveState.inputX = 0;
  mobileMoveState.inputY = 0;
  pointer.moveX = 0;
  pointer.moveY = 0;
  mobileMovePad?.classList.remove('is-active');

  if (mobileMoveThumb) {
    mobileMoveThumb.style.transform = 'translate(0px, 0px)';
  }
}

function handleMobileLookPointerDown(event) {
  if (event.button !== 0 || mobileLookState.isActive) {
    return;
  }

  event.preventDefault();
  mobileLookState.isActive = true;
  mobileLookState.pointerId = event.pointerId;
  mobileLookPad?.setPointerCapture(event.pointerId);
  updateMobileLookInput(event.clientX, event.clientY);
}

function handleMobileLookPointerMove(event) {
  if (!mobileLookState.isActive || event.pointerId !== mobileLookState.pointerId) {
    return;
  }

  event.preventDefault();
  updateMobileLookInput(event.clientX, event.clientY);
}

function handleMobileLookPointerUp(event) {
  if (event.pointerId !== mobileLookState.pointerId) {
    return;
  }

  releaseMobileLookPad();
}

function updateMobileLookInput(clientX, clientY) {
  const { deltaX, deltaY, inputX, inputY } = resolveMobilePadInput(mobileLookPad, clientX, clientY);
  mobileLookState.inputX = inputX;
  mobileLookState.inputY = inputY;

  mobileLookPad?.classList.add('is-active');

  if (mobileLookThumb) {
    mobileLookThumb.style.transform = `translate(${deltaX.toFixed(1)}px, ${deltaY.toFixed(1)}px)`;
  }
}

function releaseMobileLookPad() {
  if (!mobileLookState.isActive) {
    return;
  }

  if (mobileLookPad && mobileLookState.pointerId !== null && mobileLookPad.hasPointerCapture(mobileLookState.pointerId)) {
    mobileLookPad.releasePointerCapture(mobileLookState.pointerId);
  }

  mobileLookState.isActive = false;
  mobileLookState.pointerId = null;
  mobileLookState.inputX = 0;
  mobileLookState.inputY = 0;
  mobileLookPad?.classList.remove('is-active');

  if (mobileLookThumb) {
    mobileLookThumb.style.transform = 'translate(0px, 0px)';
  }
}

function updateMobileLook(delta) {
  if (!mobileLookState.isActive) {
    return;
  }

  lookState.yaw -= mobileLookState.inputX * MOBILE_LOOK_SPEED * delta;
  lookState.pitch = THREE.MathUtils.clamp(
    lookState.pitch - mobileLookState.inputY * MOBILE_LOOK_SPEED * delta,
    -Math.PI / 2 + 0.01,
    Math.PI / 2 - 0.01,
  );
  applyCameraLook();
}

function isFullscreenSupported() {
  return Boolean(
    document.fullscreenEnabled ||
    document.webkitFullscreenEnabled ||
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen
  );
}

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function updateFullscreenButtonState() {
  if (!fullscreenButton) {
    return;
  }

  const isSupported = isFullscreenSupported();
  const isActive = Boolean(getFullscreenElement());
  fullscreenButton.disabled = !isSupported;
  fullscreenButton.classList.toggle('is-active', isActive);
  fullscreenButton.setAttribute('aria-label', isActive ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.title = isActive ? 'Exit fullscreen' : 'Enter fullscreen';
}

async function toggleFullscreen() {
  if (!isFullscreenSupported()) {
    setStatus('Fullscreen is not available in this browser.');
    return;
  }

  try {
    if (getFullscreenElement()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }
  } catch (error) {
    console.error(error);
    setStatus(`Fullscreen failed. ${error.message || 'Check the browser console for details.'}`);
  } finally {
    updateFullscreenButtonState();
  }
}

function handleViewportContextMenu(event) {
  event.preventDefault();
}

function handleViewportPointerDown(event) {
  if (isTouchViewportPointer(event)) {
    beginTouchViewportGesture(event);
    return;
  }

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
  if (updateTouchViewportGesture(event)) {
    return;
  }

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
  if (finishTouchViewportGesture(event)) {
    return;
  }

  if (!lookState.isDragging || event.pointerId !== lookState.pointerId || event.button !== 2) {
    return;
  }

  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  stopLookDrag();
}

function handleViewportPointerCancel(event) {
  if (cancelTouchViewportGesture(event)) {
    return;
  }

  if (!lookState.isDragging || event.pointerId !== lookState.pointerId) {
    return;
  }

  if (renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  stopLookDrag();
}

function handleViewportClick(event) {
  if (performance.now() < touchViewportState.suppressClickUntil) {
    return;
  }

  if (event.button !== 0) {
    return;
  }

  handleViewportSelection(event);
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
  stopTouchViewportGesture();
  releaseMobileLookPad();
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
  pointer.moveX = 0;
  pointer.moveY = 0;
  pointer.right = false;
  pointer.sprint = false;
  releaseMobileMovePad();
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

  newSceneButton?.addEventListener('click', () => {
    void handleNewSceneRequest();
  });

  saveSceneButton?.addEventListener('click', () => {
    void saveSceneToFile();
  });

  loadSceneButton?.addEventListener('click', () => {
    void loadSceneFromFile();
  });

  sceneFileInput?.addEventListener('change', (event) => {
    void handleSceneFileInputChange(event);
  });

  sceneConfirmSaveButton?.addEventListener('click', () => resolveSceneConfirm('save'));
  sceneConfirmDiscardButton?.addEventListener('click', () => resolveSceneConfirm('discard'));
  sceneConfirmCancelButton?.addEventListener('click', () => resolveSceneConfirm('cancel'));
  sceneConfirm?.querySelector('.scene-confirm-backdrop')?.addEventListener('click', () => resolveSceneConfirm('cancel'));
  window.addEventListener('keydown', handleSceneConfirmKeyDown);
}

function updateSceneFileActionAvailability() {
  if (newSceneButton) {
    newSceneButton.disabled = sceneFileState.isBusy;
  }

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

async function handleNewSceneRequest() {
  if (sceneFileState.isBusy) {
    return;
  }

  const canContinue = await confirmPendingSceneTransition('start a new scene');
  if (!canContinue) {
    return;
  }

  clearPlacedItems();
  resetViewerToStart();
  commitSceneDocumentBaseline({
    displayName: 'New Scene',
    isNewScene: true,
  });
  setStatus('New scene ready. Choose a module below to place the first piece.');
}

async function confirmPendingSceneTransition(actionLabel) {
  if (!shouldPromptBeforeSceneTransition()) {
    return true;
  }

  const decision = await openSceneConfirmDialog(actionLabel);
  if (decision === 'cancel') {
    return false;
  }

  if (decision === 'save') {
    return saveSceneToFile();
  }

  return true;
}

function shouldPromptBeforeSceneTransition() {
  return hasUnsavedSceneChanges() && !isCurrentSceneNew();
}

function hasUnsavedSceneChanges() {
  return captureSceneFingerprintFromData(placementState.placedItems) !== sceneDocumentState.baselineFingerprint;
}

function commitSceneDocumentBaseline({ displayName = sceneDocumentState.displayName, isNewScene = sceneDocumentState.isNewScene } = {}) {
  sceneDocumentState.baselineFingerprint = captureSceneFingerprintFromData(placementState.placedItems);
  sceneDocumentState.displayName = displayName;
  sceneDocumentState.isNewScene = isNewScene;
}

function isCurrentSceneNew() {
  return sceneDocumentState.isNewScene && placementState.placedItems.length === 0 && !hasUnsavedSceneChanges();
}

function resetViewerToStart() {
  clearMovementState();
  stopLookDrag();
  lookState.pitch = START_CAMERA_PITCH;
  lookState.yaw = START_CAMERA_YAW;
  applyCameraLook();
  camera.position.copy(START_CAMERA_POSITION);
  playerController.setSurfaceY(START_CAMERA_POSITION.y - EYE_HEIGHT);
}

function openSceneConfirmDialog(actionLabel) {
  if (!sceneConfirm || !sceneConfirmTitle || !sceneConfirmMessage || !sceneConfirmSaveButton) {
    return Promise.resolve('cancel');
  }

  if (sceneConfirmState.resolver) {
    resolveSceneConfirm('cancel');
  }

  sceneConfirmTitle.textContent = `Save changes before you ${actionLabel}?`;
  sceneConfirmMessage.textContent = `This scene has unsaved changes. Save it before you ${actionLabel}, or continue without saving.`;
  sceneConfirm.hidden = false;
  sceneConfirm.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-dialog-open');
  sceneConfirmState.activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    sceneConfirmState.resolver = resolve;
    window.setTimeout(() => sceneConfirmSaveButton.focus(), 0);
  });
}

function resolveSceneConfirm(decision) {
  if (!sceneConfirmState.resolver) {
    return;
  }

  const resolve = sceneConfirmState.resolver;
  sceneConfirmState.resolver = null;

  if (sceneConfirm) {
    sceneConfirm.hidden = true;
    sceneConfirm.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('is-dialog-open');

  if (sceneConfirmState.activeElement) {
    sceneConfirmState.activeElement.focus();
  }
  sceneConfirmState.activeElement = null;

  resolve(decision);
}

function handleSceneConfirmKeyDown(event) {
  if (!sceneConfirmState.resolver || event.code !== 'Escape') {
    return;
  }

  event.preventDefault();
  resolveSceneConfirm('cancel');
}

async function saveSceneToFile() {
  if (sceneFileState.isBusy) {
    return false;
  }

  const payload = buildSceneFilePayloadFromData({
    environment: modelLibrary.environment || DEFAULT_ENVIRONMENT,
    fileType: WORLDGEN_FILE_TYPE,
    placedItems: placementState.placedItems,
    version: WORLDGEN_FILE_VERSION,
  });
  const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;

  if (typeof window.showSaveFilePicker !== 'function') {
    downloadScenePayload(serializedPayload);
    commitSceneDocumentBaseline({
      displayName: buildSceneFileNameFromData(modelLibrary.environment, DEFAULT_ENVIRONMENT),
      isNewScene: false,
    });
    return true;
  }

  setSceneFileBusy(true);

  try {
    const handle = await window.showSaveFilePicker({
      id: WORLDGEN_FILE_PICKER_ID,
      startIn: getScenePickerStartLocationFromData(sceneFileState.lastHandle),
      suggestedName: buildSceneFileNameFromData(modelLibrary.environment, DEFAULT_ENVIRONMENT),
      types: getSceneFilePickerTypesFromData(),
    });
    const writable = await handle.createWritable();
    await writable.write(serializedPayload);
    await writable.close();

    sceneFileState.lastHandle = handle;
    commitSceneDocumentBaseline({
      displayName: handle.name,
      isNewScene: false,
    });

    const count = placementState.placedItems.length;
    setStatus(`Scene saved to ${handle.name}. ${count} module${count === 1 ? '' : 's'} written.`);
    return true;
  } catch (error) {
    if (isPickerAbortErrorFromData(error)) {
      return false;
    }

    console.error(error);
    setStatus(`Scene save failed. ${error.message || 'Check the browser console for details.'}`);
    return false;
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

  const canContinue = await confirmPendingSceneTransition('load another scene');
  if (!canContinue) {
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
      startIn: getScenePickerStartLocationFromData(sceneFileState.lastHandle),
      multiple: false,
      types: getSceneFilePickerTypesFromData(),
    });
    const file = await handle.getFile();
    const fileText = await file.text();

    await loadSceneFromText(fileText, handle.name);
    sceneFileState.lastHandle = handle;
  } catch (error) {
    if (isPickerAbortErrorFromData(error)) {
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

function downloadScenePayload(serializedPayload) {
  const blob = new Blob([serializedPayload], { type: 'application/json' });
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = buildSceneFileNameFromData(modelLibrary.environment, DEFAULT_ENVIRONMENT);
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  const count = placementState.placedItems.length;
  setStatus(`Scene downloaded as ${link.download}. ${count} module${count === 1 ? '' : 's'} written.`);
}

async function loadSceneFromText(fileText, sourceLabel) {
  const parsedScene = parseSceneFilePayloadFromData(fileText, {
    defaultEnvironment: DEFAULT_ENVIRONMENT,
    fileType: WORLDGEN_FILE_TYPE,
  });
  const resolvedEntries = parsedScene.scene.map((entry, index) => {
    const resolvedPath = normalizeSceneModulePathFromData(resolveScenePathFromData(entry.path, parsedScene.environment));
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
  commitSceneDocumentBaseline({
    displayName: sourceLabel,
    isNewScene: false,
  });

  if (lastPlaced) {
    const count = placementState.placedItems.length;
    setStatus(getSelectedItemStatus(lastPlaced, `Scene loaded from ${sourceLabel}. ${count} module${count === 1 ? '' : 's'} restored.`));
    return;
  }

  setStatus(`Scene loaded from ${sourceLabel}. Scene is empty.`);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsedTime = clock.elapsedTime;
  updateMobileLook(delta);
  playerController.update(delta, pointer);
  updateModuleInteriorLight();
  updateSelectionHelper();

  const stars = scene.getObjectByName('starfield');
  if (stars) {
    stars.rotation.y += delta * 0.01;
  }

  updateSunSystemScene(sunSystem, elapsedTime);
  previewSystem.update(delta, elapsedTime);

  renderer.render(scene, camera);
}

function startAnimationLoop() {
  if (isAnimating) {
    return;
  }

  isAnimating = true;
  animate();
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  releaseMobileLookPad();
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
  setModuleInteriorLightItem(null);

  for (const item of placementState.placedItems) {
    detachPlacedItem(item);
  }

  placementState.placedItems.length = 0;
  placementState.lastDirection.set(0, 0, -1);
}

function detachPlacedItem(item) {
  if (moduleInteriorLightState.currentItem === item) {
    setModuleInteriorLightItem(null);
  }

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
  updateMobileSelectionActionAvailability();

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
    if (child.isMesh && !child.userData?.worldgenIgnoreCollision) {
      meshes.push(child);
    }
  });

  return meshes;
}

function refreshPlacedItemCollision(item) {
  item.group.updateMatrixWorld(true);
  item.collisionBounds.makeEmpty();

  for (const mesh of item.collisionMeshes) {
    item.collisionBounds.expandByObject(mesh);
  }
}

function updateModuleInteriorLight() {
  const currentItem = resolveViewerModuleItem(camera.position);
  setModuleInteriorLightItem(currentItem);

  if (!currentItem) {
    return;
  }

  const bounds = currentItem.collisionBounds;
  const light = moduleInteriorLightState.light;
  bounds.getCenter(moduleInteriorLightState.moduleCenter);
  bounds.getSize(moduleInteriorLightState.moduleSize);
  const minLightY = bounds.min.y + 0.7;
  const maxLightY = Math.max(bounds.max.y - MODULE_INTERIOR_LIGHT_TOP_CLEARANCE, minLightY);
  const targetY = THREE.MathUtils.clamp(bounds.min.y + MODULE_INTERIOR_LIGHT_HEIGHT, minLightY, maxLightY);
  const coverage = Math.max(
    moduleInteriorLightState.moduleSize.x,
    moduleInteriorLightState.moduleSize.z,
    moduleInteriorLightState.moduleSize.y * 1.2,
  );

  light.position.set(moduleInteriorLightState.moduleCenter.x, targetY, moduleInteriorLightState.moduleCenter.z);
  light.distance = THREE.MathUtils.clamp(coverage * 2.5, MODULE_INTERIOR_LIGHT_MIN_DISTANCE, MODULE_INTERIOR_LIGHT_MAX_DISTANCE);
  light.shadow.camera.far = light.distance;
}

function resolveViewerModuleItem(position) {
  const currentItem = moduleInteriorLightState.currentItem;
  if (
    currentItem &&
    placementState.placedItems.includes(currentItem) &&
    isPointWithinBounds(currentItem.collisionBounds, position, MODULE_INTERIOR_LIGHT_STICKY_MARGIN)
  ) {
    return currentItem;
  }

  let bestItem = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const item of placementState.placedItems) {
    if (!isPointWithinBounds(item.collisionBounds, position)) {
      continue;
    }

    const center = item.collisionBounds.getCenter(moduleInteriorLightState.moduleCenter);
    const size = item.collisionBounds.getSize(moduleInteriorLightState.moduleSize);
    const volume = Math.max(size.x * size.y * size.z, 0.001);
    const distanceSq = center.distanceToSquared(position);
    const score = distanceSq + volume * 0.0015;

    if (score < bestScore) {
      bestItem = item;
      bestScore = score;
    }
  }

  return bestItem;
}

function isPointWithinBounds(bounds, point, margin = 0) {
  return (
    point.x >= bounds.min.x - margin &&
    point.x <= bounds.max.x + margin &&
    point.y >= bounds.min.y - margin &&
    point.y <= bounds.max.y + margin &&
    point.z >= bounds.min.z - margin &&
    point.z <= bounds.max.z + margin
  );
}

function setModuleInteriorLightItem(item) {
  if (moduleInteriorLightState.currentItem === item) {
    moduleInteriorLightState.light.visible = Boolean(item);
    return;
  }

  moduleInteriorLightState.currentItem = item;
  moduleInteriorLightState.light.visible = Boolean(item);
}
