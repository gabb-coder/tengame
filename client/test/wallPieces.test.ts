import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateInterior } from '../../shared/interior.ts';
import { generateTown } from '../../shared/town.ts';
import { wallPieces, type WallRect } from '../src/world/town/meshBuilder.ts';

type Hole = { center: number; width: number; bottom: number; top: number };

/** Checks the pieces cover the wall exactly once, except the openings. */
function checkCoverage(lo: number, hi: number, bottom: number, top: number, holes: Hole[], pieces: WallRect[]): void {
  const inHole = (u: number, v: number) => holes.some((o) => Math.abs(u - o.center) < o.width / 2 && v > o.bottom && v < o.top);
  const steps = 200;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const u = lo + ((i + 0.5) / steps) * (hi - lo);
      const v = bottom + ((j + 0.5) / steps) * (top - bottom);
      const covering = pieces.filter((r) => u > r.u0 && u < r.u1 && v > r.v0 && v < r.v1).length;
      assert.equal(covering, inHole(u, v) ? 0 : 1, `at u=${u.toFixed(2)} v=${v.toFixed(2)}`);
    }
  }
}

test('a window stacked above a door leaves both open', () => {
  const holes = [
    { center: 0, width: 1.1, bottom: 0.4, top: 2.6 },
    { center: 0.3, width: 1.2, bottom: 4.1, top: 5.4 },
  ];
  const pieces = wallPieces(-5, 5, 0.4, 6, holes);
  checkCoverage(-5, 5, 0.4, 6, holes, pieces);
});

test('every outer wall of every house has its openings left open', () => {
  for (const h of generateTown().houses) {
    const plan = generateInterior(h);
    const top = 0.4 + h.stories * 2.8;
    for (const side of ['front', 'back', 'left', 'right'] as const) {
      const along = side === 'front' || side === 'back';
      const [lo, hi] = along ? [-h.width / 2, h.width / 2] : [-h.depth / 2 + 0.2, h.depth / 2 - 0.2];
      const holes = plan.exterior[side];
      checkCoverage(lo, hi, 0.4, top, holes, wallPieces(lo, hi, 0.4, top, holes));
    }
  }
});
