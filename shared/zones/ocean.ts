// Coral Bay (south-east): a fishing harbor with a lighthouse and a pier, and the sea
// beyond it: coral reefs, kelp, a shipwreck, sunken ruins, and a glass tunnel road down
// to a domed station on the sea floor.
import { fbm, smoothstep } from '../noise.ts';
import { CURB_HEIGHT } from '../town.ts';
import { circle, housePad, makeRoad, type Pad, SEA_LEVEL, type Shape, type ZoneLayout, zoneHouse } from '../worldKit.ts';

export const OCEAN = {
  x: 400,
  z: 400,
  harborZ: 250,
  lighthouse: { x: 482, z: 274, y: 1.6 },
  pier: { x: 340, z0: 256, z1: 336, width: 5, y: 0.9 },
  galleon: { x: 396, z: 322, yaw: 1.2 },
  dome: { x: 497, z: 487, r: 27, y: -16 },
  ruins: { x: 425, z: 565, r: 48 },
  wreck: { x: 562, z: 372, yaw: 0.7 },
  kelp: { x: 300, z: 478, r: 34 },
  reefs: [
    { x: 362, z: 330, r: 30 },
    { x: 300, z: 540, r: 34 },
    { x: 525, z: 420, r: 30 },
    { x: 560, z: 250, r: 26 },
  ],
  trench: { x: 572, z: 565 },
} as const;

const PASTELS = ['#9fc6d8', '#e8c5c0', '#f0e2b0', '#b9d8bf', '#d8d2e8', '#f4f0e8'];
const ROOFS = ['#3b4a5a', '#7a3a32', '#4a5a48'];
const DOORS = ['#2e4a7a', '#b8452e', '#f2efe8', '#2f5e44'];

/** How far (x, z) is from the shore's inland side: small on land, larger out to sea. */
function coastDistance(x: number, z: number): number {
  return Math.min(x - 200, z - 200) + 10 * fbm(x / 60, z / 60, 2, 41);
}

export function oceanLayout(): ZoneLayout {
  const { harborZ } = OCEAN;
  const lh = OCEAN.lighthouse;
  const harborRoad = makeRoad(
    'Harbor Road',
    'asphalt',
    8,
    [
      [200, harborZ],
      [290, harborZ],
      [380, harborZ],
      [440, harborZ + 4, 0.4],
      [lh.x - 12, lh.z - 2, lh.y],
    ],
    { lines: true },
  );
  const d = OCEAN.dome;
  // The tunnel road dives from the shore to the station on the sea floor.
  const tunnel = makeRoad(
    'Abyss Tunnel',
    'metal',
    8,
    [
      [200, 360],
      [252, 360],
      [292, 372, -1.6],
      [332, 392, -6.5],
      [372, 420, -11.5],
      [412, 448, -15],
      [452, 468, d.y],
      [d.x - d.r * 0.82, d.z - d.r * 0.45, d.y],
    ],
    { lines: true },
  );
  const house = (i: number, x: number) =>
    zoneHouse(`ocean-h${i}`, {
      address: `${i * 2 + 1} Harbor Road`,
      roadZ: harborZ,
      roadWidth: 8,
      x,
      side: 'north',
      style: 'siding',
      roof: 'shingles',
      wallColors: PASTELS,
      roofColors: ROOFS,
      doorColors: DOORS,
    });
  const houses = [house(0, 232), house(1, 270), house(2, 308), house(3, 346), house(4, 384)];
  const pads: Pad[] = [
    { shape: circle(lh.x, lh.z, 9), y: lh.y, margin: 14 },
    { shape: circle(d.x, d.z, d.r + 2), y: d.y, margin: 16 },
    ...houses.map((h) => housePad(h, CURB_HEIGHT)),
  ];
  // Inside the tunnel and the dome it's dry.
  const dry: Shape[] = [
    { type: 'path', path: tunnel.path, width: 10 },
    circle(d.x, d.z, d.r),
  ];
  return {
    id: 'ocean',
    roads: [harborRoad, tunnel],
    pads,
    waters: [{ kind: 'sea', level: SEA_LEVEL, shape: { type: 'rect', minX: 200, minZ: 200, maxX: 1200, maxZ: 1200 }, except: dry }],
    houses,
    landmarks: [
      { name: 'Coral Bay Harbor', x: 300, z: 240, r: 70 },
      { name: 'Old Lighthouse', x: lh.x, z: lh.z, r: 22 },
      { name: 'The Pier', x: OCEAN.pier.x, z: (OCEAN.pier.z0 + OCEAN.pier.z1) / 2, r: 30 },
      { name: 'Abyss Tunnel', x: 340, z: 398, r: 40 },
      { name: 'Atlantis Station', x: d.x, z: d.z, r: d.r + 8 },
      { name: 'Sunken City', x: OCEAN.ruins.x, z: OCEAN.ruins.z, r: OCEAN.ruins.r + 6 },
      { name: 'Shipwreck', x: OCEAN.wreck.x, z: OCEAN.wreck.z, r: 26 },
      { name: 'Kelp Forest', x: OCEAN.kelp.x, z: OCEAN.kelp.z, r: OCEAN.kelp.r + 6 },
      ...OCEAN.reefs.map((r) => ({ name: 'Coral Reef', x: r.x, z: r.z, r: r.r + 4 })),
    ],
    fires: [],
    ground(x, z) {
      const coast = coastDistance(x, z);
      let h = 0.5 + 0.5 * fbm(x / 40, z / 40, 2, 43);
      // Beach, then the sea floor sloping away into the deep.
      h -= 3.3 * smoothstep(coast, 52, 95) + 12.5 * smoothstep(coast, 95, 240) + 5 * smoothstep(coast, 300, 500);
      // Coral mounds and rocks on the bottom.
      h += 2.4 * Math.max(0, fbm(x / 26, z / 26, 3, 42)) * smoothstep(coast, 100, 130);
      // A deep trench far out, and a rocky cape for the lighthouse.
      h -= 6 * Math.exp(-((x - OCEAN.trench.x) ** 2 + (z - OCEAN.trench.z) ** 2) / 3600);
      h += 3.5 * Math.max(0, 1 - Math.hypot(x - lh.x, z - lh.z) / 42) ** 1.5;
      return h;
    },
  };
}
