import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { APPLIANCE_REACH, type ApplianceKind, TV_REMOTE_REACH } from '../../../shared/appliances.ts';
import { type Act, type AvatarState, CAR_REACH, type CarPose, type CarSeat, type CarState, DOOR_REACH, MAX_EXIT_SPEED, type Quat, type StrikeKind, type Vec3 } from '../../../shared/protocol.ts';
import { DRIVER, passengerSeat, sameSeat, seatFor, seatPlace } from '../../../shared/seats.ts';
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
import { KICK_SECONDS } from '../player/humanModel.ts';
import { Car } from '../vehicles/car.ts';
import { CAR, type CarControls } from '../vehicles/carPhysics.ts';
import { Headlights } from '../vehicles/headlights.ts';
import type { Appliances } from '../world/appliances.ts';
import type { Doors } from '../world/doors.ts';
import { nearestSeat, type Seat } from '../world/seats.ts';
import type { World } from '../world/world.ts';
import { placeEffects } from '../world/zones/index.ts';
import type { Activities, Activity, Mount, Prompt } from './activities.ts';
import { carHits, type CarShape, STRIKE_LIFTS, strikeHit } from './impacts.ts';
import { game } from './link.ts';
import { groundUnder } from './limp.ts';
import { Seating } from './seating.ts';

/** How long to wait for the server's word on a seat before asking again (ms). */
const ASK_PATIENCE_MS = 1500;
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
/** Knocked down by a car: lying there once still (longer if knocked out). */
const DOWN_SECONDS = 2.2;
const KNOCKED_OUT_SECONDS = 5;
/** Health lost to a car hit at no speed, and per m/s more; how soon and fast it comes back. */
const HIT_HARM = 12;
const HARM_PER_MS = 2.6;
const HEAL_AFTER = 6;
const HEAL_RATE = 4;
/** Below this much health you limp. */
const LIMPING_BELOW = 60;
/** How long one-shot moves take to play. */
const ONE_SHOT_SECONDS: Partial<Record<Act, number>> = { interact: 1.4, pickup: 1.8, hit: 1.1, flinch: 0.45 };
/**
 * Punches (a jab, then a cross, taking turns) and kicks: when each lands (seconds in),
 * how long it's shown, and how soon the next can start.
 */
type StrikeAct = 'jab' | 'cross' | 'kick';
const STRIKE_MOVES: Record<StrikeAct, { lands: number; shows: number; next: number }> = {
  jab: { lands: 0.2, shows: 0.55, next: 0.38 },
  cross: { lands: 0.25, shows: 0.62, next: 0.42 },
  kick: { lands: 0.3, shows: KICK_SECONDS, next: 0.75 },
};
/** Health a punch and a kick from another player take off. */
const STRUCK_HARM: Record<StrikeKind, number> = { punch: 7, kick: 14 };

/** Driving (our car or a friend's), riding along in someone's car, or on foot. */
export type Mode = 'car' | 'passenger' | 'foot';

/**
 * What pressing E would do right now, for the on-screen prompt. In a car, it's getting out
 * (and C changing seats: moving over for a friend riding along, or taking the wheel).
 */
export type Interaction =
  | { kind: 'enter-car'; seat: CarSeat; owner: string | null; driver: string | null }
  | { kind: 'car-full'; owner: string | null }
  | { kind: 'exit-car'; moveOver: string | null }
  | { kind: 'too-fast' }
  | { kind: 'ride'; owner: string | null; driver: string | null; canExit: boolean; takeWheel: boolean }
  | { kind: 'door'; houseId: string; address: string; open: boolean }
  | { kind: 'sit'; seat: Seat }
  | { kind: 'stand' }
  | { kind: 'leave'; label: string; blocked: string | null }
  | { kind: 'switch'; id: string; appliance: ApplianceKind; on: boolean }
  | { kind: 'activity'; activity: Activity; prompt: Prompt }
  | null;

/** A car drawn from another player's game (see net/remotePlayers.ts). */
export interface DrawnCar {
  object: THREE.Object3D;
  body: RAPIER.RigidBody;
  speed: number;
}

