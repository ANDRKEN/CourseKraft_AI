import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.module.js";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Language accent palette for real-time reactive illumination
const LANGUAGE_PALETTE = {
  java: { primary: 0xf59e0b, secondary: 0xd97706, emissive: 0x451a03 },
  python: { primary: 0x10b981, secondary: 0x059669, emissive: 0x064e3b },
  javascript: { primary: 0xfacc15, secondary: 0xeab308, emissive: 0x713f12 },
  "c++": { primary: 0x38bdf8, secondary: 0x0284c7, emissive: 0x0c4a6e },
  default: { primary: 0x9333ea, secondary: 0x7c3aed, emissive: 0x2e1065 }
};

export function createPaperScene(container) {
  const canvas = container.querySelector(".paper-canvas");
  if (!canvas) return null;

  const reducedMotion = window.matchMedia(MOTION_QUERY);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0.25, 8.2);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Studio Lighting setup: Warm key, cool rim, focused cursor spot
  const ambientLight = new THREE.HemisphereLight(0xfff9f0, 0x1e1c38, 2.2);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffecd4, 3.2);
  keyLight.position.set(-4, 5.5, 6.5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xbab0ff, 1.6);
  fillLight.position.set(4.5, -3, 4);
  scene.add(fillLight);

  const spotLight = new THREE.PointLight(0xa78bfa, 2.5, 12, 1.8);
  spotLight.position.set(0, 0, 4.5);
  scene.add(spotLight);

  // Main interactive sculpture group
  const sculpture = new THREE.Group();
  sculpture.rotation.set(-0.03, -0.08, -0.02);
  scene.add(sculpture);

  const materials = [];
  const meshes = [];

  function registerMaterial(mat) {
    materials.push(mat);
    return mat;
  }

  function addMesh(geo, mat, parent = sculpture) {
    const mesh = new THREE.Mesh(geo, registerMaterial(mat));
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  // --- LAYERED METAMORPHIC FOLIO SHEETS ---
  const folioGroup = new THREE.Group();
  sculpture.add(folioGroup);

  const pageSpecs = [
    { x: -0.22, y: -0.12, z: -0.32, angle: 0.16, color: 0x1b1d33, roughness: 0.9, w: 3.35, h: 2.25, name: "substrate" },
    { x: -0.12, y: -0.06, z: -0.18, angle: 0.09, color: 0xc4bcf2, roughness: 0.82, w: 3.25, h: 2.20, name: "indigo_folio" },
    { x: 0.10, y: -0.02, z: -0.06, angle: -0.08, color: 0xe8ad98, roughness: 0.85, w: 3.15, h: 2.15, name: "coral_folio" },
    { x: 0.00, y: 0.08, z: 0.08, angle: -0.015, color: 0xfcf9f2, roughness: 0.78, w: 3.08, h: 2.10, name: "front_manuscript" }
  ];

  const pageGroups = [];

  pageSpecs.forEach((spec, idx) => {
    const page = new THREE.Group();
    page.position.set(spec.x, spec.y, spec.z);
    page.rotation.z = spec.angle;
    folioGroup.add(page);
    pageGroups.push(page);

    // Beveled paper body with subtle sheen
    const paperMat = new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0.02
    });
    const paper = addMesh(new THREE.BoxGeometry(spec.w, spec.h, 0.05), paperMat, page);
    paper.userData.paperLayer = true;
    paper.userData.pageIndex = idx;

    // Deckle edge / gold gilded border on front leaf
    if (idx === 3) {
      // Embossed architectural coordinate lines
      const lineMaterial = registerMaterial(new THREE.LineBasicMaterial({
        color: 0x8b8599,
        transparent: true,
        opacity: 0.4
      }));
      for (let l = 0; l < 7; l++) {
        const y = 0.65 - l * 0.19;
        const pts = [new THREE.Vector3(-1.22, y, 0.032), new THREE.Vector3(0.85, y, 0.032)];
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMesh = new THREE.Line(lineGeo, lineMaterial);
        page.add(lineMesh);
      }

      // Elegant origami corner fold
      const foldShape = new THREE.Shape();
      foldShape.moveTo(0.96, 1.05);
      foldShape.lineTo(1.54, 0.47);
      foldShape.lineTo(1.54, 1.05);
      foldShape.closePath();
      const fold = addMesh(
        new THREE.ShapeGeometry(foldShape),
        new THREE.MeshStandardMaterial({
          color: 0xddd5f8,
          roughness: 0.75,
          metalness: 0.1,
          side: THREE.DoubleSide
        }),
        page
      );
      fold.position.z = 0.032;

      // Golden seal stamp
      const seal = addMesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.04, 24),
        new THREE.MeshStandardMaterial({
          color: 0xe5c158,
          roughness: 0.3,
          metalness: 0.75
        }),
        page
      );
      seal.position.set(-1.15, -0.68, 0.04);
      seal.rotation.x = Math.PI / 2;
    }
  });

  // --- KINETIC RIBBON HELIX ---
  const ribbonCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.2, -1.1, 0.25),
    new THREE.Vector3(-1.6, -1.6, 0.65),
    new THREE.Vector3(-0.6, -1.4, 0.55),
    new THREE.Vector3(0.8, -1.5, 0.35),
    new THREE.Vector3(1.9, -0.85, 0.2),
    new THREE.Vector3(2.1, 0.25, 0.45),
    new THREE.Vector3(1.35, 1.15, 0.55),
    new THREE.Vector3(0.2, 1.45, 0.35)
  ]);
  const ribbonSegs = 64;
  const ribbonFrames = ribbonCurve.computeFrenetFrames(ribbonSegs, false);
  const ribbonPos = [];
  const ribbonIdx = [];
  for (let i = 0; i <= ribbonSegs; i++) {
    const pt = ribbonCurve.getPointAt(i / ribbonSegs);
    const side = ribbonFrames.binormals[i].multiplyScalar(0.09);
    ribbonPos.push(
      pt.x - side.x, pt.y - side.y, pt.z - side.z,
      pt.x + side.x, pt.y + side.y, pt.z + side.z
    );
    if (i < ribbonSegs) {
      const idx = i * 2;
      ribbonIdx.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
    }
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute("position", new THREE.Float32BufferAttribute(ribbonPos, 3));
  ribbonGeo.setIndex(ribbonIdx);
  ribbonGeo.computeVertexNormals();

  const ribbonMat = registerMaterial(new THREE.MeshStandardMaterial({
    color: 0xf29e85,
    roughness: 0.45,
    metalness: 0.15,
    side: THREE.DoubleSide
  }));
  const ribbonMesh = addMesh(ribbonGeo, ribbonMat);
  ribbonMesh.userData.paperLayer = true;

  // --- FLOATING CELESTIAL ORBITAL RING & SATELLITE NODES ---
  const ringGroup = new THREE.Group();
  ringGroup.position.set(0.2, 0.1, 0.4);
  ringGroup.rotation.x = 0.45;
  ringGroup.rotation.y = -0.3;
  sculpture.add(ringGroup);

  const orbitRing = addMesh(
    new THREE.TorusGeometry(1.95, 0.018, 16, 96),
    new THREE.MeshStandardMaterial({
      color: 0xdeb887,
      roughness: 0.28,
      metalness: 0.8
    }),
    ringGroup
  );

  // Satellite node spheres (representing Slides, Code, Practice, Summary)
  const satellites = [];
  const satelliteColors = [0xa78bfa, 0x34d399, 0xfb923c, 0x38bdf8];
  for (let s = 0; s < 4; s++) {
    const angle = (s / 4) * Math.PI * 2;
    const node = addMesh(
      new THREE.SphereGeometry(0.075, 16, 16),
      new THREE.MeshStandardMaterial({
        color: satelliteColors[s],
        emissive: satelliteColors[s],
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.4
      }),
      ringGroup
    );
    node.position.set(Math.cos(angle) * 1.95, Math.sin(angle) * 1.95, 0);
    satellites.push({ mesh: node, baseAngle: angle });
  }

  // --- FLOATING ATMOSPHERIC KNOWLEDGE MOTES ---
  const moteCount = 38;
  const motePos = new Float32Array(moteCount * 3);
  const moteSeeds = [];
  for (let m = 0; m < moteCount; m++) {
    motePos[m * 3] = (Math.random() - 0.5) * 6.5;
    motePos[m * 3 + 1] = (Math.random() - 0.5) * 4.5;
    motePos[m * 3 + 2] = (Math.random() - 0.5) * 3.5;
    moteSeeds.push({
      speedX: 0.002 + Math.random() * 0.004,
      speedY: 0.003 + Math.random() * 0.006,
      phase: Math.random() * Math.PI * 2
    });
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const moteMat = registerMaterial(new THREE.PointsMaterial({
    color: 0xc4b5fd,
    size: 0.055,
    transparent: true,
    opacity: 0.65,
    blending: THREE.AdditiveBlending
  }));
  const motes = new THREE.Points(moteGeo, moteMat);
  sculpture.add(motes);

  // --- INTERACTION & ANIMATION STATE ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(3, 3);
  const target = { x: -0.03, y: -0.08, scroll: 0, dragX: 0, dragY: 0 };
  const current = { x: -0.03, y: -0.08, scroll: 0, dragX: 0, dragY: 0 };
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  let frame = 0;
  let clock = new THREE.Clock();
  let visible = false;
  let destroyed = false;
  let pulseEnergy = 0;

  const renderFrame = () => {
    if (destroyed || !visible || document.visibilityState !== "visible") {
      frame = 0;
      return;
    }

    const elapsed = clock.getElapsedTime();
    const ease = reducedMotion.matches ? 0.3 : 0.085;

    current.x += (target.x - current.x) * ease;
    current.y += (target.y - current.y) * ease;
    current.scroll += (target.scroll - current.scroll) * ease;
    current.dragX += (target.dragX - current.dragX) * ease;
    current.dragY += (target.dragY - current.dragY) * ease;

    // Organic hover and scroll rotation with spring inertia
    sculpture.rotation.y = current.y + current.dragX + current.scroll * 0.16;
    sculpture.rotation.x = -0.03 + current.x + current.dragY - current.scroll * 0.1;
    sculpture.rotation.z = -0.02 + current.y * 0.08;

    // Gentle orbital rotation of brass ring and satellites
    ringGroup.rotation.z = elapsed * 0.18;
    for (let s = 0; s < satellites.length; s++) {
      const scale = 1 + Math.sin(elapsed * 2 + satellites[s].baseAngle) * 0.15;
      satellites[s].mesh.scale.setScalar(scale);
    }

    // Dynamic light tracking
    spotLight.position.x = current.y * 12;
    spotLight.position.y = -current.x * 12;

    // Pulse wave dynamics
    if (pulseEnergy > 0.01) {
      pulseEnergy *= 0.94;
      sculpture.scale.setScalar(1 + Math.sin(elapsed * 12) * pulseEnergy * 0.08);
      spotLight.intensity = 2.5 + pulseEnergy * 4;
    } else {
      sculpture.scale.setScalar(1);
      spotLight.intensity = 2.5;
    }

    // Gentle floating motion of atmospheric motes
    const positions = moteGeo.attributes.position.array;
    for (let m = 0; m < moteCount; m++) {
      positions[m * 3 + 1] += Math.sin(elapsed + moteSeeds[m].phase) * 0.0025;
      positions[m * 3] += Math.cos(elapsed * 0.8 + moteSeeds[m].phase) * 0.0018;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // Raycast hover highlighting on paper layers
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    const hitPaper = hits.find((h) => h.object.userData.paperLayer);

    pageGroups.forEach((group, i) => {
      const isTarget = hitPaper && hitPaper.object.parent === group;
      const targetScale = isTarget ? 1.025 : 1;
      group.scale.setScalar(group.scale.x + (targetScale - group.scale.x) * 0.12);
    });

    renderer.render(scene, camera);

    // Keep loop running if active or animating
    const settled = Math.abs(target.x - current.x) < 0.0005
      && Math.abs(target.y - current.y) < 0.0005
      && Math.abs(target.scroll - current.scroll) < 0.0005
      && Math.abs(target.dragX - current.dragX) < 0.0005
      && Math.abs(target.dragY - current.dragY) < 0.0005
      && pulseEnergy < 0.01;

    if (!reducedMotion.matches || !settled) {
      frame = window.requestAnimationFrame(renderFrame);
    } else {
      frame = 0;
    }
  };

  const invalidate = () => {
    if (!frame && visible && !destroyed && document.visibilityState === "visible") {
      frame = window.requestAnimationFrame(renderFrame);
    }
  };

  const resize = () => {
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    if (window.matchMedia("(max-width: 620px)").matches) {
      visible = false;
      canvas.style.display = "none";
      if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
      return;
    }

    canvas.style.display = "";
    visible = true;
    camera.aspect = bounds.width / bounds.height;
    camera.position.z = bounds.width < 500 ? 9.2 : 8.2;
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, false);
    invalidate();
  };

  // Interaction handlers
  const onPointerMove = (e) => {
    const bounds = container.getBoundingClientRect();
    const nx = (e.clientX - bounds.left) / bounds.width;
    const ny = (e.clientY - bounds.top) / bounds.height;

    target.y = THREE.MathUtils.clamp((nx - 0.5) * 0.35, -0.18, 0.18);
    target.x = THREE.MathUtils.clamp((ny - 0.5) * -0.24, -0.12, 0.12);
    pointer.x = THREE.MathUtils.clamp(nx * 2 - 1, -1, 1);
    pointer.y = THREE.MathUtils.clamp(-ny * 2 + 1, -1, 1);

    if (isDragging) {
      const deltaX = (e.clientX - dragStart.x) * 0.005;
      const deltaY = (e.clientY - dragStart.y) * 0.005;
      target.dragX += deltaX;
      target.dragY += deltaY;
      dragStart = { x: e.clientX, y: e.clientY };
    }
    invalidate();
  };

  const onPointerDown = (e) => {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  const onPointerLeave = () => {
    isDragging = false;
    target.x = -0.03;
    target.y = -0.08;
    pointer.set(3, 3);
    invalidate();
  };

  const onScroll = () => {
    target.scroll = THREE.MathUtils.clamp(window.scrollY / 700, 0, 1.2);
    invalidate();
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };

  const onContextLost = (e) => {
    e.preventDefault();
    visible = false;
    canvas.style.display = "none";
    container.dataset.fallback = "true";
    if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
  };

  const onContextRestored = () => {
    canvas.style.display = "";
    delete container.dataset.fallback;
    resize();
    invalidate();
  };

  const intersectionObserver = new IntersectionObserver((entries) => {
    const isIntersecting = entries.some((e) => e.isIntersecting);
    visible = isIntersecting && document.visibilityState === "visible";
    if (visible) {
      resize();
      invalidate();
    } else if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }, { rootMargin: "80px", threshold: 0.01 });
  intersectionObserver.observe(container);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  container.addEventListener("pointermove", onPointerMove, { passive: true });
  container.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  container.addEventListener("pointerleave", onPointerLeave, { passive: true });
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", resize, { passive: true });
  resize();

  return {
    setVisible(nextVisible) {
      visible = Boolean(nextVisible) && document.visibilityState === "visible";
      if (visible) invalidate();
      else if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
    },

    setTopic(topic) {
      // Shimmer ribbon and illuminate spotlight with topic presence
      if (!topic) return;
      spotLight.color.setHex(0xd8b4fe);
      spotLight.intensity = 3.6;
      pulseEnergy = Math.min(pulseEnergy + 0.35, 1);
      invalidate();
    },

    setLanguage(lang) {
      const palette = LANGUAGE_PALETTE[String(lang || "").toLowerCase()] || LANGUAGE_PALETTE.default;
      ribbonMat.color.setHex(palette.primary);
      orbitRing.material.color.setHex(palette.secondary);
      satellites.forEach((s) => {
        s.mesh.material.color.setHex(palette.primary);
        s.mesh.material.emissive.setHex(palette.emissive);
      });
      spotLight.color.setHex(palette.primary);
      invalidate();
    },

    setDuration(minutes) {
      // Adjust folio leaf depth spacing based on course duration
      const spread = THREE.MathUtils.clamp((Number(minutes) || 45) / 90, 0.5, 1.4);
      pageGroups.forEach((g, idx) => {
        g.position.z = pageSpecs[idx].z * spread;
      });
      invalidate();
    },

    triggerPulse() {
      // Radiant burst animation when generating or loading course
      pulseEnergy = 1.0;
      target.dragY = 0.25;
      target.dragX = 0.35;
      window.setTimeout(() => {
        target.dragY = 0;
        target.dragX = 0;
      }, 900);
      invalidate();
    },

    dispose() {
      destroyed = true;
      if (frame) window.cancelAnimationFrame(frame);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
