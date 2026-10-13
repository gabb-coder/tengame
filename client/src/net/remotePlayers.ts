import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Label } from '../render/labels.ts';
import type { Act, AvatarState, CarState, PlayerInfo, PlayerTransform } from '../../../shared/protocol.ts';
import type { Seating } from '../game/seating.ts';
import { CAR_SHAPE_GROUPS, REMOTE_CAR_GROUPS, WALKER_GROUPS } from '../game/groups.ts';
import { groundUnder } from '../game/limp.ts';
import { game } from '../game/link.ts';
import { strikePush, type Target } from '../game/impacts.ts';
import { showAct } from '../player/acts.ts';
import { AvatarModel } from '../player/avatarModel.ts';
import { AVATAR, CAPSULE_CENTER } from '../player/character.ts';
import { flingFrom } from '../player/ragdoll.ts';
import { CAR, carShapes } from '../vehicles/carPhysics.ts';
import { CarModel } from '../vehicles/carModel.ts';
import { EngineSound } from '../vehicles/engineSound.ts';

// Render remote players this far in the past so there are two snapshots to blend between.
const INTERPOLATION_DELAY_MS = 100;
const MAX_BUFFERED = 30;
// Suspension isn't synced; draw wheels at the length the car rests at on flat ground.
const SETTLED_SUSPENSION = CAR.suspensionRest * 0.65;
/** Where colliders wait while their player isn't there. */
const PARKED_FAR = { x: 0, y: -200, z: 0 };
/** A jump further than this between frames is a teleport, not movement to push things with. */
const TELEPORT_DISTANCE = 8;

/**
 * Camera rays (collision groups: memberships << 16 | filter, see game/groups.ts) pass
 * through other players, so the camera doesn't jump in whenever a car drives between it and you.
 */
export const CAMERA_RAY_GROUPS = (0x0001 << 16) | 0x0001;

interface CarSample {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  car: CarState;
}

interface AvatarSample {
  t: number;
  avatar: AvatarState | null;
}

/**
 * The two samples either side of `time` (dropping those long past, but keeping one before
 * it), and how far `time` is from the first to the second.
 */
function between<T extends { t: number }>(samples: T[], time: number): { a: T; b: T; k: number } | null {
  while (samples.length >= 2 && samples[1].t <= time) samples.shift();
  const [a, b] = samples;
  if (!a) return null;
  return { a, b: b ?? a, k: !b || time <= a.t ? 0 : (time - a.t) / (b.t - a.t) };
}

/**
 * A car moved by another player's game (its owner's, or a friend's who's driving it):
 * drawn and voiced from the snapshots, smoothed, with a solid stand-in in our physics
 * world. Put away while our own game moves it instead (we're driving it, or it's ours
 * and nobody else is).
 */
class PuppetCar {
  readonly model: CarModel;
  private engine: EngineSound;
  private audio: THREE.PositionalAudio;
  /** A stand-in in our physics world, moved to where the car is drawn, so we bump into it. */
  readonly body: RAPIER.RigidBody;
  private samples: CarSample[] = [];
  private wheelSpin = 0;
  private away = false;
  /** Forward speed as drawn (m/s). */
  speed = 0;

  constructor(
    scene: THREE.Scene,
    private physics: RAPIER.World,
    listener: THREE.AudioListener,
    color: string,
    body: RAPIER.RigidBody,
  ) {
    this.model = new CarModel(color);
    this.model.root.visible = false; // until the first snapshot places it
    this.engine = new EngineSound(listener.context);
    this.audio = new THREE.PositionalAudio(listener);
    this.audio.setRefDistance(6);
    this.audio.setRolloffFactor(1.6);
    this.audio.setNodeSource(this.engine.output);
    this.model.root.add(this.audio);
    scene.add(this.model.root);
    this.body = body;
  }

  /** Drawn here: someone else's game moves it, and we know where it is. */
  get drawn(): boolean {
    return this.model.root.visible;
  }

