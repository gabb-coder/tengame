// Valley of Empires (south): Rome's Colosseum and aqueduct, a Greek temple, a Mesoamerican
// step pyramid, and Egypt's pyramids and sphinx, along a grand avenue of obelisks.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { CURB_HEIGHT } from '../town.ts';
import { beyondEdge, circle, type Fire, housePad, makeRoad, type Pad, rect, type ZoneLayout, zoneHouse } from '../worldKit.ts';

export const ANCIENT = {
  x: 0,
  z: 400,
  kingsZ: 400,
  colosseum: { x: -100, z: 300, rx: 50, rz: 40, height: 24, arenaRx: 30, arenaRz: 21 },
  aqueduct: { z: 362, x0: -195, x1: -30, height: 13 },
  arch: { x: 0, z: 248 },
  parthenon: { x: 105, z: 292, w: 24, d: 50 },
  stepPyramid: { x: -105, z: 505, base: 52, tiers: 9, height: 27 },
  greatPyramid: { x: 122, z: 522, base: 84, height: 54 },
  smallPyramid: { x: 58, z: 572, base: 34, height: 22 },
  sphinx: { x: 44, z: 455 },
  oasis: { x: 160, z: 434, r: 18, level: -0.35 },
  obeliskZ: [252, 300, 350, 452, 500, 550],
} as const;

const WALLS = ['#f2ece0', '#ece2cf', '#e8dcc6'];
const CLAY = ['#b4553a', '#a84a32', '#c0603f'];
const DOORS = ['#6a4a2a', '#2e4a7a', '#7a2e2e'];

export function ancientLayout(): ZoneLayout {
  const A = ANCIENT;
  const via = makeRoad('Via Imperialis', 'sandstone', 10, [
    [0, 200],
    [0, 400],
    [0, 572],
  ]);
  const kings = makeRoad('Road of Kings', 'sandstone', 10, [
    [-200, A.kingsZ],
    [0, A.kingsZ],
    [200, A.kingsZ],
  ]);
  const villa = (i: number, x: number) =>
    zoneHouse(`ancient-h${i}`, {
      address: `${i + 1} Road of Kings`,
      roadZ: A.kingsZ,
      roadWidth: 10,
      x,
      side: 'south',
      style: 'plaster',
      roof: 'clay',
      wallColors: WALLS,
      roofColors: CLAY,
      doorColors: DOORS,
    });
  const houses = [villa(0, -178), villa(1, -146), villa(2, -40)];
  const c = A.colosseum;
  const p = A.parthenon;
  const sp = A.stepPyramid;
  const gp = A.greatPyramid;
  const small = A.smallPyramid;
  const pads: Pad[] = [
    { shape: circle(c.x, c.z, c.rx + 8), y: 0, margin: 12 },
    { shape: rect(p.x, p.z, p.w / 2 + 8, p.d / 2 + 8), y: 0, margin: 12 },
    { shape: rect(sp.x, sp.z, sp.base / 2 + 8, sp.base / 2 + 8), y: 0, margin: 12 },
    { shape: rect(gp.x, gp.z, gp.base / 2 + 6, gp.base / 2 + 6), y: 0, margin: 14 },
    { shape: rect(small.x, small.z, small.base / 2 + 4, small.base / 2 + 4), y: 0, margin: 10 },
    { shape: rect(A.sphinx.x, A.sphinx.z, 10, 16), y: 0, margin: 10 },
    { shape: circle(A.oasis.x, A.oasis.z, A.oasis.r - 3), y: -2, margin: 10 },
    ...houses.map((h) => housePad(h, CURB_HEIGHT)),
  ];
  const fires: Fire[] = [
    { id: 'ancient/parthenon', x: p.x, y: 0, z: p.z + p.d / 2 + 5 },
    { id: 'ancient/pyramid', x: sp.x, y: sp.height, z: sp.z + 4.6 },
    { id: 'ancient/oasis', x: A.oasis.x - 4, y: 0, z: A.oasis.z - A.oasis.r - 5 },
  ];
  pads.push({ shape: circle(fires[2].x, fires[2].z, 4), y: 0, margin: 6 });
  return {
    id: 'ancient',
    roads: [via, kings],
    pads,
    waters: [{ kind: 'water', level: A.oasis.level, shape: circle(A.oasis.x, A.oasis.z, A.oasis.r) }],
    houses,
    landmarks: [
      { name: 'Colosseum', x: c.x, z: c.z, r: c.rx + 8 },
      { name: 'Aqueduct', x: (A.aqueduct.x0 + A.aqueduct.x1) / 2, z: A.aqueduct.z, r: 18 },
      { name: 'Triumphal Arch', x: A.arch.x, z: A.arch.z, r: 14 },
      { name: 'Parthenon', x: p.x, z: p.z, r: 34 },
      { name: 'Temple of Kukulkan', x: sp.x, z: sp.z, r: 38 },
      { name: 'Great Pyramid', x: gp.x, z: gp.z, r: 56 },
      { name: 'Queen’s Pyramid', x: small.x, z: small.z, r: 24 },
      { name: 'Great Sphinx', x: A.sphinx.x, z: A.sphinx.z, r: 18 },
      { name: 'Desert Oasis', x: A.oasis.x, z: A.oasis.z, r: A.oasis.r + 10 },
    ],
    fires,
    ground(x, z) {
      let h = 1.1 * fbm(x / 50, z / 50, 3, 51) + 2 * fbm(x / 140, z / 140, 2, 52);
      // Sand dunes in the Egyptian quarter.
      const egypt = smoothstep(x, 20, 90) * smoothstep(z, 420, 490);
      h += egypt * 3.5 * (0.6 + 0.4 * Math.sin((x * 0.8 + z * 0.6) / 16 + 3 * fbm(x / 90, z / 90, 2, 53)));
      // Desert mesas beyond the edge.
      h += smoothstep(beyondEdge(x, z), -60, 160) * (25 + 50 * ridged(x / 100, z / 100, 3, 54));
      return h;
    },
  };
}
