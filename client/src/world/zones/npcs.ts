import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Label } from '../../render/labels.ts';
import { groundUnder } from '../../game/thrown.ts';
import { generateTown, PARK_FOUNTAIN } from '../../../../shared/town.ts';
import { ANCIENT } from '../../../../shared/zones/ancient.ts';
import { ARCTIC } from '../../../../shared/zones/arctic.ts';
import { CYBERPUNK } from '../../../../shared/zones/cyberpunk.ts';
import { JUNGLE } from '../../../../shared/zones/jungle.ts';
import { MEDIEVAL } from '../../../../shared/zones/medieval.ts';
import { SPACE } from '../../../../shared/zones/space.ts';
import { game } from '../../game/link.ts';
import { AvatarModel } from '../../player/avatarModel.ts';
import type { Human, Outfit } from '../../player/humanModel.ts';
import { flingFrom } from '../../player/ragdoll.ts';
import type { Terrain } from '../terrain.ts';

/** People are only animated (and drawn) this close to the camera. */
const RANGE = 110;
/** Sidewalks and blocks in town stand this high. */
const CURB = 0.15;
/** How long someone stops to talk, after your last word. */
const TALK_SECONDS = 7;
/** Knocked over by a car: how long they lie there, how long they limp afterwards, and how fast. */
const DOWN_SECONDS = 3.5;
const HURT_SECONDS = 40;
const LIMP_SPEED = 0.9;
/** What people say, getting up after being knocked over. */
const OUCH = [
  'Ow! Watch where you’re driving!',
  'Hey! I was walking here!',
  'My back… my poor back…',
  'Learn to drive!',
  'Ouch! You could have just said hello.',
  'I’m okay! I’m okay… I think.',
  'Somebody take that driver’s license away!',
];

/** Knocked flying by a car: thrown limp, then lying there, getting up and limping back. */
interface Knock {
  phase: 'fly' | 'down' | 'up' | 'back';
  /** Seconds in this phase. */
  t: number;
}

type Gear = (human: Human) => void;

/** Who someone is and what they have to say. */
interface Role {
  name: string;
  lines: string[];
  /** What they do when standing about (a clip, e.g. 'Sword_Idle'). */
  idle?: string;
}

