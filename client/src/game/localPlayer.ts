import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { APPLIANCE_REACH, type ApplianceKind, TV_REMOTE_REACH } from '../../../shared/appliances.ts';
import { type Act, type AvatarState, DOOR_REACH } from '../../../shared/protocol.ts';
import { zoneAt } from '../../../shared/world.ts';
import { doorPosition } from '../../../shared/town.ts';
import type { Sounds } from '../audio/sounds.ts';
import { ChaseCamera } from '../camera/chaseCamera.ts';
import { OrbitCamera } from '../camera/orbitCamera.ts';
import type { Input } from '../input.ts';
import { CAMERA_RAY_GROUPS } from '../net/remotePlayers.ts';
import { rodTip, showAct } from '../player/acts.ts';
import { AvatarModel } from '../player/avatarModel.ts';
import { AVATAR, CharacterPhysics } from '../player/character.ts';
import { Car } from '../vehicles/car.ts';
import { CAR, type CarControls } from '../vehicles/carPhysics.ts';
import type { Appliances } from '../world/appliances.ts';
import type { Doors } from '../world/doors.ts';
import { nearestSeat, type Seat } from '../world/seats.ts';
import type { World } from '../world/world.ts';
import { placeEffects } from '../world/zones/index.ts';
import type { Activities, Activity, Mount, Prompt } from './activities.ts';
import { carHits, type CarShape } from './impacts.ts';
import { game } from './link.ts';

/** How close (meters from the car's center) you must be to get in. */
const CAR_REACH = 3.2;
/** Can't jump out of a moving car. */
const MAX_EXIT_SPEED = 3; // m/s
const PARKED: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: true };
const HIDDEN_FEET = new THREE.Vector3(0, -50, 0);
const STILL = new THREE.Vector3();
/** A jetpack's tank lasts this long at full thrust, and refills this fast on the ground. */
const JET_SECONDS = 7;
const REFUEL_SECONDS = 3;
/** Jetpack thrust, as a multiple of the local gravity. */
const JET_THRUST = 2.2;
/** The car's body, for running into people and things (see game/impacts.ts). */
const CAR_SHAPE: CarShape = { halfWidth: 0.98, halfLength: 2.25, below: 0.7, above: 0.9 };
/** Knocked down by a car: lying there (longer if knocked out), then getting up (the clip's length). */
const DOWN_SECONDS = 2.2;
const KNOCKED_OUT_SECONDS = 5;
const GET_UP_SECONDS = 2;
/** Health lost to a car hit at no speed, and per m/s more; how soon and fast it comes back. */
const HIT_HARM = 12;
const HARM_PER_MS = 2.6;
const HEAL_AFTER = 6;
const HEAL_RATE = 4;
/** Below this much health you limp. */
const LIMPING_BELOW = 60;
/** How long one-shot moves take to play. */
const ONE_SHOT_SECONDS: Partial<Record<Act, number>> = { interact: 1.4, pickup: 1.8, hit: 1.1 };

export type Mode = 'car' | 'foot';

