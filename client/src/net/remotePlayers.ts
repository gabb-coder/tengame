import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { PlayerInfo, PlayerTransform } from '../../../shared/protocol.ts';
import { createPlayerMesh } from '../player/playerMesh.ts';

// Render remote players this far in the past so there are two snapshots to blend between.
const INTERPOLATION_DELAY_MS = 100;
const MAX_BUFFERED = 30;

interface Sample {
  t: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

interface Remote {
  info: PlayerInfo;
  mesh: THREE.Object3D;
  samples: Sample[];
}

/** Draws other players, smoothing between server snapshots. */
export class RemotePlayers {
  private remotes = new Map<string, Remote>();

  constructor(
    private scene: THREE.Scene,
    private localId: string,
  ) {}

  add(info: PlayerInfo): void {
    if (info.id === this.localId || this.remotes.has(info.id)) return;
    const mesh = createPlayerMesh(info.color);
    mesh.visible = false; // until the first snapshot places it
    mesh.add(createNameTag(info.name));
    this.scene.add(mesh);
    this.remotes.set(info.id, { info, mesh, samples: [] });
  }

  remove(id: string): void {
    const remote = this.remotes.get(id);
    if (!remote) return;
    remote.mesh.traverse((o) => o instanceof CSS2DObject && o.element.remove());
    this.scene.remove(remote.mesh);
    this.remotes.delete(id);
  }

  applySnapshot(players: PlayerTransform[], now: number): void {
    for (const { id, p, q } of players) {
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.samples.push({ t: now, p: new THREE.Vector3(...p), q: new THREE.Quaternion(...q) });
      if (remote.samples.length > MAX_BUFFERED) remote.samples.shift();
    }
  }

  update(now: number): void {
    const renderTime = now - INTERPOLATION_DELAY_MS;
    for (const { mesh, samples } of this.remotes.values()) {
      if (samples.length === 0) continue;
      mesh.visible = true;

      // Drop samples we've fully moved past, keeping one before renderTime.
      while (samples.length >= 2 && samples[1].t <= renderTime) samples.shift();

      const [a, b] = samples;
      if (!b || renderTime <= a.t) {
        mesh.position.copy(a.p);
        mesh.quaternion.copy(a.q);
        continue;
      }
      const k = (renderTime - a.t) / (b.t - a.t);
      mesh.position.lerpVectors(a.p, b.p, k);
      mesh.quaternion.slerpQuaternions(a.q, b.q, k);
    }
  }

  get list(): PlayerInfo[] {
    return [...this.remotes.values()].map((r) => r.info);
  }
}

function createNameTag(name: string): CSS2DObject {
  const el = document.createElement('div');
  el.className = 'name-tag';
  el.textContent = name;
  const tag = new CSS2DObject(el);
  tag.position.set(0, 1.4, 0);
  return tag;
}
