// Emerald Jungle (west): dense rainforest on rolling hills, a river from a waterfall to a
// lagoon, a rope bridge, and a lost temple overgrown with vines.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { beyondEdge, circle, distanceToPath, type Fire, makeRoad, type Pad, type ZoneLayout } from '../worldKit.ts';

export const JUNGLE = {
  x: -400,
  z: 0,
  riverLevel: -1.2,
  riverWidth: 16,
  /** The plateau the waterfall drops from, west of this x. */
  cliffX: -566,
  plateau: 22,
  falls: { x: -566, z: -50 },
  lagoon: { x: -360, z: 72, r: 32 },
  temple: { x: -505, z: -156, base: 30, tiers: 5, height: 18 },
  bridge: { from: { x: -462, z: -26 }, to: { x: -455, z: -74 } },
  /** A zipline from the top of the temple, over the canopy, down to the lagoon. */
  zipline: { from: { x: -500.5, y: 18, z: -151.5 }, to: { x: -399, z: 58 } },
} as const;

/** The river's course, from the foot of the falls to the lagoon. */
export const RIVER = makeRoad('river', 'dirt', JUNGLE.riverWidth, [
  [-562, -48],
  [-520, -40],
  [-470, -55],
  [-420, -30],
  [-380, 10],
  [-364, 50],
  [-360, 72],
]).path;

/** The stream on the plateau above the falls. */
export const UPPER_RIVER = makeRoad('stream', 'dirt', 10, [
  [-700, -70],
  [-640, -58],
  [-566, -50],
]).path;

export function jungleLayout(): ZoneLayout {
  const J = JUNGLE;
  const trail = makeRoad('Jungle Trail', 'dirt', 7, [
    [-200, 20],
    [-280, 15],
    [-340, -20],
    [-400, -62],
    [-450, -100],
    [-490, -124],
  ]);
  const northTrack = makeRoad('North Track', 'dirt', 7, [
    [-300, -200],
    [-300, -120],
    [-328, -62],
    [-340, -20],
  ]);
  const b = J.bridge;
  const canopyRoad = makeRoad(
    'Canopy Road',
    'dirt',
    7,
    [
      [-480, 200],
      [-480, 90],
      [-466, 20],
      [b.from.x, b.from.z],
      [b.to.x, b.to.z],
      [-450, -100],
    ],
    { bridges: [3] },
  );
  const lagoonRoad = makeRoad('Lagoon Road', 'dirt', 7, [
    [-330, 200],
    [-330, 140],
    [-298, 104],
    [-272, 60],
    [-280, 15],
  ]);
  const t = J.temple;
  const pads: Pad[] = [
    { shape: { type: 'rect', minX: t.x - 34, maxX: t.x + 34, minZ: t.z - 28, maxZ: t.z + 30 }, y: 0, margin: 12 },
    { shape: circle(J.lagoon.x, J.lagoon.z, J.lagoon.r - 4), y: -3.6, margin: 10 },
  ];
  const fires: Fire[] = [
    { id: 'jungle/temple', x: t.x + 8, y: 0, z: t.z + t.base / 2 + 8 },
    { id: 'jungle/lagoon', x: J.lagoon.x + J.lagoon.r + 9, y: 0, z: J.lagoon.z - 8 },
  ];
  pads.push({ shape: circle(fires[1].x, fires[1].z, 4), y: 0, margin: 6 });
  return {
    id: 'jungle',
    roads: [trail, northTrack, canopyRoad, lagoonRoad],
    pads,
    waters: [
      { kind: 'water', level: J.riverLevel, shape: { type: 'path', path: RIVER, width: J.riverWidth } },
      { kind: 'water', level: J.riverLevel, shape: circle(J.lagoon.x, J.lagoon.z, J.lagoon.r) },
      { kind: 'water', level: J.plateau - 1.4, shape: { type: 'path', path: UPPER_RIVER, width: 10 } },
    ],
    houses: [],
    landmarks: [
      { name: 'Lost Temple', x: t.x, z: t.z, r: 36 },
      { name: 'Thunder Falls', x: J.falls.x, z: J.falls.z, r: 30 },
      { name: 'Emerald Lagoon', x: J.lagoon.x, z: J.lagoon.z, r: J.lagoon.r + 8 },
      { name: 'Rope Bridge', x: (b.from.x + b.to.x) / 2, z: (b.from.z + b.to.z) / 2, r: 18 },
      { name: 'Zipline Landing', x: J.zipline.to.x, z: J.zipline.to.z, r: 10 },
    ],
    fires,
    ground(x, z) {
      let h = 5 * fbm(x / 80, z / 80, 3, 71) + 2 * fbm(x / 22, z / 22, 2, 72) + 2;
      // The plateau above the waterfall, with its stream.
      const plateau = smoothstep(-x, -J.cliffX - 4, -J.cliffX + 8);
      if (plateau > 0) {
        const stream = 1 - smoothstep(distanceToPath(UPPER_RIVER, x, z).distance, 4, 9);
        h += plateau * (J.plateau + 3 * ridged(x / 40, z / 40, 3, 73) - 3.5 * stream);
      }
      // The river valley.
      if (x > J.cliffX - 6) {
        const d = distanceToPath(RIVER, x, z).distance;
        const channel = 1 - smoothstep(d, J.riverWidth / 2 - 1, J.riverWidth / 2 + 9);
        h = h * (1 - channel) - 3.6 * channel;
      }
      h += smoothstep(beyondEdge(x, z), -40, 160) * (40 + 60 * ridged(x / 100, z / 100, 4, 74));
      return h;
    },
  };
}
