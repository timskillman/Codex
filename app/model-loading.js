import * as THREE from '../node_modules/three/build/three.module.js';
import { MTLLoader } from '../vendor/three/MTLLoader.js';
import { OBJLoader } from '../vendor/three/OBJLoader.js';
import { toRelativeModelPath } from './scene-format.js';

export function prepareTexture(renderer, texture) {
  if (!texture) {
    return;
  }

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() ?? 1;
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
      if (!usesMtl) {
        child.material = material;
      } else {
        child.material = applyMaterialSettings(renderer, child.material);
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

  if (shouldUseGifSelfLitMaterial(material)) {
    return getGifSelfLitMaterial(renderer, material);
  }

  material.side = THREE.DoubleSide;
  if ('map' in material && material.map) {
    prepareTexture(renderer, material.map);
  }
  material.needsUpdate = true;
  return material;
}

function shouldUseGifSelfLitMaterial(material) {
  if (material.userData?.worldgenIsGifSelfLitMaterial) {
    return false;
  }

  return isGifTexture(material.map);
}

function getGifSelfLitMaterial(renderer, sourceMaterial) {
  if (sourceMaterial.userData?.worldgenGifSelfLitMaterial) {
    return sourceMaterial.userData.worldgenGifSelfLitMaterial;
  }

  const map = sourceMaterial.map ?? null;
  if (map) {
    prepareTexture(renderer, map);
  }

  const opacity = Number.isFinite(sourceMaterial.opacity) ? sourceMaterial.opacity : 1;
  const material = new THREE.MeshBasicMaterial({
    map,
    color: 0xffffff,
    name: sourceMaterial.name,
    opacity,
    side: sourceMaterial.side ?? THREE.DoubleSide,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
    toneMapped: false,
  });

  material.userData.worldgenIsGifSelfLitMaterial = true;
  material.userData.worldgenSourceMaterial = sourceMaterial;
  ignoreDiffuseMapAlpha(material);
  material.needsUpdate = true;

  sourceMaterial.userData = sourceMaterial.userData || {};
  sourceMaterial.userData.worldgenGifSelfLitMaterial = material;

  return material;
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
