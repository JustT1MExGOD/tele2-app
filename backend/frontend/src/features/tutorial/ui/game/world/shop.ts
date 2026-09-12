import * as THREE from 'three';

export interface ShopAnchors {
  playerSpawn: THREE.Vector3;
  arbuzychSpot: THREE.Vector3;
  terminalSpot: THREE.Vector3;
  registerSpot: THREE.Vector3;
  customerSpot: THREE.Vector3;
  entrance: THREE.Vector3;
  introPath: THREE.Vector3[];
}

export interface ShopBuild {
  group: THREE.Group;
  anchors: ShopAnchors;
  /** XZ-plane circular collision obstacles (cheap, robust for a small cast). */
  colliders: { center: THREE.Vector2; radius: number }[];
  floorY: number;
}

const T2_LIME = 0x8fe61a;
const T2_CYAN = 0x2fd0e0;

/** Palette (see ART-DIRECTION.md): warm near-black shell (#0c1014), cool
 * slate for fixtures (#232b31), lime (#8fe61a) + cyan (#2fd0e0) brand
 * accents used sparingly as emissive trim, warm practical light (~3200K)
 * from the ceiling coffers + a cooler rim from the shopfront glass. */
export function buildShop(): ShopBuild {
  const group = new THREE.Group();
  const colliders: ShopBuild['colliders'] = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1b2126, roughness: 0.55, metalness: 0.08 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 9), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Floor tile seams (thin emissive-free strips) for scale/readability.
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x0f1317, roughness: 0.8 });
  for (let x = -4; x <= 4; x += 1) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 9), seamMat);
    seam.position.set(x, 0.006, 0);
    group.add(seam);
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x141a1f, roughness: 0.85, metalness: 0.05 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(11, 3.4, 0.2), wallMat);
  backWall.position.set(0, 1.7, -4.4);
  backWall.castShadow = true; backWall.receiveShadow = true;
  group.add(backWall);
  colliders.push({ center: new THREE.Vector2(0, -4.4), radius: 0.15 });

  const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 9), wallMat);
  sideWall.position.set(-5.4, 1.7, 0);
  sideWall.castShadow = true; sideWall.receiveShadow = true;
  group.add(sideWall);
  colliders.push({ center: new THREE.Vector2(-5.4, 0), radius: 0.15 });

  // Storefront glass wall (opposite side) with a doorway gap — the entrance.
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fd8e0, transparent: true, opacity: 0.22, roughness: 0.06, metalness: 0,
    transmission: 0.6, ior: 1.4, thickness: 0.05
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x30393f, roughness: 0.4, metalness: 0.6 });
  const glassPanel = (x: number, z: number, w: number) => {
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.04), glassMat);
    pane.position.set(x, 1.5, z);
    group.add(pane);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.08, 0.08), frameMat);
    frame.position.set(x, 2.82, z);
    group.add(frame);
  };
  glassPanel(-3.4, 4.45, 3.6);
  glassPanel(3.15, 4.45, 4.1);
  const doorFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), frameMat);
  doorFrameL.position.set(-1.55, 1.4, 4.45); group.add(doorFrameL);
  const doorFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.7, 0.1), frameMat);
  doorFrameR.position.set(1.05, 1.4, 4.45); group.add(doorFrameR);

  // Ceiling with a lit coffer strip above the counter.
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.9 });
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(11, 0.15, 9), ceilMat);
  ceiling.position.set(0, 3.42, 0);
  group.add(ceiling);
  const cofferMat = new THREE.MeshStandardMaterial({ color: 0xfff2d8, emissive: 0xfff2d8, emissiveIntensity: 1.1, roughness: 1 });
  const coffer = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.03, 0.5), cofferMat);
  coffer.position.set(0.4, 3.4, -1.6);
  group.add(coffer);

  // T2 sign on the back wall.
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.5 }));
  signBoard.position.set(1.5, 2.35, -4.28);
  group.add(signBoard);
  const signGlyph = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 0.03), new THREE.MeshStandardMaterial({ color: T2_LIME, emissive: T2_LIME, emissiveIntensity: 1.4 }));
  signGlyph.position.set(1.5, 2.35, -4.24);
  group.add(signGlyph);

  // Shelving unit (left wall) — instanced product boxes for draw-call budget.
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.4, metalness: 0.5 });
  const boxGeo = new THREE.BoxGeometry(0.16, 0.24, 0.1);
  const boxMats = [T2_LIME, T2_CYAN, 0xffffff, 0x22262c].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.1 }));
  for (let row = 0; row < 3; row++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 3.4), shelfMat);
    shelf.position.set(-5.05, 0.9 + row * 0.75, -0.6);
    shelf.castShadow = true; shelf.receiveShadow = true;
    group.add(shelf);
    for (let i = 0; i < 10; i++) {
      const box = new THREE.Mesh(boxGeo, boxMats[(row + i) % boxMats.length]);
      box.position.set(-5.05, 0.9 + row * 0.75 + 0.15, -2.15 + i * 0.36);
      box.castShadow = true;
      group.add(box);
    }
  }
  colliders.push({ center: new THREE.Vector2(-5.05, -0.6), radius: 0.5 });

  // Checkout counter (front-of-store, near the entrance) with monitor + terminal kiosk beside it.
  const counterMat = new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.3, metalness: 0.4 });
  const counterTopMat = new THREE.MeshStandardMaterial({ color: 0xd7dde0, roughness: 0.15, metalness: 0.2 });
  const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.05, 0.7), counterMat);
  counter.position.set(0.4, 0.52, 1.1);
  counter.castShadow = true; counter.receiveShadow = true;
  group.add(counter);
  const counterTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.78), counterTopMat);
  counterTop.position.set(0.4, 1.06, 1.1);
  group.add(counterTop);
  const counterAccent = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 0.03), new THREE.MeshStandardMaterial({ color: T2_LIME, emissive: T2_LIME, emissiveIntensity: 0.9 }));
  counterAccent.position.set(0.4, 0.55, 1.44);
  group.add(counterAccent);
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.03), new THREE.MeshStandardMaterial({ color: T2_CYAN, emissive: T2_CYAN, emissiveIntensity: 0.7, roughness: 0.2 }));
  monitor.position.set(0.4, 1.35, 0.86);
  monitor.rotation.y = Math.PI;
  group.add(monitor);
  const monitorStand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.06), counterMat);
  monitorStand.position.set(0.4, 1.19, 0.9);
  group.add(monitorStand);
  colliders.push({ center: new THREE.Vector2(0.4, 1.1), radius: 0.65 });
  const registerSpot = new THREE.Vector3(0.4, 0, 1.9);

  const kiosk = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.4), counterMat);
  kiosk.position.set(2.55, 0.75, 0.1);
  kiosk.castShadow = true; kiosk.receiveShadow = true;
  group.add(kiosk);
  const kioskScreen = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.02), new THREE.MeshStandardMaterial({ color: T2_LIME, emissive: T2_LIME, emissiveIntensity: 0.8 }));
  kioskScreen.position.set(2.55, 1.15, -0.11);
  kioskScreen.rotation.y = Math.PI;
  group.add(kioskScreen);
  colliders.push({ center: new THREE.Vector2(2.55, 0.1), radius: 0.42 });
  const terminalSpot = new THREE.Vector3(2.55, 0, 0.85);

  // Fitting/plant/rug near Arbuzych's spot for a lived-in feel.
  const potMat = new THREE.MeshStandardMaterial({ color: 0x3c4248, roughness: 0.7 });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.32, 12), potMat);
  pot.position.set(-2.7, 0.16, 2.6);
  pot.castShadow = true;
  group.add(pot);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f6e33, roughness: 0.75 });
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), leafMat);
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(-2.7 + Math.cos(a) * 0.12, 0.55 + Math.sin(i) * 0.1, 2.6 + Math.sin(a) * 0.12);
    leaf.scale.set(0.7, 1.3, 0.7);
    leaf.castShadow = true;
    group.add(leaf);
  }
  colliders.push({ center: new THREE.Vector2(-2.7, 2.6), radius: 0.3 });

  const rugMat = new THREE.MeshStandardMaterial({ color: 0x222a2f, roughness: 0.95 });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-1.6, 0.008, 1.5);
  rug.receiveShadow = true;
  group.add(rug);

  // Lighting rig: warm key from the ceiling coffer, cool rim through the
  // glass front, soft fill so shadows never crush to black.
  // Intensities are tuned for three.js's physically-correct lighting model
  // (candela for point/spot lights, not the old pre-r155 "legacy" scale) —
  // roughly a 10x jump from what a legacy-lit scene would need.
  const key = new THREE.PointLight(0xfff0d0, 90, 12, 2);
  key.position.set(0.4, 3.1, 0.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.002;
  group.add(key);

  const rim = new THREE.DirectionalLight(0x9fd8ff, 2.6);
  rim.position.set(-2, 3, 6);
  rim.target.position.set(0, 1, 0);
  group.add(rim, rim.target);

  const hemi = new THREE.HemisphereLight(0x6c7f8c, 0x14181c, 1.6);
  group.add(hemi);

  const fill = new THREE.AmbientLight(0x3a4a55, 1.4);
  group.add(fill);

  const accentA = new THREE.PointLight(T2_LIME, 20, 4.5, 2);
  accentA.position.set(-5.05, 1.6, -0.6);
  group.add(accentA);

  const anchors: ShopAnchors = {
    playerSpawn: new THREE.Vector3(-0.4, 0, 3.3),
    arbuzychSpot: new THREE.Vector3(-1.6, 0, 1.6),
    terminalSpot,
    registerSpot,
    customerSpot: new THREE.Vector3(1.3, 0, 2.7),
    entrance: new THREE.Vector3(-0.25, 0, 4.6),
    introPath: [
      new THREE.Vector3(0, 2.6, 6.5),
      new THREE.Vector3(-2.4, 2.1, 1.4),
      new THREE.Vector3(1.6, 1.7, -0.4),
      new THREE.Vector3(0.2, 1.5, 2.2)
    ]
  };

  return { group, anchors, colliders, floorY: 0 };
}
