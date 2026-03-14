import * as THREE from '../node_modules/three/build/three.module.js';

export function buildWorld(scene) {
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(320, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x07101c,
      side: THREE.BackSide,
    }),
  );
  scene.add(skyDome);

  const ambient = new THREE.HemisphereLight(0x9cbfff, 0x140d07, 0.92);
  scene.add(ambient);

  const rimLight = new THREE.DirectionalLight(0xb8d3ff, 0.72);
  rimLight.position.set(-26, 20, 14);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0x6e88b5, 0.24);
  fillLight.position.set(-10, 12, -20);
  scene.add(fillLight);

  const keyLight = new THREE.DirectionalLight(0xffefbf, 1.9);
  keyLight.position.set(42, 78, -36);
  keyLight.target.position.set(0, 2, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(4096, 4096);
  keyLight.shadow.camera.near = 8;
  keyLight.shadow.camera.far = 180;
  keyLight.shadow.camera.left = -58;
  keyLight.shadow.camera.right = 58;
  keyLight.shadow.camera.top = 58;
  keyLight.shadow.camera.bottom = -58;
  keyLight.shadow.bias = -0.00018;
  keyLight.shadow.normalBias = 0.026;
  keyLight.shadow.radius = 2.2;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const sunSystem = createSunSystem(keyLight.position);
  scene.add(sunSystem);

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

  const groundMesh = new THREE.Mesh(
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

  return { groundMesh, sunSystem };
}

export function updateSunSystem(sunSystem, elapsedTime) {
  if (!sunSystem) {
    return;
  }

  const flareLayers = sunSystem.userData.flareLayers ?? [];
  for (let index = 0; index < flareLayers.length; index += 1) {
    const layer = flareLayers[index];
    const pulse = 1 + Math.sin(elapsedTime * layer.speed + index * 1.7) * layer.pulse;
    layer.sprite.scale.set(layer.baseWidth * pulse, layer.baseHeight * pulse, 1);
    layer.sprite.material.opacity =
      layer.baseOpacity * (0.92 + Math.sin(elapsedTime * (layer.speed + 0.18) + index) * 0.08);
    layer.sprite.material.rotation = layer.baseRotation + elapsedTime * layer.rotationSpeed;
  }

  sunSystem.rotation.y = Math.sin(elapsedTime * 0.08) * 0.01;
}

function createSunSystem(position) {
  const group = new THREE.Group();
  group.name = 'sun-system';
  group.position.copy(position);

  const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xfff2c7 }),
  );
  sunCore.renderOrder = 40;
  group.add(sunCore);

  const sunCorona = new THREE.Mesh(
    new THREE.SphereGeometry(6.6, 32, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffc96d,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  sunCorona.renderOrder = 39;
  group.add(sunCorona);

  const haloTexture = createRadialGradientTexture(512, [
    [0, 'rgba(255,250,236,1)'],
    [0.15, 'rgba(255,241,201,0.92)'],
    [0.36, 'rgba(255,201,108,0.48)'],
    [0.72, 'rgba(255,159,72,0.1)'],
    [1, 'rgba(255,159,72,0)'],
  ]);
  const flareTexture = createSolarFlareTexture(768);
  const streakTexture = createLinearGlowTexture(768, 192);

  const halo = createSunSprite(haloTexture, 22, 22, 0xffdfa3, 0.92);
  const flare = createSunSprite(flareTexture, 30, 30, 0xffb35f, 0.52);
  const streakWide = createSunSprite(streakTexture, 44, 12, 0xffd79b, 0.34);
  const streakTall = createSunSprite(streakTexture, 26, 8, 0xffe6bc, 0.22);
  streakTall.material.rotation = Math.PI / 2.6;

  group.add(halo, flare, streakWide, streakTall);
  group.userData.flareLayers = [
    { sprite: halo, baseWidth: 22, baseHeight: 22, baseOpacity: 0.92, pulse: 0.035, speed: 0.8, baseRotation: 0, rotationSpeed: 0.02 },
    { sprite: flare, baseWidth: 30, baseHeight: 30, baseOpacity: 0.52, pulse: 0.065, speed: 0.55, baseRotation: 0, rotationSpeed: -0.03 },
    { sprite: streakWide, baseWidth: 44, baseHeight: 12, baseOpacity: 0.34, pulse: 0.08, speed: 0.44, baseRotation: 0, rotationSpeed: 0.014 },
    { sprite: streakTall, baseWidth: 26, baseHeight: 8, baseOpacity: 0.22, pulse: 0.06, speed: 0.67, baseRotation: Math.PI / 2.6, rotationSpeed: -0.018 },
  ];

  return group;
}

function createSunSprite(texture, width, height, color, opacity) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 41;
  return sprite;
}

