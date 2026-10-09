// Primeval Valley (south-west): a smoking volcano with a lava lake, a cave you can drive
// into, steaming hot springs and a fossil field, roamed by dinosaurs and mammoths.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { beyondEdge, circle, type Fire, makeRoad, type Pad, type ZoneLayout } from '../worldKit.ts';

export const PREHISTORIC = {
  x: -400,
  z: 400,
  volcano: { x: -515, z: 515, radius: 130, height: 112, crater: 24, craterDepth: 12, lava: 73 },
  cave: { x: -275, z: 528, r: 22 },
  springs: [
    { x: -246, z: 266, r: 12 },
    { x: -270, z: 247, r: 8 },
    { x: -228, z: 245, r: 7 },
  ],
  fossils: { x: -420, z: 262 },
  springLevel: -0.3,
  /** Geysers by the springs: they blow every so often, and throw whoever's standing on them. */
  geysers: [
    { x: -226, z: 266 },
    { x: -255, z: 238 },
    { x: -263, z: 280 },
  ],
} as const;

/** Volcano height at (x, z), crater included. */
function volcano(x: number, z: number): number {
  const v = PREHISTORIC.volcano;
  const r = Math.hypot(x - v.x, z - v.z);
  if (r > v.radius) return 0;
  // Gullies down the flanks.
  const gullies = 1 - 0.1 * ridged(Math.atan2(z - v.z, x - v.x) * 4, r / 25, 3, 64) * Math.min(1, r / 40);
  const cone = (rr: number) => v.height * Math.max(0, 1 - rr / v.radius) ** 1.3;
  let h = cone(r) * gullies;
  if (r < v.crater) {
    const rim = cone(v.crater) * gullies;
    h = Math.min(h, rim - v.craterDepth * (1 - (r / v.crater) ** 2));
  }
  return h;
}

export function prehistoricLayout(): ZoneLayout {
  const P = PREHISTORIC;
  const trail = makeRoad('Fossil Trail', 'dirt', 7, [
    [-360, 200],
    [-360, 310],
    [-335, 365],
    [-292, 420],
    [-279, 470],
    [-275, P.cave.z - P.cave.r - 6],
  ]);
  const ridgeRoad = makeRoad('Ridge Road', 'dirt', 7, [
    [-200, 322],
    [-280, 324],
    [-357, 320],
  ]);
  const pads: Pad[] = [
    { shape: circle(P.cave.x, P.cave.z, P.cave.r + 10), y: 0, margin: 12 },
    { shape: circle(P.fossils.x, P.fossils.z, 18), y: 0, margin: 10 },
    // Hot spring pools.
    ...P.springs.map((s) => ({ shape: circle(s.x, s.z, s.r - 2), y: -1.8, margin: 8 })),
  ];
  const fires: Fire[] = [
    { id: 'prehistoric/cave', x: P.cave.x + 2, y: 0, z: P.cave.z + 4 },
    { id: 'prehistoric/fossils', x: P.fossils.x + 14, y: 0, z: P.fossils.z + 14 },
  ];
  const v = P.volcano;
  return {
    id: 'prehistoric',
    roads: [trail, ridgeRoad],
    pads,
    waters: [
      { kind: 'lava', level: v.lava, shape: circle(v.x, v.z, v.crater - 3) },
      ...P.springs.map((s) => ({ kind: 'water' as const, level: P.springLevel, shape: circle(s.x, s.z, s.r) })),
    ],
    houses: [],
    landmarks: [
      { name: 'Cave of Echoes', x: P.cave.x, z: P.cave.z, r: P.cave.r + 8 },
      { name: 'Steam Springs', x: -250, z: 255, r: 30 },
      { name: 'Fossil Field', x: P.fossils.x, z: P.fossils.z, r: 30 },
      { name: 'Mount Ignis', x: v.x, z: v.z, r: v.radius },
    ],
    fires,
    ground(x, z) {
      let h = 2.4 * fbm(x / 60, z / 60, 3, 61) + 5 * fbm(x / 170, z / 170, 2, 62);
      h += volcano(x, z);
      h += smoothstep(beyondEdge(x, z), -60, 160) * (45 + 70 * ridged(x / 100, z / 100, 4, 63));
      return h;
    },
  };
}
