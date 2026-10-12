import * as THREE from 'three';
import { F1 } from './f1.ts';
import type { Team } from '../../../shared/racing.ts';

/**
 * A Grand Prix car, modelled in code: the survival cell and nose, sidepods and engine
 * cover, floor and diffuser, multi-element front and rear wings (the rear wing's top flap
 * opens for DRS), the halo, suspension arms, mirrors, the driver's helmet, and big 18-inch
 * wheels with covers. Facing +Z, origin at the physics chassis' center, like CarModel.
 *
 * The bodywork is one shape for every car; each team's paint comes from a `paint` value on
 * every vertex (main color, second color, accent, carbon, dark) picked in the shader.
 */

/** Paint zones. */
const PRIMARY = 0;
const SECONDARY = 1;
const ACCENT = 2;
const CARBON = 3;
const DARK = 4;

/** The ground, in the chassis frame, with the car at rest. */
const SETTLED = F1.suspensionRest - 0.02;
const WHEEL_Y = F1.wheelY - SETTLED;
const GROUND = WHEEL_Y - F1.wheelRadius;
const MAX_ROLL = 0.025;
const MAX_PITCH = 0.015;
/** The rear wing's top flap: closed and open angles (rad). */
const FLAP_CLOSED = 0.62;
const FLAP_OPEN = 0.08;

/** Collects pieces of bodywork into one geometry with a paint zone per vertex. */
class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, paint: number | ((x: number, y: number, z: number) => number)): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position;
    const zones = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) zones[k] = typeof paint === 'number' ? paint : paint(p.getX(k), p.getY(k), p.getZ(k));
    geo.setAttribute('paint', new THREE.BufferAttribute(zones, 1));
    geo.deleteAttribute('uv');
    this.list.push(geo);
  }
  build(): THREE.BufferGeometry {
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'paint']) {
      const size = this.list[0].attributes[name].itemSize;
      const total = this.list.reduce((n, g) => n + g.attributes[name].count, 0);
      const array = new Float32Array(total * size);
      let offset = 0;
      for (const g of this.list) {
        array.set(g.attributes[name].array as Float32Array, offset);
        offset += g.attributes[name].count * size;
      }
      out.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    out.computeBoundingSphere();
    return out;
  }
}

/** A cross-section for lofting along Z: a rounded rectangle (superellipse) centered at (x, h) above the ground. */
interface Station {
  z: number;
  x?: number;
  h: number;
  w: number;
  t: number;
  /** Roundness: 2 is an ellipse, higher is boxier. */
  n?: number;
}