/** What the player needs to know of every car in the room; set by main. */
export interface CarDirectory {
  /** Every car, by its owner's id (ours included). */
  ids(): string[];
  /** Whose it is, and its paint. */
  owner(id: string): { name: string; color: string } | null;
  /** The car as drawn from another player's game, while that's what moves it. */
  puppet(id: string): DrawnCar | null;
  /** Our game moves car `id` now (`away`: stop drawing it from theirs), or theirs does, carrying on from `from`. */
  setAway(id: string, away: boolean, from?: THREE.Object3D): void;
}

/**
 * The player's character and the car they're in, and switching between them. Anyone can
 * get in anyone's car: to drive it if nobody is, else to ride along. The server says who
 * sits where; a car is moved by its driver's game, or its owner's while nobody's driving.
 */
export class LocalPlayer {
  mode: Mode = 'car';
  /** Held in place (e.g. on a race grid before the start): brakes on, can't get out. */
  frozen = false;
  /** Our own car. */
  readonly car: Car;
  /** A friend's car we're driving: our game moves it while we do. */
  private borrowed: { id: string; car: Car } | null = null;
  /** Whether our game moves our own car: unless someone else is driving it. */
  private ownHere = true;
  /** Where we sit (null on foot): our own wheel to begin with. */
  seat: CarSeat | null;
  /** Who sits where in every car, and every car there is; set by main. */
  seating = new Seating();
  cars: CarDirectory = { ids: () => [], owner: () => null, puppet: () => null, setAway: () => {} };
  /** Asks the server for a seat, or to get out (null); set by main. */
  requestSeat: (seat: CarSeat | null) => void = () => {};
  /** When we last asked for a seat (ms): one at a time. */
  private askedAt = -Infinity;
  /** Called when the car we're driving is wrecked: ours (`owner` null), or a friend's. */
  onWrecked: (car: Car, owner: string | null) => void = () => {};
  private headlights: Headlights;
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
  /** Dancing (G, see keys.ts): until you move. */
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
  /** A punch or kick under way: which, how far in (s), and whether it has landed yet. */
  private striking: { act: StrikeAct; t: number; landed: boolean } | null = null;
  /** Punches take turns: a jab with the left, then a cross with the right. */
  private nextPunch: 'jab' | 'cross' = 'jab';
  private shownAct: Act | null = null;
  private time = 0;
  /** 0..100: a car knocks some off, and it slowly comes back. */
  health = 100;
  private sinceHurt = Infinity;
  /** The red flash of being hit, fading (0..1). */
  flash = 0;
  /** Knocked over by a car: flying limp, lying there, getting up; seconds left of lying there. */
  private knockdown: { phase: 'fly' | 'down' | 'up'; left: number; out: boolean } | null = null;
  /** Where we were hit, to get up at if there's no room where we fell. */
  private knockedFrom = new THREE.Vector3();
  /** Called when knocked out cold, and when coming round. */
  onKnockedOut: (out: boolean) => void = () => {};

  constructor(
    private world: World,
    private doors: Doors,
    private sounds: Sounds,
    private id: string,
    color: string,
    spawn: { position: THREE.Vector3; yaw: number },
    private listener: THREE.AudioListener,
  ) {
    this.car = new Car(world.physics, color, spawn, listener);
    this.car.onImpact = (strength) => sounds.crash(this.car.object.position, strength);
    this.car.onWrecked = () => this.onWrecked(this.car, null);
    world.scene.add(this.car.object);
    this.seat = { car: id, n: DRIVER };
    this.headlights = new Headlights(world.scene);
    this.headlights.fit(this.car);

    this.character = new CharacterPhysics(world.physics, HIDDEN_FEET);
    this.character.setEnabled(false);
    this.avatar = new AvatarModel(color, id);
    this.avatar.root.visible = false;
    world.scene.add(this.avatar.root);

    this.chase = new ChaseCamera(world.camera, (from, to) => this.castRay(from, to, this.inside?.body ?? this.car.bodyHandle));
    this.orbit = new OrbitCamera(world.camera, (from, to) => this.castRay(from, to, this.character.body));
  }

