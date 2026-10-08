import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { type AvatarState, DOOR_REACH } from '../../../shared/protocol.ts';
import type { Sounds } from '../audio/sounds.ts';
import { ChaseCamera } from '../camera/chaseCamera.ts';
import { OrbitCamera } from '../camera/orbitCamera.ts';
import type { Input } from '../input.ts';
import { AvatarModel } from '../player/avatarModel.ts';
import { CharacterPhysics } from '../player/character.ts';
import { Car } from '../vehicles/car.ts';
import { CAR, type CarControls } from '../vehicles/carPhysics.ts';
import type { Doors } from '../world/doors.ts';
import type { World } from '../world/world.ts';

/** How close (meters from the car's center) you must be to get in. */
const CAR_REACH = 3.2;
/** Can't jump out of a moving car. */
const MAX_EXIT_SPEED = 3; // m/s
const PARKED: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const HIDDEN_FEET = new THREE.Vector3(0, -50, 0);

export type Mode = 'car' | 'foot';

/** What pressing E would do right now, for the on-screen prompt. */
export type Interaction =
  | { kind: 'enter-car' }
  | { kind: 'exit-car' }
  | { kind: 'too-fast' }
  | { kind: 'door'; houseId: string; address: string; open: boolean }
  | null;

/** The player's own car and character, and switching between them. */
export class LocalPlayer {
  mode: Mode = 'car';
  readonly car: Car;
  private character: CharacterPhysics;
  private avatar: AvatarModel;
  private chase: ChaseCamera;
  private orbit: OrbitCamera;
  interaction: Interaction = null;
  /** Called when the player asks to open or close a door; the server decides. */
  requestDoor: (houseId: string, open: boolean) => void = () => {};

  constructor(
    private world: World,
    private doors: Doors,
    private sounds: Sounds,
    id: string,
    color: string,
    spawn: { position: THREE.Vector3; yaw: number },
    listener: THREE.AudioListener,
  ) {
    this.car = new Car(world.physics, color, spawn, listener);
    world.scene.add(this.car.object);

    this.character = new CharacterPhysics(world.physics, HIDDEN_FEET);
    this.character.setEnabled(false);
    this.avatar = new AvatarModel(color, id);
    this.avatar.root.visible = false;
    world.scene.add(this.avatar.root);

    this.chase = new ChaseCamera(world.camera, (from, to) => this.castRay(from, to, this.car.bodyHandle));
    this.orbit = new OrbitCamera(world.camera, (from, to) => this.castRay(from, to, this.character.body));
  }

  /** Fixed-step physics update; call before `world.physics.step()`. */
  fixedStep(input: Input, dt: number): void {
    if (this.mode === 'car') {
      this.car.step(input.car, dt);
      return;
    }
    this.car.step(PARKED, dt);
    const c = input.foot;
    const { forward, right } = this.orbit.basis;
    const move = forward.multiplyScalar(c.forward).addScaledVector(right, c.strafe);
    if (move.lengthSq() > 1) move.normalize();
    this.character.step(move, c.run, c.jump, dt);
  }

  /** Per-frame update after physics: interactions, models and camera. */
  update(input: Input, dt: number): void {
    this.interaction = this.findInteraction();
    if (input.wasPressed('KeyE')) this.interact();
    if (this.mode === 'car') {
      if (input.wasPressed('KeyR')) this.car.reset();
      if (input.wasPressed('KeyT')) this.car.respawn();
    }

    this.car.update(dt);
    if (this.mode === 'car') {
      input.takeLook(dt); // discard mouse movement while driving
      this.chase.update(this.car.object, this.car.physics.speed, dt);
    } else {
      const look = input.takeLook(dt);
      this.orbit.turn(look.yaw, look.pitch);
      const feet = this.character.feet;
      this.avatar.root.position.copy(feet);
      this.avatar.root.rotation.y = this.character.yaw;
      this.avatar.animate(this.character.speed, dt, !this.character.grounded);
      this.orbit.update(feet);
    }
  }

