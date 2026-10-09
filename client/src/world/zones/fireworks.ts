import * as THREE from 'three';
import { game } from '../../game/link.ts';

const MAX = 6000;
const GRAVITY = 5.5;
const PALETTE = ['#ff3a3a', '#ffb62a', '#fff27a', '#3aff6a', '#3ac8ff', '#7a5cff', '#ff4ad8', '#ffffff'];

interface Shell {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Seconds until it bursts. */
  fuse: number;
  colors: THREE.Color[];
  size: number;
  /** Seconds to wait before launching. */
  delay: number;
  from: THREE.Vector3;
}

/**
 * Fireworks: rockets that whistle up and burst into thousands of glowing sparks. One set of
 * particles serves every show in the world.
 */
export class Fireworks {
  readonly points: THREE.Points;
  private position = new Float32Array(MAX * 3);
  private velocity = new Float32Array(MAX * 3);
  private color = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private span = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private next = 0;
  private shells: Shell[] = [];
  private flash: THREE.PointLight;
  private flashLeft = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 900 } },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float alpha;
        uniform float scale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.0 ? max(1.5, scale * 0.35 / -mv.z) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float glow = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColor * (1.0 + glow * 2.0) * vAlpha, 1.0) * glow;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.flash = new THREE.PointLight('#ffffff', 0, 160, 1.2);
    this.points.add(this.flash);
  }

  /** A show of `count` rockets over a few seconds, fired from `from`. */
  show(from: THREE.Vector3, count = 14, height = 55): void {
    for (let i = 0; i < count; i++) {
      const finale = i >= count - 4;
      this.launch(from, height * (0.75 + Math.random() * 0.5), finale ? 0.6 + i * 0.12 + count * 0.5 : i * 0.55 + Math.random() * 0.3, finale ? 1.4 : 1);
    }
  }

  /** One rocket from `from`, bursting about `height` meters up after `delay` seconds. */
  launch(from: THREE.Vector3, height: number, delay = 0, size = 1): void {
    const pick = () => new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const colors = Math.random() < 0.35 ? [pick(), pick()] : [pick()];
    const rise = 1.6 + Math.random() * 0.5;
    const spread = 0.12;
    const velocity = new THREE.Vector3((Math.random() - 0.5) * spread * height, height / rise + (GRAVITY * rise) / 2, (Math.random() - 0.5) * spread * height);
    this.shells.push({ position: from.clone(), velocity, fuse: rise, colors, size, delay, from: from.clone() });
  }

  /** A quick burst of sparks right here (finding a treasure). */
  sparkle(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 60): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const v = randomDirection().multiplyScalar(1.5 + Math.random() * 2.5);
      v.y += 2;
      this.spark(at, v, c, 0.9 + Math.random() * 0.6);
    }
  }

  update(dt: number): void {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (s.delay > 0) {
        s.delay -= dt;
        if (s.delay <= 0) game.sounds?.whistle(s.from, s.fuse);
        continue;
      }
      s.velocity.y -= GRAVITY * dt;
      s.position.addScaledVector(s.velocity, dt);
      s.fuse -= dt;
      // The rocket's own trail.
      this.spark(s.position, new THREE.Vector3((Math.random() - 0.5) * 0.6, -1, (Math.random() - 0.5) * 0.6), new THREE.Color(1, 0.75, 0.4), 0.35);
      if (s.fuse > 0) continue;
      this.shells.splice(i, 1);
      this.explode(s);
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      this.flash.intensity = Math.max(0, this.flashLeft) * 900;
    }
    const p = this.position;
    const v = this.velocity;
    const drag = Math.exp(-1.3 * dt);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      v[k] *= drag;
      v[k + 1] = v[k + 1] * drag - GRAVITY * 0.5 * dt;
      v[k + 2] *= drag;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.span[i]);
      // Fade out, twinkling near the end.
      this.alpha[i] = f < 0.3 ? f * 3.3 * (0.5 + 0.5 * Math.sin(this.life[i] * 40 + i)) : 1;
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  private explode(s: Shell): void {
    const n = Math.round((130 + Math.random() * 90) * s.size);
    const speed = (13 + Math.random() * 7) * s.size;
    const ring = Math.random() < 0.25;
    for (let i = 0; i < n; i++) {
      const dir = ring ? new THREE.Vector3(Math.cos((i / n) * Math.PI * 2), (Math.random() - 0.5) * 0.15, Math.sin((i / n) * Math.PI * 2)) : randomDirection();
      this.spark(s.position, dir.multiplyScalar(speed * (0.85 + Math.random() * 0.3)), s.colors[i % s.colors.length], 1.8 + Math.random() * 1.0);
    }
    this.flash.position.copy(s.position);
    this.flash.color.copy(s.colors[0]);
    this.flashLeft = 0.25;
    game.sounds?.burstBang(s.position, s.size);
  }

  private spark(at: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const k = i * 3;
    this.position[k] = at.x;
    this.position[k + 1] = at.y;
    this.position[k + 2] = at.z;
    this.velocity[k] = v.x;
    this.velocity[k + 1] = v.y;
    this.velocity[k + 2] = v.z;
    this.color[k] = color.r;
    this.color[k + 1] = color.g;
    this.color[k + 2] = color.b;
    this.life[i] = life;
    this.span[i] = life;
    this.alpha[i] = 1;
  }
}

function randomDirection(): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
}

/** One set of fireworks for the whole world, added to the scene by the zones. */
export const fireworks = new Fireworks();
