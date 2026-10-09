import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { APPLIANCE_REACH, type ApplianceKind, TV_REMOTE_REACH } from '../../../shared/appliances.ts';
import { type AvatarState, DOOR_REACH } from '../../../shared/protocol.ts';
import { doorPosition } from '../../../shared/town.ts';
import type { Sounds } from '../audio/sounds.ts';
import { ChaseCamera } from '../camera/chaseCamera.ts';
import { OrbitCamera } from '../camera/orbitCamera.ts';
import type { Input } from '../input.ts';
import { CAMERA_RAY_GROUPS } from '../net/remotePlayers.ts';
import { AvatarModel } from '../player/avatarModel.ts';
import { CharacterPhysics } from '../player/character.ts';
import { Car } from '../vehicles/car.ts';
import { CAR, type CarControls } from '../vehicles/carPhysics.ts';
import type { Appliances } from '../world/appliances.ts';
import type { Doors } from '../world/doors.ts';
import { nearestSeat, type Seat } from '../world/seats.ts';
import type { World } from '../world/world.ts';
import { placeEffects } from '../world/zones/index.ts';

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
  | { kind: 'sit'; seat: Seat }
  | { kind: 'stand' }
  | { kind: 'switch'; id: string; appliance: ApplianceKind; on: boolean }
  | null;

