import * as THREE from 'three';
import { catchFish, FISHING_SPOTS, type FishingSpot, type Rarity } from '../../../shared/activities.ts';
import type { Activity } from './activities.ts';
import { game } from './link.ts';

const STORAGE_KEY = 'tengame.fish';
/** Seconds to wait for a bite, and how long you have to strike once one comes. */
const BITE_WAIT: [number, number] = [3, 10];
const STRIKE_WINDOW = 1.4;

export interface FishRecord {
  count: number;
  /** Heaviest caught, kg. */
  best: number;
  rarity: Rarity;
}

const RARITY_WORDS: Record<Rarity, string> = { common: '', uncommon: ' Nice!', rare: ' Rare catch!', legendary: ' LEGENDARY!' };

function load(): Record<string, FishRecord> {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof data === 'object' && data ? data : {};
  } catch {
    return {};
  }
}

type State = { kind: 'idle' } | { kind: 'waiting'; bite: number } | { kind: 'biting'; left: number };

/**
 * Fishing: stand at a fishing spot, cast with E, wait for the float to bob, and strike
 * with E before the fish gets away. Every catch goes in the journal.
 */
export class Fishing {
  readonly group = new THREE.Group();
  readonly records = load();
  private float: THREE.Group;
  private line: THREE.Line;
  private spot: FishingSpot | null = null;
  private state: State = { kind: 'idle' };
  private time = 0;
  /** Where the rod's tip is right now (set by the game), for drawing the line. */
  rodTip: (out: THREE.Vector3) => THREE.Vector3 | null = () => null;
  onCatch: () => void = () => {};

  constructor() {
    this.float = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: '#e0302a', roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.5 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4).translate(0, 0.1, 0), red);
    this.float.add(top, bottom, stick);
    this.float.visible = false;
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#e8e8e8', transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.float, this.line);
    // A hole cut in the lake ice.
    const hole = FISHING_SPOTS.find((s) => s.id === 'arctic/ice-hole')!;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0e2a3a', roughness: 0.1 }));
    water.position.set(hole.float.x, hole.float.y + 0.01, hole.float.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.1, 6, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e8f2f8', roughness: 0.6 }));
    rim.position.copy(water.position);
    this.group.add(water, rim);
  }

  /** The "press E" spots, one per fishing spot. */
  activities(): Activity[] {
    return FISHING_SPOTS.map((spot) => ({
      position: new THREE.Vector3(spot.x, spot.y, spot.z),
      reach: 2.2,
      prompt: () => {
        if (!game.player.onFoot) return null;
        if (this.spot !== spot) return { action: 'Go fishing', detail: spot.name };
        if (this.state.kind === 'biting') return { action: 'Strike! Reel it in!' };
        return { action: 'Reel in', detail: 'Waiting for a bite… (walk away to stop)' };
      },
      use: () => {
        if (this.spot !== spot) this.cast(spot);
        else if (this.state.kind === 'biting') this.land(spot);
        else this.stop();
      },
    }));
  }

  update(dt: number): void {
    this.time += dt;
    const spot = this.spot;
    if (!spot) return;
    const s = this.state;
    const bob = new THREE.Vector3(spot.float.x, spot.float.y, spot.float.z);
    if (s.kind === 'waiting') {
      bob.y += Math.sin(this.time * 2.2) * 0.015;
      // A nibble or two before the real bite.
      if (s.bite - this.time < 1.2 && Math.sin(this.time * 18) > 0.95) bob.y -= 0.03;
      if (this.time >= s.bite) {
        this.state = { kind: 'biting', left: STRIKE_WINDOW };
        game.sounds?.plop(bob, 0.7);
      }
    } else if (s.kind === 'biting') {
      bob.y -= 0.12 + Math.abs(Math.sin(this.time * 14)) * 0.08;
      s.left -= dt;
      if (s.left <= 0) {
        game.notice('It got away… keep waiting for another bite');
        this.wait();
      }
    }
    this.float.position.copy(bob);
    const tip = this.rodTip(new THREE.Vector3());
    const positions = this.line.geometry.attributes.position as THREE.BufferAttribute;
    if (tip) {
      positions.setXYZ(0, tip.x, tip.y, tip.z);
      positions.setXYZ(1, bob.x, bob.y + 0.05, bob.z);
      positions.needsUpdate = true;
    }
    this.line.visible = !!tip;
  }

  private cast(spot: FishingSpot): void {
    this.spot = spot;
    game.startTask('fish', spot.yaw, () => this.reset());
    this.float.visible = true;
    game.sounds?.plop(new THREE.Vector3(spot.float.x, spot.float.y, spot.float.z), 0.4);
    this.wait();
  }

  private wait(): void {
    this.state = { kind: 'waiting', bite: this.time + BITE_WAIT[0] + Math.random() * (BITE_WAIT[1] - BITE_WAIT[0]) };
  }

  private land(spot: FishingSpot): void {
    const { fish, kg } = catchFish(spot, Math.random);
    const record = this.records[fish.name] ?? { count: 0, best: 0, rarity: fish.rarity };
    const best = kg > record.best;
    this.records[fish.name] = { count: record.count + 1, best: Math.max(record.best, kg), rarity: fish.rarity };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // Remembered until the page closes.
    }
    const weight = kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg.toFixed(1)} kg`;
    game.notice(`You caught a ${fish.name} (${weight})!${RARITY_WORDS[fish.rarity]}${best && record.count > 0 ? ' Your biggest yet!' : ''}`);
    game.sounds?.splash(this.float.position, 0.7);
    if (fish.rarity === 'legendary' || fish.rarity === 'rare') game.sounds?.chime(fish.rarity === 'legendary');
    this.onCatch();
    this.wait();
  }

  private stop(): void {
    game.stopTask();
  }

  /** Puts the rod away (the player moved, or reeled in). */
  private reset(): void {
    this.spot = null;
    this.state = { kind: 'idle' };
    this.float.visible = false;
    this.line.visible = false;
  }
}