  /** Where the camera's attention is, for the sun's shadow area. */
  get focus(): THREE.Vector3 {
    return this.mode === 'car' ? this.car.object.position : this.avatar.root.position;
  }

  get avatarState(): AvatarState | null {
    if (this.mode === 'car') return null;
    const f = this.character.feet;
    return { p: [round(f.x), round(f.y), round(f.z)], yaw: round(this.character.yaw), speed: round(this.character.speed) };
  }

  private findInteraction(): Interaction {
    if (this.mode === 'car') {
      return Math.abs(this.car.physics.speed) <= MAX_EXIT_SPEED ? { kind: 'exit-car' } : { kind: 'too-fast' };
    }
    const feet = this.character.feet;
    const door = this.doors.nearest(feet, DOOR_REACH);
    const carDistance = feet.distanceTo(this.car.object.position);
    if (door && (carDistance > CAR_REACH || door.distance < carDistance)) {
      return { kind: 'door', houseId: door.house.id, address: door.house.address, open: door.open };
    }
    return carDistance <= CAR_REACH ? { kind: 'enter-car' } : null;
  }

  private interact(): void {
    const i = this.interaction;
    if (i?.kind === 'exit-car') this.exitCar();
    else if (i?.kind === 'enter-car') this.enterCar();
    else if (i?.kind === 'door') this.requestDoor(i.houseId, !i.open);
  }

  private exitCar(): void {
    const spot = this.findExitSpot();
    if (!spot) return; // boxed in: stay in the car
    this.mode = 'foot';
    this.car.engineOn = false;
    const carYaw = yawOf(this.car.object.quaternion);
    this.character.setEnabled(true);
    this.character.teleport(spot, carYaw);
    this.avatar.root.visible = true;
    this.orbit.yaw = carYaw;
    this.orbit.pitch = 0.25;
    this.sounds.carDoor(this.car.object.position);
  }

  private enterCar(): void {
    this.mode = 'car';
    this.car.engineOn = true;
    this.character.teleport(HIDDEN_FEET);
    this.character.setEnabled(false);
    this.avatar.root.visible = false;
    this.sounds.carDoor(this.car.object.position);
  }

  /** Beside the driver's door if there's room, else the other side, behind, or in front. */
  private findExitSpot(): THREE.Vector3 | null {
    const car = this.car.object;
    const side = CAR.halfExtents.x + 0.55;
    const end = CAR.halfExtents.z + 0.6;
    // Driver sits on the left, which is the car's local +X (it faces +Z).
    const candidates = [
      [side, 0.3],
      [-side, 0.3],
      [0, -end],
      [0, end],
    ];
    this.character.setEnabled(true);
    try {
      for (const [x, z] of candidates) {
        const p = new THREE.Vector3(x, 0, z).applyQuaternion(car.quaternion).add(car.position);
        const ground = this.groundBelow(p);
        if (ground === null) continue;
        p.y = ground;
        if (this.character.fits(p)) return p;
      }
      return null;
    } finally {
      this.character.setEnabled(this.mode === 'foot');
    }
  }

  /** Height of the first surface below `p` (ignoring the car), or null if none nearby. */
  private groundBelow(p: THREE.Vector3): number | null {
    const from = p.clone().setY(p.y + 1.5);
    const ray = new RAPIER.Ray(from, { x: 0, y: -1, z: 0 });
    const hit = this.world.physics.castRay(ray, 4, true, undefined, undefined, this.character.collider, this.car.bodyHandle);
    return hit ? from.y - hit.timeOfImpact : null;
  }

  /** Distance to the first obstacle between two points, ignoring `exclude`; null if clear. */
  private castRay(from: THREE.Vector3, to: THREE.Vector3, exclude: RAPIER.RigidBody): number | null {
    const dir = to.clone().sub(from);
    const max = dir.length();
    if (max < 1e-6) return null;
    const ray = new RAPIER.Ray(from, dir.divideScalar(max));
    const hit = this.world.physics.castRay(ray, max, true, undefined, undefined, undefined, exclude);
    return hit ? hit.timeOfImpact : null;
  }
}

function yawOf(q: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(forward.x, forward.z);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
