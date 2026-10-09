// Things to do out in the world: buttons everyone shares (bells, cannons, fireworks),
// hidden relics to find, and fishing spots. Shared so the server can check players are
// standing by a button before everyone hears it, and so tests can check where things are.
import { CURB_HEIGHT, PARK_FOUNTAIN } from './town.ts';
import { distanceToPath, generateWorld, groundHeight, SEA_LEVEL, type ZoneId } from './world.ts';
import { ANCIENT } from './zones/ancient.ts';
import { ARCTIC } from './zones/arctic.ts';
import { CYBERPUNK } from './zones/cyberpunk.ts';
import { JUNGLE } from './zones/jungle.ts';
import { MEDIEVAL } from './zones/medieval.ts';
import { OCEAN } from './zones/ocean.ts';
import { PREHISTORIC } from './zones/prehistoric.ts';
import { SPACE } from './zones/space.ts';

// ---------------------------------------------------------------------------
// Shared buttons: one player presses, everyone sees and hears what happens.

export type TriggerKind = 'bell' | 'gong' | 'horn' | 'cannon' | 'trebuchet' | 'fireworks' | 'flare';

export interface Trigger {
  id: string;
  kind: TriggerKind;
  /** What pressing E does, e.g. "Ring the bell". */
  label: string;
  /** Where you stand to use it (feet). */
  x: number;
  y: number;
  z: number;
  /** Seconds before anyone in the room can use it again. */
  cooldown: number;
}

/** How close (horizontally) you must stand to a trigger. The server allows some slack. */
export const TRIGGER_REACH = 2.5;

const onGround = (x: number, z: number) => groundHeight(x, z);

export const TRIGGERS: Trigger[] = [
  { id: 'medieval/bell', kind: 'bell', label: 'Ring the bell', x: MEDIEVAL.bellTower.x, y: 0, z: MEDIEVAL.bellTower.z + 2.6, cooldown: 4 },
  {
    id: 'medieval/trebuchet',
    kind: 'trebuchet',
    label: 'Climb in the trebuchet and fire!',
    x: MEDIEVAL.trebuchet.x - 6.2,
    y: MEDIEVAL.trebuchet.y,
    z: MEDIEVAL.trebuchet.z,
    cooldown: 4,
  },
  { id: 'jungle/gong', kind: 'gong', label: 'Strike the gong', x: JUNGLE.temple.x - 4.4, y: JUNGLE.temple.height, z: JUNGLE.temple.z + 5.6, cooldown: 4 },
  { id: 'ocean/horn', kind: 'horn', label: 'Sound the foghorn', x: OCEAN.lighthouse.x, y: OCEAN.lighthouse.y, z: OCEAN.lighthouse.z + 4.8, cooldown: 6 },
  { id: 'ocean/cannon', kind: 'cannon', label: 'Climb in the cannon and fire!', x: OCEAN.cannon.x + 2.6, y: OCEAN.lighthouse.y, z: OCEAN.cannon.z - 1.0, cooldown: 4 },
  { id: 'town/fireworks', kind: 'fireworks', label: 'Light the fireworks', x: 0, y: CURB_HEIGHT, z: -14, cooldown: 25 },
  {
    id: 'cyberpunk/fireworks',
    kind: 'fireworks',
    label: 'Light the fireworks',
    x: CYBERPUNK.helix.x,
    y: CYBERPUNK.helix.rise * CYBERPUNK.helix.turns,
    z: CYBERPUNK.helix.z - (CYBERPUNK.helix.inner + CYBERPUNK.helix.outer) / 2,
    cooldown: 25,
  },
  { id: 'arctic/flare', kind: 'flare', label: 'Fire a signal flare', x: ARCTIC.flare.x, y: onGround(ARCTIC.flare.x, ARCTIC.flare.z), z: ARCTIC.flare.z, cooldown: 12 },
];

export const TRIGGERS_BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// Relics: treasures hidden all over the world, five in each zone and three in town.

export interface Relic {
  id: string;
  zone: ZoneId;
  name: string;
  /** A riddle about where it is, shown in the journal until it's found. */
  hint: string;
  /** Where it floats (its middle). */
  x: number;
  y: number;
  z: number;
}

