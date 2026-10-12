import type RAPIER from '@dimforge/rapier3d-compat';
import { type CarControls, CarPhysics } from '../vehicles/carPhysics.ts';
import type { SurfaceKind } from './circuit/surfaces.ts';
import { F1 } from './f1.ts';
import type { Track } from './track.ts';

/** Grip off the track, and how hard it holds the car back (m/s² at speed). */
const SURFACES: Record<SurfaceKind, { grip: number; drag: number }> = {
  road: { grip: 1, drag: 0 },
  grass: { grip: 0.55, drag: 1.5 },
  gravel: { grip: 0.5, drag: 9 },
  sand: { grip: 0.55, drag: 6 },
};
/** An open rear wing (DRS) cuts drag this much, and some of the rear downforce with it. */
const DRS_DRAG = 0.78;
const DRS_DOWNFORCE = 0.9;
/** Right behind another car its wake cuts your drag up to this much, but costs some downforce. */
const TOW_DRAG = 0.34;
const TOW_DOWNFORCE = 0.14;
/** Sliding more than this (rad) starts cutting the power. */
const SLIDE_FROM = 0.1;
/** Height of the chassis' center over the road when it sits on its wheels. */
export const RIDE_HEIGHT = 0.36;

/**
 * One car in the race, as physics: the F1 car itself, what its tires are on (grass and
 * gravel slow it and cost grip), the air (an open rear wing, or a tow from the car ahead),
 * and where it is on the lap.
 */
export class Racer {
  readonly physics: CarPhysics;
  /** The rear wing is open (DRS). */
  drsOpen = false;
  /** 0..1: how much of a tow it's getting from the car ahead. */
  tow = 0;
  /** Distance along the lap and meters right of the centre line, as of the last `locate`. */
  s = 0;
  lateral = 0;
  /** How far off the centre line's height (m): to tell the bridge from the road under it. */
  private surface: SurfaceKind = 'road';

  constructor(
    world: RAPIER.World,
    readonly track: Track,
    position: { x: number; y: number; z: number },
    yaw: number,
    private surfaceOf: (c: RAPIER.Collider | null) => SurfaceKind | null,
  ) {
    this.physics = new CarPhysics(world, position, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, F1);
    this.locate();
  }

  get body(): RAPIER.RigidBody {
    return this.physics.body;
  }

  get speed(): number {
    return this.physics.speed;
  }

  /** What most of its wheels are on. */
  get on(): SurfaceKind {
    return this.surface;
  }

  /** Heading (rad round +Y, 0 = +Z). */
  get yaw(): number {
    const r = this.physics.body.rotation();
    return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.x * r.x));
  }

  /** Updates `s` and `lateral` from where the car is. */
  locate(): void {
    const t = this.physics.body.translation();
    const spot = this.track.project(t.x, t.z, this.s, t.y - RIDE_HEIGHT);
    this.s = spot.s;
    this.lateral = spot.lateral;
  }

  step(controls: CarControls, dt: number): void {
    const p = this.physics;
    // Tires on grass or gravel: less grip, and it drags at the car.
    let grip = 0;
    let drag = 0;
    let touching = 0;
    const counts: Partial<Record<SurfaceKind, number>> = {};
    for (let i = 0; i < 4; i++) {
      const ground = p.wheelGround(i);
      if (!ground) continue;
      const kind = this.surfaceOf(ground) ?? 'road';
      grip += SURFACES[kind].grip;
      drag += SURFACES[kind].drag;
      counts[kind] = (counts[kind] ?? 0) + 1;
      touching++;
    }
    if (touching) {
      grip /= touching;
      drag /= 4;
      this.surface = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as SurfaceKind) ?? 'road';
    } else grip = 1;
    // Traction control: ease the power while the rear steps out.
    const slide = p.slipAngle;
    if (slide > SLIDE_FROM && Math.abs(p.speed) > 12) controls = { ...controls, throttle: controls.throttle * Math.max(0.15, 1 - (slide - SLIDE_FROM) * 6) };
    p.dragScale = (this.drsOpen ? DRS_DRAG : 1) * (1 - TOW_DRAG * this.tow);
    p.downforceScale = (this.drsOpen ? DRS_DOWNFORCE : 1) * (1 - TOW_DOWNFORCE * this.tow);
    p.step(controls, dt, { gravity: 1, grip, underwater: false });
    if (drag > 0) {
      const v = p.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.5) {
        const k = (-Math.min(drag * dt * Math.min(1, speed / 8), speed) * F1.mass) / speed;
        p.body.applyImpulse({ x: v.x * k, y: 0, z: v.z * k }, true);
      }
    }
  }

  /** Puts the car at rest at `position`, facing `yaw`. */
  place(position: { x: number; y: number; z: number }, yaw: number): void {
    const body = this.physics.body;
    body.setTranslation(position, true);
    body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.physics.gear = 1;
    this.drsOpen = false;
    this.s = this.track.project(position.x, position.z, undefined, position.y - RIDE_HEIGHT).s;
  }

  /** Back on the track at `s`, `lateral` from the centre line, facing down the track, at rest. */
  placeOnTrack(s: number, lateral: number): void {
    const p = this.track.pointAt(s, lateral, { x: 0, y: 0, z: 0 });
    this.place({ x: p.x, y: p.y + RIDE_HEIGHT + 0.15, z: p.z }, this.track.heading(s));
    this.s = this.track.wrap(s);
  }

  /** Upside down or on its side. */
  get upset(): boolean {
    const r = this.physics.body.rotation();
    return 1 - 2 * (r.x * r.x + r.z * r.z) < 0.3;
  }

  dispose(): void {
    this.physics.dispose();
  }
}