  push(t: number, p: THREE.Vector3, q: THREE.Quaternion, car: CarState): void {
    this.samples.push({ t, p, q, car });
    if (this.samples.length > MAX_BUFFERED) this.samples.shift();
  }

  /**
   * Puts the car away (our game moves it now), or brings it back (someone else's does),
   * carrying on from `from` (where our game left it) if given.
   */
  setAway(away: boolean, from?: THREE.Object3D): void {
    if (away === this.away) return;
    this.away = away;
    if (away) {
      this.model.root.visible = false;
      moveBody(this.body, PARKED_FAR);
      this.engine.update(0, 0, 0);
      return;
    }
    if (from) {
      const last = this.samples.at(-1);
      this.samples = [{ t: performance.now(), p: from.position.clone(), q: from.quaternion.clone(), car: last?.car ?? STILL_CAR }];
      this.model.root.position.copy(from.position);
      this.model.root.quaternion.copy(from.quaternion);
      this.model.root.visible = true;
      this.body.setTranslation(from.position, true);
      this.body.setRotation(from.quaternion, true);
    }
  }

  update(renderTime: number, dt: number): void {
    const at = this.away ? null : between(this.samples, renderTime);
    if (!at) return;
    const { a, b, k } = at;
    const { model } = this;
    model.root.visible = true;
    model.root.position.lerpVectors(a.p, b.p, k);
    model.root.quaternion.slerpQuaternions(a.q, b.q, k);
    moveBody(this.body, model.root.position, model.root.quaternion);

    const lerp = (key: 'steer' | 'rpm' | 'load' | 'speed') => a.car[key] + (b.car[key] - a.car[key]) * k;
    this.speed = lerp('speed');
    this.wheelSpin += (this.speed / CAR.wheelRadius) * dt;
    for (let i = 0; i < 4; i++) model.setWheel(i, i < 2 ? lerp('steer') : 0, this.wheelSpin, SETTLED_SUSPENSION);
    model.setBraking(b.car.braking);
    model.setDamage(b.car.dmg);
    model.smoke(dt);
    const rpm = lerp('rpm');
    this.engine.update(rpm, lerp('load'), rpm > 0 ? 1 : 0);
  }

  dispose(scene: THREE.Scene): void {
    // Detach the positional audio before stopping its source; the reverse order throws.
    this.audio.disconnect();
    this.engine.dispose();
    this.model.dispose();
    scene.remove(this.model.root);
    this.physics.removeRigidBody(this.body);
  }
}

const STILL_CAR: CarState = { steer: 0, rpm: 0, load: 0, speed: 0, braking: false };

interface Remote {
  info: PlayerInfo;
  avatar: AvatarModel;
  nameTag: Label;
  samples: AvatarSample[];
  /** The act last shown, so one-shot moves play once. */
  act: Act | null;
  /** A stand-in in our physics world, moved to where the player is drawn, so we bump into them. */
  avatarBody: RAPIER.RigidBody;
  /** Something our car can knock flying, while they're walking. */
  target: Target;
  /** When we last sent their body flying (ms), before their own game says so too. */
  flungAt: number;
}

/** After knocking someone over, they can't be hit again for this long (ms): they're flying. */
const KNOCK_AGAIN_MS = 2500;
/** What someone knocked over is doing until they're back on their feet. */
const KNOCKED_DOWN = new Set<Act | null>(['tumble', 'down', 'getup']);
/** How long a body we knocked flying stays limp waiting for their game to agree (ms). */
const AGREE_MS = 2000;

