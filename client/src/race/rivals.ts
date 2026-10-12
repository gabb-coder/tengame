import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { CarState, Quat, Vec3 } from '../../../shared/protocol.ts';
import { TEAMS } from '../../../shared/racing.ts';
import { REMOTE_CAR_GROUPS } from '../game/groups.ts';
import { Label } from '../render/labels.ts';
import { EngineSound } from '../vehicles/engineSound.ts';
import { F1 } from './f1.ts';
import { F1Model } from './f1Model.ts';
import { F1_VOICE } from './raceCar.ts';
import { RIDE_HEIGHT } from './racer.ts';
import type { Track } from './track.ts';

/** Drawn this far in the past, so there are two updates to blend between. */
const DELAY_MS = 100;
const KEEP = 30;
const WHEELBASE_SPIN = 1 / F1.wheelRadius;

interface Sample {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  car: CarState;
}

/** Another car, driven in someone else's game: a player's, or a computer driver's. */
export interface Rival {
  id: string;
  model: F1Model;
  body: RAPIER.RigidBody;
  samples: Sample[];
  spin: number;
  tag: Label | null;
  /** Where it is on the lap (kept up to date), and how fast it goes. */
  s: number;
  lateral: number;
  speed: number;
  rpm: number;
  load: number;
  seen: boolean;
}

/**
 * The cars other games drive, smoothed between the server's updates: drawn, given solid
 * stand-ins in our physics so we can't drive through them, and placed on the track for
 * the timing.
 */
export class Rivals {
  readonly cars = new Map<string, Rival>();

  constructor(
    private scene: THREE.Scene,
    private physics: RAPIER.World,
    private track: Track,
  ) {}

  /** Makes sure there's a car for `id` in `team`'s colors, named over it when `name` is given. */
  ensure(id: string, team: number, name: string | null): Rival {
    let r = this.cars.get(id);
    if (r && r.model.team !== TEAMS[team]) {
      this.remove(id);
      r = undefined;
    }
    if (r) return r;
    const model = new F1Model(TEAMS[team]);
    model.root.visible = false;
    this.scene.add(model.root);
    const h = F1.halfExtents;
    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -200, 0));
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z).setCollisionGroups(REMOTE_CAR_GROUPS), body);
    let tag: Label | null = null;
    if (name) {
      const div = document.createElement('div');
      div.className = 'name-tag';
      div.textContent = name;
      tag = new Label(div);
      tag.position.set(0, 1.4, 0);
      model.root.add(tag);
    }
    r = { id, model, body, samples: [], spin: 0, tag, s: 0, lateral: 0, speed: 0, rpm: 0, load: 0, seen: false };
    this.cars.set(id, r);
    return r;
  }

  remove(id: string): void {
    const r = this.cars.get(id);
    if (!r) return;
    r.model.root.removeFromParent();
    r.tag?.dispose();
    this.physics.removeRigidBody(r.body);
    this.cars.delete(id);
  }

  /** Removes every car not in `keep`. */
  keepOnly(keep: Set<string>): void {
    for (const id of [...this.cars.keys()]) if (!keep.has(id)) this.remove(id);
  }

  /** A position update from the server (time `t`, ms). */
  push(id: string, p: Vec3, q: Quat, car: CarState, t: number): void {
    const r = this.cars.get(id);
    if (!r) return;
    r.samples.push({ t, p: new THREE.Vector3(...p), q: new THREE.Quaternion(...q), car });
    if (r.samples.length > KEEP) r.samples.shift();
  }

  /** Where each car is drawn now; moves their stand-ins too. */
  update(now: number, dt: number): void {
    const at = now - DELAY_MS;
    for (const r of this.cars.values()) {
      const s = r.samples;
      if (!s.length) continue;
      let a = s[0];
      let b = s[s.length - 1];
      for (let k = 0; k < s.length - 1; k++) {
        if (s[k].t <= at && s[k + 1].t >= at) {
          a = s[k];
          b = s[k + 1];
          break;
        }
      }
      const f = b.t > a.t ? THREE.MathUtils.clamp((at - a.t) / (b.t - a.t), 0, 1) : 1;
      const root = r.model.root;
      root.position.lerpVectors(a.p, b.p, f);
      root.quaternion.slerpQuaternions(a.q, b.q, f);
      root.visible = true;
      const car = f < 0.5 ? a.car : b.car;
      r.speed = car.speed;
      r.rpm = car.rpm;
      r.load = car.load;
      r.spin += car.speed * WHEELBASE_SPIN * dt;
      for (let i = 0; i < 4; i++) r.model.setWheel(i, i < 2 ? car.steer : 0, r.spin, F1.suspensionRest - 0.02);
      r.model.setDrs(!!car.drs, dt);
      r.body.setNextKinematicTranslation(root.position);
      r.body.setNextKinematicRotation(root.quaternion);
      const spot = this.track.project(root.position.x, root.position.z, r.seen ? r.s : undefined, root.position.y - RIDE_HEIGHT);
      r.s = spot.s;
      r.lateral = spot.lateral;
      r.seen = true;
    }
  }

  /** Clears every car's history (a new race: everyone's back on the grid). */
  reset(): void {
    for (const r of this.cars.values()) {
      r.samples = [];
      r.seen = false;
      r.model.root.visible = false;
    }
  }
}

/** Engine sound for the few cars nearest the camera, shared round as they come and go. */
export class EnginePool {
  private voices: { holder: THREE.Object3D; engine: EngineSound; audio: THREE.PositionalAudio }[] = [];

  constructor(scene: THREE.Scene, listener: THREE.AudioListener, count = 5) {
    for (let k = 0; k < count; k++) {
      const engine = new EngineSound(listener.context, F1_VOICE);
      const audio = new THREE.PositionalAudio(listener);
      audio.setRefDistance(8);
      audio.setRolloffFactor(1.4);
      audio.setNodeSource(engine.output);
      const holder = new THREE.Object3D();
      holder.add(audio);
      scene.add(holder);
      this.voices.push({ holder, engine, audio });
    }
  }

  /** Silences and lets go of the voices. */
  dispose(): void {
    for (const v of this.voices) {
      // Unplugged from the speaker first: the engine then cuts its own output.
      v.audio.disconnect();
      v.engine.dispose();
      v.holder.removeFromParent();
    }
    this.voices = [];
  }

  /** Gives the voices to the cars nearest `ear`. */
  update(cars: { position: THREE.Vector3; rpm: number; load: number }[], ear: THREE.Vector3): void {
    const near = [...cars].sort((a, b) => a.position.distanceToSquared(ear) - b.position.distanceToSquared(ear)).slice(0, this.voices.length);
    this.voices.forEach((v, k) => {
      const car = near[k];
      if (!car) {
        v.engine.update(0, 0, 0);
        return;
      }
      v.holder.position.copy(car.position);
      v.engine.update(car.rpm, car.load, 1);
    });
  }
}