function createRadialGradientTexture(size, stops) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.Texture();
  }

  const center = size * 0.5;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);

  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.globalCompositeOperation = 'screen';
  const offsetGradient = context.createRadialGradient(
    center * 0.9,
    center * 0.88,
    size * 0.02,
    center,
    center,
    center * 0.92,
  );
  offsetGradient.addColorStop(0, 'rgba(255,248,226,0.65)');
  offsetGradient.addColorStop(0.24, 'rgba(255,214,142,0.18)');
  offsetGradient.addColorStop(0.7, 'rgba(255,165,82,0.05)');
  offsetGradient.addColorStop(1, 'rgba(255,165,82,0)');
  context.fillStyle = offsetGradient;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';

  applyCanvasGrain(context, size, size, 10, 0.06);
  return finalizeCanvasTexture(canvas);
}

function createSolarFlareTexture(size = 768) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.Texture();
  }

  const center = size * 0.5;
  const baseGradient = context.createRadialGradient(center, center, 0, center, center, center);
  baseGradient.addColorStop(0, 'rgba(255,248,233,1)');
  baseGradient.addColorStop(0.1, 'rgba(255,229,172,0.9)');
  baseGradient.addColorStop(0.28, 'rgba(255,196,108,0.46)');
  baseGradient.addColorStop(0.62, 'rgba(255,152,70,0.12)');
  baseGradient.addColorStop(1, 'rgba(255,152,70,0)');
  context.fillStyle = baseGradient;
  context.fillRect(0, 0, size, size);

  context.globalCompositeOperation = 'screen';
  const ringGradient = context.createRadialGradient(center, center, size * 0.24, center, center, size * 0.47);
  ringGradient.addColorStop(0, 'rgba(255,196,120,0)');
  ringGradient.addColorStop(0.52, 'rgba(255,196,120,0)');
  ringGradient.addColorStop(0.72, 'rgba(255,214,154,0.14)');
  ringGradient.addColorStop(0.84, 'rgba(255,171,83,0.05)');
  ringGradient.addColorStop(1, 'rgba(255,171,83,0)');
  context.fillStyle = ringGradient;
  context.fillRect(0, 0, size, size);

  context.globalCompositeOperation = 'lighter';
  context.translate(center, center);

  for (let index = 0; index < 28; index += 1) {
    context.save();
    context.rotate((Math.PI * 2 * index) / 28 + Math.sin(index * 7.13) * 0.09);
    const rayLength = size * (0.22 + Math.abs(Math.sin(index * 2.17)) * 0.18);
    const rayWidth = size * (0.008 + Math.abs(Math.cos(index * 1.91)) * 0.008);
    const gradient = context.createLinearGradient(0, 0, 0, rayLength);
    gradient.addColorStop(0, 'rgba(255,235,183,0)');
    gradient.addColorStop(0.16, 'rgba(255,223,162,0.24)');
    gradient.addColorStop(0.58, 'rgba(255,172,88,0.11)');
    gradient.addColorStop(1, 'rgba(255,172,88,0)');
    context.fillStyle = gradient;
    context.filter = `blur(${(size * 0.01).toFixed(2)}px)`;
    context.beginPath();
    context.moveTo(-rayWidth, 0);
    context.lineTo(rayWidth, 0);
    context.lineTo(rayWidth * 0.28, rayLength);
    context.lineTo(-rayWidth * 0.28, rayLength);
    context.closePath();
    context.fill();
    context.restore();
  }

  for (let index = 0; index < 10; index += 1) {
    context.save();
    context.rotate((Math.PI * 2 * index) / 10 + Math.sin(index * 4.37) * 0.05);
    const rayLength = size * (0.34 + Math.abs(Math.sin(index * 1.4)) * 0.16);
    const rayWidth = size * (0.012 + Math.abs(Math.cos(index * 2.03)) * 0.007);
    const gradient = context.createLinearGradient(0, 0, 0, rayLength);
    gradient.addColorStop(0, 'rgba(255,248,217,0)');
    gradient.addColorStop(0.24, 'rgba(255,232,182,0.18)');
    gradient.addColorStop(0.82, 'rgba(255,160,76,0.04)');
    gradient.addColorStop(1, 'rgba(255,160,76,0)');
    context.fillStyle = gradient;
    context.filter = `blur(${(size * 0.018).toFixed(2)}px)`;
    context.beginPath();
    context.moveTo(-rayWidth, 0);
    context.lineTo(rayWidth, 0);
    context.lineTo(rayWidth * 0.18, rayLength);
    context.lineTo(-rayWidth * 0.18, rayLength);
    context.closePath();
    context.fill();
    context.restore();
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  const coreGradient = context.createRadialGradient(center, center, 0, center, center, center);
  coreGradient.addColorStop(0, 'rgba(255,248,231,1)');
  coreGradient.addColorStop(0.18, 'rgba(255,228,163,0.9)');
  coreGradient.addColorStop(0.42, 'rgba(255,190,92,0.44)');
  coreGradient.addColorStop(0.8, 'rgba(255,144,64,0.08)');
  coreGradient.addColorStop(1, 'rgba(255,144,64,0)');
  context.fillStyle = coreGradient;
  context.fillRect(0, 0, size, size);

  applyCanvasGrain(context, size, size, 14, 0.08);
  return finalizeCanvasTexture(canvas);
}

function createLinearGlowTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.Texture();
  }

  const linearGradient = context.createLinearGradient(0, height * 0.5, width, height * 0.5);
  linearGradient.addColorStop(0, 'rgba(255,217,149,0)');
  linearGradient.addColorStop(0.18, 'rgba(255,217,149,0.06)');
  linearGradient.addColorStop(0.5, 'rgba(255,247,225,0.9)');
  linearGradient.addColorStop(0.82, 'rgba(255,217,149,0.06)');
  linearGradient.addColorStop(1, 'rgba(255,217,149,0)');
  context.fillStyle = linearGradient;
  context.fillRect(0, 0, width, height);

  context.globalCompositeOperation = 'screen';
  const softLayer = context.createLinearGradient(0, height * 0.5, width, height * 0.5);
  softLayer.addColorStop(0, 'rgba(255,238,198,0)');
  softLayer.addColorStop(0.4, 'rgba(255,238,198,0.08)');
  softLayer.addColorStop(0.5, 'rgba(255,253,240,0.42)');
  softLayer.addColorStop(0.6, 'rgba(255,238,198,0.08)');
  softLayer.addColorStop(1, 'rgba(255,238,198,0)');
  context.fillStyle = softLayer;
  context.fillRect(0, 0, width, height);

  const glowGradient = context.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, height * 0.6);
  glowGradient.addColorStop(0, 'rgba(255,250,236,0.95)');
  glowGradient.addColorStop(0.35, 'rgba(255,222,156,0.38)');
  glowGradient.addColorStop(1, 'rgba(255,222,156,0)');
  context.fillStyle = glowGradient;
  context.fillRect(width * 0.32, 0, width * 0.36, height);

  context.globalCompositeOperation = 'source-over';
  applyCanvasGrain(context, width, height, 8, 0.05);
  return finalizeCanvasTexture(canvas);
}

function applyCanvasGrain(context, width, height, strength = 10, alphaStrength = 0.05) {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const noise = (Math.random() - 0.5) * strength;
    data[index] = clampByte(data[index] + noise);
    data[index + 1] = clampByte(data[index + 1] + noise * 0.9);
    data[index + 2] = clampByte(data[index + 2] + noise * 0.7);
    data[index + 3] = clampByte(data[index + 3] + noise * alphaStrength * 12);
  }

  context.putImageData(imageData, 0, 0);
}

function finalizeCanvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
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
