// Frostfang Tundra (north-west): snowfields, a frozen lake, an igloo camp, a polar
// outpost and an aurora observatory, under glacier-covered mountains.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { CURB_HEIGHT } from '../town.ts';
import { beyondEdge, circle, type Fire, housePad, makeRoad, type Pad, type ZoneLayout, zoneHouse } from '../worldKit.ts';

export const ARCTIC = {
  x: -400,
  z: -400,
  lake: { x: -500, z: -350, r: 55 },
  igloos: [
    { x: -462, z: -255, yaw: 0.4 },
    { x: -495, z: -238, yaw: -0.3 },
    { x: -448, z: -228, yaw: 1.2 },
    { x: -512, z: -272, yaw: 2.4 },
  ],
  camp: { x: -478, z: -250 },
  observatory: { x: -290, z: -532 },
  /** Outpost Road runs east-west along this z. */
  outpostZ: -400,
} as const;

const LOG_WALLS = ['#8a6248', '#7a5640', '#9a7052'];
const SNOWY_ROOFS = ['#e9eef2', '#dfe6ec'];
const DOORS = ['#7a2e2e', '#2e4a7a', '#2f5e44'];

export function arcticLayout(): ZoneLayout {
  const { x: X, z: Z } = ARCTIC;
  const glacierRoad = makeRoad('Glacier Road', 'snow', 7, [
    [X, Z + 200],
    [X, Z + 120],
    [X + 10, Z + 40],
    [X + 4, Z],
    [X - 4, Z - 60],
    [X + 20, Z - 115],
    [X + 70, Z - 130],
    [X + 98, Z - 132],
  ]);
  const outpostRoad = makeRoad('Outpost Road', 'snow', 7, [
    [X + 200, ARCTIC.outpostZ],
    [X + 120, ARCTIC.outpostZ],
    [X + 40, ARCTIC.outpostZ],
    [X + 6, ARCTIC.outpostZ],
  ]);
  const cabin = (i: number, x: number, side: 'north' | 'south') =>
    zoneHouse(`arctic-h${i}`, {
      address: `${i + 1} Outpost Road`,
      roadZ: ARCTIC.outpostZ,
      roadWidth: 7,
      x,
      side,
      style: 'log',
      roof: 'shingles',
      wallColors: LOG_WALLS,
      roofColors: SNOWY_ROOFS,
      doorColors: DOORS,
    });
  const houses = [cabin(0, X + 62, 'north'), cabin(1, X + 104, 'north'), cabin(2, X + 146, 'north'), cabin(3, X + 84, 'south'), cabin(4, X + 136, 'south')];

  const pads: Pad[] = [
    // The lake is leveled; the ice sheet lies on it.
    { shape: circle(ARCTIC.lake.x, ARCTIC.lake.z, ARCTIC.lake.r + 4), y: 0, margin: 18 },
    { shape: circle(ARCTIC.camp.x, ARCTIC.camp.z, 42), y: 0, margin: 14 },
    { shape: circle(ARCTIC.observatory.x, ARCTIC.observatory.z, 18), y: 0, margin: 10 },
    ...houses.map((h) => housePad(h, CURB_HEIGHT)),
  ];
  const fires: Fire[] = [
    { id: 'arctic/camp', x: ARCTIC.camp.x, y: 0, z: ARCTIC.camp.z },
    { id: 'arctic/outpost', x: X + 110, y: 0, z: ARCTIC.outpostZ + 12 },
    { id: 'arctic/lake', x: ARCTIC.lake.x + 64, y: 0, z: ARCTIC.lake.z + 22 },
  ];
  for (const f of fires.slice(1)) pads.push({ shape: circle(f.x, f.z, 4), y: 0, margin: 6 });
  return {
    id: 'arctic',
    roads: [glacierRoad, outpostRoad],
    pads,
    waters: [{ kind: 'ice', level: 0.03, shape: circle(ARCTIC.lake.x, ARCTIC.lake.z, ARCTIC.lake.r) }],
    houses,
    landmarks: [
      { name: 'Frozen Lake', x: ARCTIC.lake.x, z: ARCTIC.lake.z, r: ARCTIC.lake.r + 8 },
      { name: 'Igloo Camp', x: ARCTIC.camp.x, z: ARCTIC.camp.z, r: 45 },
      { name: 'Polar Outpost', x: X + 104, z: ARCTIC.outpostZ, r: 60 },
      { name: 'Aurora Observatory', x: ARCTIC.observatory.x, z: ARCTIC.observatory.z, r: 30 },
      { name: 'Glacier Wall', x: X - 150, z: Z - 150, r: 90 },
    ],
    fires,
    ground(x, z) {
      // Wind-blown snow drifts, and glacier-capped mountains past the world's edge.
      const drifts = 1.4 * fbm(x / 55, z / 55, 3, 11) + 3 * fbm(x / 150, z / 150, 2, 12);
      const edge = beyondEdge(x, z);
      const mountains = smoothstep(edge, -60, 150) * (45 + 85 * ridged(x / 110, z / 110, 4, 13));
      return drifts + mountains;
    },
  };
}
