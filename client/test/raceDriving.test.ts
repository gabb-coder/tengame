// Headless laps: a computer driver in the F1 car round real circuits, on the real physics.
// Catches broken handling or driving (spinning off, crawling, missing corners), not small tweaks.
import RAPIER from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
import { circuitInfo } from '../../shared/circuits.ts';
import { AiDriver } from '../src/race/ai.ts';
import { ribbon, strip } from '../src/race/circuit/ribbon.ts';
import type { SurfaceKind } from '../src/race/circuit/surfaces.ts';
import { F1_PERFORMANCE } from '../src/race/f1.ts';
import { CircuitLayout } from '../src/race/layout.ts';
import { Drs, towFor } from '../src/race/drs.ts';
import { drsZones, RacingLine } from '../src/race/racingLine.ts';
import { Racer, RIDE_HEIGHT } from '../src/race/racer.ts';
import { Track } from '../src/race/track.ts';
import { mulberry32 } from '../../shared/town.ts';

const DT = 1 / 60;

before(() => RAPIER.init());

/** A circuit as colliders only: the track, run-off out to the barriers, and the barriers. */
export function circuitColliders(id: string, world: RAPIER.World) {
  const data = JSON.parse(readFileSync(new URL(`../public/media/circuits/${id}.json`, import.meta.url), 'utf8'));
  const track = new Track(data, circuitInfo(id));
  const line = new RacingLine(track, F1_PERFORMANCE);
  const layout = new CircuitLayout(track, line);
  const half = track.width / 2;
  const rows = Array.from({ length: track.n + 1 }, (_, k) => k);
  const kinds = new Map<number, SurfaceKind>();
  const add = (g: ReturnType<typeof ribbon>, kind?: SurfaceKind) => {
    const c = world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(g.attributes.position.array), new Uint32Array(g.index!.array)));
    if (kind) kinds.set(c.handle, kind);
  };
  add(ribbon(track, rows, () => [{ lateral: -half, dy: 0 }, { lateral: half, dy: 0 }]), 'road');
  add(ribbon(track, rows, (i) => [{ lateral: -layout.edge(i, -1).barrier, dy: -0.01 }, { lateral: -half, dy: -0.01 }]), 'grass');
  add(ribbon(track, rows, (i) => [{ lateral: half, dy: -0.01 }, { lateral: layout.edge(i, 1).barrier, dy: -0.01 }]), 'grass');
  for (const side of [-1, 1] as const) add(strip(track, rows, (i) => side * layout.edge(track.wrapIndex(i), side).barrier, 0, side, -0.5, 1.5));
  return { track, line, layout, surfaceOf: (c: RAPIER.Collider | null) => (c ? (kinds.get(c.handle) ?? null) : null) };
}

/** Drives `laps` laps from the grid; returns each lap's time and how it went. */
function drive(id: string, laps: number, skill = 1) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const { track, line, layout, surfaceOf } = circuitColliders(id, world);
  const slot = layout.gridSlot(0);
  const p = track.pointAt(slot.s, slot.lateral, { x: 0, y: 0, z: 0 });
  const car = new Racer(world, track, { x: p.x, y: p.y + RIDE_HEIGHT + 0.1, z: p.z }, track.heading(slot.s), surfaceOf);
  const ai = new AiDriver(line, skill, mulberry32(1));
  const times: number[] = [];
  let time = 0;
  let lapStart = -1;
  let wide = 0;
  let rescues = 0;
  let offTrack = 0;
  let last = car.s;
  for (let step = 0; step < (laps * line.lapTime * 1.6 + 10) / DT && times.length < laps; step++) {
    car.locate();
    const controls = ai.drive(car, [], step * DT > 1, DT);
    car.step(controls, DT);
    world.step();
    time += DT;
    // Crossing the line.
    if (last > track.length - 60 && car.s < 60) {
      if (lapStart >= 0) times.push(time - lapStart);
      lapStart = time;
    }
    last = car.s;
    wide = Math.max(wide, Math.abs(car.lateral) - track.width / 2);
    if (Math.abs(car.lateral) > track.width / 2 + 0.5) offTrack += DT;
    if (ai.needsRescue(car)) {
      rescues++;
      car.placeOnTrack(car.s, line.offsetAt(car.s));
      ai.rescued();
    }
  }
  return { times, wide, rescues, offTrack, best: line.lapTime };
}

for (const id of (process.env.LAPS ?? "monza,monaco,spa").split(",")) {
  test(`a computer driver laps ${id} cleanly, near the planned pace`, () => {
    const r = drive(id, 2);
    console.log(id, r.times.map((t) => t.toFixed(1)), 'planned', r.best.toFixed(1), 'widest', r.wide.toFixed(1), 'm, off track', r.offTrack.toFixed(1), 's, rescues', r.rescues);
    assert.equal(r.times.length, 2, 'two laps done');
    assert.equal(r.rescues, 0);
    assert.ok(r.times[1] < r.best * 1.05, `flying lap ${r.times[1].toFixed(1)} s, planned ${r.best.toFixed(1)} s`);
    assert.ok(r.offTrack < 1, `off the track for ${r.offTrack.toFixed(1)} s`);
  });
}

