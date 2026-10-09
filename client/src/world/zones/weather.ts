import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';
import type { WeatherKind } from './ambience.ts';

/** Particles fill a box this big around the camera, wrapping around as it moves. */
const BOX = new THREE.Vector3(44, 26, 44);

interface Spec {
  count: number;
  /** Drift in m/s. */
  velocity: THREE.Vector3;
  /** How much each particle wanders sideways (m/s). */
  wobble: number;
  color: string;
  size: number;
  opacity: number;
  /** Streaks (rain) instead of dots. */
  streak?: number;
  /** Glows (embers, fireflies): not dimmed by night. */
  glow?: boolean;
}

const SPECS: Record<WeatherKind, Spec> = {
  snow: { count: 1800, velocity: new THREE.Vector3(0.6, -1.3, 0.2), wobble: 0.6, color: '#ffffff', size: 0.13, opacity: 0.9 },
  rain: { count: 1600, velocity: new THREE.Vector3(1.5, -17, 0.8), wobble: 0, color: '#b9c8e8', size: 0, opacity: 0.38, streak: 0.06 },
  ash: { count: 1200, velocity: new THREE.Vector3(0.4, -0.7, 0.3), wobble: 0.4, color: '#8a8580', size: 0.1, opacity: 0.75 },
  dust: { count: 700, velocity: new THREE.Vector3(3.2, -0.1, 1.1), wobble: 0.5, color: '#d8c49a', size: 0.08, opacity: 0.55 },
  spores: { count: 500, velocity: new THREE.Vector3(0.1, 0.12, 0), wobble: 0.35, color: '#d8f080', size: 0.11, opacity: 0.85, glow: true },
  bubbles: { count: 600, velocity: new THREE.Vector3(0, 1.1, 0), wobble: 0.3, color: '#d8f4ff', size: 0.09, opacity: 0.6 },
};

/** Round, soft-edged dot for particles. */
function dotTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

class Particles {
  readonly object: THREE.Points | THREE.LineSegments;
  private base: Float32Array;
  private phase: Float32Array;
  private positions: Float32Array;
  private material: THREE.PointsMaterial | THREE.LineBasicMaterial;

  constructor(
    private spec: Spec,
    dot: THREE.Texture,
    seed: number,
  ) {
    const rng = mulberry32(seed);
    this.base = new Float32Array(spec.count * 3);
    this.phase = new Float32Array(spec.count);
    for (let i = 0; i < spec.count; i++) {
      this.base.set([rng() * BOX.x, rng() * BOX.y, rng() * BOX.z], i * 3);
      this.phase[i] = rng() * Math.PI * 2;
    }
    const per = spec.streak ? 2 : 1;
    this.positions = new Float32Array(spec.count * 3 * per);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    if (spec.streak) {
      this.material = new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: spec.opacity, depthWrite: false });
      this.object = new THREE.LineSegments(g, this.material);
    } else {
      this.material = new THREE.PointsMaterial({
        color: spec.color,
        size: spec.size,
        map: dot,
        transparent: true,
        opacity: spec.opacity,
        depthWrite: false,
        blending: spec.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      this.object = new THREE.Points(g, this.material);
    }
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  update(time: number, camera: THREE.Vector3, amount: number, night: number): void {
    const { spec } = this;
    const count = Math.floor(spec.count * Math.min(1, amount));
    this.object.visible = count > 0;
    if (!count) return;
    this.object.geometry.setDrawRange(0, count * (spec.streak ? 2 : 1));
    // Glowing specks are fireflies: much brighter after dark.
    this.material.opacity = spec.opacity * (spec.glow ? 0.25 + night * 0.75 : 1 - night * 0.4);
    const v = spec.velocity;
    const origin = { x: camera.x - BOX.x / 2, y: camera.y - BOX.y / 2, z: camera.z - BOX.z / 2 };
    const wrap = (value: number, size: number, start: number) => start + ((((value - start) % size) + size) % size);
    for (let i = 0; i < count; i++) {
      const p = this.phase[i];
      const sway = spec.wobble * Math.sin(time * 0.9 + p);
      let x = this.base[i * 3] + v.x * time + sway;
      let y = this.base[i * 3 + 1] + v.y * time + spec.wobble * 0.5 * Math.sin(time * 1.3 + p * 2);
      let z = this.base[i * 3 + 2] + v.z * time + spec.wobble * Math.cos(time * 0.7 + p);
      x = wrap(x, BOX.x, origin.x);
      y = wrap(y, BOX.y, origin.y);
      z = wrap(z, BOX.z, origin.z);
      if (spec.streak) {
        const k = spec.streak;
        this.positions.set([x, y, z, x - v.x * k, y - v.y * k, z - v.z * k], i * 6);
      } else this.positions.set([x, y, z], i * 3);
    }
    (this.object.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Snow, rain, ash, dust, spores and bubbles around the camera, as strong as the zone says. */
export class Weather {
  readonly group = new THREE.Group();
  private systems = new Map<WeatherKind, Particles>();
  private time = 0;

  constructor() {
    const dot = dotTexture();
    let seed = 1;
    for (const [kind, spec] of Object.entries(SPECS) as [WeatherKind, Spec][]) {
      const p = new Particles(spec, dot, seed++);
      this.systems.set(kind, p);
      this.group.add(p.object);
    }
  }

  /** `amounts` per kind (0..1); `sheltered` hides falling weather (indoors). */
  update(dt: number, camera: THREE.Vector3, amounts: Partial<Record<WeatherKind, number>>, night: number, sheltered: boolean): void {
    this.time += dt;
    for (const [kind, p] of this.systems) {
      const falling = kind === 'snow' || kind === 'rain' || kind === 'ash' || kind === 'dust';
      p.update(this.time, camera, sheltered && falling ? 0 : (amounts[kind] ?? 0), night);
    }
  }
}
