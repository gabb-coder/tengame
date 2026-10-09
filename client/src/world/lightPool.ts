import * as THREE from 'three';

/** Something that gives off light: a street lamp, a fire, a room's ceiling light. */
export interface LightSource {
  /** Where it is. Read every frame, so it can move. */
  position: THREE.Vector3;
  color: THREE.ColorRepresentation;
  /** How bright. Read every frame, so it can fade. */
  intensity: number;
  /** How far it reaches, in meters. */
  range: number;
  /** How fast it fades with distance (default 1.6). */
  decay?: number;
  /** Only lit when this says so (e.g. a fire that's burning, or at night). */
  active?: () => boolean;
  /** Fires flicker. */
  flicker?: boolean;
  /** Chosen over sources this many meters nearer (the lights of the room you're in). */
  priority?: number;
  /** Gets a light the moment it switches on, at full brightness (a flash). */
  instant?: boolean;
}

/** How many real lights there are. Each one costs time on every pixel drawn. */
const POOL = 8;
/** How often to choose which sources get them, in seconds. */
const RESELECT = 0.25;
/** A light that moves to a new source fades in over this long, in seconds. */
const FADE_IN = 0.3;

/**
 * The few real point lights that every glowing thing in the world shares (street lamps,
 * room lights, fires, neon, fireworks): each goes to one of the best sources near the
 * camera. The number of lights never changes, even when some are dark: a change would
 * make every material in view rebuild its shader, freezing the game for a moment.
 */
export class LightPool {
  private sources: LightSource[] = [];
  private instant: LightSource[] = [];
  private lights: THREE.PointLight[] = [];
  private assigned: (LightSource | null)[] = [];
  private fade: number[] = [];
  private since = Infinity;
  private time = 0;
  private camera = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 20, 1.6);
      scene.add(light);
      this.lights.push(light);
      this.assigned.push(null);
      this.fade.push(0);
    }
  }

  add(...sources: LightSource[]): void {
    for (const s of sources) {
      this.sources.push(s);
      if (s.instant) this.instant.push(s);
    }
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    this.since += dt;
    if (this.since > RESELECT || this.instant.some((s) => !this.assigned.includes(s) && this.eligible(s, camera))) {
      this.since = 0;
      this.reselect(camera);
    }
    this.lights.forEach((light, i) => {
      const s = this.assigned[i];
      if (!s) {
        light.intensity = 0;
        return;
      }
      this.fade[i] = Math.min(1, this.fade[i] + dt / FADE_IN);
      const flicker = s.flicker ? 0.82 + 0.18 * Math.sin(this.time * 13 + i * 3) * Math.sin(this.time * 7.3 + i) : 1;
      light.position.copy(s.position);
      if (s.color instanceof THREE.Color) light.color.copy(s.color);
      light.intensity = s.intensity * flicker * this.fade[i];
    });
  }

  private eligible(s: LightSource, camera: THREE.Vector3): boolean {
    return s.intensity > 0 && (s.active?.() ?? true) && s.position.distanceToSquared(camera) < (s.range + 60) ** 2;
  }

  private reselect(camera: THREE.Vector3): void {
    const at = this.camera.copy(camera);
    const score = (s: LightSource) => s.position.distanceTo(at) - (s.priority ?? 0);
    const best = this.sources
      .filter((s) => this.eligible(s, at))
      .sort((a, b) => score(a) - score(b))
      .slice(0, POOL);
    // Lights already on a chosen source keep it (no fade); the rest take the others.
    const free: number[] = [];
    this.assigned.forEach((s, i) => {
      if (s && best.includes(s)) best.splice(best.indexOf(s), 1);
      else free.push(i);
    });
    for (const i of free) {
      const s = best.shift() ?? null;
      this.assigned[i] = s;
      this.fade[i] = s?.instant ? 1 : 0;
      if (!s) continue;
      const light = this.lights[i];
      light.color.set(s.color);
      light.distance = s.range;
      light.decay = s.decay ?? 1.6;
    }
  }
}
