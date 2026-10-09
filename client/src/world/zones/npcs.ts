import * as THREE from 'three';
import { ANCIENT } from '../../../../shared/zones/ancient.ts';
import { ARCTIC } from '../../../../shared/zones/arctic.ts';
import { CYBERPUNK } from '../../../../shared/zones/cyberpunk.ts';
import { JUNGLE } from '../../../../shared/zones/jungle.ts';
import { MEDIEVAL } from '../../../../shared/zones/medieval.ts';
import { SPACE } from '../../../../shared/zones/space.ts';
import { AvatarModel } from '../../player/avatarModel.ts';
import type { Human, Outfit } from '../../player/humanModel.ts';
import type { Terrain } from '../terrain.ts';

/** People are only animated (and drawn) this close to the camera. */
const RANGE = 110;

type Gear = (human: Human) => void;

interface Npc {
  avatar: AvatarModel;
  /** A loop to walk round, or a spot to stand on. */
  path: THREE.CatmullRomCurve3 | null;
  spot: { x: number; z: number; yaw: number };
  speed: number;
  offset: number;
  /** Height of the floor they walk on, if not the ground (inside a building). */
  floor?: number;
}

const metal = new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.9, roughness: 0.3 });
const darkMetal = new THREE.MeshStandardMaterial({ color: '#5a5e66', metalness: 0.8, roughness: 0.4 });
const bronze = new THREE.MeshStandardMaterial({ color: '#c08a3e', metalness: 0.9, roughness: 0.35 });
const wood = new THREE.MeshStandardMaterial({ color: '#6a4a2a', roughness: 0.8 });
const glass = new THREE.MeshPhysicalMaterial({ color: '#d8ecf8', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
const white = new THREE.MeshStandardMaterial({ color: '#f2f2f0', roughness: 0.6 });
const red = new THREE.MeshStandardMaterial({ color: '#a8201a', roughness: 0.8 });
const khaki = new THREE.MeshStandardMaterial({ color: '#c8b48a', roughness: 0.9 });
const fur = new THREE.MeshStandardMaterial({ color: '#e8e0d0', roughness: 1 });
const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.4), toneMapped: false });

const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};

/** A great helm, a sword and a heater shield. */
const knight = (crest: THREE.Material): Gear => (h) => {
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.CylinderGeometry(0.135, 0.13, 0.27, 16), metal, 0, 0.08, 0.01));
  helm.add(mesh(new THREE.SphereGeometry(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0.21, 0.01));
  helm.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.02), darkMetal, 0, 0.11, 0.14));
  helm.add(mesh(new THREE.BoxGeometry(0.03, 0.12, 0.2), crest, 0, 0.3, 0));
  h.attach('Head', helm);
  const sword = new THREE.Group();
  sword.add(mesh(new THREE.BoxGeometry(0.04, 0.9, 0.012), metal, 0, -0.5, 0.06));
  sword.add(mesh(new THREE.BoxGeometry(0.2, 0.03, 0.04), darkMetal, 0, -0.05, 0.06));
  h.attach('hand_r', sword);
  const shield = new THREE.Group();
  const face = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).scale(1, 1.3, 1), crest, 0, -0.05, 0);
  shield.add(face);
  shield.position.set(0.12, 0, 0);
  h.attach('lowerarm_l', shield);
};

/** A spacesuit's bubble helmet and life-support pack. */
const astronaut: Gear = (h) => {
  h.attach('Head', mesh(new THREE.SphereGeometry(0.2, 18, 14), glass, 0, 0.06, 0.02));
  h.attach('Head', mesh(new THREE.TorusGeometry(0.17, 0.03, 6, 18).rotateX(Math.PI / 2), white, 0, -0.08, 0));
  const pack = new THREE.Group();
  pack.add(mesh(new THREE.BoxGeometry(0.36, 0.45, 0.18), white, 0, 0, -0.2));
  pack.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.02), neon, 0, 0.1, -0.29));
  h.attach('spine_03', pack);
};

/** A Roman legionary's crested helmet and big shield. */
const legionary: Gear = (h) => {
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.SphereGeometry(0.14, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), bronze, 0, 0.08, 0));
  helm.add(mesh(new THREE.BoxGeometry(0.04, 0.12, 0.3), red, 0, 0.26, 0));
  h.attach('Head', helm);
  h.attach('lowerarm_l', mesh(new THREE.BoxGeometry(0.06, 0.9, 0.55), red, 0.12, -0.1, 0));
  h.attach('hand_r', mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.9, 6), wood, 0, 0, 0.05));
};

