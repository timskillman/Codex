import * as THREE from '../node_modules/three/build/three.module.js';
import { MTLLoader } from '../vendor/three/MTLLoader.js';
import { OBJLoader } from '../vendor/three/OBJLoader.js';
import { toRelativeModelPath } from './scene-format.js';

const ADJOINING_NORMAL_ANGLE_DEGREES = 30;
const NORMAL_WELD_TOLERANCE = 1e-4;

export function prepareTexture(renderer, texture) {
  if (!texture) {
    return;
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
}

export function materialContributesToBloom(material) {
  if (Array.isArray(material)) {
    return material.some((entry) => materialContributesToBloom(entry));
  }

  if (!material) {
    return false;
  }

  if (material.userData?.worldgenIsTexturedSelfLitMaterial) {
    return true;
  }

  if (material.emissiveMap) {
    return true;
  }

  const emissiveLuminance = getColorLuminance(material.emissive);
  const emissiveIntensity = Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 1;
  return emissiveLuminance * emissiveIntensity > 0.08;
}

export async function loadModels({
  definitions,
  textures,
  loadingManager,
  modelScale = 0.08,
  onStatus = () => {},
  renderer,
}) {
  const models = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    onStatus(`Loading module ${index + 1} of ${definitions.length}: ${definition.label}`);
    let rawObject;
    const objLoader = new OBJLoader(loadingManager);
    let usesMtl = Boolean(definition.mtlPath);

    try {
      if (usesMtl) {
        try {
          const materials = await loadObjMaterials({ loadingManager, mtlPath: definition.mtlPath, renderer });
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

    const material = createMaterial(renderer, textures.get(definition.texturePath) ?? null);

    rawObject.traverse((child) => {
      if (!child.isMesh) {
        return;
      }

      remapZUpGeometryToYUp(child.geometry);
      child.geometry = generateAdjoiningSurfaceNormals(child.geometry, ADJOINING_NORMAL_ANGLE_DEGREES);
      if (!usesMtl) {
        child.material = material;
      } else {
        child.material = applyMaterialSettings(renderer, child.material);
      }
      child.castShadow = true;
      child.receiveShadow = true;
    });

    const rawBox = new THREE.Box3().setFromObject(rawObject);
    const rawCenter = rawBox.getCenter(new THREE.Vector3());

    rawObject.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);

    const normalizedRoot = new THREE.Group();
    normalizedRoot.name = definition.label;
    normalizedRoot.add(rawObject);
    normalizedRoot.scale.setScalar(modelScale);

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

function createMaterial(renderer, texture) {
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
  return applyMaterialSettings(renderer, material);
}

async function loadObjMaterials({ loadingManager, mtlPath, renderer }) {
  const mtlLoader = new MTLLoader(loadingManager);
  const basePath = mtlPath.slice(0, mtlPath.lastIndexOf('/') + 1);
  mtlLoader.setMaterialOptions({ side: THREE.DoubleSide });
  mtlLoader.setResourcePath(basePath);

  const materials = await mtlLoader.loadAsync(mtlPath);
  materials.preload();

  Object.values(materials.materials).forEach((material) => {
    applyMaterialSettings(renderer, material);
  });

  return materials;
}

function applyMaterialSettings(renderer, material) {
  if (Array.isArray(material)) {
    return material.map((entry) => applyMaterialSettings(renderer, entry));
  }

  if (!material) {
    return material;
  }

  const selfLitMode = getTexturedSelfLitMode(material);
  if (selfLitMode) {
    return getTexturedSelfLitMaterial(renderer, material, selfLitMode);
  }

  material.side = THREE.DoubleSide;
  prepareKnownMaterialTextures(renderer, material);
  material.needsUpdate = true;
  return material;
}

function getTexturedSelfLitMode(material) {
  if (material.userData?.worldgenIsTexturedSelfLitMaterial) {
    return null;
  }

  if (isGifTexture(getPrimarySelfLitTexture(material))) {
    return 'gif';
  }

  if (shouldUseFullKeSelfLitMaterial(material)) {
    return 'full-ke';
  }

  return null;
}

function shouldUseFullKeSelfLitMaterial(material) {
  return Boolean(getPrimarySelfLitTexture(material) && isFullyEmissiveColor(material.emissive));
}

function isFullyEmissiveColor(color) {
  if (!color?.isColor) {
    return false;
  }

  return color.r >= 0.99 && color.g >= 0.99 && color.b >= 0.99;
}

function getTexturedSelfLitMaterial(renderer, sourceMaterial, mode) {
  const cacheKey = mode === 'gif' ? 'worldgenGifSelfLitMaterial' : 'worldgenFullKeSelfLitMaterial';
  if (sourceMaterial.userData?.[cacheKey]) {
    return sourceMaterial.userData[cacheKey];
  }

  const map = getPrimarySelfLitTexture(sourceMaterial);
  if (map) {
    prepareTexture(renderer, map);
  }
  if (sourceMaterial.alphaMap) {
    prepareTexture(renderer, sourceMaterial.alphaMap);
  }

  const opacity = Number.isFinite(sourceMaterial.opacity) ? sourceMaterial.opacity : 1;
  const material = new THREE.MeshBasicMaterial({
    alphaMap: sourceMaterial.alphaMap ?? null,
    alphaTest: sourceMaterial.alphaTest ?? 0,
    map,
    color: 0xffffff,
    name: sourceMaterial.name,
    opacity,
    side: sourceMaterial.side ?? THREE.DoubleSide,
    transparent: Boolean(sourceMaterial.transparent || sourceMaterial.alphaMap || opacity < 1),
    depthWrite: opacity >= 1 && !sourceMaterial.alphaMap,
    toneMapped: false,
  });

  material.userData.worldgenIsTexturedSelfLitMaterial = true;
  material.userData.worldgenSelfLitMode = mode;
  material.userData.worldgenSourceMaterial = sourceMaterial;
  if (mode === 'gif') {
    ignoreDiffuseMapAlpha(material);
  }
  material.needsUpdate = true;

  sourceMaterial.userData = sourceMaterial.userData || {};
  sourceMaterial.userData[cacheKey] = material;

  return material;
}

function prepareKnownMaterialTextures(renderer, material) {
  const textureKeys = [
    'map',
    'emissiveMap',
    'specularMap',
    'normalMap',
    'bumpMap',
    'displacementMap',
    'alphaMap',
  ];

  for (const key of textureKeys) {
    if (material[key]) {
      prepareTexture(renderer, material[key]);
    }
  }
}

function getPrimarySelfLitTexture(material) {
  return material.map ?? material.emissiveMap ?? null;
}

function getColorLuminance(color) {
  if (!color?.isColor) {
    return 0;
  }

  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function ignoreDiffuseMapAlpha(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'diffuseColor *= sampledDiffuseColor;',
      'diffuseColor.rgb *= sampledDiffuseColor.rgb;',
    );
  };
  material.customProgramCacheKey = () => 'worldgen-gif-self-lit-v1';
}

function isGifTexture(texture) {
  const textureUrl = getTextureSourceUrl(texture);
  return /\.gif(?:$|[?#])/i.test(textureUrl);
}

function getTextureSourceUrl(texture) {
  if (!texture) {
    return '';
  }

  return (
    texture.userData?.worldgenSourceUrl ||
    texture.image?.currentSrc ||
    texture.image?.src ||
    texture.source?.data?.currentSrc ||
    texture.source?.data?.src ||
    ''
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

function generateAdjoiningSurfaceNormals(sourceGeometry, maxAngleDegrees, weldTolerance = NORMAL_WELD_TOLERANCE) {
  const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry;
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3 || position.count % 3 !== 0) {
    return geometry;
  }

  const maxAngleRadians = THREE.MathUtils.degToRad(maxAngleDegrees);
  const smoothingThreshold = Math.cos(maxAngleRadians);
  const faceCount = position.count / 3;
  const faceNormals = new Array(faceCount);
  const weightedFaceNormals = new Array(faceCount);
  const adjacency = new Map();
  const normalValues = new Float32Array(position.count * 3);

  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const weightedNormal = new THREE.Vector3();
  const accumulatedNormal = new THREE.Vector3();

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const vertexOffset = faceIndex * 3;
    readVertex(position, vertexOffset, vertexA);
    readVertex(position, vertexOffset + 1, vertexB);
    readVertex(position, vertexOffset + 2, vertexC);

    edgeAB.subVectors(vertexB, vertexA);
    edgeAC.subVectors(vertexC, vertexA);
    weightedNormal.crossVectors(edgeAB, edgeAC);

    if (weightedNormal.lengthSq() < 1e-12) {
      weightedFaceNormals[faceIndex] = new THREE.Vector3(0, 1, 0);
      faceNormals[faceIndex] = new THREE.Vector3(0, 1, 0);
    } else {
      weightedFaceNormals[faceIndex] = weightedNormal.clone();
      faceNormals[faceIndex] = weightedNormal.clone().normalize();
    }

    for (let localVertex = 0; localVertex < 3; localVertex += 1) {
      const vertexIndex = vertexOffset + localVertex;
      const vertexKey = getQuantizedVertexKey(position, vertexIndex, weldTolerance);
      if (!adjacency.has(vertexKey)) {
        adjacency.set(vertexKey, []);
      }
      adjacency.get(vertexKey).push(faceIndex);
    }
  }

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const faceIndex = Math.floor(vertexIndex / 3);
    const currentFaceNormal = faceNormals[faceIndex];
    const adjacentFaces = adjacency.get(getQuantizedVertexKey(position, vertexIndex, weldTolerance)) ?? [];
    accumulatedNormal.set(0, 0, 0);

    for (const adjacentFaceIndex of adjacentFaces) {
      if (currentFaceNormal.dot(faceNormals[adjacentFaceIndex]) < smoothingThreshold) {
        continue;
      }

      accumulatedNormal.add(weightedFaceNormals[adjacentFaceIndex]);
    }

    if (accumulatedNormal.lengthSq() < 1e-12) {
      accumulatedNormal.copy(currentFaceNormal);
    } else {
      accumulatedNormal.normalize();
    }

    normalValues[vertexIndex * 3] = accumulatedNormal.x;
    normalValues[vertexIndex * 3 + 1] = accumulatedNormal.y;
    normalValues[vertexIndex * 3 + 2] = accumulatedNormal.z;
  }

  geometry.setAttribute('normal', new THREE.BufferAttribute(normalValues, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function readVertex(positionAttribute, index, target) {
  return target.set(
    positionAttribute.getX(index),
    positionAttribute.getY(index),
    positionAttribute.getZ(index),
  );
}

function getQuantizedVertexKey(positionAttribute, index, tolerance) {
  const invTolerance = 1 / tolerance;
  return [
    Math.round(positionAttribute.getX(index) * invTolerance),
    Math.round(positionAttribute.getY(index) * invTolerance),
    Math.round(positionAttribute.getZ(index) * invTolerance),
  ].join(':');
}