interface Npc {
  id: string;
  avatar: AvatarModel;
  role: Role;
  /** A loop to walk round, or a spot to stand on. */
  path: THREE.CatmullRomCurve3 | null;
  spot: { x: number; z: number; yaw: number };
  speed: number;
  /** How far round their loop they've walked (m). */
  walked: number;
  /** Height of the floor they walk on, if not the ground (inside a building). */
  floor?: number;
  /** Seconds left of talking to the player, and which line is next. */
  talking: number;
  line: number;
  bubble: Label | null;
  /** Seconds left of something said in passing (not a chat), shown in the bubble. */
  saying: number;
  knock: Knock | null;
  /** Seconds left of limping after being knocked over. */
  hurt: number;
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

/** A tall pointed hat and a staff topped with a glowing stone. */
const wizard: Gear = (h) => {
  const hat = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: '#2a1e5a', roughness: 0.9 });
  hat.add(mesh(new THREE.ConeGeometry(0.17, 0.5, 14), cloth, 0, 0.32, -0.02));
  hat.add(mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 18), cloth, 0, 0.1, 0));
  h.attach('Head', hat);
  const staff = new THREE.Group();
  staff.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.7, 6), wood, 0, 0.1, 0.05));
  staff.add(mesh(new THREE.OctahedronGeometry(0.07, 0), neon, 0, 0.98, 0.05));
  h.attach('hand_l', staff);
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

  constructor(
    private terrain: Terrain,
    private physics: RAPIER.World,
  ) {
    const c = MEDIEVAL.castle;
    const tabards = [red, new THREE.MeshStandardMaterial({ color: '#1d3c8a', roughness: 0.8 })];
    const knightOutfit: Outfit = { pants: '#6a6e76', shoes: '#2a2a2e', noHair: true, body: 'male' };
    const guard: Role = {
      name: 'Sir Roderick',
      idle: 'Sword_Idle',
      lines: [
        'Halt! Oh, a traveller. Welcome to Castle Eldermoor.',
        'The king’s trebuchet, west of the castle, will throw a brave soul right over these walls.',
        'Ring the bell on the market square and the whole kingdom will hear it.',
      ],
    };
    // Castle: two guards at the gate, a patrol round the courtyard, two in the great hall.
    for (const side of [-1, 1]) this.add('knight-gate' + side, '#8e9298', knightOutfit, knight(tabards[0]), { spot: { x: c.x + side * 3.3, z: c.z + c.half - 6, yaw: 0 }, role: side < 0 ? guard : { ...guard, name: 'Sir Edmund' } });
    const yard: [number, number][] = [
      [c.x - 30, c.z + 30],
      [c.x + 30, c.z + 30],
      [c.x + 32, c.z - 30],
      [c.x - 32, c.z - 30],
    ];
    const patrol = ['Sir Gareth', 'Dame Elaine', 'Sir Percival', 'Dame Isolde'];
    for (let i = 0; i < 4; i++) {
      this.add(`knight-patrol${i}`, '#8e9298', knightOutfit, knight(tabards[i % 2]), {
        loop: yard,
        speed: 1.3,
        offset: i * 30,
        role: {
          name: patrol[i],
          lines: [
            'Have you seen the dragon? It circles the castle every day. Keep your head down.',
            'The king keeps his crown beside the throne. Don’t touch it!',
            'There’s a feast in the great hall. Pull up a bench!',
            'They say the fish in the moat are as old as the castle.',
          ].slice(i % 2, (i % 2) + 3),
        },
      });
    }
    const k = MEDIEVAL.keep;
    const hall: Role = { name: 'Sir Lancelot', idle: 'Sword_Idle', lines: ['Welcome to the great hall. Take a seat at the feast!', 'Only the bravest sit on the throne. Go on, try it.'] };
    for (const side of [-1, 1]) this.add('knight-hall' + side, '#8e9298', knightOutfit, knight(tabards[1]), { spot: { x: k.x + side * 2.2, z: k.z - k.d / 2 + 5.5, yaw: 0 }, role: side < 0 ? hall : { ...hall, name: 'Dame Morgana' } });
    const t = MEDIEVAL.tournament;
    const jousting: Role = { name: 'The Black Knight', lines: ['None shall pass! …Unless you’d like a seat in the stands.', 'Sit in the top row: someone dropped a lance tip up there.'] };
    this.add('knight-lists1', '#8e9298', knightOutfit, knight(tabards[0]), { loop: [[t.x - 35, t.z - 8], [t.x + 35, t.z - 8], [t.x + 35, t.z - 14], [t.x - 35, t.z - 14]], speed: 1.6, role: jousting });
    this.add('knight-lists2', '#8e9298', knightOutfit, knight(tabards[1]), { loop: [[t.x + 35, t.z + 8], [t.x - 35, t.z + 8], [t.x - 35, t.z + 14], [t.x + 35, t.z + 14]], speed: 1.6, role: { ...jousting, name: 'The White Knight' } });
    // Villagers at the market, the smith at his anvil, and a wizard in the courtyard.
    const sq = MEDIEVAL.square;
    const villagers = ['Martha the Baker', 'Old Tom', 'Rosalind'];
    for (let i = 0; i < 3; i++) {
      this.add(`villager${i}`, ['#7a5a3a', '#4a6a3a', '#8a3a3a'][i], { pants: '#4a3a2a' }, () => {}, {
        loop: [[sq.x - 22, sq.z - 22 + i * 3], [sq.x - 8, sq.z - 22], [sq.x - 10, sq.z - 8], [sq.x - 24, sq.z - 10]],
        speed: 1,
        offset: i * 12,
        role: { name: villagers[i], lines: [['Fresh bread! Warm from the oven!', 'Somebody dropped a wishing coin by the well.'], ['In my day the dragon was half the size.', 'Climb the hill to the windmill. Lovely view.'], ['Have you tried fishing in the moat?', 'The bell tower rope is just by the square.']][i] },
      });
    }
    const s = MEDIEVAL.smithy;
    this.add('smith', '#3a2a22', { pants: '#2a2220', body: 'male' }, () => {}, { spot: { x: s.x + 1.2, z: s.z + 1.6, yaw: Math.PI }, role: { name: 'Bram the Smith', idle: 'Fixing_Kneeling', lines: ['*clang* *clang* Busy, busy!', 'Every knight’s sword in Eldermoor came from this anvil.'] } });
    this.add('wizard', '#3a2a6a', { pants: '#2a1e4a', body: 'male' }, wizard, { spot: { x: c.x - 20, z: c.z + 8, yaw: 0.6 }, role: { name: 'Merlin', idle: 'Spell_Simple_Idle_Loop', lines: ['Ah, a visitor. The stars told me you would come.', 'Eight lands surround the town. Find all their relics and something marvelous happens.', 'Press J to read your journal. Its riddles will guide you.'] } });

    // The outpost's astronauts.
    const astro: Outfit = { pants: '#f2f2f0', shoes: '#c8ccd2', noHair: true };
    const hab = SPACE.habitat;
    this.add('astro1', '#f2f2f0', astro, astronaut, { loop: [[hab.x - 30, hab.z + 28], [hab.x + 20, hab.z + 40], [hab.x + 40, hab.z + 10]], speed: 1, role: { name: 'Commander Vega', lines: ['Welcome to Outpost Nova! Gravity here is a third of home. Jump!', 'Borrow a jetpack from the rack by the habitat. Hold Space to fly!'] } });
    this.add('astro2', '#f2f2f0', astro, astronaut, { spot: { x: SPACE.dock.x - 10, z: SPACE.dock.z + 8, yaw: 2 }, role: { name: 'Pilot Okafor', lines: ['She’s a beauty, isn’t she? Fastest ship in the sector.', 'Somebody dropped a meteorite at the bottom of the Great Crater.'] } });
    this.add('astro3', '#f2f2f0', astro, astronaut, { spot: { x: hab.x + 4, z: hab.z - 6, yaw: Math.PI }, role: { name: 'Dr. Lin', lines: ['The hologram shows every planet we’ve mapped.', 'Careful outside. The crystals hum at night.'] } });
    this.add('astro4', '#f2f2f0', astro, astronaut, { loop: [[SPACE.launchPad.x - 40, SPACE.launchPad.z + 30], [SPACE.launchPad.x - 40, SPACE.launchPad.z - 30]], speed: 1, role: { name: 'Launch Chief Ruiz', lines: ['The rocket goes up every four minutes. Watch it from here!', 'Stand clear of the pad during launch. Seriously.'] } });
    this.add('astro5', '#f2f2f0', astro, astronaut, { spot: { x: hab.x - 26, z: hab.z + 22, yaw: 1.2 }, role: { name: 'Mechanic Jo', idle: 'Fixing_Kneeling', lines: ['These rovers never stop breaking. Hand me that spanner?', 'Low gravity is great until you drop a bolt. Then it floats off.'] } });

    // Legionaries guarding the Colosseum's gates.
    const leg: Outfit = { pants: '#a8201a', shoes: '#5a3a1e', body: 'male', noHair: true };
    const col = ANCIENT.colosseum;
    for (const side of [-1, 1]) {
      this.add('legion' + side, '#a8201a', leg, legionary, {
        spot: { x: col.x + side * (col.rx + 5), z: col.z + 4, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2 },
        role: { name: side < 0 ? 'Centurion Marcus' : 'Legionary Gaius', lines: ['Ave! The chariots race round the arena all day. Hop on at the west end!', 'Ride with the camel caravan by the pyramids.', 'The oasis has the best fishing in the desert.'] },
      });
    }
    this.add('legion-march', '#a8201a', leg, legionary, { loop: [[-40, 250], [-40, 380], [-30, 380], [-30, 250]], speed: 1.4, role: { name: 'Legionary Titus', lines: ['Left, right, left, right…', 'Climb the step pyramid. The view from the top is worth it.'] } });
    this.add('merchant', '#d8b05a', { pants: '#f0e8d8' }, () => {}, { spot: { x: ANCIENT.oasis.x - 6, z: ANCIENT.oasis.z - ANCIENT.oasis.r - 7, yaw: Math.PI }, role: { name: 'Nefret the Merchant', idle: 'Idle_Talking_Loop', lines: ['Dates! Figs! Finest silks from the east!', 'They say the Sphinx guards a golden scarab at its feet.'] } });

    // Explorers by the igloos, and at the lost temple.
    const parka: Outfit = { pants: '#2a3442', shoes: '#3a2a1e' };
    this.add('explorer1', '#d8501a', parka, explorer, { spot: { x: ARCTIC.camp.x + 3, z: ARCTIC.camp.z + 2, yaw: -2 }, role: { name: 'Musher Anja', lines: ['Brrr! Stay near a fire or you’ll freeze solid.', 'The dog sleds leave from the camp. Hop on and hold tight!', 'There’s an ice-fishing hole by the red hut on the lake.'] } });
    this.add('explorer2', '#2a6ad8', parka, explorer, { loop: [[ARCTIC.camp.x - 20, ARCTIC.camp.z], [ARCTIC.camp.x, ARCTIC.camp.z + 20], [ARCTIC.camp.x + 20, ARCTIC.camp.z]], speed: 0.9, role: { name: 'Professor Frost', lines: ['The northern lights are best around midnight.', 'Lost? Fire the signal flare at the outpost.'] } });
    const jt = JUNGLE.temple;
    const safari: Outfit = { pants: '#8a7a5a', shoes: '#4a3a2a' };
    this.add('adventurer1', '#c8b48a', safari, adventurer, { loop: [[jt.x - 25, jt.z + 22], [jt.x + 25, jt.z + 22], [jt.x + 25, jt.z + 26]], speed: 1.1, role: { name: 'Dr. Jones', lines: ['The temple has a hidden chamber. The way in is on the east side.', 'Take the zipline from the top of the temple down to the lagoon!'] } });
    this.add('adventurer2', '#a89a72', safari, adventurer, { spot: { x: jt.x + 6, z: jt.z + jt.base / 2 + 4, yaw: Math.PI }, role: { name: 'Lara', lines: ['Strike the gong at the top. The whole jungle hears it.', 'Something glitters in the pool under the waterfall…'] } });
    this.add('torchbearer', '#8a6a3a', safari, adventurer, { spot: { x: jt.x - 3, z: jt.z - 2, yaw: 1.2 }, role: { name: 'Guide Mateo', idle: 'Idle_Torch_Loop', lines: ['Shh! This chamber hasn’t been opened in a thousand years.', 'The idol glows on its own. Spooky, no?'] } });

    // City folk walking the neon sidewalks, and dancers at the night market.
    const jackets = ['#ff2a8a', '#2af0ff', '#b44aff', '#ffe02a', '#1a1a20', '#2aff8a'];
    const cityNames = ['Kai', 'Nova', 'Rex', 'Juno', 'Zed', 'Pixel'];
    const cityLines = [
      'Take the monorail. Elevators up are at Neon Central and Circuit Station.',
      'There’s a neon bounce pad that throws you onto the Skypark roof.',
      'Fireworks on top of the Helix? Best view in the city.',
      'It never stops raining here. I kind of like it.',
    ];
    CYBERPUNK.blocks.slice(0, 12).forEach(([x0, z0, x1, z1], i) => {
      if (i % 2) return;
      const path: [number, number][] = [
        [x0 + 1.2, z0 + 1.2],
        [x1 - 1.2, z0 + 1.2],
        [x1 - 1.2, z1 - 1.2],
        [x0 + 1.2, z1 - 1.2],
      ];
      this.add(`citizen${i}`, jackets[i % jackets.length], { pants: '#1a1a22' }, cyber, { loop: i % 4 ? path : [...path].reverse(), speed: 1.4, offset: i * 20, floor: 0.15, role: { name: cityNames[i / 2], lines: [cityLines[(i / 2) % 4], cityLines[(i / 2 + 1) % 4]] } });
    });
    const mk = CYBERPUNK.market;
    for (let i = 0; i < 3; i++) {
      this.add(`dancer${i}`, jackets[(i + 2) % jackets.length], { pants: '#1a1a22' }, cyber, { spot: { x: mk.x - 8 + i * 4, z: mk.z + 8 + (i % 2) * 2, yaw: Math.PI }, floor: 0.15, role: { name: ['DJ Volt', 'Glitch', 'Neon'][i], idle: 'Dance_Loop', lines: ['Can you feel the bass? Press G and dance with us!', 'The night market never closes.'] } });
    }

    // Townsfolk: out for a walk round the blocks, a jogger in the park, the mayor by the fireworks.
    const town = generateTown();
    const sidewalk = (r: { minX: number; minZ: number; maxX: number; maxZ: number }): [number, number][] => [
      [r.minX - 1, r.minZ - 1],
      [r.maxX + 1, r.minZ - 1],
      [r.maxX + 1, r.maxZ + 1],
      [r.minX - 1, r.maxZ + 1],
    ];
    const townsfolk = ['Mrs. Patel', 'Mr. Okoye', 'Lily', 'Sam', 'Grandpa Joe', 'Maria', 'Ben'];
    const shirts = ['#5a8ad8', '#d85a5a', '#5ad88a', '#e8c040', '#a07ad8', '#e8e8e8', '#3a3a3a'];
    const townLines = [
      'Lovely day for a drive.',
      'Have you been to the castle up north? There’s a trebuchet that throws people over the walls!',
      'My cousin rides dinosaurs in Primeval Valley. Can you believe it?',
      'Press J to see your journal of treasures and fish.',
      'The monorail in Neon Spire has the best view in the world.',
      'I lost my grandpa’s pocket watch near the north highway…',
      'Go and see the fountain in the park. Someone threw a penny in it.',
    ];
    town.blocks.forEach((r, i) => {
      if (i >= townsfolk.length + 1 || r === town.park) return;
      const n = i > 4 ? i - 1 : i;
      const loop = sidewalk(r);
      this.add(`townsfolk${i}`, shirts[n % shirts.length], {}, () => {}, { loop: i % 2 ? loop : [...loop].reverse(), speed: 1.1 + (i % 3) * 0.15, offset: i * 37, floor: CURB, role: { name: townsfolk[n], lines: [townLines[n], townLines[(n + 3) % townLines.length]] } });
    });
    const p = town.park;
    this.add('jogger', '#ff7a2a', { pants: '#1a1a1a' }, () => {}, { loop: [[p.minX + 3, p.minZ + 3], [p.maxX - 3, p.minZ + 3], [p.maxX - 3, p.maxZ - 3], [p.minX + 3, p.maxZ - 3]], speed: 3.2, floor: CURB, role: { name: 'Jess', lines: ['Can’t stop! Training for the chariot races!', 'Three more laps!'] } });
    this.add('dancer-town', '#e84ad8', {}, () => {}, { spot: { x: PARK_FOUNTAIN.x + 5, z: PARK_FOUNTAIN.z + 5, yaw: -2.4 }, floor: CURB, role: { name: 'Zoe', idle: 'Dance_Loop', lines: ['The music’s in my head! Press G and dance with me!'] } });
    this.add('mayor', '#2a3a5a', { pants: '#2a2a30' }, () => {}, {
      spot: { x: 3, z: -11, yaw: Math.PI * 0.8 },
      floor: CURB,
      role: {
        name: 'Mayor Ada',
        lines: [
          'Welcome to Tengame Town! Light the fireworks rack and the whole town sees the show.',
          'Eight lands lie beyond the highways. Follow any road out of town!',
          `There are relics hidden all over: three in town, five in every land. Press J to see the riddles.`,
        ],
      },
    });
  }

  private add(seed: string, shirt: string, outfit: Outfit, gear: Gear, opts: { loop?: [number, number][]; spot?: { x: number; z: number; yaw: number }; speed?: number; offset?: number; floor?: number; role: Role }): void {
    const { loop, spot = { x: 0, z: 0, yaw: 0 }, speed = 1.2, offset = 0, floor, role } = opts;
    const avatar = new AvatarModel(shirt, seed, outfit);
    avatar.onHuman = gear;
    const path = loop ? new THREE.CatmullRomCurve3(loop.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'catmullrom', 0.1) : null;
    this.group.add(avatar.root);
    const npc: Npc = { id: seed, avatar, role, path, spot, speed, walked: offset, floor, talking: 0, line: 0, bubble: null, saying: 0, knock: null, hurt: 0 };
    this.npcs.push(npc);
    // Walk up and press E to chat.
    game.activities.add({
      get position() {
        return avatar.root.position;
      },
      reach: 2.6,
      prompt: () => (avatar.root.visible && game.player.onFoot && !npc.knock ? { action: `Talk to ${role.name}` } : null),
      use: () => this.talk(npc),
    });
    // Drive into them and they go flying.
    game.impacts.addMoving({
      at: (out) => (avatar.root.visible && !npc.knock ? out.copy(avatar.root.position) : null),
      radius: 0.35,
      height: 1.8,
      minSpeed: 1.2,
      mass: 80,
      harm: 0.03,
      hit: (car) => this.knockOver(npc, flingFrom(car), true),
    });
    // Another player's car knocking them over reaches them here (if they're anywhere near us).
    game.knockables.set(`npc:${seed}`, (v) => {
      if (!npc.knock && avatar.root.visible) this.knockOver(npc, v, false);
    });
  }

  /** Sends someone flying at `v` (m/s); if it was our car, the other players are told. */
  private knockOver(n: Npc, v: THREE.Vector3Like, mine: boolean): void {
    n.avatar.fling(this.physics, v);
    n.knock = { phase: 'fly', t: 0 };
    n.talking = n.saying = 0;
    this.hideBubble(n);
    if (mine) game.knock(`npc:${n.id}`, v);
    game.sounds?.thud(n.avatar.root.position, Math.min(1, Math.hypot(v.x, v.y, v.z) / 15));
  }

  /** Where someone belongs: their spot, or the point on their walk they'd got to. */
  private home(n: Npc, out: THREE.Vector3): THREE.Vector3 {
    if (!n.path) return out.set(n.spot.x, 0, n.spot.z);
    const length = n.path.getLength();
    return n.path.getPointAt((((n.walked % length) + length) % length) / length, out);
  }

  /** The floor or ground under `p`. */
  private ground(n: Npc, p: THREE.Vector3Like): number {
    return groundUnder(this.physics, p, (x, z) => n.floor ?? this.terrain.heightAt(x, z));
  }

  /** Flying limp, lying there, getting up, and limping back to where they were. */
  private recover(n: Npc, dt: number, camera: THREE.Vector3): void {
    const k = n.knock!;
    const a = n.avatar;
    k.t += dt;
    let speed = 0;
    if (k.phase === 'fly' || k.phase === 'down') {
      const hard = a.takeImpact();
      if (hard > 0.2) game.sounds?.thud(a.hips(), hard * 0.6);
      if (k.phase === 'fly' && a.resting) {
        k.phase = 'down';
        k.t = 0;
      } else if (k.phase === 'down' && k.t > DOWN_SECONDS) {
        a.getUp(this.ground(n, a.hips()));
        k.phase = 'up';
        k.t = 0;
      }
    } else if (k.phase === 'up') {
      if (!a.rising) {
        k.phase = 'back';
        k.t = 0;
        this.say(n, OUCH[Math.floor(Math.random() * OUCH.length)]);
      }
    } else {
      const p = a.root.position;
      const home = this.home(n, new THREE.Vector3());
      const dx = home.x - p.x;
      const dz = home.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3 || k.t > 60) {
        n.knock = null;
        n.hurt = HURT_SECONDS;
        return;
      }
      speed = LIMP_SPEED;
      const step = Math.min(d, speed * dt);
      p.x += (dx / d) * step;
      p.z += (dz / d) * step;
      p.y = this.ground(n, p);
      const yaw = Math.atan2(dx, dz);
      const cur = a.root.rotation.y;
      a.root.rotation.y = cur + Math.atan2(Math.sin(yaw - cur), Math.cos(yaw - cur)) * Math.min(1, dt * 6);
    }
    const p = a.root.position;
    const near = (p.x - camera.x) ** 2 + (p.z - camera.z) ** 2 < RANGE * RANGE;
    a.root.visible = a.root.matrixWorldAutoUpdate = near;
    if (!near) return;
    a.limp = k.phase === 'back' ? 1 : 0;
    a.animate(speed, dt);
  }

  /** Shows something said in passing over their head for a few seconds. */
  private say(n: Npc, text: string): void {
    this.showBubble(n, text);
    n.saying = 5;
  }

  private hideBubble(n: Npc): void {
    if (!n.bubble) return;
    n.bubble.visible = false;
    n.bubble.element.replaceChildren();
  }

  /** Says the next line, turning to face the player. */
  private talk(n: Npc): void {
    const line = n.role.lines[n.line % n.role.lines.length];
    n.line++;
    n.talking = TALK_SECONDS;
    this.showBubble(n, line);
  }

  private showBubble(n: Npc, line: string): void {
    if (!n.bubble) {
      const el = document.createElement('div');
      el.className = 'speech';
      n.bubble = new Label(el);
      n.bubble.position.y = 2.25;
      n.avatar.root.add(n.bubble);
    }
    const el = n.bubble.element;
    el.replaceChildren();
    const who = document.createElement('strong');
    who.textContent = n.role.name;
    el.append(who, line);
    n.bubble.visible = true;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    const me = game.player.position;
    for (const n of this.npcs) {
      if (n.saying > 0 && (n.saying -= dt) <= 0 && n.talking <= 0) this.hideBubble(n);
      if (n.knock) {
        this.recover(n, dt, camera);
        continue;
      }
      let x = n.spot.x;
      let z = n.spot.z;
      let yaw = n.spot.yaw;
      let speed = 0;
      if (n.talking > 0) {
        n.talking -= dt;
        // Walked off: stop talking.
        if (Math.hypot(me.x - n.avatar.root.position.x, me.z - n.avatar.root.position.z) > 6) n.talking = Math.min(n.talking, 0.5);
        if (n.talking <= 0 && n.saying <= 0) this.hideBubble(n);
      }
      // Still sore after being knocked over: slower, limping.
      if (n.hurt > 0) n.hurt -= dt;
      const pace = n.hurt > 0 ? Math.min(n.speed, LIMP_SPEED) : n.speed;
      if (n.path) {
        if (n.talking <= 0) n.walked += pace * dt;
        const length = n.path.getLength();
        const u = ((n.walked % length) + length) % length / length;
        n.path.getPointAt(u, p);
        n.path.getPointAt((u + 0.5 / length) % 1, ahead);
        [x, z] = [p.x, p.z];
        yaw = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        speed = n.talking > 0 ? 0 : pace;
      }
      if (n.talking > 0) yaw = Math.atan2(me.x - x, me.z - z);
      const near = (x - camera.x) ** 2 + (z - camera.z) ** 2 < RANGE * RANGE;
      // Far away, skip them entirely: each person is some eighty bones and parts to place.
      n.avatar.root.visible = n.avatar.root.matrixWorldAutoUpdate = near;
      if (!near) continue;
      const y = n.floor ?? this.terrain.heightAt(x, z);
      n.avatar.root.position.set(x, y, z);
      // Turn smoothly (toward the player, or along the path).
      const cur = n.avatar.root.rotation.y;
      n.avatar.root.rotation.y = cur + Math.atan2(Math.sin(yaw - cur), Math.cos(yaw - cur)) * Math.min(1, dt * 6);
      n.avatar.action = n.talking > 0 ? 'Idle_Talking_Loop' : speed > 0 ? null : (n.role.idle ?? null);
      n.avatar.limp = n.hurt > 0 ? Math.min(1, n.hurt / 5) : 0;
      n.avatar.animate(speed, dt);
    }
  }
}
