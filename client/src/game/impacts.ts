import * as THREE from 'three';
import type { StrikeKind } from '../../../shared/protocol.ts';

/** Something a car can hit: a person, an animal, a lamp post, a bin. */
export interface Target {
  /** Where it stands right now (its feet or base), written into `out`; null while it can't be hit. */
  at(out: THREE.Vector3): THREE.Vector3 | null;
  /** How far it reaches around that point, and how tall it is (m). */
  radius: number;
  height: number;
  /** Slower than this (m/s), the car doesn't knock it over: it's in the way, or gets nudged past. */
  minSpeed: number;
  /** How heavy it feels to the car (kg): the heavier, the more it slows the car. */
  mass: number;
  /** How badly it dents the car when hit at 20 m/s (0..1); harder hits do more. */
  harm: number;
  /** Doesn't budge (a dinosaur): the car bounces off it. */
  solid?: boolean;
  /** Knocks it over, flying, or smashes it: `velocity` is the car's (m/s) as it struck. */
  hit(velocity: THREE.Vector3): void;
  /**
   * Punched or kicked by the player, who faces `dir` (flat, unit length). Without this,
   * a kick knocks over things light enough (see STRIKE_LIFTS), like a slow car would.
   */
  struck?(kind: StrikeKind, dir: THREE.Vector3): void;
}

/** Grid cell size (m) for things that stay put. */
const CELL = 8;

/**
 * Everything a car can run into that isn't simply a wall: things that stay put (street
 * lamps, bins, hydrants) by where they are, and things that move (people, animals).
 */
export class Impacts {
  private still = new Map<string, Target[]>();
  private moving = new Set<Target>();
  private found: Target[] = [];
  private at = new THREE.Vector3();

  /** Adds something that stays put, filed by where it is now. */
  add(t: Target): void {
    const at = t.at(this.at);
    if (!at) return this.addMoving(t);
    const key = cellKey(Math.floor(at.x / CELL), Math.floor(at.z / CELL));
    const list = this.still.get(key) ?? [];
    list.push(t);
    this.still.set(key, list);
  }

  /** Adds something that walks about (looked for wherever it is). */
  addMoving(t: Target): void {
    this.moving.add(t);
  }

  /** Takes away something that walks about (a player who left). */
  removeMoving(t: Target): void {
    this.moving.delete(t);
  }

  /** Targets that might be within `range` (m) of `p` (still ones by cell, moving ones checked). */
  near(p: THREE.Vector3Like, range: number): Target[] {
    const found = this.found;
    found.length = 0;
    const r = Math.ceil(range / CELL);
    const cx = Math.floor(p.x / CELL);
    const cz = Math.floor(p.z / CELL);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) for (const t of this.still.get(cellKey(i, j)) ?? []) found.push(t);
    for (const t of this.moving) {
      const at = t.at(this.at);
      if (at && Math.abs(at.x - p.x) < range + t.radius && Math.abs(at.z - p.z) < range + t.radius) found.push(t);
    }
    return found;
  }
}

function cellKey(i: number, j: number): string {
  return `${i},${j}`;
}

/** The car's body, as a box (half sizes, m), and how far below and above its middle it reaches. */
export interface CarShape {
  halfWidth: number;
  halfLength: number;
  below: number;
  above: number;
}

export interface CarHit {
  target: Target;
  /** Toward what was hit, in the car's frame (x across, z along). */
  dir: { x: number; z: number };
  /** How fast the car was closing on it (m/s). */
  speed: number;
}

const local = new THREE.Vector3();
const velocity = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const point = new THREE.Vector3();

/**
 * What the car will run into in the next `dt` seconds: targets inside its box, grown a
 * little in the direction it's moving, that it's driving into fast enough to knock over.
 */