/** A fur-lined parka hood. */
const explorer: Gear = (h) => {
  h.attach('Head', mesh(new THREE.TorusGeometry(0.13, 0.05, 8, 18), fur, 0, 0.05, 0.03));
  h.attach('Head', mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: '#d8501a', roughness: 0.9 }), 0, 0.06, -0.01));
};

/** A pith helmet. */
const adventurer: Gear = (h) => {
  const hat = new THREE.Group();
  hat.add(mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), khaki, 0, 0.12, 0));
  hat.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 18), khaki, 0, 0.12, 0));
  h.attach('Head', hat);
};

/** Glowing visor glasses. */
const cyber: Gear = (h) => {
  h.attach('Head', mesh(new THREE.BoxGeometry(0.17, 0.035, 0.03), neon, 0, 0.06, 0.11));
};

/**
 * People going about their business in the zones: knights at the castle, astronauts at the
 * outpost, legionaries at the Colosseum, explorers in the tundra and the jungle, and city
 * folk under the neon.
 */
export class Npcs {
  readonly group = new THREE.Group();
  private npcs: Npc[] = [];
  private time = 0;

  constructor(private terrain: Terrain) {
    const c = MEDIEVAL.castle;
    const tabards = [red, new THREE.MeshStandardMaterial({ color: '#1d3c8a', roughness: 0.8 })];
    const knightOutfit: Outfit = { pants: '#6a6e76', shoes: '#2a2a2e', noHair: true, body: 'male' };
    // Castle: two guards at the gate, a patrol round the courtyard, two in the great hall.
    for (const side of [-1, 1]) this.add('knight-gate' + side, '#8e9298', knightOutfit, knight(tabards[0]), null, { x: c.x + side * 3.3, z: c.z + c.half - 6, yaw: 0 });
    const yard: [number, number][] = [
      [c.x - 30, c.z + 30],
      [c.x + 30, c.z + 30],
      [c.x + 32, c.z - 30],
      [c.x - 32, c.z - 30],
    ];
    for (let i = 0; i < 4; i++) this.add(`knight-patrol${i}`, '#8e9298', knightOutfit, knight(tabards[i % 2]), yard, undefined, 1.3, i * 30);
    const k = MEDIEVAL.keep;
    for (const side of [-1, 1]) this.add('knight-hall' + side, '#8e9298', knightOutfit, knight(tabards[1]), null, { x: k.x + side * 2.2, z: k.z - k.d / 2 + 5.5, yaw: 0 });
    const t = MEDIEVAL.tournament;
    this.add('knight-lists1', '#8e9298', knightOutfit, knight(tabards[0]), [[t.x - 35, t.z - 8], [t.x + 35, t.z - 8], [t.x + 35, t.z - 14], [t.x - 35, t.z - 14]], undefined, 1.6);
    this.add('knight-lists2', '#8e9298', knightOutfit, knight(tabards[1]), [[t.x + 35, t.z + 8], [t.x - 35, t.z + 8], [t.x - 35, t.z + 14], [t.x + 35, t.z + 14]], undefined, 1.6);
    // Villagers at the market.
    const sq = MEDIEVAL.square;
    for (let i = 0; i < 3; i++) this.add(`villager${i}`, ['#7a5a3a', '#4a6a3a', '#8a3a3a'][i], { pants: '#4a3a2a' }, () => {}, [[sq.x - 22, sq.z - 22 + i * 3], [sq.x - 8, sq.z - 22], [sq.x - 10, sq.z - 8], [sq.x - 24, sq.z - 10]], undefined, 1, i * 12);

    // The outpost's astronauts.
    const astro: Outfit = { pants: '#f2f2f0', shoes: '#c8ccd2', noHair: true };
    const hab = SPACE.habitat;
    this.add('astro1', '#f2f2f0', astro, astronaut, [[hab.x - 30, hab.z + 28], [hab.x + 20, hab.z + 40], [hab.x + 40, hab.z + 10]], undefined, 1);
    this.add('astro2', '#f2f2f0', astro, astronaut, null, { x: SPACE.dock.x - 10, z: SPACE.dock.z + 8, yaw: 2 });
    this.add('astro3', '#f2f2f0', astro, astronaut, null, { x: hab.x + 4, z: hab.z - 6, yaw: Math.PI });
    this.add('astro4', '#f2f2f0', astro, astronaut, [[SPACE.launchPad.x - 40, SPACE.launchPad.z + 30], [SPACE.launchPad.x - 40, SPACE.launchPad.z - 30]], undefined, 1);

    // Legionaries guarding the Colosseum's gates.
    const leg: Outfit = { pants: '#a8201a', shoes: '#5a3a1e', body: 'male', noHair: true };
    const col = ANCIENT.colosseum;
    for (const side of [-1, 1]) {
      this.add('legion' + side, '#a8201a', leg, legionary, null, { x: col.x + side * (col.rx + 5), z: col.z + 4, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    this.add('legion-march', '#a8201a', leg, legionary, [[-40, 250], [-40, 380], [-30, 380], [-30, 250]], undefined, 1.4);

    // Explorers by the igloos, and at the lost temple.
    const parka: Outfit = { pants: '#2a3442', shoes: '#3a2a1e' };
    this.add('explorer1', '#d8501a', parka, explorer, null, { x: ARCTIC.camp.x + 3, z: ARCTIC.camp.z + 2, yaw: -2 });
    this.add('explorer2', '#2a6ad8', parka, explorer, [[ARCTIC.camp.x - 20, ARCTIC.camp.z], [ARCTIC.camp.x, ARCTIC.camp.z + 20], [ARCTIC.camp.x + 20, ARCTIC.camp.z]], undefined, 0.9);
    const jt = JUNGLE.temple;
    const safari: Outfit = { pants: '#8a7a5a', shoes: '#4a3a2a' };
    this.add('adventurer1', '#c8b48a', safari, adventurer, [[jt.x - 25, jt.z + 22], [jt.x + 25, jt.z + 22], [jt.x + 25, jt.z + 26]], undefined, 1.1);
    this.add('adventurer2', '#a89a72', safari, adventurer, null, { x: jt.x + 6, z: jt.z + jt.base / 2 + 4, yaw: Math.PI });

    // City folk walking the neon sidewalks.
    const jackets = ['#ff2a8a', '#2af0ff', '#b44aff', '#ffe02a', '#1a1a20', '#2aff8a'];
    CYBERPUNK.blocks.slice(0, 12).forEach(([x0, z0, x1, z1], i) => {
      if (i % 2) return;
      const path: [number, number][] = [
        [x0 + 1.2, z0 + 1.2],
        [x1 - 1.2, z0 + 1.2],
        [x1 - 1.2, z1 - 1.2],
        [x0 + 1.2, z1 - 1.2],
      ];
      this.add(`citizen${i}`, jackets[i % jackets.length], { pants: '#1a1a22' }, cyber, i % 4 ? path : [...path].reverse(), undefined, 1.4, i * 20, 0.15);
    });
  }

  private add(seed: string, shirt: string, outfit: Outfit, gear: Gear, loop: [number, number][] | null, spot = { x: 0, z: 0, yaw: 0 }, speed = 1.2, offset = 0, floor?: number): void {
    const avatar = new AvatarModel(shirt, seed, outfit);
    avatar.onHuman = gear;
    const path = loop ? new THREE.CatmullRomCurve3(loop.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.1) : null;
    this.group.add(avatar.root);
    this.npcs.push({ avatar, path, spot, speed, offset, floor });
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    for (const n of this.npcs) {
      let x = n.spot.x;
      let z = n.spot.z;
      let yaw = n.spot.yaw;
      let speed = 0;
      if (n.path) {
        const length = n.path.getLength();
        const u = (((this.time * n.speed + n.offset) % length) + length) % length / length;
        n.path.getPointAt(u, p);
        n.path.getPointAt((u + 0.5 / length) % 1, ahead);
        [x, z] = [p.x, p.z];
        yaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        speed = n.speed;
      }
      const near = (x - camera.x) ** 2 + (z - camera.z) ** 2 < RANGE * RANGE;
      n.avatar.root.visible = near;
      if (!near) continue;
      const y = n.floor ?? this.terrain.heightAt(x, z);
      n.avatar.root.position.set(x, y, z);
      n.avatar.root.rotation.y = yaw;
      n.avatar.animate(speed, dt);
    }
  }
}
