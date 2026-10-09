import * as THREE from 'three';
import { CYBERPUNK } from '../../../../shared/zones/cyberpunk.ts';
import { worldSeconds } from '../../game/clock.ts';
import { game } from '../../game/link.ts';
import { boxCollider } from '../town/colliders.ts';
import { box, placement } from '../town/meshBuilder.ts';
import { type ChunkedBuilder, cylinderCollider, mergeAll, type ZoneContext } from './kit.ts';
import { distanceAlong, lineActivities, loopCurve, Shaft, type Stop, TransitLine, type VehicleState } from './transit.ts';

const NEON = ['#ff2a8a', '#2af0ff', '#b44aff'];
const CURB = 0.15;
/** Top of the station platforms, level with the train's floor. */
const PLATFORM_Y = CYBERPUNK.monorail.height + 1;
const CARS = 4;
const CAR_GAP = 12;
/** Trains and lifts further than this from the camera aren't drawn. */
const NEAR = 380;

/**
 * The elevated monorail: a loop over the outer streets, with trains that stop at two
 * stations, each reached by a glass lift from the sidewalk. Trains and lifts run on the
 * shared clock, so everyone rides the same ones.
 */
export function buildMonorail(ctx: ZoneContext, b: ChunkedBuilder): { group: THREE.Group; update(camera: THREE.Vector3): void } {
  const { physics, zm, m } = ctx;
  const r = CYBERPUNK.monorail;
  const y = r.height;
  const curve = loopCurve(roundedRect(r.minX, r.minZ, r.maxX, r.maxZ, 16, y));
  const group = new THREE.Group();

  // The beam, in short straight pieces following the curve.
  const len = curve.getLength();
  const steps = Math.ceil(len / 4);
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  for (let i = 0; i < steps; i++) {
    curve.getPointAt(i / steps, p0);
    curve.getPointAt((i + 1) / steps, p1);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const l = p0.distanceTo(p1) + 0.05;
    const M = placement((p0.x + p1.x) / 2, y, (p0.z + p1.z) / 2, yaw);
    b.add(box(1.6, 1.4, l, 2), zm.paint, M, '#3a3e46');
    b.add(box(1.7, 0.15, l), zm.glow, M.clone().multiply(placement(0, -0.75, 0)), '#b44aff');
  }
  // Portal frames straddling the street every so often, clear of the crossings.
  const crossings = (x: number, z: number) =>
    CYBERPUNK.avenues.some((a) => Math.abs(x - a) < 12) && CYBERPUNK.streets.some((s) => Math.abs(z - s) < 12);
  for (let s = 0; s < len; s += 34) {
    curve.getPointAt(s / len, p0);
    curve.getPointAt(((s + 1) % len) / len, p1);
    if (crossings(p0.x, p0.z)) continue;
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const M = placement(p0.x, 0, p0.z, yaw);
    for (const side of [-1, 1]) {
      b.add(new THREE.CylinderGeometry(0.45, 0.6, y - 0.7, 10).translate(0, (y - 0.7) / 2, 0), zm.paint, M.clone().multiply(placement(side * 7.6, 0, 0)), '#2e3238');
      const at = new THREE.Vector3(side * 7.6, 0, 0).applyMatrix4(M);
      cylinderCollider(physics, at.x, 0, at.z, 0.6, y - 0.7);
    }
    b.add(box(16, 0.8, 1, 2), zm.paint, M.clone().multiply(placement(0, y - 1.1, 0)), '#2e3238');
  }

  // Stations: a platform beside the track, and a glass lift down to the sidewalk.
  const stops: Stop[] = [];
  const lifts: { line: TransitLine; cabin: THREE.Group }[] = [];
  for (const st of CYBERPUNK.stations) {
    const along = distanceAlong(curve, st.x, st.z);
    const across = new THREE.Vector3(st.side.x, 0, st.side.z);
    const tangent = new THREE.Vector3(-st.side.z, 0, st.side.x);
    const yaw = Math.atan2(tangent.x, tangent.z);
    // The platform runs from just beside the train out over the sidewalk.
    const near = 2.1;
    const far = 8.7;
    const mid = (near + far) / 2;
    const P = placement(st.x + across.x * mid, PLATFORM_Y, st.z + across.z * mid, yaw);
    b.add(box(24, 0.4, far - near, 2), zm.roads.cobble, P.clone().multiply(placement(0, -0.2, 0)), '#5a5e66');
    boxCollider(physics, P, { x: 0, y: -0.2, z: 0 }, { x: 24, y: 0.4, z: far - near });
    b.add(box(24, 0.06, 0.3), zm.glow, P.clone().multiply(placement(0, 0.02, (far - near) / 2 - 0.35)), '#ffd02a', { castShadow: false });
    // Railings on the outer edge and the ends, a roof on posts, and a sign.
    const rail = (x: number, z: number, w: number, d: number) => {
      b.add(box(w, 1.1, d), zm.glass, P.clone().multiply(placement(x, 0.55, z)));
      b.add(box(w + 0.05, 0.08, d + 0.05), zm.glow, P.clone().multiply(placement(x, 1.12, z)), NEON[stops.length % 3]);
      boxCollider(physics, P, { x, y: 0.6, z }, { x: w, y: 1.2, z: d });
    };
    rail(0, -(far - near) / 2 + 0.05, 24, 0.1);
    rail(-12, 0, 0.1, far - near);
    rail(12, 0, 0.1, far - near);
    for (const px of [-10, 0, 10]) b.add(box(0.2, 3.4, 0.2), m.darkMetal, P.clone().multiply(placement(px, 1.7, -(far - near) / 2 + 0.4)));
    b.add(box(24, 0.2, far - near + 0.6, 2), zm.paint, P.clone().multiply(placement(0, 3.5, -0.3, 0, 0.06)), '#22262e');
    b.add(box(9, 1.2, 0.2), zm.glow, P.clone().multiply(placement(0, 4.4, -(far - near) / 2 + 0.6)), NEON[(stops.length + 1) % 3]);
    // Benches to wait on.
    for (const bx of [-7, 7]) b.add(box(3, 0.45, 0.6, 1), zm.paint, P.clone().multiply(placement(bx, 0.22, -(far - near) / 2 + 0.9)), '#3a3e46');

    // Where you wait for the train, and where you're put when you get off.
    const wait = new THREE.Vector3(st.x + across.x * (near + 1.4), PLATFORM_Y, st.z + across.z * (near + 1.4));
    stops.push({ name: st.name, at: along, dwell: 10, board: wait, exit: wait.clone() });

    // The lift: a glass shaft from the sidewalk to the platform.
    const lx = st.lift.x;
    const lz = st.lift.z;
    const L = placement(lx, 0, lz, yaw);
    const shaftTop = PLATFORM_Y + 3;
    for (const [sx, sz, w, d] of [[-1.2, 0, 0.08, 2.4], [1.2, 0, 0.08, 2.4]] as const) b.add(box(w, shaftTop, d), zm.glass, L.clone().multiply(placement(sx, shaftTop / 2, sz)));
    for (const [sx, sz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.add(box(0.14, shaftTop, 0.14), m.darkMetal, L.clone().multiply(placement(sx, shaftTop / 2, sz)));
    b.add(box(2.6, 0.2, 2.6), zm.paint, L.clone().multiply(placement(0, shaftTop, 0)), '#22262e');
    b.add(box(2.4, 0.1, 0.1), zm.glow, L.clone().multiply(placement(0, 2.6, -1.25)), NEON[stops.length % 3]);
    // In from the sidewalk on the far side from the track; out onto the platform toward it
    // (a few steps clear of the lift, so the train's the thing to board from there).
    const at = (d: number, y: number) => new THREE.Vector3(lx + across.x * d, y, lz + across.z * d);
    const shaft = new Shaft(lx, lz, CURB, PLATFORM_Y);
    const liftLine = new TransitLine(
      shaft,
      [
        { name: 'Street', at: 0, dwell: 5, board: at(2, CURB), exit: at(3.2, CURB) },
        { name: 'Platform', at: shaft.getLength() / 2, dwell: 5, board: at(-2, PLATFORM_Y), exit: at(-4.2, PLATFORM_Y) },
      ],
      6,
    );
    const cabin = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 2.2), new THREE.MeshStandardMaterial({ color: '#2a2e36', metalness: 0.6, roughness: 0.4 }));
    floor.position.y = -0.075;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 2.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.4), toneMapped: false }));
    glow.position.y = 2.4;
    cabin.add(floor, glow);
    cabin.rotation.y = yaw;
    group.add(cabin);
    lifts.push({ line: liftLine, cabin });
    game.activities.add(
      ...lineActivities(liftLine, { name: 'lift', verb: 'Take the lift', seats: [new THREE.Vector3(0.4, 0, 0.3), new THREE.Vector3(-0.4, 0, -0.3)], pose: 'stand', reach: 1.6, sound: (at) => game.sounds?.ding(at) }, (s) =>
        new THREE.Matrix4().makeRotationY(yaw).setPosition(s.position),
      ),
    );
  }

  // The trains: two of them, four cars each, with glass sides so you can see who's riding.
  const line = new TransitLine(curve, stops, 16, 2);
  const shell = new THREE.MeshStandardMaterial({ color: '#e8ecf0', roughness: 0.3, metalness: 0.4 });
  const windows = new THREE.MeshPhysicalMaterial({ color: '#9ad8ff', emissive: '#2af0ff', emissiveIntensity: 0.25, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
  const stripe = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.4, 1.4), toneMapped: false });
  const trains: THREE.Group[][] = [];
  const seatRows = mergeAll([-3, -1, 1, 3].flatMap((sz) => [-0.75, 0.75].map((sx) => new THREE.BoxGeometry(0.6, 0.12, 0.55).translate(sx, -0.75, sz))));
  for (let v = 0; v < line.vehicles; v++) {
    const cars: THREE.Group[] = [];
    for (let k = 0; k < CARS; k++) {
      const car = new THREE.Group();
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 8.6, 6, 14).rotateX(Math.PI / 2).scale(1, 0.55, 1), shell);
      lower.position.y = -0.6;
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(1.45, 8.6, 6, 14).rotateX(Math.PI / 2).scale(1, 0.75, 1), windows);
      upper.position.y = 0.3;
      const band = new THREE.Mesh(new THREE.BoxGeometry(3.06, 0.12, 9), stripe);
      band.position.y = -0.25;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 9.2), shell);
      roof.position.y = 1.35;
      lower.castShadow = roof.castShadow = true;
      car.add(lower, upper, band, roof);
      // Rows of seats inside.
      car.add(new THREE.Mesh(seatRows, stripe));
      group.add(car);
      cars.push(car);
    }
    trains.push(cars);
  }
  const seats: THREE.Vector3[] = [];
  for (const sz of [-3, -1, 1, 3]) for (const sx of [-0.75, 0.75]) seats.push(new THREE.Vector3(sx, -0.55, sz));
  const carMatrix = (s: VehicleState) => new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.position.x, s.position.y + 2.3, s.position.z);
  game.activities.add(
    ...lineActivities(line, { name: 'monorail', verb: 'Board the monorail', seats, pose: 'sit', reach: 9, sound: (at) => game.sounds?.ding(at) }, carMatrix),
  );

  const state = { position: new THREE.Vector3(), yaw: 0, pitch: 0, stopped: null, next: stops[0], wait: 0, vehicle: 0 } as VehicleState;
  return {
    group,
    update(camera) {
      const t = worldSeconds();
      trains.forEach((cars, v) =>
        cars.forEach((car, k) => {
          line.state(t, v, k * CAR_GAP, state);
          car.position.set(state.position.x, state.position.y + 2.3, state.position.z);
          car.rotation.y = state.yaw;
          // Far-off trains are a speck in the haze: skip drawing them.
          car.visible = car.position.distanceTo(camera) < NEAR;
        }),
      );
      for (const lift of lifts) {
        lift.line.state(t, 0, 0, state);
        lift.cabin.position.copy(state.position);
        lift.cabin.visible = state.position.distanceTo(camera) < NEAR;
      }
    },
  };
}

/** Points round a rectangle with rounded corners, clockwise from the north-west, at height `y`. */
function roundedRect(minX: number, minZ: number, maxX: number, maxZ: number, radius: number, y: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const corners = [
    [maxX - radius, minZ + radius, -Math.PI / 2],
    [maxX - radius, maxZ - radius, 0],
    [minX + radius, maxZ - radius, Math.PI / 2],
    [minX + radius, minZ + radius, Math.PI],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius));
    }
  }
  // Extra points along the straights keep the spline straight there.
  const out: THREE.Vector3[] = [];
  pts.forEach((p, i) => {
    out.push(p);
    const q = pts[(i + 1) % pts.length];
    const gap = p.distanceTo(q);
    if (gap > 20) for (let s = 20; s < gap - 10; s += 20) out.push(p.clone().lerp(q, s / gap));
  });
  return out;
}