/** A body lofted through `stations` (front to back), capped at both ends. */
function loft(stations: Station[], around = 20): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const ring = (s: Station) => {
    const pts: [number, number, number][] = [];
    const n = s.n ?? 3;
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** (2 / n) * s.w;
      const y = Math.sign(sn) * Math.abs(sn) ** (2 / n) * s.t;
      pts.push([(s.x ?? 0) + x, GROUND + s.h + y, s.z]);
    }
    return pts;
  };
  for (const s of stations) for (const p of ring(s)) positions.push(...p);
  for (let r = 0; r < stations.length - 1; r++) {
    for (let k = 0; k < around; k++) {
      const a = r * around + k;
      const b = r * around + ((k + 1) % around);
      const c = a + around;
      const d = b + around;
      index.push(a, c, b, b, c, d);
    }
  }
  // Caps: fans from each end's center.
  for (const [r, flip] of [
    [0, false],
    [stations.length - 1, true],
  ] as const) {
    const s = stations[r];
    const center = positions.length / 3;
    positions.push(s.x ?? 0, GROUND + s.h, s.z);
    for (let k = 0; k < around; k++) {
      const a = r * around + k;
      const b = r * around + ((k + 1) % around);
      if (flip) index.push(center, a, b);
      else index.push(center, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  // Smooth shading round the body, but not across the caps: average normals by position along each ring.
  return smoothNormals(flat);
}

/** Averages the normals of vertices that share a position (smooth shading after toNonIndexed), except across sharp creases. */
function smoothNormals(g: THREE.BufferGeometry, crease = 0.6): THREE.BufferGeometry {
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  const groups = new Map<string, number[]>();
  for (let k = 0; k < p.count; k++) {
    const key = `${p.getX(k).toFixed(4)},${p.getY(k).toFixed(4)},${p.getZ(k).toFixed(4)}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(k);
  }
  const out = new Float32Array(p.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (const list of groups.values()) {
    for (const k of list) {
      a.fromBufferAttribute(nrm, k);
      sum.set(0, 0, 0);
      for (const j of list) {
        b.fromBufferAttribute(nrm, j);
        if (a.dot(b) > crease) sum.add(b);
      }
      sum.normalize();
      out.set([sum.x, sum.y, sum.z], k * 3);
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

/** A wing section across the car: chord and thickness, leading edge at (z, h), pitched up `angle` at the back. */
interface WingStation {
  x: number;
  z: number;
  h: number;
  chord: number;
  angle: number;
}

/** A wing element lofted across X through `stations` (left to right), with a cambered airfoil section. */
function wing(stations: WingStation[], thickness = 0.1): THREE.BufferGeometry {
  const around = 12;
  const positions: number[] = [];
  const index: number[] = [];
  for (const s of stations) {
    for (let k = 0; k < around; k++) {
      // Round the airfoil: top surface front to back, then bottom back to front.
      const top = k < around / 2;
      const u = top ? k / (around / 2) : 1 - (k - around / 2) / (around / 2);
      const t = 5 * thickness * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4);
      const camber = 0.06 * Math.sin(Math.PI * u);
      const along = u * s.chord;
      const up = (camber + (top ? t : -t)) * s.chord;
      const ca = Math.cos(s.angle);
      const sa = Math.sin(s.angle);
      positions.push(s.x, GROUND + s.h + along * sa + up * ca, s.z - along * ca + up * sa);
    }
  }
  for (let r = 0; r < stations.length - 1; r++) {
    for (let k = 0; k < around; k++) {
      const a = r * around + k;
      const b = r * around + ((k + 1) % around);
      index.push(a, b, a + around, b, b + around, a + around);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return smoothNormals(flat, 0.3);
}

/** A thin flat plate in a plane of constant X: `outline` points (z, h above ground), `thick` across. */
function plate(x: number, outline: [number, number][], thick: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([z, h]) => new THREE.Vector2(z, h)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  // Shape X,Y = car Z, height; extrusion along car X.
  g.rotateY(-Math.PI / 2);
  g.translate(x + thick / 2, GROUND, 0);
  return g;
}

/** A rod from a to b (heights above ground), `r` thick, flattened like a carbon wishbone. */
function rod(a: [number, number, number], b: [number, number, number], r = 0.016): THREE.BufferGeometry {
  const pa = new THREE.Vector3(a[0], GROUND + a[1], a[2]);
  const pb = new THREE.Vector3(b[0], GROUND + b[1], b[2]);
  const len = pa.distanceTo(pb);
  const g = new THREE.CylinderGeometry(r, r, len, 5, 1, true);
  g.scale(1.8, 1, 0.7);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pb.clone().sub(pa).normalize());
  g.applyQuaternion(q);
  g.translate((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
  return g;
}

function bodywork(): { body: THREE.BufferGeometry; flap: THREE.BufferGeometry } {
  const parts = new Parts();
  // Survival cell and nose: main color on top, carbon underneath, second color along the nose.
  const cell: Station[] = [
    { z: 2.82, h: 0.235, w: 0.05, t: 0.04, n: 2.4 },
    { z: 2.65, h: 0.25, w: 0.09, t: 0.06 },
    { z: 2.35, h: 0.28, w: 0.13, t: 0.085 },
    { z: 2.0, h: 0.32, w: 0.17, t: 0.115 },
    { z: 1.65, h: 0.36, w: 0.21, t: 0.15 },
    { z: 1.25, h: 0.4, w: 0.25, t: 0.2 },
    { z: 0.85, h: 0.41, w: 0.28, t: 0.22 },
    { z: 0.55, h: 0.39, w: 0.29, t: 0.2 },
    { z: 0.1, h: 0.36, w: 0.3, t: 0.18 },
    { z: -0.25, h: 0.42, w: 0.3, t: 0.28 },
    { z: -0.7, h: 0.41, w: 0.27, t: 0.29 },
    { z: -1.1, h: 0.37, w: 0.21, t: 0.23 },
    { z: -1.5, h: 0.33, w: 0.15, t: 0.16 },
    { z: -1.9, h: 0.3, w: 0.11, t: 0.12 },
    { z: -2.28, h: 0.3, w: 0.07, t: 0.07, n: 2.5 },
  ];
  parts.add(loft(cell, 24), (x, y, z) => {
    const h = y - GROUND;
    if (h < 0.22) return CARBON;
    if (z > 1.6 && Math.abs(x) < 0.07) return SECONDARY;
    if (z < -0.3 && z > -1.6 && h > 0.6) return SECONDARY;
    return PRIMARY;
  });
  // The airbox over the driver's head, and its intake.
  parts.add(
    loft([
      { z: -0.02, h: 0.82, w: 0.1, t: 0.085, n: 2.6 },
      { z: -0.3, h: 0.8, w: 0.12, t: 0.11 },
      { z: -0.7, h: 0.71, w: 0.1, t: 0.08 },
      { z: -1.15, h: 0.6, w: 0.05, t: 0.05, n: 2.5 },
    ]),
    (_, y) => (y - GROUND > 0.84 ? ACCENT : SECONDARY),
  );
  parts.add(new THREE.CircleGeometry(0.075, 14).scale(1, 0.85, 1).translate(0, GROUND + 0.82, -0.015), DARK);
  // Shark fin down the engine cover.
  parts.add(plate(0, [[-0.55, 0.8], [-1.75, 0.6], [-1.75, 0.5], [-0.6, 0.66]], 0.012), SECONDARY);
  // Sidepods, with their intakes.
  for (const s of [-1, 1]) {
    parts.add(
      loft(
        [
          { z: 0.78, x: s * 0.56, h: 0.36, w: 0.19, t: 0.16 },
          { z: 0.45, x: s * 0.59, h: 0.35, w: 0.22, t: 0.19 },
          { z: 0.0, x: s * 0.57, h: 0.33, w: 0.22, t: 0.18 },
          { z: -0.5, x: s * 0.5, h: 0.29, w: 0.18, t: 0.15 },
          { z: -1.0, x: s * 0.39, h: 0.24, w: 0.12, t: 0.1 },
          { z: -1.45, x: s * 0.28, h: 0.2, w: 0.06, t: 0.06 },
        ],
        20,
      ),
      (_, y) => (y - GROUND < 0.24 ? SECONDARY : PRIMARY),
    );
    parts.add(new THREE.CircleGeometry(0.15, 16).scale(1, 0.75, 1).translate(s * 0.56, GROUND + 0.38, 0.785), DARK);
    // Mirror on its stalk.
    parts.add(rod([s * 0.28, 0.6, 0.78], [s * 0.47, 0.67, 0.74], 0.012), CARBON);
    parts.add(new THREE.BoxGeometry(0.17, 0.07, 0.06).translate(s * 0.5, GROUND + 0.68, 0.74), PRIMARY);
  }
  // The floor, its edges, and the diffuser rising at the back.
  const floor = new THREE.Shape([
    new THREE.Vector2(-0.3, 1.3),
    new THREE.Vector2(-0.82, 0.75),
    new THREE.Vector2(-0.86, -1.2),
    new THREE.Vector2(-0.58, -1.45),
    new THREE.Vector2(0.58, -1.45),
    new THREE.Vector2(0.86, -1.2),
    new THREE.Vector2(0.82, 0.75),
    new THREE.Vector2(0.3, 1.3),
  ]);
  parts.add(new THREE.ExtrudeGeometry(floor, { depth: 0.025, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, GROUND + 0.065, 0), CARBON);
  parts.add(
    wing(
      [-0.48, 0, 0.48].map((x) => ({ x, z: -1.45, h: 0.05, chord: 0.75, angle: 0.36 })),
      0.03,
    ),
    CARBON,
  );
  for (const s of [-1, 1]) parts.add(plate(s * 0.48, [[-1.45, 0.04], [-2.15, 0.33], [-2.15, 0.24], [-1.45, 0.02]], 0.01), CARBON);
  // Front wing: main plane and two flaps curling up toward the endplates.
  const front = (z: number, h: number, chord: number, angle: number, curl: number) =>
    [-0.92, -0.7, -0.45, -0.2, 0, 0.2, 0.45, 0.7, 0.92].map((x) => {
      const out = Math.max(0, Math.abs(x) - 0.25) / 0.67;
      return { x, z: z - out * 0.06, h: h + out * out * curl, chord, angle: angle + out * 0.2 };
    });
  parts.add(wing(front(3.0, 0.09, 0.32, 0.04, 0.03)), CARBON);
  parts.add(wing(front(2.76, 0.15, 0.21, 0.32, 0.1)), PRIMARY);
  parts.add(wing(front(2.6, 0.21, 0.15, 0.6, 0.14)), (x) => (Math.abs(x) > 0.75 ? ACCENT : CARBON));
  for (const s of [-1, 1]) parts.add(plate(s * 0.93, [[3.02, 0.04], [2.42, 0.04], [2.44, 0.28], [2.7, 0.3], [3.02, 0.12]], 0.012), CARBON);
  // Rear wing: main plane, endplates, the swan-neck pylon, and the beam wing below.
  const rear = (z: number, h: number, chord: number, angle: number) =>
    [-0.5, -0.25, 0, 0.25, 0.5].map((x) => ({ x, z: z + Math.abs(x) * 0.04, h: h - (0.5 - Math.abs(x)) * 0.03, chord, angle }));
  parts.add(wing(rear(-2.15, 0.86, 0.3, 0.2)), CARBON);
  parts.add(wing(rear(-1.98, 0.42, 0.18, 0.35)), CARBON);
  for (const s of [-1, 1]) parts.add(plate(s * 0.505, [[-2.0, 0.66], [-2.56, 0.62], [-2.6, 1.04], [-2.34, 1.1], [-2.04, 0.98]], 0.014), (_, y) => (y - GROUND > 0.96 ? PRIMARY : CARBON));
  for (const s of [-1, 1]) parts.add(plate(s * 0.06, [[-1.85, 0.42], [-2.0, 0.42], [-2.25, 0.88], [-2.12, 0.88]], 0.012), CARBON);
  // The halo round the cockpit.
  const halo = new THREE.CatmullRomCurve3(
    [
      [-0.32, 0.64, -0.12],
      [-0.33, 0.83, -0.05],
      [-0.27, 0.86, 0.22],
      [0, 0.87, 0.4],
      [0.27, 0.86, 0.22],
      [0.33, 0.83, -0.05],
      [0.32, 0.64, -0.12],
    ].map(([x, h, z]) => new THREE.Vector3(x, GROUND + h, z)),
  );
  parts.add(new THREE.TubeGeometry(halo, 40, 0.026, 8), CARBON);
  parts.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, GROUND + 0.87, 0.4), new THREE.Vector3(0, GROUND + 0.78, 0.56), new THREE.Vector3(0, GROUND + 0.62, 0.64)]), 8, 0.024, 6), CARBON);
  // The driver's helmet in the cockpit, visor forward.
  const helmet = new THREE.SphereGeometry(0.125, 16, 12).scale(0.95, 1, 1.08).translate(0, GROUND + 0.7, 0.02);
  parts.add(helmet, (_, y, z) => {
    const h = y - GROUND;
    if (z > 0.08 && h > 0.68 && h < 0.76) return DARK;
    return h > 0.77 ? ACCENT : SECONDARY;
  });
  // Suspension: wishbones, push rods, track rods and drive shafts.
  for (const s of [-1, 1]) {
    for (const [z, wheelZ] of [
      [1, F1.wheelZFront],
      [-1, F1.wheelZRear],
    ]) {
      const inner = z > 0 ? 0.2 : 0.14;
      const upper: [number, number, number] = [s * 0.66, 0.52, wheelZ];
      const lower: [number, number, number] = [s * 0.7, 0.22, wheelZ];
      parts.add(rod([s * inner, 0.5, wheelZ + 0.24], upper), CARBON);
      parts.add(rod([s * inner, 0.48, wheelZ - 0.24], upper), CARBON);
      parts.add(rod([s * inner, 0.28, wheelZ + 0.28], lower), CARBON);
      parts.add(rod([s * inner, 0.27, wheelZ - 0.28], lower), CARBON);
      parts.add(rod([s * (inner + 0.04), 0.3, wheelZ - 0.1 * z], [s * 0.64, 0.5, wheelZ + 0.03 * z], 0.013), CARBON);
      if (z < 0) parts.add(rod([s * 0.12, 0.34, wheelZ], [s * 0.7, 0.36, wheelZ], 0.022), DARK);
      else parts.add(rod([s * 0.2, 0.4, wheelZ + 0.12], [s * 0.67, 0.4, wheelZ + 0.12], 0.012), CARBON);
    }
  }
  // The rain light on the crash structure.
  parts.add(new THREE.BoxGeometry(0.1, 0.05, 0.03).translate(0, GROUND + 0.34, -2.3), DARK);

  const flap = new Parts();
  // DRS flap, built at its pivot (the leading edge), pitched closed by default.
  flap.add(wing([-0.5, -0.25, 0, 0.25, 0.5].map((x) => ({ x, z: 0, h: -GROUND, chord: 0.2, angle: 0 }))), (x) => (Math.abs(x) > 0.4 ? ACCENT : PRIMARY));
  return { body: parts.build(), flap: flap.build() };
}

/** Big low-profile tires on 18-inch rims with flat covers; front ones narrower. */
function wheelGeometry(width: number): { tire: THREE.BufferGeometry; stripe: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const r = F1.wheelRadius;
  const rim = 0.235;
  const w = width / 2;
  // Tire cross-section (radius, x), lathed round the axle.
  const profile: [number, number][] = [
    [rim, -w * 0.92],
    [rim + 0.04, -w * 1.0],
    [r - 0.03, -w * 0.98],
    [r - 0.005, -w * 0.88],
    [r, -w * 0.7],
    [r, w * 0.7],
    [r - 0.005, w * 0.88],
    [r - 0.03, w * 0.98],
    [rim + 0.04, w * 1.0],
    [rim, w * 0.92],
  ];
  const lathe = (pts: [number, number][], segments: number) =>
    new THREE.LatheGeometry(
      pts.map(([radius, x]) => new THREE.Vector2(radius, x)),
      segments,
    ).rotateZ(-Math.PI / 2);
  const tire = lathe(profile, 28);
  // The compound's colored band round both sidewalls.
  const band = (side: number) =>
    lathe(
      [
        [0.29, side * w * 1.005],
        [0.305, side * w * 1.002],
      ],
      28,
    );
  const stripe = mergeIndexed([band(-1), band(1)]);
  // Rims behind flat covers, with a dark hub nut that shows the wheel turning.
  const cover = (side: number) => new THREE.CylinderGeometry(rim, rim, 0.02, 24).rotateZ(Math.PI / 2).translate(side * w * 0.9, 0, 0);
  const nut = (side: number) => new THREE.BoxGeometry(0.03, 0.06, 0.12).translate(side * w * 0.95, 0.06, 0);
  const rimGeo = mergeIndexed([cover(-1), cover(1), nut(-1), nut(1)]);
  return { tire, stripe, rim: rimGeo };
}

function mergeIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal']) {
    const total = flat.reduce((n, g) => n + g.attributes[name].count, 0);
    const array = new Float32Array(total * 3);
    let offset = 0;
    for (const g of flat) {
      array.set(g.attributes[name].array as Float32Array, offset);
      offset += g.attributes[name].count * 3;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
  return out;
}

let shapes: ReturnType<typeof bodywork> | null = null;
let wheels: { front: ReturnType<typeof wheelGeometry>; rear: ReturnType<typeof wheelGeometry> } | null = null;
const tireMaterial = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.82 });
const stripeMaterial = new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.6 });
const coverMaterial = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.4, metalness: 0.6 });
const paints = new Map<Team, THREE.MeshPhysicalMaterial>();

/** Car paint: each vertex picks its team's color by its paint zone; carbon is darker and less glossy. */
function paintFor(team: Team): THREE.MeshPhysicalMaterial {
  let m = paints.get(team);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  const colors = [team.primary, team.secondary, team.accent, '#16171a', '#08090a'].map((c) => new THREE.Color(c));
  m.onBeforeCompile = (shader) => {
    shader.uniforms.zoneColors = { value: colors };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float paint;\nvarying float vPaint;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = paint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 zoneColors[5];\nvarying float vPaint;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nint zone = int(vPaint + 0.5);\ndiffuseColor.rgb = zoneColors[zone];',
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (zone >= 3) roughnessFactor = 0.5;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nif (zone >= 3) material.clearcoat = 0.15;');
  };
  m.customProgramCacheKey = () => 'f1-paint';
  paints.set(team, m);
  return m;
}

export class F1Model {
  readonly root = new THREE.Group();
  /** Bodywork leans with roll and pitch; the wheels stay planted. */
  private body = new THREE.Group();
  private wheels: THREE.Group[] = [];
  private flap: THREE.Object3D;
  private flapAngle = FLAP_CLOSED;
  private roll = 0;
  private pitch = 0;
  /** Small parts (tire stripes, wheel covers) and shadow casters, dropped when far away. */
  private details: THREE.Object3D[] = [];
  private casters: THREE.Mesh[] = [];
  private near = true;

  constructor(readonly team: Team) {
    shapes ??= bodywork();
    wheels ??= { front: wheelGeometry(0.37), rear: wheelGeometry(0.42) };
    const paint = paintFor(team);
    const body = new THREE.Mesh(shapes.body, paint);
    body.castShadow = body.receiveShadow = true;
    this.casters.push(body);
    this.body.add(body);
    // The DRS flap hinges at its leading edge, above and behind the main plane.
    const pivot = new THREE.Group();
    pivot.position.set(0, GROUND + 1.0, -2.33);
    const flap = new THREE.Mesh(shapes.flap, paint);
    flap.castShadow = true;
    pivot.add(flap);
    pivot.rotation.x = FLAP_CLOSED;
    this.flap = pivot;
    this.body.add(pivot);
    this.root.add(this.body);

    const spots: [number, number][] = [
      [F1.wheelX, F1.wheelZFront],
      [-F1.wheelX, F1.wheelZFront],
      [F1.wheelX, F1.wheelZRear],
      [-F1.wheelX, F1.wheelZRear],
    ];
    spots.forEach(([x, z], i) => {
      const geo = i < 2 ? wheels!.front : wheels!.rear;
      const wheel = new THREE.Group();
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(geo.tire, tireMaterial);
      tire.castShadow = true;
      this.casters.push(tire);
      const stripe = new THREE.Mesh(geo.stripe, stripeMaterial);
      const rim = new THREE.Mesh(geo.rim, coverMaterial);
      this.details.push(stripe, rim);
      spin.add(tire, stripe, rim);
      wheel.add(spin);
      wheel.position.set(x, WHEEL_Y, z);
      this.wheels.push(wheel);
      this.root.add(wheel);
    });
  }

  /** Close to the camera: all the detail and shadows; far: a simpler car, no shadow. */
  setNear(near: boolean): void {
    if (near === this.near) return;
    this.near = near;
    for (const d of this.details) d.visible = near;
    for (const m of this.casters) m.castShadow = near;
  }

  /** Poses one wheel. `suspension` is the current spring length. */
  setWheel(i: number, steer: number, rotation: number, suspension: number): void {
    const wheel = this.wheels[i];
    wheel.position.y = WHEEL_Y + SETTLED - suspension;
    wheel.rotation.y = steer;
    wheel.children[0].rotation.x = rotation;
  }

  /** Leans the bodywork from acceleration in the car's frame (m/s²), less than a road car: it's stiff. */
  lean(lateral: number, longitudinal: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.roll += (THREE.MathUtils.clamp(lateral * 0.0015, -MAX_ROLL, MAX_ROLL) - this.roll) * k;
    this.pitch += (THREE.MathUtils.clamp(-longitudinal * 0.0008, -MAX_PITCH, MAX_PITCH) - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);
  }

  /** Opens or closes the rear wing's top flap (DRS), swinging over a fraction of a second. */
  setDrs(open: boolean, dt: number): void {
    const target = open ? FLAP_OPEN : FLAP_CLOSED;
    this.flapAngle += (target - this.flapAngle) * (1 - Math.exp(-dt * 14));
    this.flap.rotation.x = this.flapAngle;
  }
}