  /** Fixed-step physics update; call before `world.stepPhysics()`. */
  fixedStep(input: Input, dt: number): void {
    const controls = this.mode === 'car' && !this.frozen ? input.car : PARKED;
    if (this.mode === 'car') this.runInto(dt);
    // Our own car waits where it's parked while we're out of it (or in a friend's).
    if (this.ownHere) this.car.step(this.borrowed ? PARKED : controls, dt, placeOf(this.car));
    if (this.borrowed) this.borrowed.car.step(controls, dt, placeOf(this.borrowed.car));
    if (this.mode !== 'foot') return;
    // On a ride the body is out of the physics world; on a seat it waits where it stood.
    if (this.mount?.ride) return;
    const feet = this.character.feet;
    const place = placeEffects(feet.x, feet.y + 1.2, feet.z);
    this.swimming = place.underwater;
    const c = input.foot;
    if (this.task && (c.forward || c.strafe || c.jump)) this.stopTask();
    // Limp, the body is all physics; the walking capsule waits until we're up.
    if (this.knockdown && this.knockdown.phase !== 'up') return;
    if (this.mount || this.task || this.knockdown || this.rooted) {
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

  /** Planted mid punch or kick, until the next one could start. */
  private get rooted(): boolean {
    return this.striking !== null && this.striking.t < STRIKE_MOVES[this.striking.act].next;
  }

  /** Limping after being hit by a car, until health comes back. */
  get hurt(): boolean {
    return this.health < LIMPING_BELOW;
  }

  /**
   * Hit by a car (or kicked): thrown at `v` (m/s) and hurt by how hard (or by `harm`); down
   * for a moment, then up.
   */
  knockedBy(v: THREE.Vector3Like, harm?: number): void {
    // Already flying or lying there: one knock at a time.
    if (this.mode !== 'foot' || this.knockdown) return;
    if (this.mount) this.leave(true);
    this.stopTask();
    this.dancing = false;
    this.oneShot = null;
    this.striking = null;
    this.knockedFrom.copy(this.character.feet);
    this.avatar.fling(this.world.physics, v);
    this.character.setEnabled(false);
    const speed = Math.hypot(v.x, v.y, v.z);
    this.health = Math.max(0, this.health - (harm ?? HIT_HARM + speed * HARM_PER_MS));
    this.sinceHurt = 0;
    this.flash = 1;
    this.knockdown = { phase: 'fly', left: 0, out: this.health <= 0 };
    this.sounds.thud(this.knockedFrom, Math.min(1, speed / 15));
  }

  /**
   * Punched or kicked by another player, pushed at `v` (m/s). A kick knocks you down; a
   * punch makes you reel, unless it's one too many. Returns whether it reached you (not
   * in a car, say).
   */
  struck(kind: StrikeKind, v: THREE.Vector3Like): boolean {
    if (this.mode !== 'foot' || this.knockdown) return false;
    if (kind === 'kick' || this.health <= STRUCK_HARM.punch) {
      this.knockedBy(kind === 'kick' ? v : { x: v.x, y: 1.5, z: v.z }, STRUCK_HARM[kind]);
      return true;
    }
    this.health -= STRUCK_HARM.punch;
    this.sinceHurt = 0;
    this.flash = Math.max(this.flash, 0.6);
    this.striking = null;
    this.stopTask();
    this.dancing = false;
    this.playOnce('flinch');
    return true;
  }

  /** Healing over time, and the knockdown: flying, lying there, getting up. */
  private recover(dt: number): void {
    this.sinceHurt += dt;
    this.flash = Math.max(0, this.flash - dt * 1.5);
    if (this.sinceHurt > HEAL_AFTER && !this.knockdown) this.health = Math.min(100, this.health + HEAL_RATE * dt);
    const k = this.knockdown;
    if (!k) return;
    k.left -= dt;
    if (k.phase !== 'up') {
      const hard = this.avatar.takeImpact();
      if (hard > 0.2) this.sounds.thud(this.avatar.hips(), hard * 0.6);
    }
    if (k.phase === 'fly') {
      // Come to rest in a heap.
      if (this.avatar.resting) {
        k.phase = 'down';
        k.left = k.out ? KNOCKED_OUT_SECONDS : DOWN_SECONDS;
        if (k.out) this.onKnockedOut(true);
      }
    } else if (k.phase === 'down' && k.left <= 0) {
      k.phase = 'up';
      if (k.out) {
        this.health = 30;
        this.onKnockedOut(false);
      }
      this.standUp();
    } else if (k.phase === 'up' && !this.avatar.rising) this.knockdown = null;
  }

  /** Gets up where the body lies (or where we were hit, if there's no room there). */
  private standUp(): void {
    const hips = this.avatar.hips();
    const fallback = this.knockedFrom;
    const { position, yaw } = this.avatar.getUp(groundUnder(this.world.physics, hips, () => fallback.y));
    this.character.setEnabled(true);
    const spot = this.character.fits(position) ? position : fallback;
    this.character.teleport(spot, yaw);
    if (spot !== position) this.avatar.root.position.copy(spot);
  }

  /** Back on our feet at once, however we lay (put in our car for a race, say). */
  private endKnockdown(): void {
    if (!this.knockdown) return;
    this.avatar.unfling();
    this.knockdown = null;
  }

  /**
   * Knocks over whatever the car is about to run into (people, animals, lamp posts, bins),
   * slowing the car by what each takes off it and denting it.
   */
  private runInto(dt: number): void {
    const car = this.vehicle;
    const body = car.physics.body;
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
      car.hit(hit.dir, hit.target.harm * (hit.speed / 20) ** 2);
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
    if (this.mode === 'foot' && input.pressed('dance') && !this.mount && !this.task) this.dancing = !this.dancing;
    if (moving || this.mode !== 'foot' || this.mount || this.task) this.dancing = false;
    if (this.oneShot && (this.oneShot.left -= dt) <= 0) this.oneShot = null;
    this.recover(dt);
    if (this.mode === 'foot') {
      if (input.pressed('punch')) this.strike('punch');
      if (input.pressed('kick')) this.strike('kick');
    }
    this.followThrough(dt);
    // Once it's landed, walking off cuts the rest of it short.
    const s = this.striking;
    if (s && moving && !this.rooted) {
      this.striking = null;
      if (this.oneShot?.act === s.act) this.oneShot = null;
    }
    this.interaction = this.findInteraction();
    if (input.pressed(this.mode === 'foot' ? 'use' : 'getOut')) this.interact();
    if (this.mode !== 'foot' && input.pressed('changeSeat')) this.changeSeat();
    if (this.mount && !this.mount.ride && input.pressed('remote')) this.useRemote();
    if (this.mode === 'car' && !this.frozen) {
      if (input.pressed('flip')) this.vehicle.reset();
      if (input.pressed('newCar')) this.vehicle.replace();
    }

    if (this.ownHere) this.car.update(dt);
    this.borrowed?.car.update(dt);
    const inside = this.inside;
    if (this.mode === 'car') {
      input.takeLook(dt); // discard mouse movement while driving
      this.chase.update(this.vehicle.object, this.vehicle.physics.speed, dt);
    } else if (this.mode === 'passenger') {
      // Riding along, look about with the mouse.
      const look = input.takeLook(dt);
      this.chase.look(look.yaw, look.pitch);
      if (inside) this.chase.update(inside.object, inside.speed, dt);
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
      this.avatar.limp = this.hurt ? 1 : 0;
      if (this.avatar.down) {
        // Limp: the body goes where physics throws it, and the camera follows.
        this.avatar.animate(0, dt);
        this.orbit.update(this.avatar.hips());
        return;
      }
      const feet = this.character.feet;
      this.avatar.root.position.copy(feet);
      this.avatar.root.rotation.y = this.character.yaw;
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

  /** Throws a punch or a kick, turning to face where the camera looks. */
  private strike(kind: StrikeKind): void {
    const s = this.striking;
    if (s && s.t < STRIKE_MOVES[s.act].next) return;
    if (this.mount || this.task || this.knockdown || this.swimming || this.jetpack?.thrusting) return;
    if (kind === 'kick' && !this.character.grounded) return;
    const act: StrikeAct = kind === 'kick' ? 'kick' : this.nextPunch;
    if (kind === 'punch') this.nextPunch = this.nextPunch === 'jab' ? 'cross' : 'jab';
    this.dancing = false;
    const { forward } = this.orbit.basis;
    this.character.yaw = Math.atan2(forward.x, forward.z);
    this.striking = { act, t: 0, landed: false };
    this.oneShot = { act, left: STRIKE_MOVES[act].shows };
    this.sounds.swing(this.character.feet.clone().setY(this.character.feet.y + 1.2), kind === 'kick');
  }

  /** A punch or kick under way: lands partway through, on whatever is right in front. */
  private followThrough(dt: number): void {
    const s = this.striking;
    if (!s) return;
    if (this.mode !== 'foot' || this.mount || this.knockdown) {
      this.striking = null;
      return;
    }
    s.t += dt;
    if (!s.landed && s.t >= STRIKE_MOVES[s.act].lands) {
      s.landed = true;
      this.land(s.act === 'kick' ? 'kick' : 'punch');
    }
    if (s.t >= STRIKE_MOVES[s.act].shows) this.striking = null;
  }

  /** What the punch or kick hits, if anything: people and players react; light things get knocked flying. */
  private land(kind: StrikeKind): void {
    const feet = this.character.feet;
    const yaw = this.character.yaw;
    const target = strikeHit(game.impacts, kind, feet, yaw);
    if (!target) return;
    const at = target.at(new THREE.Vector3())!;
    at.y = feet.y + (kind === 'kick' ? 0.8 : 1.4);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (target.struck) {
      target.struck(kind, dir);
      this.sounds.smack(at, kind === 'kick');
      return;
    }
    // Things that don't mind being hit: knocked flying if they're light enough (a bin), otherwise just a knock.
    const lift = STRIKE_LIFTS[kind];
    if (!target.solid && target.mass <= lift.mass) target.hit(dir.multiplyScalar(lift.speed));
    else this.sounds.smack(at, kind === 'kick', true);
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

  /** Where the player is (and the camera's attention, for the sun's shadow area): the car they're in, or on foot. */
  get focus(): THREE.Vector3 {
    if (this.mode === 'foot') return this.avatar.root.position;
    return (this.inside?.object ?? this.car.object).position;
  }

  /** Which way the player faces (yaw, 0 = +Z): the car they're in, or the character on foot. */
  get facing(): number {
    if (this.mode === 'foot') return this.character.yaw;
    return yawOf((this.inside?.object ?? this.car.object).quaternion);
  }

  get avatarState(): AvatarState | null {
    if (this.mode !== 'foot') return null;
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
    // Limp, we're wherever the body lies.
    const f = this.avatar.down ? this.avatar.root.position : this.character.feet;
    return { p: [round(f.x), round(f.y), round(f.z)], yaw: round(this.character.yaw), speed: round(this.character.speed), ...extra };
  }

  /**
   * Puts the player's car on a race grid slot. The server has put everyone back at their
   * own wheel first (see server/src/rooms.ts).
   */
  lineUp(position: THREE.Vector3, yaw: number): void {
    this.leave(true);
    this.stopTask();
    if (this.mode !== 'car' || this.borrowed) return;
    this.car.teleport(position, yaw);
    this.chase.snap();
  }

  /** The car we're driving: ours, or a friend's. */
  get vehicle(): Car {
    return this.borrowed?.car ?? this.car;
  }

  /** Where car `id` is drawn by our game, while ours moves it (our own, or a friend's we're driving). */
  carObject(id: string): THREE.Object3D | null {
    if (this.borrowed?.id === id) return this.borrowed.car.object;
    return id === this.id && this.ownHere ? this.car.object : null;
  }

  /** The car we're sitting in, as drawn here. */
  private get inside(): DrawnCar | null {
    const car = this.seat?.car;
    if (!car) return null;
    const ours = this.borrowed?.id === car ? this.borrowed.car : car === this.id && this.ownHere ? this.car : null;
    return ours ? { object: ours.object, body: ours.bodyHandle, speed: ours.physics.speed } : this.cars.puppet(car);
  }

  /** Our own car for the server, while our game moves it (not while a friend drives it). */
  get ownReport(): { p: Vec3; q: Quat; car: CarState } | null {
    return this.ownHere ? { ...this.car.transform, car: this.car.state } : null;
  }

  /** The friend's car we're driving, for the server. */
  get driveReport(): CarPose | null {
    const b = this.borrowed;
    return b && { id: b.id, ...b.car.transform, car: b.car.state };
  }

  /** Tail lights glow after dark, and the headlights light the road. */
  setNight(night: number): void {
    this.car.setNight(night);
    this.borrowed?.car.setNight(night);
    this.headlights.update(night);
  }

  /**
   * Someone (`who`, maybe us) got in a car, changed seats or got out, says the server (the
   * seating's already changed): `cars` are where the cars that changed hands are. Our game
   * takes over moving a car we're now driving, or our own car back; and lets go of ours if
   * someone else is driving it.
   */
  seatsChanged(who: string, cars: CarPose[] = []): void {
    if (who === this.id) this.askedAt = -Infinity;
    const pose = (id: string) => cars.find((c) => c.id === id);
    const driver = this.seating.driverOf(this.id);
    const here = driver === null || driver === this.id;
    if (here !== this.ownHere) {
      this.ownHere = here;
      if (here) {
        // Back from a friend: from where they left it.
        const p = pose(this.id);
        const drawn = this.cars.puppet(this.id)?.object;
        this.car.setActive(true);
        if (p) this.car.place(p.p, p.q, p.car.dmg);
        else if (drawn) this.car.place(drawn.position.toArray() as Vec3, drawn.quaternion.toArray() as Quat, this.car.damage.state);
        this.cars.setAway(this.id, true);
      } else {
        this.cars.setAway(this.id, false, this.car.object);
        this.car.setActive(false);
      }
    }
    const seat = this.seating.of(this.id);
    if (!sameSeat(seat, this.seat)) this.sitIn(seat, pose(seat?.car ?? ''));
    this.fitHeadlights();
  }

  /** Moves us to `seat` (null: out on foot), as the server says, from wherever we were. */
  private sitIn(seat: CarSeat | null, pose: CarPose | undefined): void {
    const was = this.seat;
    if (!seat) {
      this.putOut();
      return;
    }
    // Off the wheel of a friend's car (moving over): its owner's game moves it again.
    if (this.borrowed && !(seat.n === DRIVER && seat.car === this.borrowed.id)) this.giveBack();
    if (!was) this.climbIn();
    this.seat = seat;
    this.mode = seat.n === DRIVER ? 'car' : 'passenger';
    if (seat.n === DRIVER && seat.car !== this.id) this.borrow(seat.car, pose);
    this.car.engineOn = this.mode === 'car' && !this.borrowed;
    if (this.mode === 'car') this.chase.straighten();
    if (was?.car !== seat.car) this.chase.snap();
    const inside = this.inside;
    if (inside) this.sounds.carDoor(inside.object.position);
  }

  /** From our feet into a car: the character's put away. */
  private climbIn(): void {
    this.leave(true);
    this.endKnockdown();
    this.stopTask();
    this.dancing = false;
    this.oneShot = null;
    this.striking = null;
    this.character.teleport(HIDDEN_FEET);
    this.character.setEnabled(false);
    this.avatar.root.visible = false;
  }

  /** At the wheel of a friend's car: our game moves it now, from where theirs left it. */
  private borrow(id: string, pose: CarPose | undefined): void {
    const owner = this.cars.owner(id);
    const drawn = this.cars.puppet(id)?.object;
    const p = pose?.p ?? (drawn?.position.toArray() as Vec3 | undefined) ?? this.car.transform.p;
    const q = pose?.q ?? (drawn?.quaternion.toArray() as Quat | undefined) ?? [0, 0, 0, 1];
    const car = new Car(this.world.physics, owner?.color ?? '#888888', { position: new THREE.Vector3(...p), yaw: yawOf(new THREE.Quaternion(...q)) }, this.listener);
    car.place(p, q, pose?.car.dmg);
    car.onImpact = (strength) => this.sounds.crash(car.object.position, strength);
    car.onWrecked = () => this.onWrecked(car, owner?.name ?? 'Someone');
    this.world.scene.add(car.object);
    this.cars.setAway(id, true);
    this.borrowed = { id, car };
  }

  /** Off the wheel of a friend's car: their game moves it again, carrying on from where we left it. */
  private giveBack(): void {
    const b = this.borrowed;
    if (!b) return;
    this.borrowed = null;
    this.fitHeadlights();
    this.cars.setAway(b.id, false, b.car.object);
    b.car.dispose();
  }

  /** The headlights go on the car we drive (or ours, parked, while we're about). */
  private fitHeadlights(): void {
    this.headlights.fit(this.borrowed?.car ?? (this.ownHere ? this.car : null));
  }

  /** Asks the server for a seat; one request at a time. */
  private askFor(seat: CarSeat): void {
    const now = performance.now();
    if (now - this.askedAt < ASK_PATIENCE_MS) return;
    this.askedAt = now;
    this.requestSeat(seat);
  }

  /** C (see keys.ts): move over for a friend riding with us, or take the wheel from the passenger seat. */
  private changeSeat(): void {
    const i = this.interaction;
    const car = this.seat?.car;
    if (!car) return;
    if (i?.kind === 'exit-car' && i.moveOver) {
      const n = passengerSeat(this.seating.taken(car));
      if (n !== null) this.askFor({ car, n });
    } else if (i?.kind === 'ride' && i.takeWheel) this.askFor({ car, n: DRIVER });
  }

  /** A player's name, or 'Someone' if we don't know them. */
  private nameOf(id: string): string {
    return this.cars.owner(id)?.name ?? 'Someone';
  }

  private findInteraction(): Interaction {
    if (this.frozen || this.knockdown) return null;
    const sitting = this.seat;
    if (sitting && this.mode !== 'foot') {
      const inside = this.inside;
      const slow = !inside || Math.abs(inside.speed) <= MAX_EXIT_SPEED;
      if (this.mode === 'car') {
        if (!slow) return { kind: 'too-fast' };
        // Someone riding with us can have the wheel, while we take their seat or another.
        const rider = this.seating.riders(sitting.car).find((r) => r.n !== DRIVER);
        const room = passengerSeat(this.seating.taken(sitting.car)) !== null;
        return { kind: 'exit-car', moveOver: rider && room ? this.nameOf(rider.id) : null };
      }
      const driver = this.seating.driverOf(sitting.car);
      return {
        kind: 'ride',
        owner: sitting.car === this.id ? null : this.nameOf(sitting.car),
        driver: driver && this.nameOf(driver),
        canExit: slow,
        takeWheel: slow && driver === null,
      };
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
    // Any car: the wheel if nobody has it, else a seat beside whoever does.
    for (const id of this.cars.ids()) {
      const object = this.carObject(id) ?? this.cars.puppet(id)?.object;
      const distance = object ? feet.distanceTo(object.position) : Infinity;
      if (!object || distance > CAR_REACH) continue;
      const owner = id === this.id ? null : this.nameOf(id);
      const n = seatFor(this.seating.taken(id));
      const driver = this.seating.driverOf(id);
      add(distance, object.position, n === null ? { kind: 'car-full', owner } : { kind: 'enter-car', seat: { car: id, n }, owner, driver: driver && this.nameOf(driver) });
    }
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
    if (i?.kind === 'exit-car' || (i?.kind === 'ride' && i.canExit)) this.exitCar();
    else if (i?.kind === 'enter-car') this.askFor(i.seat);
    else if (i?.kind === 'door') this.requestDoor(i.houseId, !i.open);
    else if (i?.kind === 'sit') this.sit(i.seat);
    else if (i?.kind === 'stand' || i?.kind === 'leave') this.leave();
    else if (i?.kind === 'switch') {
      this.requestSwitch(i.id, !i.on);
      this.playOnce('interact');
    } else if (i?.kind === 'activity' && !i.prompt.waiting) i.activity.use();
  }

  /** R (see keys.ts) while seated: the TV remote. */
  private useRemote(): void {
    const tv = this.remoteTv;
    if (tv) this.requestSwitch(tv.id, !tv.on);
  }

  /** Gets out (it's never refused: the server's told after the car's last whereabouts). */
  private exitCar(): void {
    const inside = this.inside;
    const spot = inside && this.findExitSpot(inside, this.seat?.n ?? DRIVER);
    if (!inside || !spot) return; // boxed in: stay in the car
    this.requestSeat(null);
    this.seating.set(this.id, null);
    this.stepOut(spot, inside);
  }

  /** Put out by the server (the car's owner left, say): beside it, or on top if there's no room. */
  private putOut(): void {
    const inside = this.inside;
    const spot = inside ? (this.findExitSpot(inside, this.seat?.n ?? DRIVER) ?? inside.object.position.clone().setY(inside.object.position.y + 1.6)) : this.focus.clone();
    this.stepOut(spot, inside);
  }

  /** Out of the car onto our feet at `spot`, facing the way the car does. */
  private stepOut(spot: THREE.Vector3, inside: DrawnCar | null): void {
    const yaw = inside ? yawOf(inside.object.quaternion) : this.facing;
    const door = inside?.object.position.clone();
    this.giveBack();
    this.seat = null;
    this.mode = 'foot';
    this.car.engineOn = false;
    this.character.setEnabled(true);
    this.character.teleport(spot, yaw);
    this.avatar.root.visible = true;
    this.orbit.yaw = yaw;
    this.orbit.pitch = 0.25;
    if (door) this.sounds.carDoor(door);
    this.fitHeadlights();
  }

  /** Beside our seat's door if there's room, else the other side, behind, or in front. */
  private findExitSpot(inside: DrawnCar, seat: number): THREE.Vector3 | null {
    const car = inside.object;
    const out = CAR.halfExtents.x + 0.55;
    const end = CAR.halfExtents.z + 0.6;
    // The driver sits on the left, which is the car's local +X (it faces +Z).
    const { side, z: along } = seatPlace(seat);
    const candidates = [
      [side * out, along],
      [-side * out, along],
      [0, -end],
      [0, end],
    ];
    this.character.setEnabled(true);
    try {
      for (const [x, z] of candidates) {
        const p = new THREE.Vector3(x, 0, z).applyQuaternion(car.quaternion).add(car.position);
        const ground = this.groundBelow(p, inside.body);
        if (ground === null) continue;
        p.y = ground;
        if (this.character.fits(p)) return p;
      }
      return null;
    } finally {
      this.character.setEnabled(this.mode === 'foot');
    }
  }

  /** Height of the first surface below `p` (ignoring the car, `car`), or null if none nearby. */
  private groundBelow(p: THREE.Vector3, car: RAPIER.RigidBody): number | null {
    const from = p.clone().setY(p.y + 1.5);
    const ray = new RAPIER.Ray(from, { x: 0, y: -1, z: 0 });
    const hit = this.world.physics.castRay(ray, 4, true, undefined, undefined, this.character.collider, car);
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

/** What the place a car is in does to it (low gravity, ice...). */
function placeOf(car: Car) {
  const at = car.physics.body.translation();
  return placeEffects(at.x, at.y, at.z);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
