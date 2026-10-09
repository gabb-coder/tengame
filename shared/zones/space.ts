// Outpost Nova (north-east): an alien world with low gravity, craters, glowing crystals,
// a domed habitat, a rocket launch pad, a starship dock and an asteroid belt overhead.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { beyondEdge, circle, type Fire, makeRoad, type Pad, type ZoneLayout } from '../worldKit.ts';

export const SPACE = {
  x: 400,
  z: -400,
  /** Gravity here, as a fraction of normal. */
  gravity: 0.38,
  habitat: { x: 410, z: -510, r: 44 },
  domes: [
    { x: 410, z: -512, r: 16 },
    { x: 378, z: -530, r: 9 },
    { x: 444, z: -538, r: 9 },
    { x: 440, z: -484, r: 8 },
  ],
  launchPad: { x: 535, z: -400, r: 30 },
  dock: { x: 460, z: -290, r: 28 },
  array: { x: 270, z: -350 },
  solar: { x: 262, z: -248 },
  craters: [
    { x: 530, z: -280, r: 40, depth: 9 },
    { x: 262, z: -540, r: 30, depth: 7 },
    { x: 520, z: -535, r: 24, depth: 6 },
  ],
  belt: { radius: 190, height: 150 },
} as const;

export function spaceLayout(): ZoneLayout {
  const { x: X, z: Z } = SPACE;
  const launchRoad = makeRoad(
    'Launch Road',
    'metal',
    8,
    [
      [X - 60, Z + 200],
      [X - 60, Z + 60],
      [X - 40, Z + 10],
      [X + 20, Z],
      [SPACE.launchPad.x - SPACE.launchPad.r - 2, Z],
    ],
    { lines: true },
  );
  const habRoad = makeRoad(
    'Habitat Road',
    'metal',
    8,
    [
      [X - 200, Z - 60],
      [X - 120, Z - 62],
      [X - 62, Z - 70],
      [SPACE.habitat.x - SPACE.habitat.r * 0.75, SPACE.habitat.z + SPACE.habitat.r * 0.62],
    ],
    { lines: true },
  );
  const link = makeRoad('Crater Way', 'metal', 8, [
    [X - 62, Z - 70],
    [X - 52, Z - 30],
    [X - 40, Z + 10],
  ]);
  const dockRoad = makeRoad('Dock Road', 'metal', 8, [
    [X - 60, Z + 110],
    [SPACE.dock.x - SPACE.dock.r - 2, SPACE.dock.z],
  ]);

  const pads: Pad[] = [
    { shape: circle(SPACE.habitat.x, SPACE.habitat.z, SPACE.habitat.r), y: 0, margin: 14 },
    { shape: circle(SPACE.launchPad.x, SPACE.launchPad.z, SPACE.launchPad.r), y: 0, margin: 14 },
    { shape: circle(SPACE.dock.x, SPACE.dock.z, SPACE.dock.r), y: 0, margin: 14 },
    { shape: circle(SPACE.array.x, SPACE.array.z, 34), y: 0, margin: 12 },
    { shape: circle(SPACE.solar.x, SPACE.solar.z, 30), y: 0, margin: 10 },
  ];
  const craters = SPACE.craters;
  return {
    id: 'space',
    roads: [launchRoad, habRoad, link, dockRoad],
    pads,
    waters: [],
    houses: [],
    landmarks: [
      { name: 'Nova Habitat', x: SPACE.habitat.x, z: SPACE.habitat.z, r: SPACE.habitat.r + 6 },
      { name: 'Launch Complex', x: SPACE.launchPad.x, z: SPACE.launchPad.z, r: SPACE.launchPad.r + 10 },
      { name: 'Starship Dock', x: SPACE.dock.x, z: SPACE.dock.z, r: SPACE.dock.r + 8 },
      { name: 'Deep Space Array', x: SPACE.array.x, z: SPACE.array.z, r: 38 },
      { name: 'Solar Farm', x: SPACE.solar.x, z: SPACE.solar.z, r: 32 },
      ...craters.map((c, i) => ({ name: i === 0 ? 'Great Crater' : 'Crater', x: c.x, z: c.z, r: c.r + 6 })),
    ],
    fires: [] as Fire[],
    ground(x, z) {
      let h = 1.6 * fbm(x / 45, z / 45, 3, 31) + 3.5 * fbm(x / 130, z / 130, 2, 32);
      for (const c of craters) {
        const r = Math.hypot(x - c.x, z - c.z) / c.r;
        if (r > 1.6) continue;
        // A bowl with a raised rim that fades out beyond it.
        const bowl = r < 1 ? -c.depth * (1 - r * r) : 0;
        const rim = c.depth * 0.45 * Math.exp(-((r - 1) ** 2) / 0.04);
        h += bowl + rim;
      }
      // Jagged alien ranges beyond the edge.
      h += smoothstep(beyondEdge(x, z), -60, 150) * (50 + 110 * ridged(x / 90, z / 90, 4, 33));
      return h;
    },
  };
}