/** A relic hovering just above the ground at (x, z). */
const low = (x: number, z: number, lift = 0.7) => ({ x, y: groundHeight(x, z) + lift, z });

/** Height of a road's surface (bridges included) nearest (x, z). */
function roadY(name: string, x: number, z: number): number {
  const road = generateWorld().roads.find((r) => r.name === name)!;
  const { index, t } = distanceToPath(road.path, x, z);
  const a = road.path[index];
  const b = road.path[Math.min(index + 1, road.path.length - 1)];
  return a.y + (b.y - a.y) * t;
}

const k = MEDIEVAL.keep;
const hall = { back: k.z - k.d / 2 + 1.6, tables: k.z + 1 };
const t = JUNGLE.temple;
const L = JUNGLE.lagoon;
const col = ANCIENT.colosseum;
const sp = ANCIENT.stepPyramid;
const par = ANCIENT.parthenon;
const hab = SPACE.habitat;
const crater = SPACE.craters[0];
const cave = PREHISTORIC.cave;
const fossils = PREHISTORIC.fossils;
const spring = PREHISTORIC.springs[0];
const helixTop = CYBERPUNK.helix.rise * CYBERPUNK.helix.turns;
const R = (CYBERPUNK.helix.inner + CYBERPUNK.helix.outer) / 2;
const sky = CYBERPUNK.skypark;
const station = CYBERPUNK.stations[0];

/** The middle of the jungle's rope bridge, a little above its planks. */
function bridgeMiddle(): { x: number; y: number; z: number } {
  const x = (JUNGLE.bridge.from.x + JUNGLE.bridge.to.x) / 2;
  const z = (JUNGLE.bridge.from.z + JUNGLE.bridge.to.z) / 2;
  return { x, y: roadY('Canopy Road', x, z) + 0.8, z };
}

