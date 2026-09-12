import * as THREE from 'three';
import type { QualityProfile } from '../types.js';

/** Renderer/scene/camera bootstrap + RAF loop with tab-hidden pause and a
 * delta clamp (a debugger-paused or backgrounded tab must not produce a
 * multi-second physics/animation jump on the next visible frame). */
export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  quality: QualityProfile = 'high';
  private raf = 0;
  private lastTime = -1;
  private paused = false;
  private disposed = false;
  private tickFns = new Set<(dt: number) => void>();
  private resizeObserver: ResizeObserver | null = null;

  constructor(private host: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 60);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, failIfMajorPerformanceCaveat: false });
    }
    this.renderer = renderer;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'academy-3d-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
    this.setQuality('high');
  }

  private onVisibility = () => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  setQuality(quality: QualityProfile): void {
    this.quality = quality;
    const dpr = quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  onTick(fn: (dt: number) => void): () => void {
    this.tickFns.add(fn);
    return () => this.tickFns.delete(fn);
  }

  start(): void {
    if (this.raf || this.disposed) return;
    this.lastTime = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.paused = true;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    this.start();
  }

  private frame = (time: number): void => {
    if (this.disposed || this.paused) return;
    const dt = this.lastTime < 0 ? 1 / 60 : Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    for (const fn of this.tickFns) fn(dt);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.tickFns.clear();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