const FIELD = process.env.FIELD ?? 'monza';

/** Twelve computer drivers of the given skills race two laps from the grid (the first on pole). */
function race(circuit: string, skills: number[]) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  const { track, line, layout, surfaceOf } = circuitColliders(circuit, world);
  const drs = new Drs(track, drsZones(line));
  const rng = mulberry32(7);
  const field = skills.map((skill, k) => {
    const slot = layout.gridSlot(k);
    const p = track.pointAt(slot.s, slot.lateral, { x: 0, y: 0, z: 0 });
    const car = new Racer(world, track, { x: p.x, y: p.y + RIDE_HEIGHT + 0.1, z: p.z }, track.heading(slot.s), surfaceOf);
    return { id: `bot${k}`, car, ai: new AiDriver(line, skill, rng), laps: -1, distance: 0, last: car.s };
  });
  let rescues = 0;
  let overtakes = 0;
  let contacts = 0;
  let order = field.map((f) => f.id);
  const chassis = new Map(field.map((f) => [f.car.body.collider(0).handle, f.id]));
  for (let step = 0; step < 260 / DT && field.some((f) => f.laps < 2); step++) {
    const now = step * DT;
    const runners = field.map((f) => ({ id: f.id, s: f.car.s, lateral: f.car.lateral, speed: f.car.speed }));
    for (const f of field) {
      const from = f.car.s;
      f.car.locate();
      drs.moved(f.id, from, f.car.s, now, f.laps >= 1);
      const others = runners.filter((r) => r.id !== f.id && Math.abs(track.delta(f.car.s, r.s)) < 60);
      const c = f.ai.drive(f.car, others, now > 1, DT);
      f.car.tow = towFor(track, runners.find((r) => r.id === f.id)!, runners);
      f.car.drsOpen = drs.open(f.id, f.car.s) && c.brake === 0;
      f.car.step(c, DT);
      if (f.last > track.length - 60 && f.car.s < 60) f.laps++;
      f.last = f.car.s;
      f.distance = f.laps * track.length + f.car.s;
      if (f.ai.needsRescue(f.car)) {
        rescues++;
        if (process.env.CONTACTS) console.log('rescue', f.id, 'at', f.car.s.toFixed(0), 't', now.toFixed(1));
        f.car.placeOnTrack(f.car.s, line.offsetAt(f.car.s));
        f.ai.rescued();
      }
    }
    world.step();
    for (const f of field) {
      const mine = f.car.body.collider(0);
      world.contactPairsWith(mine, (other) => {
        if (!chassis.has(other.handle)) return;
        world.contactPair(mine, other, (m) => {
          if (m.numContacts() > 0) {
            contacts++;
            if (process.env.CONTACTS) console.log('contact', f.id, chassis.get(other.handle), 'at', f.car.s.toFixed(0), 't', now.toFixed(1));
          }
        });
      });
    }
    const now2 = [...field].sort((a, b) => b.distance - a.distance).map((f) => f.id);
    if (now > 5) for (let k = 0; k < now2.length; k++) if (now2[k] !== order[k] && order.indexOf(now2[k]) > k) overtakes++;
    order = now2;
  }
  console.log(`${circuit}: rescues`, rescues, 'overtakes', overtakes, 'car-to-car contact steps', contacts / 2, 'laps', field.map((f) => f.laps).join(','), 'order', order.join(','));
  return { field, rescues, overtakes, order };
}

test(`a field of computer drivers races two laps of ${FIELD} without piling up`, () => {
  // Slower drivers start at the front, so there's passing to do.
  const { field, rescues, overtakes } = race(FIELD, Array.from({ length: 12 }, (_, k) => 0.9 + (k / 11) * 0.1));
  assert.ok(field.every((f) => f.laps >= 2), 'everyone finished');
  assert.ok(rescues <= 1, `${rescues} cars had to be rescued`);
  assert.ok(overtakes > 0, 'someone overtook');
});

test(`faster drivers get past a much slower car on pole at ${FIELD}, using the slipstream and DRS`, () => {
  // Like a careful player on the grid ahead of the computer drivers.
  const { field, rescues, order } = race(FIELD, Array.from({ length: 12 }, (_, k) => (k === 0 ? 0.8 : 0.9 + (k / 11) * 0.1)));
  assert.ok(field.every((f) => f.laps >= 2), 'everyone finished');
  assert.ok(rescues <= 1, `${rescues} cars had to be rescued`);
  assert.ok(order.indexOf('bot0') >= 2, `the slow car finished ${order.indexOf('bot0') + 1}th`);
});
