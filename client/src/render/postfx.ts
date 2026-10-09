import * as THREE from 'three';
import { settings } from '../settings.ts';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type Quality = 'low' | 'medium' | 'high';

/**
 * The most pixels drawn per screen pixel, by quality. Sharp (Retina) screens have two or
 * more; drawing all of them at medium would mean four times the work for a little
 * sharpness.
 */
const MAX_PIXEL_RATIO: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

export function pixelRatio(quality: Quality): number {
  return Math.min(devicePixelRatio, MAX_PIXEL_RATIO[quality]);
}

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
    this.quality = settings.quality;
    this.build();
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.renderer.setPixelRatio(pixelRatio(q));
    this.build();
  }

  setSize(width: number, height: number): void {
    this.size.set(width, height);
    this.composer?.setSize(width, height);
  }

  /**
   * Builds the shaders for everything in the scene now, so the game doesn't freeze to
   * build them the first time each thing comes into view. Where the browser can, they're
   * built in the background and this waits for them.
   */
  async compile(): Promise<void> {
    // Shaders differ when drawing into the effects' buffer rather than to the screen.
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.composer?.renderTarget1 ?? null);
    const ready = this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    await ready;
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
