import * as THREE from '../node_modules/three/build/three.module.js';

const BLOOM_SHELL_STEPS = 10;
const BLOOM_SHELL_LAYERS = Array.from({ length: BLOOM_SHELL_STEPS }, (_, index) => {
  const t = index / (BLOOM_SHELL_STEPS - 1);
  return {
    expansion: THREE.MathUtils.lerp(1.012, 1.13, t),
    opacity: 0.052 * Math.pow(1 - t, 1.35),
  };
});

export function attachEmissiveBloomShells(root, materialFilter = () => false) {
  const targets = [];

  root.traverse((child) => {
    if (!child.isMesh || child.userData?.worldgenHasBloomShells || child.userData?.worldgenIsBloomShell) {
      return;
    }

    const sourceMaterial = getBloomSourceMaterial(child.material, materialFilter);
    if (!sourceMaterial) {
      return;
    }

    targets.push({ mesh: child, sourceMaterial });
  });

  for (const { mesh, sourceMaterial } of targets) {
    mesh.userData.worldgenHasBloomShells = true;

    for (const layer of BLOOM_SHELL_LAYERS) {
      const shellGeometry = createExpandedBloomGeometry(mesh.geometry, layer.expansion);
      const shell = new THREE.Mesh(shellGeometry, createBloomShellMaterial(sourceMaterial, layer.opacity));
      shell.position.copy(mesh.position);
      shell.quaternion.copy(mesh.quaternion);
      shell.scale.copy(mesh.scale);
      shell.renderOrder = (mesh.renderOrder ?? 0) + 0.25;
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.matrixAutoUpdate = mesh.matrixAutoUpdate;
      if (!shell.matrixAutoUpdate) {
        shell.updateMatrix();
      }
      shell.visible = mesh.visible;
      shell.userData.worldgenIgnoreCollision = true;
      shell.userData.worldgenIsBloomShell = true;
      shell.raycast = () => {};
      mesh.parent?.add(shell);
    }
  }
}

function createExpandedBloomGeometry(sourceGeometry, expansion) {
  const geometry = sourceGeometry.clone();
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;
  if (!bounds || bounds.isEmpty()) {
    return geometry;
  }

  const center = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(expansion, expansion, expansion);
  geometry.translate(center.x, center.y, center.z);
  geometry.computeBoundingSphere();

  return geometry;
}

function getBloomSourceMaterial(material, materialFilter) {
  if (Array.isArray(material)) {
    return material.find((entry) => materialFilter(entry)) ?? null;
  }

  return materialFilter(material) ? material : null;
}

function createBloomShellMaterial(sourceMaterial, baseOpacity) {
  const color = getBloomColor(sourceMaterial);
  const opacity = baseOpacity * getBloomStrength(sourceMaterial);
  const material = new THREE.MeshBasicMaterial({
    blending: THREE.AdditiveBlending,
    color,
    depthTest: true,
    depthWrite: false,
    opacity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 8,
    side: THREE.DoubleSide,
    toneMapped: false,
    transparent: true,
  });

  return material;
}

function getBloomColor(material) {
  if (material.emissive?.isColor && getColorLuminance(material.emissive) > 0.001) {
    return material.emissive.clone();
  }

  return new THREE.Color(0xffffff);
}

function getBloomStrength(material) {
  if (material.userData?.worldgenIsTexturedSelfLitMaterial) {
    return 1.3;
  }

  const emissiveLuminance = getColorLuminance(material.emissive);
  const emissiveIntensity = Number.isFinite(material.emissiveIntensity) ? material.emissiveIntensity : 1;
  return THREE.MathUtils.clamp(0.8 + emissiveLuminance * emissiveIntensity * 1.4, 0.8, 1.9);
}

function getColorLuminance(color) {
  if (!color?.isColor) {
    return 0;
  }

  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}
