import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CarState, Quat, Vec3 } from '../../../shared/protocol.ts';
import { CarModel } from './carModel.ts';
import { type CarControls, type CarEnvironment, CarPhysics } from './carPhysics.ts';
import { EngineSound, TireSound } from './engineSound.ts';

const RESPAWN_BELOW_Y = -60;
/** Sideways/forward deceleration (m/s²) that counts as hitting something; hard braking is ~10. */
const IMPACT_ACCEL = 35;
const IMPACT_COOLDOWN = 0.4; // s

/** The player's own car: physics, visuals and sound. */
export class Car {
  readonly model: CarModel;
  readonly physics: CarPhysics;
  private engine: EngineSound;
  private tires: TireSound;
  private controls: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Off while parked with nobody inside: silent and reported as 0 rpm. */
  engineOn = true;
  /** Real headlights for the player's own car (other cars just glow). */
  private beams: THREE.SpotLight[] = [];
  private lastVelocity = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private impactCooldown = 0;
  /** Called when the car hits something hard; `strength` is 0..1. */
  onImpact: (strength: number) => void = () => {};

  constructor(
    world: RAPIER.World,
    color: string,
    private spawn: { position: THREE.Vector3; yaw: number },
    audio: THREE.AudioListener,
  ) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spawn.yaw);
    this.physics = new CarPhysics(world, spawn.position, rotation);
    this.model = new CarModel(color);
    this.engine = new EngineSound(audio.context);
    this.engine.output.connect(audio.getInput());
    this.tires = new TireSound(audio.context);
    this.tires.output.connect(audio.getInput());

    for (const side of [-1, 1]) {
      const beam = new THREE.SpotLight('#fff3dc', 0, 90, 0.45, 0.5, 1.1);
      beam.position.set(side * 0.7, -0.03, 2.15);
      beam.target.position.set(side * 0.55, -1.3, 22);
      this.model.root.add(beam, beam.target);
      this.beams.push(beam);
    }
  }

  /** Headlights on at night, while the engine runs. */
  setNight(night: number): void {
    const on = this.engineOn ? THREE.MathUtils.smoothstep(night, 0.25, 0.6) : 0;
    for (const beam of this.beams) beam.intensity = on * 260;
    this.model.setNight(night);
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  /** Fixed-step physics update. */
  step(controls: CarControls, dt: number, place?: CarEnvironment & { lava?: boolean }): void {
    this.controls = controls;
    this.physics.step(controls, dt, place);
    // Fell off the world, or drove into lava: back to the start.
    if (this.physics.body.translation().y < RESPAWN_BELOW_Y || place?.lava) this.respawn();
  }

  /** Puts the car back on its wheels where it is. */
  reset(): void {
    this.physics.reset();
    this.impactCooldown = IMPACT_COOLDOWN; // stopping dead here isn't a crash
  }

  /** Teleports the car back to its spawn point. */
  respawn(): void {
    this.teleport(this.spawn.position, this.spawn.yaw);
  }

  /** Places the car at `position` facing `yaw` (0 = +Z), at rest. */
  teleport(position: THREE.Vector3Like, yaw: number): void {
    const body = this.physics.body;
    body.setTranslation(position, true);
    body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.impactCooldown = IMPACT_COOLDOWN;
  }

  get bodyHandle(): RAPIER.RigidBody {
    return this.physics.body;
  }

  /** Per-frame visual and audio update, after physics has stepped. */
  update(dt: number): void {
    const body = this.physics.body;
    const t = body.translation();
    const r = body.rotation();
    this.model.root.position.set(t.x, t.y, t.z);
    this.model.root.quaternion.set(r.x, r.y, r.z, r.w);

    for (let i = 0; i < 4; i++) {
      const w = this.physics.wheel(i);
      this.model.setWheel(i, w.steer, w.rotation, w.suspension);
    }

    // Body lean from acceleration in the car's own frame.
    const v = body.linvel();
    this.velocity.set(v.x, v.y, v.z);
    this.impactCooldown -= dt;
    if (dt > 0) {
      const accel = this.velocity.clone().sub(this.lastVelocity).divideScalar(dt);
      // Landing from a jump is vertical; crashes are horizontal.
      const jolt = Math.hypot(accel.x, accel.z);
      if (jolt > IMPACT_ACCEL && this.impactCooldown <= 0) {
        this.impactCooldown = IMPACT_COOLDOWN;
        this.onImpact(Math.min(1, (jolt - IMPACT_ACCEL) / 120 + 0.25));
      }
      accel.applyQuaternion(this.inverse.copy(this.model.root.quaternion).invert());
      this.model.lean(accel.x, accel.z, dt);
    }
    this.lastVelocity.copy(this.velocity);
    this.model.setBraking(this.braking);

    this.engine.update(this.physics.rpm, this.physics.load, this.engineOn ? 1 : 0);
    const grounded = [0, 1, 2, 3].some((i) => this.physics.wheel(i).inContact);
    const handbrakeSkid = this.controls.handbrake && Math.abs(this.physics.speed) > 3;
    this.tires.update(grounded ? this.physics.slipAngle : 0, grounded && handbrakeSkid);
  }

  get transform(): { p: Vec3; q: Quat } {
    const { position: p, quaternion: q } = this.model.root;
    return { p: [round(p.x), round(p.y), round(p.z)], q: [round(q.x), round(q.y), round(q.z), round(q.w)] };
  }

  get state(): CarState {
    return {
      steer: round(this.physics.steerAngle),
      rpm: this.engineOn ? Math.round(this.physics.rpm) : 0,
      load: this.engineOn ? round(this.physics.load) : 0,
      speed: round(this.physics.speed),
      braking: this.braking,
    };
  }

  private get braking(): boolean {
    const { brake, throttle } = this.controls;
    return this.physics.gear < 0 ? throttle > 0 : brake > 0;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