/** The player's own car and character, and switching between them. */
export class LocalPlayer {
  mode: Mode = 'car';
  /** Held in place (e.g. on a race grid before the start): brakes on, can't get out. */
  frozen = false;
  readonly car: Car;
  private character: CharacterPhysics;
  private avatar: AvatarModel;
  private chase: ChaseCamera;
  private orbit: OrbitCamera;
  interaction: Interaction = null;
  /** Called when the player asks to open or close a door; the server decides. */
  requestDoor: (houseId: string, open: boolean) => void = () => {};
  /** Called when the player asks to switch a TV, lamp or stove; the server decides. */
  requestSwitch: (id: string, on: boolean) => void = () => {};
  /** Things to sit on and switch; set once the world is built. */
  seats: Seat[] = [];
  appliances: Appliances | null = null;
  /** Where other players are sitting, so we don't sit on them. */
  takenSeats: () => THREE.Vector3[] = () => [];
  /** The seat we're sitting on, if any. */
  private seat: Seat | null = null;
  /** Walking speed as a fraction of normal (slowed when freezing). */
  speedScale = 1;

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
    this.car.onImpact = (strength) => sounds.crash(this.car.object.position, strength);
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
    const at = this.car.physics.body.translation();
    const carPlace = placeEffects(at.x, at.y, at.z);
    if (this.mode === 'car') {
      this.car.step(this.frozen ? PARKED : input.car, dt, carPlace);
      return;
    }
    this.car.step(PARKED, dt, carPlace);
    const feet = this.character.feet;
    const place = placeEffects(feet.x, feet.y + 1.2, feet.z);
    if (this.seat) {
      this.character.step(new THREE.Vector3(), false, false, dt, place);
      return;
    }
    const c = input.foot;
    const { forward, right } = this.orbit.basis;
    const move = forward.multiplyScalar(c.forward).addScaledVector(right, c.strafe);
    if (move.lengthSq() > 1) move.normalize();
    move.multiplyScalar(this.speedScale);
    this.character.step(move, c.run, c.jump, dt, place);
  }

  /** Per-frame update after physics: interactions, models and camera. */
  update(input: Input, dt: number): void {
    // Any move key gets you up from a seat.
    const c = input.foot;
    if (this.seat && (c.forward || c.strafe || c.jump)) this.stand();
    this.interaction = this.findInteraction();
    if (input.wasPressed('KeyE')) this.interact();
    if (this.seat && input.wasPressed('KeyR')) this.useRemote();
    if (this.mode === 'car' && !this.frozen) {
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
      if (this.seat) {
        this.avatar.seated = true;
        this.avatar.animate(0, dt);
        this.avatar.placeSeated(this.seat.position, this.seat.yaw);
        this.orbit.update(this.avatar.root.position);
        return;
      }
      this.avatar.seated = false;
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

  /** Which way the player faces (yaw, 0 = +Z): the car, or the character on foot. */
  get facing(): number {
    return this.mode === 'car' ? yawOf(this.car.object.quaternion) : this.character.yaw;
  }

  get avatarState(): AvatarState | null {
    if (this.mode === 'car') return null;
    if (this.seat) {
      const p = this.avatar.root.position;
      return { p: [round(p.x), round(p.y), round(p.z)], yaw: round(this.seat.yaw), speed: 0, seated: true };
    }
    const f = this.character.feet;
    return { p: [round(f.x), round(f.y), round(f.z)], yaw: round(this.character.yaw), speed: round(this.character.speed) };
  }

  /** Puts the player in their car at a race grid slot. */
  lineUp(position: THREE.Vector3, yaw: number): void {
    this.stand();
    if (this.mode === 'foot') this.enterCar();
    this.car.teleport(position, yaw);
    this.chase.snap();
  }

  private findInteraction(): Interaction {
    if (this.frozen) return null;
    if (this.mode === 'car') {
      return Math.abs(this.car.physics.speed) <= MAX_EXIT_SPEED ? { kind: 'exit-car' } : { kind: 'too-fast' };
    }
    if (this.seat) return { kind: 'stand' };
    // What we look at (with the camera) wins, then what's closest: a door, the car, a seat
    // or an appliance. So beside a sofa with a lamp, look at the lamp to switch it.
    const feet = this.character.feet;
    const { forward } = this.orbit.basis;
    const look = Math.atan2(forward.x, forward.z);
    const options: { score: number; interaction: Interaction }[] = [];
    const add = (distance: number, at: { x: number; z: number }, interaction: Interaction) => {
      const dir = Math.atan2(at.x - feet.x, at.z - feet.z);
      const off = Math.abs(Math.atan2(Math.sin(dir - look), Math.cos(dir - look)));
      // Things right underfoot count as in view whichever way we look.
      options.push({ score: (distance < 0.5 ? 0 : off) * 1.2 + distance * 0.5, interaction });
    };
    const door = this.doors.nearest(feet, DOOR_REACH);
    if (door) add(door.distance, doorPosition(door.house), { kind: 'door', houseId: door.house.id, address: door.house.address, open: door.open });
    const carDistance = feet.distanceTo(this.car.object.position);
    if (carDistance <= CAR_REACH) add(carDistance, this.car.object.position, { kind: 'enter-car' });
    const seat = nearestSeat(this.seats, feet, this.takenSeats());
    if (seat) add(seat.distance, seat.seat.position, { kind: 'sit', seat: seat.seat });
    const appliance = this.appliances?.nearest(feet, APPLIANCE_REACH);
    if (appliance) {
      const { id, kind, world } = appliance.appliance;
      add(appliance.distance, world, { kind: 'switch', id, appliance: kind, on: this.appliances!.isOn(id) });
    }
    options.sort((a, b) => a.score - b.score);
    return options[0]?.interaction ?? null;
  }

  /** The TV a seated player can reach with the remote, if any. */
  get remoteTv(): { id: string; on: boolean } | null {
    if (!this.seat || !this.appliances) return null;
    const tv = this.appliances.nearest(this.seat.position, TV_REMOTE_REACH, 'tv');
    return tv && { id: tv.appliance.id, on: this.appliances.isOn(tv.appliance.id) };
  }

  private sit(seat: Seat): void {
    this.seat = seat;
    this.sounds.sit(seat.position);
  }

  /** Gets up from a seat, back where we stood before sitting. */
  private stand(): void {
    if (!this.seat) return;
    this.seat = null;
    this.avatar.seated = false;
  }

  private interact(): void {
    const i = this.interaction;
    if (i?.kind === 'exit-car') this.exitCar();
    else if (i?.kind === 'enter-car') this.enterCar();
    else if (i?.kind === 'door') this.requestDoor(i.houseId, !i.open);
    else if (i?.kind === 'sit') this.sit(i.seat);
    else if (i?.kind === 'stand') this.stand();
    else if (i?.kind === 'switch') this.requestSwitch(i.id, !i.on);
  }

  /** R while seated: the TV remote. */
  private useRemote(): void {
    const tv = this.remoteTv;
    if (tv) this.requestSwitch(tv.id, !tv.on);
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

  /** Distance to the first obstacle between two points (not counting other players or `exclude`); null if clear. */
  private castRay(from: THREE.Vector3, to: THREE.Vector3, exclude: RAPIER.RigidBody): number | null {
    const dir = to.clone().sub(from);
    const max = dir.length();
    if (max < 1e-6) return null;
    const ray = new RAPIER.Ray(from, dir.divideScalar(max));
    const hit = this.world.physics.castRay(ray, max, true, undefined, CAMERA_RAY_GROUPS, undefined, exclude);
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
