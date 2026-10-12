import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CarState, Quat, Vec3 } from '../../../shared/protocol.ts';
import type { Team } from '../../../shared/racing.ts';
import type { CarControls } from '../vehicles/carPhysics.ts';
import { EngineSound, type EngineVoice, TireSound } from '../vehicles/engineSound.ts';
import type { SurfaceKind } from './circuit/surfaces.ts';
import { F1 } from './f1.ts';
import { F1Model } from './f1Model.ts';
import { Racer } from './racer.ts';
import type { Track } from './track.ts';

/** A Grand Prix engine: a turbo V6 revving to 12,500. */
export const F1_VOICE: EngineVoice = { cylinders: 6, redline: F1.redlineRpm, volume: 1.1 };

/**
 * A car this game drives: the player's own, or (in the game running the computer
 * drivers) one of theirs. Physics, the model drawn where the physics puts it, and for the
 * player's own car, its engine and tires heard.
 */
export class RaceCar {
  readonly racer: Racer;
  readonly model: F1Model;
  private engine: EngineSound | null = null;
  private tires: TireSound | null = null;
  private controls: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private lastVelocity = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private inverse = new THREE.Quaternion();

  constructor(
    world: RAPIER.World,
    track: Track,
    team: Team,
    position: { x: number; y: number; z: number },
    yaw: number,
    surfaceOf: (c: RAPIER.Collider | null) => SurfaceKind | null,
    audio?: THREE.AudioListener,
  ) {
    this.racer = new Racer(world, track, position, yaw, surfaceOf);
    this.model = new F1Model(team);
    if (audio) {
      this.engine = new EngineSound(audio.context, F1_VOICE);
      this.engine.output.connect(audio.getInput());
      this.tires = new TireSound(audio.context);
      this.tires.output.connect(audio.getInput());
    }
    this.update(0);
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  step(controls: CarControls, dt: number): void {
    this.controls = controls;
    this.racer.step(controls, dt);
  }

  /** Draws the car where the physics has it, and voices it. */
  update(dt: number): void {
    const p = this.racer.physics;
    const t = p.body.translation();
    const r = p.body.rotation();
    this.model.root.position.set(t.x, t.y, t.z);
    this.model.root.quaternion.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < 4; i++) {
      const w = p.wheel(i);
      this.model.setWheel(i, w.steer, w.rotation, w.suspension);
    }
    const v = p.body.linvel();
    this.velocity.set(v.x, v.y, v.z);
    if (dt > 0) {
      const accel = this.velocity.clone().sub(this.lastVelocity).divideScalar(dt);
      accel.applyQuaternion(this.inverse.copy(this.model.root.quaternion).invert());
      this.model.lean(accel.x, accel.z, dt);
    }
    this.lastVelocity.copy(this.velocity);
    this.model.setDrs(this.racer.drsOpen, dt);
    this.engine?.update(p.rpm, p.load);
    if (this.tires) {
      const grounded = [0, 1, 2, 3].some((i) => p.wheel(i).inContact);
      this.tires.update(grounded ? p.slipAngle : 0, grounded && this.controls.brake > 0.9 && Math.abs(p.speed) > 30 && this.racer.on !== 'road');
    }
  }

  get transform(): { p: Vec3; q: Quat } {
    const { position: p, quaternion: q } = this.model.root;
    return { p: [round(p.x), round(p.y), round(p.z)], q: [round(q.x), round(q.y), round(q.z), round(q.w)] };
  }

  get state(): CarState {
    const p = this.racer.physics;
    return {
      steer: round(p.steerAngle),
      rpm: Math.round(p.rpm),
      load: round(p.load),
      speed: round(p.speed),
      braking: this.controls.brake > 0,
      ...(this.racer.drsOpen ? { drs: true } : {}),
    };
  }

  /** Mutes and removes the car. */
  dispose(): void {
    this.engine?.dispose();
    this.tires?.dispose();
    this.racer.dispose();
    this.model.root.removeFromParent();
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
