import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Label } from '../render/labels.ts';
import type { Act, AvatarState, CarState, PlayerInfo, PlayerTransform } from '../../../shared/protocol.ts';
import { CAR_SHAPE_GROUPS, REMOTE_CAR_GROUPS, WALKER_GROUPS } from '../game/groups.ts';
import { game } from '../game/link.ts';
import type { Target } from '../game/impacts.ts';
import { groundUnder } from '../game/thrown.ts';
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

interface Sample {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  car: CarState;
  avatar: AvatarState | null;
}

interface Remote {
  info: PlayerInfo;
  model: CarModel;
  engine: EngineSound;
  audio: THREE.PositionalAudio;
  avatar: AvatarModel;
  nameTag: Label;
  samples: Sample[];
  wheelSpin: number;
  /** The act last shown, so one-shot moves play once. */
  act: Act | null;
  /** Stand-ins in our physics world, moved to where the player is drawn, so we bump into them. */
  carBody: RAPIER.RigidBody;
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
 * Draws and voices other players' cars and characters, smoothing between server
 * snapshots, and gives them solid bodies in our physics world.
 */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();
  /**
   * Whether walking players are solid to us. Not while we drive: the car hits them and
   * they fly (see game/impacts.ts), rather than stopping dead as if at a post.
   */
  walkersSolid = true;

  constructor(
    private scene: THREE.Scene,
    private physics: RAPIER.World,
    private localId: string,
    private listener: THREE.AudioListener,
  ) {}

  add(info: PlayerInfo): void {
    if (info.id === this.localId || this.remotes.has(info.id)) return;
    const model = new CarModel(info.color);
    model.root.visible = false; // until the first snapshot places it
    const nameTag = createNameTag(info.name);
    model.root.add(nameTag);
    const avatar = new AvatarModel(info.color, info.id);
    avatar.root.visible = false;
    this.scene.add(avatar.root);

    const engine = new EngineSound(this.listener.context);
    const audio = new THREE.PositionalAudio(this.listener);
    audio.setRefDistance(6);
    audio.setRolloffFactor(1.6);
    audio.setNodeSource(engine.output);
    model.root.add(audio);

    this.scene.add(model.root);
    const carBody = this.kinematicBody(RAPIER.ColliderDesc.cuboid(CAR.halfExtents.x, CAR.halfExtents.y, CAR.halfExtents.z).setCollisionGroups(REMOTE_CAR_GROUPS));
    for (const shape of carShapes()) this.physics.createCollider(shape.setCollisionGroups(CAR_SHAPE_GROUPS), carBody);
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
    };
    game.impacts.addMoving(target);
    // Someone else's car hit them: they fly here too.
    game.knockables.set(info.id, (v) => this.fling(info.id, v));
    this.remotes.set(info.id, { info, model, engine, audio, avatar, nameTag, samples: [], wheelSpin: 0, act: null, carBody, avatarBody, target, flungAt: -Infinity });
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
    // Detach the positional audio before stopping its source; the reverse order throws.
    remote.audio.disconnect();
    remote.engine.dispose();
    remote.model.dispose();
    this.scene.remove(remote.model.root);
    this.physics.removeRigidBody(remote.carBody);
    this.physics.removeRigidBody(remote.avatarBody);
    remote.avatar.unfling();
    game.impacts.removeMoving(remote.target);
    game.knockables.delete(id);
    this.remotes.delete(id);
  }

  /** Where players who are sitting down are (the seat area), so nobody sits on them. */
  seatedPositions(): THREE.Vector3[] {
    return [...this.remotes.values()].filter((r) => r.avatar.root.visible && r.avatar.seated).map((r) => r.avatar.seatPosition());
  }

  /** Each other player's position, heading (yaw, 0 = +Z) and color, for the minimap. */
  markers(): { x: number; z: number; yaw: number; color: string }[] {
    const out = [];
    for (const r of this.remotes.values()) {
      if (!r.model.root.visible) continue;
      const walking = r.avatar.root.visible;
      const o = walking ? r.avatar.root : r.model.root;
      const yaw = walking ? o.rotation.y : yawOf(o.quaternion);
      out.push({ x: o.position.x, z: o.position.z, yaw, color: r.info.color });
    }
    return out;
  }

  private kinematicBody(shape: RAPIER.ColliderDesc): RAPIER.RigidBody {
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(PARKED_FAR.x, PARKED_FAR.y, PARKED_FAR.z));
    this.physics.createCollider(shape, body);
    return body;
  }

  /** Where another player is: their character if walking, else their car. */
  locate(id: string): { position: THREE.Vector3; walking: boolean } | null {
    const r = this.remotes.get(id);
    if (!r || !r.model.root.visible) return null;
    const walking = r.avatar.root.visible;
    return { position: (walking ? r.avatar.root : r.model.root).position, walking };
  }

  applySnapshot(players: PlayerTransform[], now: number): void {
    for (const { id, p, q, car, avatar } of players) {
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.samples.push({ t: now, p: new THREE.Vector3(...p), q: new THREE.Quaternion(...q), car, avatar });
      if (remote.samples.length > MAX_BUFFERED) remote.samples.shift();
    }
  }

  /** Tail lights glow after dark. */
  setNight(night: number): void {
    for (const r of this.remotes.values()) r.model.setNight(night);
  }

  update(now: number, dt: number): void {
    const renderTime = now - INTERPOLATION_DELAY_MS;
    for (const remote of this.remotes.values()) {
      const { model, samples } = remote;
      if (samples.length === 0) continue;
      model.root.visible = true;

      // Drop samples we've fully moved past, keeping one before renderTime.
      while (samples.length >= 2 && samples[1].t <= renderTime) samples.shift();

      const [a, b] = samples;
      const k = !b || renderTime <= a.t ? 0 : (renderTime - a.t) / (b.t - a.t);
      const next = b ?? a;
      model.root.position.lerpVectors(a.p, next.p, k);
      model.root.quaternion.slerpQuaternions(a.q, next.q, k);
      moveBody(remote.carBody, model.root.position, model.root.quaternion);

      const lerp = (key: 'steer' | 'rpm' | 'load' | 'speed') => a.car[key] + (next.car[key] - a.car[key]) * k;
      const speed = lerp('speed');
      remote.wheelSpin += (speed / CAR.wheelRadius) * dt;
      for (let i = 0; i < 4; i++) model.setWheel(i, i < 2 ? lerp('steer') : 0, remote.wheelSpin, SETTLED_SUSPENSION);
      model.setBraking(next.car.braking);
      model.setDamage(next.car.dmg);
      model.smoke(dt);
      const rpm = lerp('rpm');
      remote.engine.update(rpm, lerp('load'), rpm > 0 ? 1 : 0);
      this.updateAvatar(remote, a.avatar, next.avatar, k, dt);
    }
  }

  /** Shows the player's character while they're on foot, with the name tag above it. */
  private updateAvatar(remote: Remote, a: AvatarState | null, b: AvatarState | null, k: number, dt: number): void {
    const { avatar, nameTag, model } = remote;
    const state = b ?? a;
    const walking = state !== null;
    avatar.root.visible = walking;
    if (!walking || !this.walkersSolid) moveBody(remote.avatarBody, PARKED_FAR);
    const tagParent = walking ? avatar.root : model.root;
    if (nameTag.parent !== tagParent) {
      tagParent.add(nameTag);
      nameTag.position.y = walking ? 2.05 : 1.6;
    }
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
