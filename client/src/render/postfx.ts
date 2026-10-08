import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type Quality = 'low' | 'medium' | 'high';

const STORAGE_KEY = 'tengame.quality';

/**
 * Rendering with optional post-processing, by quality setting:
 * - low: plain render (fastest)
 * - medium: bloom, so lamps, headlights and lit windows glow
 * - high: bloom plus ambient occlusion (soft contact shadows in corners, under cars
 *   and furniture), at the cost of more GPU time
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private gtao: GTAOPass | null = null;
  quality: Quality;
  private size = new THREE.Vector2(1, 1);

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.quality = loadQuality();
    this.build();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    try {
      localStorage.setItem(STORAGE_KEY, q);
    } catch {
      // Not remembered in private mode; fine.
    }
    this.build();
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.composer?.setSize(width, height);
  }

  /** Renders a frame; `night` (0..1) strengthens the glow after dark. */
  render(night: number): void {
    if (!this.composer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (this.bloom) {
      // Bloom sees HDR values before tone mapping, where the daytime sky is many times
      // brighter than 1. By day only the brightest highlights glow; at night, every lamp.
      this.bloom.strength = THREE.MathUtils.lerp(0.12, 0.6, night);
      this.bloom.threshold = THREE.MathUtils.lerp(8, 0.7, night);
    }
    this.composer.render();
  }

  private build(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    this.gtao?.dispose();
    this.gtao = null;
    if (this.quality === 'low') return;

    const { x: w, y: h } = this.size;
    // Half-float and multisampled, so HDR highlights survive for bloom and edges stay smooth.
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(w, h);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality === 'high') {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1, thickness: 1 });
      this.gtao.blendIntensity = 0.85;
      composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.2, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }
}

function loadQuality(): Quality {
  try {
    const q = localStorage.getItem(STORAGE_KEY);
    if (q === 'low' || q === 'medium' || q === 'high') return q;
  } catch {
    // Storage unavailable.
  }
  return 'medium';
}