/** What pressing E would do right now, for the on-screen prompt. */
export type Interaction =
  | { kind: 'enter-car' }
  | { kind: 'exit-car' }
  | { kind: 'too-fast' }
  | { kind: 'door'; houseId: string; address: string; open: boolean }
  | { kind: 'sit'; seat: Seat }
  | { kind: 'stand' }
  | { kind: 'leave'; label: string; blocked: string | null }
  | { kind: 'switch'; id: string; appliance: ApplianceKind; on: boolean }
  | { kind: 'activity'; activity: Activity; prompt: Prompt }
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
  /** Things to sit on and switch, and things to do out in the world; set once the world is built. */
  seats: Seat[] = [];
  appliances: Appliances | null = null;
  activities: Activities | null = null;
  /** Where other players are sitting, so we don't sit on them. */
  takenSeats: () => THREE.Vector3[] = () => [];
  /** What we're sitting or riding on, if anything. */
  private mount: Mount | null = null;
  /** Walking speed as a fraction of normal (slowed when freezing). */
  speedScale = 1;
  /** Dancing (G): until you move. */
  dancing = false;
  /** Typing in chat: shown to others as talking. */
  chatting = false;
  /** In the water. */
  swimming = false;
  /** A borrowed jetpack: fuel left (0..1), and whether it's firing. */
  jetpack: { fuel: number; thrusting: boolean } | null = null;
  /** Something done standing in one place (fishing): any move key stops it. */
  private task: { act: Act; yaw: number; stop: () => void } | null = null;
  /** A quick move playing (pressing a button, picking something up), and time left. */
  private oneShot: { act: Act; left: number } | null = null;
  private shownAct: Act | null = null;
  private time = 0;
  /** 0..100: a car knocks some off, and it slowly comes back. */
  health = 100;
  private sinceHurt = Infinity;
  /** The red flash of being hit, fading (0..1). */
  flash = 0;
  /** Knocked over by a car: flying, lying there, getting up; and seconds left of it. */
  private knockdown: { phase: 'fly' | 'down' | 'up'; left: number; out: boolean } | null = null;
  /** Called when knocked out cold, and when coming round. */
  onKnockedOut: (out: boolean) => void = () => {};

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

  /** Fixed-step physics update; call before `world.stepPhysics()`. */
  fixedStep(input: Input, dt: number): void {
    const at = this.car.physics.body.translation();
    const carPlace = placeEffects(at.x, at.y, at.z);
    if (this.mode === 'car') {
      this.runInto(dt);
      this.car.step(this.frozen ? PARKED : input.car, dt, carPlace);
      return;
    }
    this.car.step(PARKED, dt, carPlace);
    // On a ride the body is out of the physics world; on a seat it waits where it stood.
    if (this.mount?.ride) return;
    const feet = this.character.feet;
    const place = placeEffects(feet.x, feet.y + 1.2, feet.z);
    this.swimming = place.underwater;
    const c = input.foot;
    if (this.task && (c.forward || c.strafe || c.jump)) this.stopTask();
    if (this.mount || this.task || this.knockdown) {
      if (this.task) this.character.yaw = this.task.yaw;
      this.character.step(STILL, false, false, dt, place);
      return;
    }
    const { forward, right } = this.orbit.basis;
    const move = forward.multiplyScalar(c.forward).addScaledVector(right, c.strafe);
    if (move.lengthSq() > 1) move.normalize();
    // Hurt: a slow limp, no running.
    move.multiplyScalar(this.speedScale * (this.hurt ? 0.6 : 1));
    // The jetpack only works on the alien world (its fuel beacons don't reach further).
    let thrust = 0;
    const jet = this.jetpack;
    if (jet) {
      jet.thrusting = c.jump && jet.fuel > 0 && !place.underwater && zoneAt(feet.x, feet.z) === 'space';
      if (jet.thrusting) {
        thrust = AVATAR.gravity * place.gravity * JET_THRUST;
        jet.fuel = Math.max(0, jet.fuel - dt / JET_SECONDS);
      } else if (this.character.grounded) jet.fuel = Math.min(1, jet.fuel + dt / REFUEL_SECONDS);
    }
    this.character.step(move, c.run && !this.hurt, c.jump, dt, place, thrust);
  }

  /** Limping after being hit by a car, until health comes back. */
  get hurt(): boolean {
    return this.health < LIMPING_BELOW;
  }

  /** Hit by a car: thrown at `v` (m/s) and hurt by how hard; down for a moment, then up. */
  knockedBy(v: THREE.Vector3Like): void {
    // Already flying or lying there: one knock at a time.
    if (this.mode !== 'foot' || this.knockdown) return;
    if (this.mount) this.leave(true);
    this.stopTask();
    this.dancing = false;
    this.oneShot = null;
    this.character.launch(v);
    const speed = Math.hypot(v.x, v.y, v.z);
    this.health = Math.max(0, this.health - (HIT_HARM + speed * HARM_PER_MS));
    this.sinceHurt = 0;
    this.flash = 1;
    this.knockdown = { phase: 'fly', left: 0, out: this.health <= 0 };
    this.sounds.thud(this.character.feet, Math.min(1, speed / 15));
  }

  /** Healing over time, and the knockdown: flying, lying there, getting up. */
  private recover(dt: number): void {
    this.sinceHurt += dt;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (this.sinceHurt > HEAL_AFTER && !this.knockdown) this.health = Math.min(100, this.health + HEAL_RATE * dt);
    const k = this.knockdown;
    if (!k) return;
    k.left -= dt;
    if (k.phase === 'fly') {
      // Landed (or ended up on something else: in water, on a ride).
      if (this.mode !== 'foot' || this.mount || ((this.character.grounded || this.swimming) && this.character.motion.y <= 0)) {
        k.phase = 'down';
        k.left = k.out ? KNOCKED_OUT_SECONDS : DOWN_SECONDS;
        if (k.out) this.onKnockedOut(true);
      }
    } else if (k.phase === 'down' && k.left <= 0) {
      k.phase = 'up';
      k.left = GET_UP_SECONDS;
      if (k.out) {
        this.health = 30;
        this.onKnockedOut(false);
      }
    } else if (k.phase === 'up' && k.left <= 0) this.knockdown = null;
  }

  /**
   * Knocks over whatever the car is about to run into (people, animals, lamp posts, bins),
   * slowing the car by what each takes off it and denting it.
   */
  private runInto(dt: number): void {
    const body = this.car.physics.body;
    const rotation = body.rotation();
    const q = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    for (const hit of carHits(game.impacts, CAR_SHAPE, body.translation(), rotation, body.linvel(), dt)) {
      const v = body.linvel();
      const velocity = new THREE.Vector3(v.x, v.y, v.z);
      hit.target.hit(velocity.clone());
      // Like billiard balls: what's hit takes some of the car's speed toward it. Off
      // something that won't budge, the car bounces back.
      const toward = new THREE.Vector3(hit.dir.x, 0, hit.dir.z).applyQuaternion(q);
      const bounce = hit.target.solid ? 1.3 : 1;
      velocity.addScaledVector(toward, (-hit.speed * hit.target.mass * bounce) / (CAR.mass + hit.target.mass));
      body.setLinvel(velocity, true);
      this.car.hit(hit.dir, hit.target.harm * (hit.speed / 20) ** 2);
    }
  }

  /** Per-frame update after physics: interactions, models and camera. */
  update(input: Input, dt: number): void {
    this.time += dt;
    // Any move key gets you up from a seat (rides only let you off with E).
    const c = input.foot;
    const moving = c.forward || c.strafe || c.jump;
    if (this.mount && !this.mount.ride && moving) this.leave();
    if (this.mount?.done?.()) this.leave(true);
    if (this.mode === 'foot' && input.wasPressed('KeyG') && !this.mount && !this.task) this.dancing = !this.dancing;
    if (moving || this.mode !== 'foot' || this.mount || this.task) this.dancing = false;
    if (this.oneShot && (this.oneShot.left -= dt) <= 0) this.oneShot = null;
    this.recover(dt);
    this.interaction = this.findInteraction();
    if (input.wasPressed('KeyE')) this.interact();
    if (this.mount && !this.mount.ride && input.wasPressed('KeyR')) this.useRemote();
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
      const act = this.act;
      showAct(this.avatar, act, this.jetpack ? 'jetpack' : null, this.swimming && !this.mount, this.shownAct, this.time);
      this.shownAct = act;
      if (this.mount) {
        const m = this.mount;
        m.update?.();
        this.avatar.seated = m.pose === 'sit';
        this.avatar.animate(0, dt);
        if (m.pose === 'sit') this.avatar.placeSeated(m.position, m.yaw);
        else {
          this.avatar.root.position.copy(m.position);
          this.avatar.root.rotation.y = m.yaw;
        }
        this.orbit.update(this.avatar.root.position);
        return;
      }
      this.avatar.seated = false;
      const feet = this.character.feet;
      this.avatar.root.position.copy(feet);
      this.avatar.root.rotation.y = this.character.yaw;
      this.avatar.limp = this.hurt ? 1 : 0;
      this.avatar.animate(this.knockdown ? 0 : this.character.speed, dt, !this.character.grounded && !this.swimming && !this.knockdown);
      this.orbit.update(feet);
    }
  }

  /** What the character is doing, for its animation and for the other players. */
  get act(): Act | null {
    if (this.mode !== 'foot') return null;
    if (this.knockdown) return this.knockdown.phase === 'fly' ? 'tumble' : this.knockdown.phase === 'down' ? 'down' : 'getup';
    if (this.oneShot) return this.oneShot.act;
    if (this.task) return this.task.act;
    if (this.jetpack?.thrusting) return 'jet';
    if (this.dancing) return 'dance';
    if (this.chatting && !this.mount?.ride) return 'talk';
    return null;
  }

  /** Plays a quick move: pressing a button, picking something up, being knocked back. */
  playOnce(act: Act): void {
    if (this.mode !== 'foot' || this.mount?.ride) return;
    this.oneShot = { act, left: ONE_SHOT_SECONDS[act] ?? 1.2 };
  }

  /** Gets on a ride (or a seat that isn't furniture). */
  ride(mount: Mount): void {
    if (this.mode !== 'foot') return;
    this.stopTask();
    this.dancing = false;
    if (this.mount) this.leave(true);
    this.mount = mount;
    if (mount.ride) this.character.setEnabled(false);
  }

  /** Whether we're on `mount` right now. */
  riding(mount?: Mount): boolean {
    return mount ? this.mount === mount : !!this.mount?.ride;
  }

  /** Gets off whatever we're on (unless it won't let us, or `force`). */
  leave(force = false): void {
    const m = this.mount;
    if (!m) return;
    if (!force && m.blocked?.()) return;
    this.mount = null;
    this.avatar.seated = false;
    if (m.ride) {
      const exit = m.exit?.() ?? this.avatar.root.position.clone();
      this.character.setEnabled(true);
      this.character.teleport(exit, m.yaw);
      const push = m.release?.();
      if (push) this.character.launch(push);
    }
    m.left?.();
  }

  /** Starts something done standing still, facing `yaw` (fishing); `stop` is called when it ends. */
  startTask(act: Act, yaw: number, stop: () => void): void {
    this.dancing = false;
    this.task = { act, yaw, stop };
  }

  stopTask(): void {
    const task = this.task;
    this.task = null;
    task?.stop();
  }

  /** Throws the walking character through the air (m/s), e.g. from a trebuchet. */
  launch(v: THREE.Vector3Like): void {
    if (this.mode !== 'foot') return;
    if (this.mount) this.leave(true);
    this.stopTask();
    this.dancing = false;
    this.character.launch(v);
  }

  /** Teleports the walking character (feet at `p`). */
  placeAt(p: THREE.Vector3Like, yaw: number): void {
    if (this.mode !== 'foot') return;
    this.character.teleport(p, yaw);
  }

  /** Straps a jetpack on, or gives it back. */
  wearJetpack(on: boolean): void {
    this.jetpack = on ? { fuel: 1, thrusting: false } : null;
  }

  /** Where the tip of the fishing rod is, while fishing. */
  rodTip(out: THREE.Vector3): THREE.Vector3 | null {
    return this.mode === 'foot' ? rodTip(this.avatar, out) : null;
  }

  /** Whether the character is standing on something (not flying, falling or swimming). */
  get grounded(): boolean {
    return this.character.grounded;
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
    const extra: Partial<AvatarState> = {};
    const act = this.act;
    if (act) extra.act = act;
    if (this.jetpack) extra.gear = 'jetpack';
    if (this.swimming && !this.mount) extra.swim = true;
    if (this.hurt) extra.hurt = true;
    if (this.mount) {
      const p = this.avatar.root.position;
      const seated = this.mount.pose === 'sit' ? { seated: true } : {};
      return { p: [round(p.x), round(p.y), round(p.z)], yaw: round(this.mount.yaw), speed: 0, ...seated, ...extra };
    }
    const f = this.character.feet;
    return { p: [round(f.x), round(f.y), round(f.z)], yaw: round(this.character.yaw), speed: round(this.character.speed), ...extra };
  }

  /** Puts the player in their car at a race grid slot. */
  lineUp(position: THREE.Vector3, yaw: number): void {
    this.leave(true);
    this.stopTask();
    if (this.mode === 'foot') this.enterCar();
    this.car.teleport(position, yaw);
    this.chase.snap();
  }

  private findInteraction(): Interaction {
    if (this.frozen || this.knockdown) return null;
    if (this.mode === 'car') {
      return Math.abs(this.car.physics.speed) <= MAX_EXIT_SPEED ? { kind: 'exit-car' } : { kind: 'too-fast' };
    }
    if (this.mount?.ride) return { kind: 'leave', label: this.mount.label, blocked: this.mount.blocked?.() ?? null };
    if (this.mount) return { kind: 'stand' };
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
    for (const a of this.activities?.within(feet) ?? []) add(a.distance, a.activity.position, { kind: 'activity', activity: a.activity, prompt: a.prompt });
    options.sort((a, b) => a.score - b.score);
    return options[0]?.interaction ?? null;
  }

  /** The TV a seated player can reach with the remote, if any. */
  get remoteTv(): { id: string; on: boolean } | null {
    if (!this.mount || this.mount.ride || !this.appliances) return null;
    const tv = this.appliances.nearest(this.mount.position, TV_REMOTE_REACH, 'tv');
    return tv && { id: tv.appliance.id, on: this.appliances.isOn(tv.appliance.id) };
  }

  private sit(seat: Seat): void {
    this.ride({ position: seat.position, yaw: seat.yaw, pose: 'sit', label: seat.label });
    this.sounds.sit(seat.position);
  }

  private interact(): void {
    const i = this.interaction;
    if (i?.kind === 'exit-car') this.exitCar();
    else if (i?.kind === 'enter-car') this.enterCar();
    else if (i?.kind === 'door') this.requestDoor(i.houseId, !i.open);
    else if (i?.kind === 'sit') this.sit(i.seat);
    else if (i?.kind === 'stand' || i?.kind === 'leave') this.leave();
    else if (i?.kind === 'switch') {
      this.requestSwitch(i.id, !i.on);
      this.playOnce('interact');
    } else if (i?.kind === 'activity' && !i.prompt.waiting) i.activity.use();
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
    this.stopTask();
    this.dancing = false;
    this.oneShot = null;
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
