import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.module.js";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function createPaperScene(container) {
  const canvas = container.querySelector(".paper-canvas");
  const reducedMotion = window.matchMedia(MOTION_QUERY);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
  camera.position.set(0, 0.2, 7.8);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "low-power"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  scene.add(new THREE.HemisphereLight(0xfff8ec, 0x34334d, 2.1));
  const key = new THREE.DirectionalLight(0xffeadc, 3.0);
  key.position.set(-3.4, 4.8, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xaaa1ff, 1.3);
  fill.position.set(4, -2.5, 3);
  scene.add(fill);

  const sculpture = new THREE.Group();
  sculpture.rotation.set(-0.04, -0.1, -0.03);
  scene.add(sculpture);

  const materials = [];
  const meshes = [];
  const layerSpecs = [
    { x: -0.18, y: -0.08, z: -0.18, angle: 0.14, color: 0xcfc7ef, w: 3.05, h: 2.06 },
    { x: 0.08, y: -0.02, z: -0.08, angle: -0.1, color: 0xd9957f, w: 3.02, h: 2.04 },
    { x: 0, y: 0.1, z: 0.04, angle: -0.015, color: 0xf4efe5, w: 2.98, h: 2.04 }
  ];

  function addMaterial(material) {
    materials.push(material);
    return material;
  }

  function addMesh(geometry, material, parent = sculpture) {
    const mesh = new THREE.Mesh(geometry, addMaterial(material));
    parent.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  layerSpecs.forEach((spec, index) => {
    const page = new THREE.Group();
    page.position.set(spec.x, spec.y, spec.z);
    page.rotation.z = spec.angle;
    sculpture.add(page);
    const base = addMesh(
      new THREE.BoxGeometry(spec.w, spec.h, 0.055),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.88, metalness: 0.01 }) ,
      page
    );
    base.userData.paperLayer = true;
    if (index !== 2) continue;

    const ruleMaterial = new THREE.LineBasicMaterial({ color: 0x9b98a2, transparent: true, opacity: 0.45 });
    for (let line = 0; line < 6; line += 1) {
      const y = 0.54 - line * 0.205;
      const points = [new THREE.Vector3(-1.12, y, 0.034), new THREE.Vector3(0.64, y, 0.034)];
      addMesh(new THREE.BufferGeometry().setFromPoints(points), ruleMaterial, page);
      materials.pop(); // The fine rules share one material, disposed once below.
    }
    materials.push(ruleMaterial);

    const foldShape = new THREE.Shape();
    foldShape.moveTo(0.92, 1.02);
    foldShape.lineTo(1.47, 0.48);
    foldShape.lineTo(1.47, 1.02);
    foldShape.closePath();
    const fold = addMesh(
      new THREE.ShapeGeometry(foldShape),
      new THREE.MeshStandardMaterial({ color: 0xd9d2f7, roughness: 0.92, side: THREE.DoubleSide }),
      page
    );
    fold.position.z = 0.031;
  });

  const ribbonCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.85, -0.82, 0.2),
    new THREE.Vector3(-1.42, -1.34, 0.48),
    new THREE.Vector3(-0.52, -1.2, 0.42),
    new THREE.Vector3(0.64, -1.3, 0.25),
    new THREE.Vector3(1.58, -0.7, 0.1),
    new THREE.Vector3(1.75, 0.08, 0.34),
    new THREE.Vector3(1.2, 0.83, 0.44)
  ]);
  const ribbonSegments = 48;
  const ribbonFrames = ribbonCurve.computeFrenetFrames(ribbonSegments, false);
  const ribbonPositions = [];
  const ribbonIndices = [];
  for (let i = 0; i <= ribbonSegments; i += 1) {
    const point = ribbonCurve.getPointAt(i / ribbonSegments);
    const side = ribbonFrames.binormals[i].multiplyScalar(0.075);
    ribbonPositions.push(
      point.x - side.x, point.y - side.y, point.z - side.z,
      point.x + side.x, point.y + side.y, point.z + side.z
    );
    if (i < ribbonSegments) {
      const index = i * 2;
      ribbonIndices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
  }
  const ribbonGeometry = new THREE.BufferGeometry();
  ribbonGeometry.setAttribute("position", new THREE.Float32BufferAttribute(ribbonPositions, 3));
  ribbonGeometry.setIndex(ribbonIndices);
  ribbonGeometry.computeVertexNormals();
  const ribbon = addMesh(
    ribbonGeometry,
    new THREE.MeshStandardMaterial({ color: 0xe5b2a0, roughness: 0.76, metalness: 0, side: THREE.DoubleSide })
  );
  ribbon.userData.paperLayer = true;

  const accent = addMesh(
    new THREE.SphereGeometry(0.075, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x8e82ed, roughness: 0.45, emissive: 0x272046, emissiveIntensity: 0.3 })
  );
  accent.position.set(1.58, 0.95, 0.36);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(3, 3);
  const target = { x: -0.04, y: -0.1, scroll: 0 };
  const current = { x: -0.04, y: -0.1, scroll: 0 };
  let frame = 0;
  let visible = false;
  let destroyed = false;
  let intersecting = false;

  const renderFrame = () => {
    if (destroyed || !visible || document.visibilityState !== "visible") {
      frame = 0;
      return;
    }
    const ease = reducedMotion.matches ? 0.28 : 0.095;
    current.x += (target.x - current.x) * ease;
    current.y += (target.y - current.y) * ease;
    current.scroll += (target.scroll - current.scroll) * ease;
    sculpture.rotation.y = current.y + current.scroll * 0.12;
    sculpture.rotation.x = -0.04 + current.x - current.scroll * 0.08;
    sculpture.rotation.z = -0.03 + current.y * 0.12;

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false).find((entry) => entry.object.userData.paperLayer);
    sculpture.children.forEach((child) => {
      child.scale.setScalar(hit && hit.object.parent === child ? 1.012 : 1);
    });
    renderer.render(scene, camera);

    const settled = Math.abs(target.x - current.x) < 0.001
      && Math.abs(target.y - current.y) < 0.001
      && Math.abs(target.scroll - current.scroll) < 0.001;
    if (settled) frame = 0;
    else frame = window.requestAnimationFrame(renderFrame);
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
    visible = intersecting && document.visibilityState === "visible";
    camera.aspect = bounds.width / bounds.height;
    camera.position.z = bounds.width < 450 ? 8.8 : 7.8;
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, false);
    invalidate();
  };

  const onPointerMove = (event) => {
    const bounds = container.getBoundingClientRect();
    target.y = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width - 0.5) * 0.22, -0.11, 0.11);
    target.x = THREE.MathUtils.clamp(((event.clientY - bounds.top) / bounds.height - 0.5) * -0.15, -0.075, 0.075);
    pointer.x = THREE.MathUtils.clamp(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1);
    pointer.y = THREE.MathUtils.clamp(-((event.clientY - bounds.top) / bounds.height) * 2 + 1, -1, 1);
    invalidate();
  };
  const onPointerLeave = () => {
    target.x = -0.04;
    target.y = -0.1;
    pointer.set(3, 3);
    invalidate();
  };
  const onScroll = () => {
    target.scroll = THREE.MathUtils.clamp(window.scrollY / 900, 0, 1);
    invalidate();
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };
  const onMotionPreference = () => {
    target.x = -0.04;
    target.y = -0.1;
    invalidate();
  };
  const onContextLost = (event) => {
    event.preventDefault();
    visible = false;
    canvas.style.display = "none";
    container.dataset.fallback = "true";
    if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
  };
  const onContextRestored = () => {
    canvas.style.display = "";
    delete container.dataset.fallback;
    resize();
    visible = intersecting && document.visibilityState === "visible";
    invalidate();
  };

  const intersectionObserver = new IntersectionObserver((entries) => {
    intersecting = entries.some((entry) => entry.isIntersecting);
    visible = intersecting && document.visibilityState === "visible";
    if (visible) {
      resize();
      invalidate();
    } else if (frame) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }, { rootMargin: "0px", threshold: 0.01 });
  intersectionObserver.observe(container);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  container.addEventListener("pointermove", onPointerMove, { passive: true });
  container.addEventListener("pointerleave", onPointerLeave, { passive: true });
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  reducedMotion.addEventListener?.("change", onMotionPreference);
  window.addEventListener("resize", resize, { passive: true });
  resize();

  return {
    setVisible(nextVisible) {
      visible = Boolean(nextVisible) && intersecting && document.visibilityState === "visible";
      if (visible) invalidate();
      else if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
    },
    dispose() {
      destroyed = true;
      if (frame) window.cancelAnimationFrame(frame);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMotion.removeEventListener?.("change", onMotionPreference);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
      });
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