export const RELICS: Relic[] = [
  // Tengame Town.
  { id: 'town/penny', zone: 'town', name: 'Lucky Penny', hint: 'Someone made a wish in the park fountain.', x: PARK_FOUNTAIN.x, y: CURB_HEIGHT + 0.9, z: PARK_FOUNTAIN.z + 1.6 },
  { id: 'town/watch', zone: 'town', name: 'Grandpa’s Pocket Watch', hint: 'Under the trees at the edge of town, where the north highway begins.', ...low(-40, -178) },
  { id: 'town/key', zone: 'town', name: 'Golden Key', hint: 'High in the air over the park. Jump a car off a ramp!', x: 0, y: CURB_HEIGHT + 3.4, z: 0 },
  // Frostfang Tundra.
  { id: 'arctic/compass', zone: 'arctic', name: 'Explorer’s Compass', hint: 'Warm and snug inside an igloo.', x: ARCTIC.igloos[1].x, y: 0.5, z: ARCTIC.igloos[1].z },
  { id: 'arctic/tusk', zone: 'arctic', name: 'Frozen Mammoth Tusk', hint: 'Out on the frozen lake, among the ice.', x: ARCTIC.lake.x - 12, y: 0.7, z: ARCTIC.lake.z + 20 },
  { id: 'arctic/shard', zone: 'arctic', name: 'Aurora Shard', hint: 'Where they watch the northern lights.', ...low(ARCTIC.observatory.x + 4, ARCTIC.observatory.z + 12) },
  { id: 'arctic/globe', zone: 'arctic', name: 'Snow Globe', hint: 'At the foot of the radio mast.', ...low(ARCTIC.flare.x + 6, ARCTIC.flare.z - 4) },
  { id: 'arctic/yeti', zone: 'arctic', name: 'Yeti Footprint', hint: 'Deep in the snowy forest, south of the lake.', ...low(-560, -228) },
  // Kingdom of Eldermoor.
  { id: 'medieval/chalice', zone: 'medieval', name: 'Golden Chalice', hint: 'On the feast table in the great hall.', x: k.x - 5, y: 1.15, z: hall.tables - 3 },
  { id: 'medieval/crown', zone: 'medieval', name: 'King’s Crown', hint: 'Beside the throne.', x: k.x + 2.4, y: 1.1, z: hall.back + 1.6 },
  { id: 'medieval/scale', zone: 'medieval', name: 'Dragon Scale', hint: 'Behind the old windmill on the hill.', ...low(MEDIEVAL.windmill.x, MEDIEVAL.windmill.z - 7) },
  { id: 'medieval/lance', zone: 'medieval', name: 'Champion’s Lance Tip', hint: 'In the top row of the tournament stands.', x: MEDIEVAL.tournament.x + 8, y: 2.5, z: MEDIEVAL.tournament.z - MEDIEVAL.tournament.d / 2 - 6.6 },
  { id: 'medieval/coin', zone: 'medieval', name: 'Wishing Coin', hint: 'By the village well.', ...low(MEDIEVAL.well.x + 1.9, MEDIEVAL.well.z) },
  // Outpost Nova.
  { id: 'space/crystal', zone: 'space', name: 'Singing Crystal', hint: 'Among the solar panels, where the power is made.', ...low(SPACE.solar.x, SPACE.solar.z + 3) },
  { id: 'space/meteorite', zone: 'space', name: 'Meteorite', hint: 'At the bottom of the Great Crater.', ...low(crater.x, crater.z) },
  { id: 'space/patch', zone: 'space', name: 'Mission Patch', hint: 'By the hologram, inside the habitat.', x: hab.x + 2.6, y: 1.0, z: SPACE.domes[0].z + 2.6 },
  { id: 'space/starmap', zone: 'space', name: 'Star Map', hint: 'Under the biggest radio dish.', ...low(SPACE.array.x + 3, SPACE.array.z + 6) },
  { id: 'space/moonrock', zone: 'space', name: 'Moon Rock', hint: 'Next to the rocket on the launch pad.', ...low(SPACE.launchPad.x - 9, SPACE.launchPad.z + 9) },
  // Emerald Jungle.
  { id: 'jungle/idol', zone: 'jungle', name: 'Jade Idol', hint: 'In the temple’s hidden chamber.', x: t.x + 1.4, y: 1.0, z: t.z + 1.4 },
  { id: 'jungle/mask', zone: 'jungle', name: 'Golden Mask', hint: 'Behind the shrine at the top of the temple.', x: t.x, y: t.height + 0.7, z: t.z - 4.8 },
  { id: 'jungle/journal', zone: 'jungle', name: 'Explorer’s Journal', hint: 'By the ranger’s tent at the lagoon.', ...low(L.x + L.r + 11, L.z - 2) },
  { id: 'jungle/feather', zone: 'jungle', name: 'Rainbow Feather', hint: 'In the pool beneath the waterfall.', ...low(JUNGLE.falls.x + 1.2, JUNGLE.falls.z + 3) },
  { id: 'jungle/coin', zone: 'jungle', name: 'Ancient Coin', hint: 'Halfway across the rope bridge.', ...bridgeMiddle() },
  // Neon Spire.
  { id: 'cyberpunk/chip', zone: 'cyberpunk', name: 'Data Chip', hint: 'At the top of the Helix, by the gap in the rail.', x: CYBERPUNK.helix.x - R + 1, y: helixTop + 0.7, z: CYBERPUNK.helix.z + 2 },
  { id: 'cyberpunk/tube', zone: 'cyberpunk', name: 'Neon Tube', hint: 'In the middle of the night market.', x: CYBERPUNK.market.x, y: CURB_HEIGHT + 0.7, z: CYBERPUNK.market.z },
  { id: 'cyberpunk/coin', zone: 'cyberpunk', name: 'Holo Coin', hint: 'Waiting on a monorail platform.', x: station.x - 9, y: CYBERPUNK.monorail.height + 1.7, z: station.z - 5 },
  { id: 'cyberpunk/head', zone: 'cyberpunk', name: 'Robot Head', hint: 'At the foot of the Zenith Tower.', x: CYBERPUNK.zenith.x, y: CURB_HEIGHT + 0.7, z: CYBERPUNK.zenith.z + 24 },
  { id: 'cyberpunk/circuit', zone: 'cyberpunk', name: 'Golden Circuit', hint: 'In the rooftop park. Find the neon bounce pad.', x: sky.x + 8, y: sky.h + 0.9, z: sky.z + 6 },
  // Primeval Valley.
  { id: 'prehistoric/amber', zone: 'prehistoric', name: 'Amber Drop', hint: 'Deep in the Cave of Echoes.', ...low(cave.x, cave.z + 8) },
  { id: 'prehistoric/egg', zone: 'prehistoric', name: 'Dinosaur Egg', hint: 'In a nest where the long-necks graze.', ...low(-404, 392, 0.55) },
  { id: 'prehistoric/tooth', zone: 'prehistoric', name: 'T. rex Tooth', hint: 'Among the bones in the fossil field.', ...low(fossils.x - 6, fossils.z + 4) },
  { id: 'prehistoric/obsidian', zone: 'prehistoric', name: 'Obsidian Shard', hint: 'Up on the volcano, beside a river of lava.', ...low(-440, 465) },
  { id: 'prehistoric/pearl', zone: 'prehistoric', name: 'Hot Spring Pearl', hint: 'At the bottom of the biggest hot spring.', x: spring.x, y: -1.3, z: spring.z },
  // Valley of Empires.
  { id: 'ancient/wreath', zone: 'ancient', name: 'Laurel Wreath', hint: 'In the middle of the Colosseum’s arena.', ...low(col.x, col.z) },
  { id: 'ancient/owl', zone: 'ancient', name: 'Owl of Athena', hint: 'At the goddess’s feet, inside the Parthenon.', x: par.x, y: 2.2, z: par.z - (par.d - 12) / 2 + 6.4 },
  { id: 'ancient/jade', zone: 'ancient', name: 'Jade Mask', hint: 'In the temple at the top of the step pyramid.', x: sp.x, y: sp.height + 0.7, z: sp.z - 2.4 },
  { id: 'ancient/scarab', zone: 'ancient', name: 'Golden Scarab', hint: 'At the Sphinx’s feet.', ...low(ANCIENT.sphinx.x - 14.5, ANCIENT.sphinx.z) },
  { id: 'ancient/ankh', zone: 'ancient', name: 'Ankh', hint: 'Under the palms of the oasis.', ...low(ANCIENT.oasis.x + 22, ANCIENT.oasis.z + 8) },
  // Coral Bay.
  { id: 'ocean/doubloon', zone: 'ocean', name: 'Pirate Doubloon', hint: 'In the shipwreck’s treasure.', ...low(OCEAN.wreck.x - 6, OCEAN.wreck.z + 5, 0.8) },
  { id: 'ocean/pearl', zone: 'ocean', name: 'Giant Pearl', hint: 'Down in the coral reef by the galleon.', ...low(OCEAN.reefs[0].x - 4, OCEAN.reefs[0].z + 6, 0.8) },
  { id: 'ocean/trident', zone: 'ocean', name: 'Trident', hint: 'In the temple of the Sunken City.', ...low(OCEAN.ruins.x, OCEAN.ruins.z, 1.2) },
  { id: 'ocean/bottle', zone: 'ocean', name: 'Message in a Bottle', hint: 'Washed up on the beach.', ...low(425, 268, 0.5) },
  { id: 'ocean/shell', zone: 'ocean', name: 'Conch Shell', hint: 'In the garden under the sea dome.', x: OCEAN.dome.x + 5, y: OCEAN.dome.y + 0.8, z: OCEAN.dome.z - 5 },
];

