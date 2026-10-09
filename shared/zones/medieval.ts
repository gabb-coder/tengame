// Kingdom of Eldermoor (north): a moated castle with a great hall, a timber-framed market
// village, tournament grounds and a windmill, below green hills.
import { fbm, ridged, smoothstep } from '../noise.ts';
import { CURB_HEIGHT } from '../town.ts';
import { beyondEdge, circle, type Fire, housePad, makeRoad, type Pad, rect, type ZoneLayout, zoneHouse } from '../worldKit.ts';

export const MEDIEVAL = {
  x: 0,
  z: -400,
  /** Castle center; the curtain wall is a square around it. */
  castle: { x: 0, z: -470, half: 46, moatInner: 52, moatOuter: 62, moatLevel: -0.9 },
  keep: { x: 0, z: -478, w: 26, d: 24, h: 26 },
  marketZ: -300,
  square: { x: 0, z: -300, half: 18 },
  tournament: { x: -112, z: -372, w: 100, d: 40 },
  windmill: { x: 138, z: -382, y: 4 },
  smithy: { x: 34, z: -270 },
  well: { x: -24, z: -322 },
  dragonHeight: 70,
} as const;

const TIMBER_WALLS = ['#efe6d2', '#e8dcc2', '#f2ead8', '#e3d6bd'];
const THATCH = ['#b89a62', '#a88a55', '#c2a46c'];
const DOORS = ['#5a3a22', '#4a3020', '#6a4a2a', '#2e4a2a'];

export function medievalLayout(): ZoneLayout {
  const { x: X, z: Z } = MEDIEVAL;
  const c = MEDIEVAL.castle;
  // The King's Road crosses the moat on the drawbridge and ends in the castle courtyard.
  const gateZ = c.z + c.half;
  const kingsRoad = makeRoad(
    "King's Road",
    'cobble',
    8,
    [
      [X, Z + 200],
      [X, MEDIEVAL.marketZ],
      [X, c.z + c.moatOuter + 4],
      [X, c.z + c.moatInner - 4],
      [X, gateZ - 14],
    ],
    { bridges: [2] },
  );
  const marketStreet = makeRoad('Market Street', 'cobble', 8, [
    [X - 200, MEDIEVAL.marketZ],
    [X - 60, MEDIEVAL.marketZ],
    [X + 60, MEDIEVAL.marketZ],
    [X + 200, MEDIEVAL.marketZ],
  ]);
  const w = MEDIEVAL.windmill;
  const lane = makeRoad('Mill Lane', 'dirt', 6, [
    [X + 60, MEDIEVAL.marketZ],
    [X + 90, MEDIEVAL.marketZ - 40, 1],
    [w.x - 10, w.z + 8, w.y],
  ]);

  const house = (i: number, x: number, side: 'north' | 'south') =>
    zoneHouse(`medieval-h${i}`, {
      address: `${i + 1} Market Street`,
      roadZ: MEDIEVAL.marketZ,
      roadWidth: 8,
      x,
      side,
      style: 'timber',
      roof: 'thatch',
      wallColors: TIMBER_WALLS,
      roofColors: THATCH,
      doorColors: DOORS,
    });
  const houses = [
    house(0, X - 150, 'north'),
    house(1, X - 105, 'north'),
    house(2, X - 58, 'north'),
    house(3, X + 44, 'north'),
    house(4, X + 160, 'north'),
    house(5, X - 130, 'south'),
    house(6, X - 72, 'south'),
    house(7, X + 76, 'south'),
    house(8, X + 132, 'south'),
  ];

  const t = MEDIEVAL.tournament;
  const pads: Pad[] = [
    // Castle grounds, inside the moat.
    { shape: rect(c.x, c.z, c.moatInner - 1, c.moatInner - 1), y: 0, margin: 1 },
    { shape: rect(MEDIEVAL.square.x, MEDIEVAL.square.z, MEDIEVAL.square.half + 8, MEDIEVAL.square.half + 8), y: 0, margin: 10 },
    { shape: rect(t.x, t.z, t.w / 2 + 6, t.d / 2 + 14), y: 0, margin: 12 },
    { shape: circle(MEDIEVAL.smithy.x, MEDIEVAL.smithy.z, 9), y: 0, margin: 6 },
    { shape: circle(w.x, w.z, 8), y: w.y, margin: 14 },
    ...houses.map((h) => housePad(h, CURB_HEIGHT)),
  ];
  const fires: Fire[] = [
    { id: 'medieval/keep-west', x: MEDIEVAL.keep.x - 7, y: 0, z: MEDIEVAL.keep.z + MEDIEVAL.keep.d / 2 + 4 },
    { id: 'medieval/keep-east', x: MEDIEVAL.keep.x + 7, y: 0, z: MEDIEVAL.keep.z + MEDIEVAL.keep.d / 2 + 4 },
    { id: 'medieval/tournament', x: t.x, y: 0, z: t.z + t.d / 2 + 9 },
  ];
  return {
    id: 'medieval',
    roads: [kingsRoad, marketStreet, lane],
    pads,
    waters: [{ kind: 'water', level: c.moatLevel, shape: { type: 'ring', x: c.x, z: c.z, inner: c.moatInner, outer: c.moatOuter } }],
    houses,
    landmarks: [
      { name: 'Castle Eldermoor', x: c.x, z: c.z, r: c.moatOuter + 4 },
      { name: 'Market Square', x: MEDIEVAL.square.x, z: MEDIEVAL.square.z, r: 26 },
      { name: 'Tournament Grounds', x: t.x, z: t.z, r: 60 },
      { name: 'Old Windmill', x: MEDIEVAL.windmill.x, z: MEDIEVAL.windmill.z, r: 22 },
      { name: 'Blacksmith', x: MEDIEVAL.smithy.x, z: MEDIEVAL.smithy.z, r: 12 },
    ],
    fires,
    ground(x, z) {
      let h = 2.2 * fbm(x / 70, z / 70, 3, 21) + 3 * fbm(x / 160, z / 160, 2, 22);
      // A low hill for the windmill.
      h += 6 * Math.max(0, 1 - Math.hypot(x - MEDIEVAL.windmill.x, z - MEDIEVAL.windmill.z) / 45) ** 2;
      // The moat: a square ditch around the castle.
      const s = Math.max(Math.abs(x - c.x), Math.abs(z - c.z));
      const moat = smoothstep(s, c.moatInner - 1, c.moatInner + 2) * (1 - smoothstep(s, c.moatOuter - 2, c.moatOuter + 1));
      h = h * (1 - moat) - 3.2 * moat;
      // Green hills, then mountains, to the north.
      h += smoothstep(beyondEdge(x, z), -70, 160) * (35 + 60 * ridged(x / 120, z / 120, 4, 23));
      return h;
    },
  };
}
