import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { CarState, PlayerInfo, PlayerTransform } from '../../../shared/protocol.ts';
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
}

interface Remote {
  info: PlayerInfo;
  model: CarModel;
  engine: EngineSound;
  audio: THREE.PositionalAudio;
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
    model.root.add(createNameTag(info.name));

    const engine = new EngineSound(this.listener.context);
    const audio = new THREE.PositionalAudio(this.listener);
    audio.setRefDistance(6);
    audio.setRolloffFactor(1.6);
    audio.setNodeSource(engine.output);
    model.root.add(audio);

    this.scene.add(model.root);
    this.remotes.set(info.id, { info, model, engine, audio, samples: [], wheelSpin: 0 });
  }

  remove(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.model.root.traverse((o) => o instanceof CSS2DObject && o.element.remove());
    remote.engine.dispose();
    remote.audio.disconnect();
    this.scene.remove(remote.model.root);
    this.remotes.delete(id);
  }

  applySnapshot(players: PlayerTransform[], now: number): void {
    for (const { id, p, q, car } of players) {
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.samples.push({ t: now, p: new THREE.Vector3(...p), q: new THREE.Quaternion(...q), car });
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
      remote.engine.update(lerp('rpm'), lerp('load'));
    }
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
