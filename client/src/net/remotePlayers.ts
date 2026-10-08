import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { AvatarState, CarState, PlayerInfo, PlayerTransform } from '../../../shared/protocol.ts';
import { AvatarModel } from '../player/avatarModel.ts';
import { CAR } from '../vehicles/carPhysics.ts';
import { CarModel } from '../vehicles/carModel.ts';
import { EngineSound } from '../vehicles/engineSound.ts';

// Render remote players this far in the past so there are two snapshots to blend between.
const INTERPOLATION_DELAY_MS = 100;
const MAX_BUFFERED = 30;
// Suspension isn't synced; draw wheels at the length the car rests at on flat ground.
const SETTLED_SUSPENSION = CAR.suspensionRest * 0.65;

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
  nameTag: CSS2DObject;
  samples: Sample[];
  wheelSpin: number;
}

/** Draws and voices other players' cars, smoothing between server snapshots. */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();

  constructor(
    private scene: THREE.Scene,
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
    this.remotes.set(info.id, { info, model, engine, audio, avatar, nameTag, samples: [], wheelSpin: 0 });
  }

  remove(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.nameTag.element.remove();
    this.scene.remove(remote.avatar.root);
    // Detach the positional audio before stopping its source; the reverse order throws.
    remote.audio.disconnect();
    remote.engine.dispose();
    this.scene.remove(remote.model.root);
    this.remotes.delete(id);
  }

  applySnapshot(players: PlayerTransform[], now: number): void {
    for (const { id, p, q, car, avatar } of players) {
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.samples.push({ t: now, p: new THREE.Vector3(...p), q: new THREE.Quaternion(...q), car, avatar });
      if (remote.samples.length > MAX_BUFFERED) remote.samples.shift();
    }
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

      const lerp = (key: 'steer' | 'rpm' | 'load' | 'speed') => a.car[key] + (next.car[key] - a.car[key]) * k;
      const speed = lerp('speed');
      remote.wheelSpin += (speed / CAR.wheelRadius) * dt;
      for (let i = 0; i < 4; i++) model.setWheel(i, i < 2 ? lerp('steer') : 0, remote.wheelSpin, SETTLED_SUSPENSION);
      model.setBraking(next.car.braking);
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
    const tagParent = walking ? avatar.root : model.root;
    if (nameTag.parent !== tagParent) {
      tagParent.add(nameTag);
      nameTag.position.y = walking ? 2.05 : 1.6;
    }
    if (!state) return;
    // Blend between samples only when both have the avatar (not across getting in/out).
    const from = a ?? state;
    const to = b ?? state;
    avatar.root.position.set(...from.p).lerp(new THREE.Vector3(...to.p), k);
    const dy = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    avatar.root.rotation.y = from.yaw + dy * k;
    avatar.animate(from.speed + (to.speed - from.speed) * k, dt);
  }
}

function createNameTag(name: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'name-tag';
  el.textContent = name;
  const tag = new CSS2DObject(el);
  tag.position.set(0, 1.6, 0);
  return tag;
}
