import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CarDamage, CarState, Quat, Vec3 } from '../../../shared/protocol.ts';
import { CarModel } from './carModel.ts';
import { type CarControls, type CarEnvironment, CarPhysics } from './carPhysics.ts';
import { Damage } from './damage.ts';
import { EngineSound, TireSound } from './engineSound.ts';

const RESPAWN_BELOW_Y = -60;
/** Sideways/forward deceleration (m/s²) that counts as hitting something; hard braking is ~10. */
const IMPACT_ACCEL = 35;
const IMPACT_COOLDOWN = 0.4; // s
/** A crash's whole jolt is measured over this long (s) after it starts. */
const IMPACT_WINDOW = 0.12;

/**
 * A car our game moves: our own, or a friend's we're driving. Physics, visuals and sound
 * (the engine heard as ours, wherever the camera is).
 */
export class Car {
  readonly model: CarModel;
  readonly physics: CarPhysics;
  private engine: EngineSound;
  private tires: TireSound;
  private controls: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  /** Off while parked with nobody inside: silent and reported as 0 rpm. */
  engineOn = true;
  private lastVelocity = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  private impactCooldown = 0;
  /** A crash being measured: the velocity just before it, and time left to measure. */
  private impact: { before: THREE.Vector3; left: number } | null = null;
  /** Dents, and what they do to the car. */
  readonly damage = new Damage();
  /** Called when the car hits something hard; `strength` is 0..1. */
  onImpact: (strength: number) => void = () => {};
  /** Called once when the car is wrecked. */
  onWrecked: () => void = () => {};
  private wreckShown = false;

  constructor(
    world: RAPIER.World,
    color: string,
    private spawn: { position: THREE.Vector3; yaw: number },
    audio: THREE.AudioListener,
  ) {
    const rotation = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spawn.yaw);
    this.physics = new CarPhysics(world, spawn.position, rotation);
    this.model = new CarModel(color);
    this.model.root.position.copy(spawn.position);
    this.model.root.quaternion.copy(rotation);
    this.engine = new EngineSound(audio.context);
    this.engine.output.connect(audio.getInput());
    this.tires = new TireSound(audio.context);
    this.tires.output.connect(audio.getInput());
  }

  /** Tail lights glow after dark. */
  setNight(night: number): void {
    this.model.setNight(night);
  }

  /**
   * Whether our game moves the car. Not while someone else drives it: then it's drawn
   * from their game instead (see net/remotePlayers.ts), and this one is put away.
   */
  setActive(on: boolean): void {
    if (this.physics.body.isEnabled() === on) return;
    this.physics.body.setEnabled(on);
    this.model.root.visible = on;
    if (!on) {
      this.engineOn = false;
      this.engine.update(0, 0, 0);
      this.tires.update(0);
    }
  }

  /** Sets the car down where `p` and `q` say, at rest, dented as `dmg` says (when someone else had it). */
  place(p: Vec3, q: Quat, dmg: CarDamage | undefined): void {
    const body = this.physics.body;
    body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
    body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.model.root.position.set(...p);
    this.model.root.quaternion.set(...q);
    this.lastVelocity.set(0, 0, 0);
    this.impactCooldown = IMPACT_COOLDOWN;
    this.impact = null;
    this.damage.repair();
    if (dmg) this.damage.sides.splice(0, 4, ...dmg);
    this.wreckShown = this.damage.wrecked;
    this.model.setDamage(this.damage.sides);
  }

  /** Done with the car (a friend's, given back): out of the world and silent. */
  dispose(): void {
    this.engine.dispose();
    this.tires.dispose();
    this.physics.dispose();
    this.model.dispose();
    this.model.root.removeFromParent();
  }

  /** The engine's going: someone's in, and it isn't wrecked. */
  get running(): boolean {
    return this.engineOn && !this.damage.wrecked;
  }

  /**
   * Damage from hitting something the car doesn't simply bounce off (a person, a bin, a
   * lamp post that snaps): `dir` points (car-local) toward what was hit; `amount` 0..1.
   */
  hit(dir: { x: number; z: number }, amount: number): void {
    // It slows the car, but that isn't a crash into a wall.
    this.impactCooldown = Math.max(this.impactCooldown, 0.25);
    this.impact = null;
    this.damage.hit(dir, amount);
    this.showDamage();
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  /** Fixed-step physics update. */
  step(controls: CarControls, dt: number, place?: CarEnvironment & { lava?: boolean }): void {
    // A smashed nose loses power; a wreck has none.
    const power = this.damage.power;
    if (power < 1) controls = { ...controls, throttle: controls.throttle * power };
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

  /** A new car, good as new, right where this one is: upright, facing the same way. */
  replace(): void {
    this.reset();
    this.damage.repair();
    this.showDamage();
  }

  /** Teleports the car back to its spawn point, good as new (for when where it is won't do). */
  respawn(): void {
    this.teleport(this.spawn.position, this.spawn.yaw);
    this.damage.repair();
    this.showDamage();
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
        this.impact = { before: this.lastVelocity.clone(), left: IMPACT_WINDOW };
      }
      if (this.impact && (this.impact.left -= dt) <= 0) {
        // The whole change in speed the crash made, and which side took it: the car's
        // pushed away from what it hit.
        const push = this.velocity.clone().sub(this.impact.before).setY(0);
        this.impact = null;
        const toward = push.clone().negate().applyQuaternion(this.inverse.copy(this.model.root.quaternion).invert());
        this.damage.crash({ x: toward.x, z: toward.z }, push.length());
        this.showDamage();
      }
      accel.applyQuaternion(this.inverse.copy(this.model.root.quaternion).invert());
      this.model.lean(accel.x, accel.z, dt);
    }
    this.lastVelocity.copy(this.velocity);
    this.model.setBraking(this.braking);

    this.model.smoke(dt);
    this.engine.update(this.physics.rpm, this.physics.load, this.running ? 1 : 0);
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
      rpm: this.running ? Math.round(this.physics.rpm) : 0,
      load: this.running ? round(this.physics.load) : 0,
      speed: round(this.physics.speed),
      braking: this.braking,
      ...(this.damage.state ? { dmg: this.damage.state } : {}),
    };
  }

  /** Dents the model to match the damage; tells once when that's the end of the car. */
  private showDamage(): void {
    const was = this.wreckShown;
    this.model.setDamage(this.damage.sides);
    this.wreckShown = this.damage.wrecked;
    if (this.wreckShown && !was) this.onWrecked();
  }

  private get braking(): boolean {
    const { brake, throttle } = this.controls;
    return this.physics.gear < 0 ? throttle > 0 : brake > 0;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