export const RELICS_BY_ID = new Map(RELICS.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Fishing.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface Fish {
  name: string;
  rarity: Rarity;
  /** Weight range in kg. */
  kg: [number, number];
}

export interface FishingSpot {
  id: string;
  name: string;
  /** Where you stand (feet) and which way you face the water. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Where the float lands. */
  float: { x: number; y: number; z: number };
  fish: Fish[];
}

const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, uncommon: 26, rare: 11, legendary: 3 };

/** Where to stand `back` meters from (x, z), facing it from direction `yaw`. */
function spot(id: string, name: string, x: number, y: number, z: number, yaw: number, cast: number, waterY: number, fish: Fish[]): FishingSpot {
  return { id, name, x, y, z, yaw, float: { x: x + Math.sin(yaw) * cast, y: waterY, z: z + Math.cos(yaw) * cast }, fish };
}

const lakeHut = { x: ARCTIC.lake.x + 18, z: ARCTIC.lake.z - 14 };
const c = MEDIEVAL.castle;
const pier = OCEAN.pier;
const oasis = ANCIENT.oasis;

export const FISHING_SPOTS: FishingSpot[] = [
  spot('arctic/ice-hole', 'Ice-fishing hole', lakeHut.x + 1.2, 0.03, lakeHut.z + 3.4, 0.4, 2.2, 0.06, [
    { name: 'Arctic Char', rarity: 'common', kg: [0.8, 3] },
    { name: 'Lake Trout', rarity: 'common', kg: [1, 6] },
    { name: 'Burbot', rarity: 'uncommon', kg: [1, 4] },
    { name: 'Frost Pike', rarity: 'rare', kg: [4, 12] },
    { name: 'Crystal Sturgeon', rarity: 'legendary', kg: [20, 60] },
  ]),
  spot('medieval/moat', 'Castle moat', c.x + 9, groundHeight(c.x + 9, c.z + c.moatOuter + 3.4), c.z + c.moatOuter + 3.4, Math.PI, 6, c.moatLevel, [
    { name: 'Carp', rarity: 'common', kg: [1, 8] },
    { name: 'Perch', rarity: 'common', kg: [0.3, 1.5] },
    { name: 'Old Boot', rarity: 'uncommon', kg: [0.6, 1.2] },
    { name: 'Royal Pike', rarity: 'rare', kg: [3, 14] },
    { name: 'The King’s Lost Ring', rarity: 'legendary', kg: [0.01, 0.02] },
  ]),
  spot('jungle/lagoon', 'Emerald Lagoon', L.x + L.r, groundHeight(L.x + L.r, L.z + 10), L.z + 10, -Math.PI / 2, 5, JUNGLE.riverLevel, [
    { name: 'Peacock Bass', rarity: 'common', kg: [1, 5] },
    { name: 'Red-bellied Piranha', rarity: 'common', kg: [0.3, 1.2] },
    { name: 'Silver Arowana', rarity: 'uncommon', kg: [1, 4] },
    { name: 'Golden Dorado', rarity: 'rare', kg: [3, 15] },
    { name: 'Giant Arapaima', rarity: 'legendary', kg: [60, 180] },
  ]),
  spot('ocean/pier', 'End of the pier', pier.x, pier.y + 0.15, pier.z1 - 0.8, 0, 6, SEA_LEVEL, [
    { name: 'Mackerel', rarity: 'common', kg: [0.3, 1.5] },
    { name: 'Sea Bass', rarity: 'common', kg: [1, 6] },
    { name: 'Red Snapper', rarity: 'uncommon', kg: [1, 9] },
    { name: 'Swordfish', rarity: 'rare', kg: [40, 200] },
    { name: 'Golden Marlin', rarity: 'legendary', kg: [150, 450] },
  ]),
  spot('ancient/oasis', 'Desert oasis', oasis.x + oasis.r + 3, groundHeight(oasis.x + oasis.r + 3, oasis.z - 4), oasis.z - 4, -Math.PI / 2, 6, oasis.level, [
    { name: 'Tilapia', rarity: 'common', kg: [0.5, 2.5] },
    { name: 'Nile Catfish', rarity: 'common', kg: [1, 7] },
    { name: 'Tigerfish', rarity: 'uncommon', kg: [2, 9] },
    { name: 'Nile Perch', rarity: 'rare', kg: [10, 80] },
    { name: 'Pharaoh’s Golden Carp', rarity: 'legendary', kg: [5, 12] },
  ]),
];

/** Picks a fish from a spot's list (rarer ones less often), and its weight. `rng` gives 0..1. */
export function catchFish(spot: FishingSpot, rng: () => number): { fish: Fish; kg: number } {
  const total = spot.fish.reduce((sum, f) => sum + RARITY_WEIGHT[f.rarity], 0);
  let roll = rng() * total;
  let fish = spot.fish[0];
  for (const f of spot.fish) {
    roll -= RARITY_WEIGHT[f.rarity];
    if (roll <= 0) {
      fish = f;
      break;
    }
  }
  // Most fish are smallish; the odd one is a whopper.
  const [min, max] = fish.kg;
  const kg = min + (max - min) * rng() ** 2;
  return { fish, kg: Math.round(kg * 100) / 100 };
}
