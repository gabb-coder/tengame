import * as THREE from 'three';
import { RELICS, type Relic } from '../../../shared/activities.ts';
import { ZONES, type ZoneId } from '../../../shared/world.ts';
import { fireworks } from '../world/zones/fireworks.ts';
import { game } from './link.ts';

const STORAGE_KEY = 'tengame.relics';
/** How close you must get to pick one up: walking, or driving through it. */
const REACH_ON_FOOT = 1.4;
const REACH_IN_CAR = 2.8;
/** Relics are only drawn (and spun) this close to the camera. */
const VIEW_DISTANCE = 140;

/** Each zone's treasures share a look: a shape and a color. */
const LOOKS: Record<ZoneId, { color: string; shape: 'coin' | 'gem' | 'cup' | 'idol' | 'chip' | 'egg' | 'pearl' | 'ankh' }> = {
  town: { color: '#ffd24a', shape: 'coin' },
  arctic: { color: '#9ae8ff', shape: 'gem' },
  medieval: { color: '#ffc23a', shape: 'cup' },
  space: { color: '#c77aff', shape: 'gem' },
  jungle: { color: '#3aff9a', shape: 'idol' },
  cyberpunk: { color: '#2af0ff', shape: 'chip' },
  prehistoric: { color: '#ff9a2a', shape: 'egg' },
  ancient: { color: '#ffd24a', shape: 'ankh' },
  ocean: { color: '#f4f0ff', shape: 'pearl' },
};

function shapeOf(kind: (typeof LOOKS)[ZoneId]['shape']): THREE.BufferGeometry {
  switch (kind) {
    case 'coin':
      return new THREE.CylinderGeometry(0.28, 0.28, 0.06, 24).rotateX(Math.PI / 2);
    case 'gem':
      return new THREE.OctahedronGeometry(0.3, 0).scale(0.8, 1.3, 0.8);
    case 'cup':
      return new THREE.LatheGeometry([[0, -0.3], [0.18, -0.3], [0.05, -0.22], [0.04, 0], [0.2, 0.08], [0.24, 0.3], [0.2, 0.3], [0.03, 0.06]].map(([r, y]) => new THREE.Vector2(r, y)), 16);
    case 'idol':
      return new THREE.CapsuleGeometry(0.15, 0.3, 4, 10);
    case 'chip':
      return new THREE.BoxGeometry(0.42, 0.42, 0.06);
    case 'egg':
      return new THREE.SphereGeometry(0.24, 16, 12).scale(0.85, 1.15, 0.85);
    case 'pearl':
      return new THREE.SphereGeometry(0.24, 18, 14);
    case 'ankh': {
      const loop = new THREE.TorusGeometry(0.11, 0.035, 8, 16).translate(0, 0.2, 0);
      const bar = new THREE.BoxGeometry(0.34, 0.06, 0.06).translate(0, 0.04, 0);
      const stem = new THREE.BoxGeometry(0.07, 0.36, 0.06).translate(0, -0.14, 0);
      const parts = [loop, bar, stem].map((g) => g.toNonIndexed());
      const merged = new THREE.BufferGeometry();
      for (const name of ['position', 'normal'] as const) {
        merged.setAttribute(name, new THREE.Float32BufferAttribute(parts.flatMap((g) => [...g.attributes[name].array]), 3));
      }
      return merged;
    }
  }
}

/** A soft round glow for behind each relic. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function load(): Set<string> {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Treasures hidden around the world: glowing, spinning things you pick up by walking (or
 * driving) into them. What you've found is remembered in this browser.
 */
export class Relics {
  readonly group = new THREE.Group();
  readonly found = load();
  private items: { relic: Relic; object: THREE.Object3D; core: THREE.Mesh }[] = [];
  private time = 0;
  /** Called when a relic is found (to refresh the journal). */
  onFound: () => void = () => {};

  constructor() {
    const glow = glowTexture();
    const geometries = new Map<string, THREE.BufferGeometry>();
    for (const relic of RELICS) {
      const look = LOOKS[relic.zone];
      if (!geometries.has(look.shape)) geometries.set(look.shape, shapeOf(look.shape));
      const material = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 0.6, metalness: look.shape === 'pearl' ? 0.2 : 0.8, roughness: 0.25 });
      const core = new THREE.Mesh(geometries.get(look.shape)!, material);
      core.castShadow = true;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: look.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(1.6);
      const object = new THREE.Group();
      object.add(halo, core);
      object.position.set(relic.x, relic.y, relic.z);
      object.visible = !this.found.has(relic.id);
      this.group.add(object);
      this.items.push({ relic, object, core });
    }
  }

  /** Spins the relics near the camera, and picks up any the player touches. */
  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const p = game.player.position;
    const reach = game.player.onFoot ? REACH_ON_FOOT : REACH_IN_CAR;
    for (const item of this.items) {
      if (this.found.has(item.relic.id)) continue;
      const { relic, object, core } = item;
      const near = Math.abs(relic.x - camera.x) < VIEW_DISTANCE && Math.abs(relic.z - camera.z) < VIEW_DISTANCE;
      object.visible = near;
      if (!near) continue;
      core.rotation.y = this.time * 1.8;
      object.position.y = relic.y + Math.sin(this.time * 2 + relic.x) * 0.08;
      // The player's middle: feet plus a bit when walking; the car's center when driving.
      const dy = relic.y - (p.y + (game.player.onFoot ? 0.9 : 0.4));
      if (Math.hypot(relic.x - p.x, relic.z - p.z) < reach && Math.abs(dy) < 1.4) this.collect(relic, object);
    }
  }

  /** How many of a zone's relics are found, of how many. */
  count(zone?: ZoneId): { found: number; total: number } {
    const list = RELICS.filter((r) => !zone || r.zone === zone);
    return { found: list.filter((r) => this.found.has(r.id)).length, total: list.length };
  }

  private collect(relic: Relic, object: THREE.Object3D): void {
    this.found.add(relic.id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.found]));
    } catch {
      // Private browsing: it's remembered until the page closes.
    }
    object.visible = false;
    const look = LOOKS[relic.zone];
    const zone = this.count(relic.zone);
    const all = this.count();
    if (game.player.onFoot) game.playOnce('pickup');
    fireworks.sparkle(object.position, look.color);
    const where = ZONES[relic.zone].name;
    if (all.found === all.total) {
      game.sounds?.chime(true);
      game.notice(`You found all ${all.total} relics! You're a legendary explorer!`);
      fireworks.show(game.player.position.clone(), 24, 50);
    } else if (zone.found === zone.total) {
      game.sounds?.chime(true);
      game.notice(`${relic.name}! That's every relic in ${where} (${all.found} of ${all.total} in all)`);
      fireworks.show(game.player.position.clone(), 8, 35);
    } else {
      game.sounds?.chime();
      game.notice(`Found: ${relic.name}! ${zone.found} of ${zone.total} in ${where} (${all.found} of ${all.total} in all)`);
    }
    this.onFound();
  }
}
