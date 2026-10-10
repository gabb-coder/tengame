import * as THREE from 'three';

export interface ParticleLook {
  /** How many can be alive at once. */
  max: number;
  /** Glowing things add their light (fire, sparks); others cover what's behind (smoke, water). */
  glow?: boolean;
  /** Soft puffs fade out toward their edge (smoke); hard ones are round drops (water, bits). */
  soft?: boolean;
  /** Downward pull, m/s² (negative rises, like smoke). */
  gravity: number;
  /** How quickly they slow down in the air, per second. */
  drag: number;
  /** How much they grow over their life (smoke spreads out). */
  grow: number;
}

/**
 * A cloud of little things that fly, fall, grow and fade: smoke from a wrecked engine,
 * flames, a burst hydrant's spray, bits of hedge. One set draws every effect of its kind.
 */
export class Particles {
  readonly points: THREE.Points;
  private position: Float32Array;
  private velocity: Float32Array;
  private color: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private span: Float32Array;
  private start: Float32Array;
  private next = 0;
  private alive = false;
  private uniforms = { scale: { value: 700 }, light: { value: 1 } };

  constructor(private look: ParticleLook) {
    const n = look.max;
    this.position = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.span = new Float32Array(n);
    this.start = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float size;
        attribute float alpha;
        uniform float scale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = alpha > 0.0 ? max(1.0, size * scale / -mv.z) : 0.0;
        }`,
      fragmentShader: /* glsl */ `
        uniform float light;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          ${look.soft ? 'float a = vAlpha * smoothstep(1.0, 0.1, d);' : 'float a = vAlpha * smoothstep(1.0, 0.8, d);'}
          ${look.glow ? 'gl_FragColor = vec4(vColor * a, 1.0);' : 'gl_FragColor = vec4(vColor * light, a);'}
        }`,
      transparent: true,
      depthWrite: false,
      blending: look.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** How brightly lit the non-glowing ones are (dimmer at night), 0..1. */
  setLight(light: number): void {
    this.uniforms.light.value = light;
  }

  /** Matches sizes to the screen: `height` pixels tall, `fov` degrees high. */
  setView(height: number, fov: number): void {
    this.uniforms.scale.value = height / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  }

  /** One particle at `at`, moving at `v` (m/s), `size` meters across, living `life` seconds. */
  emit(at: THREE.Vector3Like, v: THREE.Vector3Like, color: THREE.Color, size: number, life: number, opacity = 1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.look.max;
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
    this.size[i] = size;
    this.start[i] = opacity;
    this.alpha[i] = opacity;
    this.life[i] = life;
    this.span[i] = life;
    this.alive = true;
  }

  update(dt: number): void {
    if (!this.alive) return;
    const { gravity, grow } = this.look;
    const drag = Math.exp(-this.look.drag * dt);
    const p = this.position;
    const v = this.velocity;
    this.alive = false;
    for (let i = 0; i < this.look.max; i++) {
      if (this.life[i] <= 0) continue;
      this.alive = true;
      this.life[i] -= dt;
      const k = i * 3;
      v[k] *= drag;
      v[k + 1] = v[k + 1] * drag - gravity * dt;
      v[k + 2] *= drag;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      this.size[i] *= 1 + grow * dt;
      // Fade in quickly, out slowly.
      const f = Math.max(0, this.life[i] / this.span[i]);
      this.alpha[i] = this.life[i] <= 0 ? 0 : this.start[i] * Math.min(1, (1 - f) * 8) * Math.min(1, f * 2.5);
    }
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'alpha']) g.attributes[name].needsUpdate = true;
  }
}

/** Every effect's particles, shared by everything that makes them. */
export const effects = {
  /** Grey and black smoke, rising and spreading. */
  smoke: new Particles({ max: 1500, soft: true, gravity: -1.2, drag: 0.9, grow: 0.9 }),
  /** Flames and sparks. */
  fire: new Particles({ max: 1200, glow: true, soft: true, gravity: -2.5, drag: 1.5, grow: -0.6 }),
  /** Water drops: a burst hydrant, splashes. */
  water: new Particles({ max: 2500, gravity: 9.8, drag: 0.4, grow: 0.3 }),
  /** Bits knocked flying: leaves, splinters, glass. */
  bits: new Particles({ max: 1200, gravity: 9.8, drag: 0.6, grow: 0 }),

  update(dt: number, night: number): void {
    for (const p of [this.smoke, this.fire, this.water, this.bits]) {
      p.update(dt);
      p.setLight(1 - night * 0.8);
    }
  },

  setView(height: number, fov: number): void {
    for (const p of [this.smoke, this.fire, this.water, this.bits]) p.setView(height, fov);
  },

  get objects(): THREE.Object3D[] {
    return [this.smoke.points, this.fire.points, this.water.points, this.bits.points];
  },
};