export function carHits(impacts: Impacts, shape: CarShape, position: THREE.Vector3Like, rotation: THREE.QuaternionLike, v: THREE.Vector3Like, dt: number): CarHit[] {
  const hits: CarHit[] = [];
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < 0.5) return hits;
  inverse.set(rotation.x, rotation.y, rotation.z, rotation.w).invert();
  velocity.set(v.x, v.y, v.z).applyQuaternion(inverse);
  // Far enough ahead that nothing slips between two steps, even at top speed.
  const ahead = dt * 2;
  for (const target of impacts.near(position, shape.halfLength + speed * ahead + 2)) {
    const p = target.at(point);
    if (!p || p.y > position.y + shape.above || p.y + target.height < position.y - shape.below) continue;
    local.set(p.x - position.x, p.y - position.y, p.z - position.z).applyQuaternion(inverse);
    const rx = shape.halfWidth + target.radius;
    const rz = shape.halfLength + target.radius;
    const x0 = -rx + Math.min(0, velocity.x * ahead);
    const x1 = rx + Math.max(0, velocity.x * ahead);
    const z0 = -rz + Math.min(0, velocity.z * ahead);
    const z1 = rz + Math.max(0, velocity.z * ahead);
    if (local.x < x0 || local.x > x1 || local.z < z0 || local.z > z1) continue;
    // Which way it is from the car's middle, measured against the box (so a thing by the
    // front bumper counts as in front, not off to the side).
    const dir = { x: local.x / shape.halfWidth, z: local.z / shape.halfLength };
    const len = Math.hypot(dir.x, dir.z) || 1;
    dir.x /= len;
    dir.z /= len;
    const closing = velocity.x * dir.x + velocity.z * dir.z;
    if (closing < target.minSpeed) continue;
    hits.push({ target, dir, speed: closing });
  }
  return hits;
}

/** How far a punch and a kick reach in front of someone's feet (m), and how wide. */
export const STRIKE_REACH: Record<StrikeKind, number> = { punch: 0.85, kick: 1.05 };
const STRIKE_WIDTH = 0.3;
/** What a punch or kick can knock over unaided, at most (kg), and how fast it sends it (as a car going this fast would, m/s). */
export const STRIKE_LIFTS: Record<StrikeKind, { mass: number; speed: number }> = { punch: { mass: 0, speed: 0 }, kick: { mass: 30, speed: 6 } };
/**
 * How high above the feet a fist and a foot land (m): nothing whose bottom is higher gets
 * hit. And how low each reaches: nothing shorter gets hit (punching a penguin means
 * bending down; a kick can catch one).
 */
const STRIKE_HEIGHT: Record<StrikeKind, number> = { punch: 1.35, kick: 0.75 };
const STRIKE_LOW: Record<StrikeKind, number> = { punch: 0.95, kick: 0.2 };

const strikeAt = new THREE.Vector3();

/**
 * What a punch or kick from someone standing at `feet`, facing `yaw`, lands on: of the
 * targets right in front of them, within reach and at the height it lands at, the one
 * whose near side is closest (so a hedge alongside doesn't get kicked instead of the bin
 * ahead).
 */
export function strikeHit(impacts: Impacts, kind: StrikeKind, feet: THREE.Vector3Like, yaw: number): Target | null {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const high = feet.y + STRIKE_HEIGHT[kind];
  const low = feet.y + STRIKE_LOW[kind];
  let best: Target | null = null;
  let nearest = Infinity;
  for (const target of impacts.near(feet, STRIKE_REACH[kind] + 2)) {
    const p = target.at(strikeAt);
    if (!p || p.y > high || p.y + target.height < low) continue;
    const dx = p.x - feet.x;
    const dz = p.z - feet.z;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    if (along < -0.1 || along > STRIKE_REACH[kind] + target.radius || across > STRIKE_WIDTH + target.radius) continue;
    const side = along - Math.sqrt(Math.max(0, target.radius ** 2 - across ** 2));
    if (side < nearest) [best, nearest] = [target, side];
  }
  return best;
}

/** How a punch or kick pushes whoever it lands on, struck from `dir`'s way (m/s): a kick takes them off their feet. */
export function strikePush(kind: StrikeKind, dir: THREE.Vector3Like): THREE.Vector3 {
  return kind === 'kick' ? new THREE.Vector3(dir.x * 4.2, 2.4, dir.z * 4.2) : new THREE.Vector3(dir.x * 2.5, 0, dir.z * 2.5);
}
