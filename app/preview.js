import * as THREE from '../node_modules/three/build/three.module.js';

export function createPreviewSystem({
  modelStrip,
  imageWidth = 360,
  imageHeight = 220,
  rotationSpeed = 0.42,
  tilt = 0,
  frameInterval = 1 / 10,
}) {
  const previewRenderer = safelyCreatePreviewCaptureRenderer({ imageWidth, imageHeight });
  const previewEntries = [];
  const previewEntryByElement = new Map();
  let previewAccumulator = 0;
  const previewVisibilityObserver = createPreviewVisibilityObserver(modelStrip, previewEntryByElement);

  return {
    imageHeight,
    imageWidth,
    isEnabled: Boolean(previewRenderer),
    registerCard(card, model, canvas) {
      if (!previewRenderer) {
        return null;
      }

      const entry = createPreviewEntry({ model, canvas, imageWidth, imageHeight, tilt });
      if (!entry) {
        return null;
      }

      previewEntries.push(entry);
      previewEntryByElement.set(card, entry);
      if (previewVisibilityObserver) {
        previewVisibilityObserver.observe(card);
      }
      renderPreviewEntry({
        entry,
        elapsedTime: 0,
        imageHeight,
        imageWidth,
        previewRenderer,
        rotationSpeed,
        tilt,
      });
      return entry;
    },
    update(delta, elapsedTime) {
      if (!previewRenderer || previewEntries.length === 0) {
        return;
      }

      previewAccumulator += delta;
      if (previewAccumulator < frameInterval) {
        return;
      }

      previewAccumulator = 0;

      for (const entry of previewEntries) {
        if (!entry.isVisible) {
          continue;
        }

        renderPreviewEntry({
          entry,
          elapsedTime,
          imageHeight,
          imageWidth,
          previewRenderer,
          rotationSpeed,
          tilt,
        });
      }
    },
  };
}

function createPreviewCaptureRenderer({ imageWidth, imageHeight }) {
  const previewRenderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  previewRenderer.setPixelRatio(1);
  previewRenderer.setSize(imageWidth, imageHeight, false);
  previewRenderer.setClearColor(0x000000, 0);
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  previewRenderer.toneMappingExposure = 1.05;
  return previewRenderer;
}

function safelyCreatePreviewCaptureRenderer(options) {
  try {
    return createPreviewCaptureRenderer(options);
  } catch (error) {
    console.warn('Preview renderer unavailable', error);
    return null;
  }
}

function createPreviewEntry({ model, canvas, imageWidth, imageHeight, tilt }) {
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const previewTemplate = model.previewTemplate ?? model.template;

  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(40, imageWidth / imageHeight, 0.1, 100);
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

  const clone = previewTemplate.clone(true);
  clone.rotation.x = tilt;
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

function createPreviewVisibilityObserver(modelStrip, previewEntryByElement) {
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

function renderPreviewEntry({
  entry,
  elapsedTime,
  imageHeight,
  imageWidth,
  previewRenderer,
  rotationSpeed,
  tilt,
}) {
  entry.object.rotation.x = tilt;
  entry.object.rotation.y = Math.PI / 5 + elapsedTime * rotationSpeed;
  previewRenderer.render(entry.scene, entry.camera);
  entry.context.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
  entry.context.drawImage(
    previewRenderer.domElement,
    0,
    0,
    imageWidth,
    imageHeight,
    0,
    0,
    entry.canvas.width,
    entry.canvas.height,
  );
}
