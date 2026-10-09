// Neon Spire (east): a rain-soaked megacity built upward: towers, neon, a spiral ramp
// up the Helix Tower, sky bridges, a monorail and flying traffic.
import { makeRoad, type Pad, rect, type ZoneLayout } from '../worldKit.ts';

export const CYBERPUNK = {
  x: 400,
  z: 0,
  streetWidth: 12,
  /** Avenue x positions (north-south) and street z positions (east-west). */
  avenues: [300, 400, 500],
  streets: [-100, 0, 100],
  /** City blocks between the streets: [minX, minZ, maxX, maxZ]. */
  blocks: [] as [number, number, number, number][],
  helix: { x: 450, z: 50, inner: 15, outer: 27, turns: 3, rise: 12 },
  zenith: { x: 350, z: -50 },
  market: { x: 250, z: 150 },
  /** The elevated monorail runs above the outer streets and avenues, round the Helix. */
  monorail: { minX: 300, maxX: 500, minZ: -100, maxZ: 100, height: 24 },
  /**
   * Stations beside the track: the platform's middle, which side of the track it's on
   * (unit vector from the track), and the elevator up to it from the sidewalk.
   */
  stations: [
    { name: 'Neon Central', x: 350, z: 100, side: { x: 0, z: -1 }, lift: { x: 350, z: 92.6 } },
    { name: 'Circuit Station', x: 500, z: -50, side: { x: -1, z: 0 }, lift: { x: 492.6, z: -50 } },
  ],
  /** A rooftop park on a lower building, and the neon bounce pad that flings you up there. */
  skypark: { x: 250, z: -50, w: 40, d: 40, h: 34 },
  bouncePad: { x: 250, z: -12 },
} as const;

const EDGES_X = [205, 294, 306, 394, 406, 494, 506, 592];
const EDGES_Z = [-195, -106, -94, -6, 6, 94, 106, 195];
for (let j = 0; j < 4; j++) {
  for (let i = 0; i < 4; i++) {
    (CYBERPUNK.blocks as [number, number, number, number][]).push([EDGES_X[i * 2] + 3, EDGES_Z[j * 2] + 3, EDGES_X[i * 2 + 1] - 3, EDGES_Z[j * 2 + 1] - 3]);
  }
}

const AVENUE_NAMES = ['Chrome Avenue', 'Neon Avenue', 'Circuit Avenue'];
const STREET_NAMES = ['Byte Street', 'Pixel Street', 'Static Street'];

export function cyberpunkLayout(): ZoneLayout {
  const w = CYBERPUNK.streetWidth;
  const roads = [
    ...CYBERPUNK.avenues.map((x, i) => makeRoad(AVENUE_NAMES[i], 'asphalt', w, [[x, -200], [x, 200]], { lines: true })),
    ...CYBERPUNK.streets.map((z, i) => makeRoad(STREET_NAMES[i], 'asphalt', w, [[200, z], [592, z]], { lines: true })),
  ];
  const pads: Pad[] = [{ shape: rect(CYBERPUNK.x + 4, CYBERPUNK.z, 196, 198), y: 0, margin: 4 }];
  const h = CYBERPUNK.helix;
  return {
    id: 'cyberpunk',
    roads,
    pads,
    waters: [],
    houses: [],
    landmarks: [
      { name: 'Helix Tower', x: h.x, z: h.z, r: h.outer + 8 },
      { name: 'Zenith Tower', x: CYBERPUNK.zenith.x, z: CYBERPUNK.zenith.z, r: 40 },
      { name: 'Night Market', x: CYBERPUNK.market.x, z: CYBERPUNK.market.z, r: 40 },
      ...CYBERPUNK.stations.map((s) => ({ name: s.name, x: s.x, z: s.z, r: 16 })),
      { name: 'Skypark', x: CYBERPUNK.skypark.x, z: CYBERPUNK.skypark.z, r: 26 },
    ],
    fires: [],
    ground: () => 0,
  };
}