/**
 * Draws and voices other players' characters, and every car moved by another player's
 * game (ours too, while a friend drives it), smoothing between server snapshots, and gives
 * them solid bodies in our physics world.
 */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();
  /** Every player's car, by their id (ours included), as drawn from the snapshots. */
  private cars = new Map<string, PuppetCar>();
  /**
   * Whether walking players are solid to us. Not while we drive: the car hits them and
   * they fly (see game/impacts.ts), rather than stopping dead as if at a post.
   */
  walkersSolid = true;
  /** Where our own game draws car `id`, while it moves it (ours, or a friend's we drive); set by main. */
  localCar: (id: string) => THREE.Object3D | null = () => null;

  constructor(
    private scene: THREE.Scene,
    private physics: RAPIER.World,
    private localId: string,
    private listener: THREE.AudioListener,
    private seating: Seating,
  ) {}

  /** A car drawn from the snapshots, for player `info` (ours is put away until a friend drives it). */
  private addCar(info: PlayerInfo): void {
    if (this.cars.has(info.id)) return;
    const body = this.kinematicBody(RAPIER.ColliderDesc.cuboid(CAR.halfExtents.x, CAR.halfExtents.y, CAR.halfExtents.z).setCollisionGroups(REMOTE_CAR_GROUPS));
    for (const shape of carShapes()) this.physics.createCollider(shape.setCollisionGroups(CAR_SHAPE_GROUPS), body);
    const car = new PuppetCar(this.scene, this.physics, this.listener, info.color, body);
    this.cars.set(info.id, car);
    if (info.id === this.localId) car.setAway(true);
  }

  add(info: PlayerInfo): void {
    this.addCar(info);
    if (info.id === this.localId || this.remotes.has(info.id)) return;
    const nameTag = createNameTag(info.name);
    const avatar = new AvatarModel(info.color, info.id);
    avatar.root.visible = false;
    avatar.root.add(nameTag);
    this.scene.add(avatar.root);

    const avatarBody = this.kinematicBody(RAPIER.ColliderDesc.capsule(AVATAR.halfHeight, AVATAR.radius).setCollisionGroups(WALKER_GROUPS));
    // Run them over and they fly limp (here at once, and in their game too); not again
    // while they're still flying, lying there or getting up.
    let hittableAt = 0;
    const down = () => avatar.down || KNOCKED_DOWN.has(this.remotes.get(info.id)?.act ?? null);
    const target: Target = {
      at: (out) => (avatar.root.visible && performance.now() > hittableAt && !down() ? out.copy(avatar.root.position) : null),
      radius: 0.35,
      height: 1.8,
      minSpeed: 1.2,
      mass: 80,
      harm: 0.03,
      hit: (car) => {
        hittableAt = performance.now() + KNOCK_AGAIN_MS;
        const v = flingFrom(car);
        game.knock(info.id, v);
        this.fling(info.id, v);
        game.sounds?.thud(avatar.root.position, Math.min(1, car.length() / 15));
      },
      // Punched, they reel in their own game (and we see it); kicked, they fly here at once too.
      struck: (kind, dir) => {
        const v = strikePush(kind, dir);
        game.strike(info.id, kind, v);
        if (kind === 'kick') {
          hittableAt = performance.now() + KNOCK_AGAIN_MS;
          this.fling(info.id, v);
        }
      },
    };
    game.impacts.addMoving(target);
    // Someone else's car hit them, or someone kicked them: they fly here too.
    game.knockables.set(info.id, (v) => this.fling(info.id, v));
    game.strikeables.set(info.id, (kind, v) => {
      if (kind === 'kick') this.fling(info.id, v);
    });
    this.remotes.set(info.id, { info, avatar, nameTag, samples: [], act: null, avatarBody, target, flungAt: -Infinity });
  }

  /**
   * Puts car `id` away, since our game moves it now (we're driving it, or it's ours back);
   * or brings it back, since another game does, carrying on from where ours left it.
   */
  setCarAway(id: string, away: boolean, from?: THREE.Object3D): void {
    this.cars.get(id)?.setAway(away, from);
  }

  /** A car drawn from the snapshots, if it's drawn here (not moved by our game). */
  puppet(id: string): { object: THREE.Object3D; body: RAPIER.RigidBody; speed: number } | null {
    const car = this.cars.get(id);
    return car?.drawn ? { object: car.model.root, body: car.body, speed: car.speed } : null;
  }

  /** Where car `id` is drawn here, by our game or from the snapshots. */
  carObject(id: string): THREE.Object3D | null {
    return this.localCar(id) ?? this.puppet(id)?.object ?? null;
  }

  /** Knocks someone's body flying limp at `v` (m/s), if they're walking about and not already down. */
  private fling(id: string, v: THREE.Vector3Like): void {
    const r = this.remotes.get(id);
    if (!r || !r.avatar.root.visible || r.avatar.down) return;
    r.avatar.fling(this.physics, v);
    r.flungAt = performance.now();
  }

  remove(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.nameTag.dispose();
    remote.avatar.dispose();
    this.scene.remove(remote.avatar.root);
    this.cars.get(id)?.dispose(this.scene);
    this.cars.delete(id);
    this.physics.removeRigidBody(remote.avatarBody);
    remote.avatar.unfling();
    game.impacts.removeMoving(remote.target);
    game.knockables.delete(id);
    game.strikeables.delete(id);
    this.remotes.delete(id);
  }

  /** Where players who are sitting down are (the seat area), so nobody sits on them. */
  seatedPositions(): THREE.Vector3[] {
    return [...this.remotes.values()].filter((r) => r.avatar.root.visible && r.avatar.seated).map((r) => r.avatar.seatPosition());
  }

  /** Each other player's position, heading (yaw, 0 = +Z) and color, for the minimap. */
  markers(): { x: number; z: number; yaw: number; color: string; name: string }[] {
    const out = [];
    for (const r of this.remotes.values()) {
      const at = this.locate(r.info.id);
      if (!at) continue;
      const o = at.walking ? r.avatar.root : this.carObject(this.seating.of(r.info.id)!.car)!;
      const yaw = at.walking ? o.rotation.y : yawOf(o.quaternion);
      out.push({ x: o.position.x, z: o.position.z, yaw, color: r.info.color, name: r.info.name });
    }
    return out;
  }

  private kinematicBody(shape: RAPIER.ColliderDesc): RAPIER.RigidBody {
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(PARKED_FAR.x, PARKED_FAR.y, PARKED_FAR.z));
    this.physics.createCollider(shape, body);
    return body;
  }

  /** Where another player is: their character if walking, else the car they're in. */
  locate(id: string): { position: THREE.Vector3; walking: boolean } | null {
    const r = this.remotes.get(id);
    if (!r) return null;
    if (r.avatar.root.visible) return { position: r.avatar.root.position, walking: true };
    const seat = this.seating.of(id);
    const car = seat && this.carObject(seat.car);
    return car ? { position: car.position, walking: false } : null;
  }

  applySnapshot(players: PlayerTransform[], now: number): void {
    for (const { id, p, q, car, avatar } of players) {
      this.cars.get(id)?.push(now, new THREE.Vector3(...p), new THREE.Quaternion(...q), car);
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.samples.push({ t: now, avatar });
      if (remote.samples.length > MAX_BUFFERED) remote.samples.shift();
    }
  }

  /** Tail lights glow after dark. */
  setNight(night: number): void {
    for (const car of this.cars.values()) car.model.setNight(night);
  }

  update(now: number, dt: number): void {
    const renderTime = now - INTERPOLATION_DELAY_MS;
    for (const car of this.cars.values()) car.update(renderTime, dt);
    for (const remote of this.remotes.values()) {
      const at = between(remote.samples, renderTime);
      if (!at) continue;
      this.updateAvatar(remote, at.a.avatar, at.b.avatar, at.k, dt);
      this.placeNameTag(remote);
    }
  }

  /**
   * Name tags go over people walking about, and over the car they're in otherwise (one
   * above another when friends ride together).
   */
  private placeNameTag(remote: Remote): void {
    const { avatar, nameTag, info } = remote;
    let parent: THREE.Object3D = avatar.root;
    let height = 2.05;
    const seat = this.seating.of(info.id);
    const car = !avatar.root.visible && seat ? this.carObject(seat.car) : null;
    if (car && seat) {
      parent = car;
      const others = this.seating.riders(seat.car).filter((r) => r.id !== this.localId);
      height = 1.6 + 0.32 * Math.max(0, others.findIndex((r) => r.id === info.id));
    }
    if (nameTag.parent !== parent) parent.add(nameTag);
    nameTag.position.y = height;
  }

  /** Shows the player's character while they're on foot, with the name tag above it. */
  private updateAvatar(remote: Remote, a: AvatarState | null, b: AvatarState | null, k: number, dt: number): void {
    const { avatar } = remote;
    const state = b ?? a;
    const walking = state !== null;
    avatar.root.visible = walking;
    if (!walking || !this.walkersSolid) moveBody(remote.avatarBody, PARKED_FAR);
    if (!state) {
      avatar.unfling();
      return;
    }
    // Blend between samples only when both have the avatar (not across getting in/out).
    const from = a ?? state;
    const to = b ?? state;
    const act = to.act ?? null;
    const there = new THREE.Vector3(...from.p).lerp(new THREE.Vector3(...to.p), k);
    const dy = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const yaw = from.yaw + dy * k;
    // Their punches and kicks swish, as ours do.
    if (act !== remote.act && (act === 'jab' || act === 'cross' || act === 'kick')) game.sounds?.swing(there.clone().setY(there.y + 1.2), act === 'kick');
    showAct(avatar, act, to.gear, !!to.swim, remote.act, performance.now() / 1000);
    remote.act = act;
    avatar.limp = to.hurt ? 1 : 0;
    if (this.knockedDown(remote, act, there, yaw, dt)) return;
    avatar.root.position.copy(there);
    avatar.root.rotation.y = yaw;
    avatar.seated = !!to.seated;
    avatar.animate(from.speed + (to.speed - from.speed) * k, dt, act === 'jet');
    const feet = avatar.root.position;
    // Someone sitting is part of the sofa; their standing body would only get in the way.
    if (this.walkersSolid) moveBody(remote.avatarBody, to.seated ? PARKED_FAR : { x: feet.x, y: feet.y + CAPSULE_CENTER, z: feet.z });
  }

  /**
   * Someone knocked over: their body flies limp here (from the knock, see `add`), lies
   * there, and gets up when they do, drifting over to where they really are as they rise.
   * Returns true while that's what's shown.
   */
  private knockedDown(remote: Remote, act: Act | null, there: THREE.Vector3, yaw: number, dt: number): boolean {
    const { avatar } = remote;
    const knocked = KNOCKED_DOWN.has(act);
    // Missed the knock (joined late, say): just fall where they are.
    if ((act === 'tumble' || act === 'down') && !avatar.down && !avatar.rising) {
      avatar.root.position.copy(there);
      avatar.fling(this.physics, { x: 0, y: 0, z: 0 });
    }
    if (act === 'getup' && avatar.down) avatar.getUp(groundUnder(this.physics, avatar.hips(), () => there.y));
    // Up and about without ever going down (in a car, say): never mind.
    else if (!knocked && avatar.down && performance.now() - remote.flungAt > AGREE_MS) avatar.unfling();
    if (!avatar.down && !avatar.rising) return false;
    if (avatar.rising) {
      const k = 1 - Math.exp(-dt * 2);
      const root = avatar.root;
      root.position.lerp(there, k);
      root.rotation.y += Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y)) * k;
    }
    avatar.animate(0, dt);
    moveBody(remote.avatarBody, PARKED_FAR);
    return true;
  }
}

/**
 * Moves a kinematic body for the next physics step. Ordinary moves give it a velocity,
 * so it shoves what it hits; teleports (respawns, getting in or out) just jump.
 */
function moveBody(body: RAPIER.RigidBody, p: THREE.Vector3Like, q?: THREE.QuaternionLike): void {
  const t = body.translation();
  if (Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) > TELEPORT_DISTANCE) {
    body.setTranslation(p, true);
    if (q) body.setRotation(q, true);
    return;
  }
  body.setNextKinematicTranslation(p);
  if (q) body.setNextKinematicRotation(q);
}

function yawOf(q: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(forward.x, forward.z);
}

function createNameTag(name: string): Label {
  const el = document.createElement('div');
  el.className = 'name-tag';
  el.textContent = name;
  const tag = new Label(el);
  tag.position.set(0, 1.6, 0);
  return tag;
}
