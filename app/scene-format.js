import * as THREE from '../node_modules/three/build/three.module.js';

export function normalizeSceneModulePath(path) {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^assets\/models\//i, '')
    .replace(/^models\/+/i, '');
}

export function toRelativeModelPath(path) {
  return normalizeSceneModulePath(path);
}

export function inferEnvironmentFromModels(models, fallbackEnvironment = 'Moonbase') {
  return inferEnvironmentFromPath(models[0]?.relativePath ?? '', fallbackEnvironment);
}

export function inferEnvironmentFromPath(path, fallbackEnvironment = 'Moonbase') {
  const normalizedPath = normalizeSceneModulePath(path);
  const [environment] = normalizedPath.split('/');
  return environment || fallbackEnvironment;
}

export function buildSceneFilePayload({ fileType, version, environment, placedItems }) {
  return {
    FileType: fileType,
    Version: version,
    Environment: environment,
    Scene: placedItems.map((item) => ({
      Object: 'Module',
      Path: item.relativePath,
      Position: formatScenePosition(item.group.position),
      Rotation: formatSceneRotation(item.group.rotation.y),
    })),
  };
}

export function buildSceneFileName(environment, fallbackEnvironment = 'Moonbase') {
  const safeEnvironment = (environment || fallbackEnvironment)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${safeEnvironment || 'worldgen'}-scene.json`;
}

export function getScenePickerStartLocation(lastHandle) {
  return lastHandle ?? 'documents';
}

export function getSceneFilePickerTypes() {
  return [
    {
      description: 'WorldGen scene JSON',
      accept: {
        'application/json': ['.json'],
      },
    },
  ];
}

export function isPickerAbortError(error) {
  return error?.name === 'AbortError';
}

export function captureSceneFingerprint(placedItems) {
  return JSON.stringify(
    placedItems.map((item) => ({
      path: item.relativePath,
      position: formatScenePosition(item.group.position),
      rotation: formatSceneRotation(item.group.rotation.y),
    })),
  );
}

export function parseSceneFilePayload(fileText, { fileType, defaultEnvironment = 'Moonbase' }) {
  let payload;
  try {
    payload = JSON.parse(fileText);
  } catch (error) {
    throw new Error('The selected file is not valid JSON.');
  }

  const header = payload && typeof payload.Header === 'object' ? payload.Header : payload;
  if (!header || header.FileType !== fileType) {
    throw new Error(`The selected file is not a ${fileType} scene.`);
  }

  const version = String(header.Version ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('The scene file version must use major.minor.debug format.');
  }

  const environment = String(header.Environment ?? payload.Environment ?? '').trim() || defaultEnvironment;
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

export function resolveScenePath(path, environment) {
  const normalizedPath = normalizeSceneModulePath(path);
  if (!normalizedPath) {
    throw new Error('Every scene module must include a Path value.');
  }

  if (normalizedPath.includes('/')) {
    return normalizedPath;
  }

  return `${environment}/${normalizedPath}`;
}

export function formatScenePosition(position) {
  return [position.x, position.y, position.z].map(formatSceneNumber).join(',');
}

export function formatSceneRotation(rotationY) {
  const degrees = THREE.MathUtils.euclideanModulo(THREE.MathUtils.radToDeg(rotationY), 360);
  return formatSceneNumber(degrees);
}

export function formatSceneNumber(value) {
  const roundedValue = Math.abs(value) < 0.0005 ? 0 : Number(value.toFixed(3));
  return String(Object.is(roundedValue, -0) ? 0 : roundedValue);
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
