import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';
import { generateWorld, shapeBounds, shapeDistance, type Shape, waterAt, type ZoneId } from '../../../../shared/world.ts';
import type { Media } from '../../assets/media.ts';
import type { Terrain } from '../terrain.ts';
import type { TownMaterials } from '../town/materials.ts';
import { MeshBuilder, type MeshOptions } from '../town/meshBuilder.ts';
import type { ZoneMaterials } from './materials.ts';

/** What a zone's builder gets to work with. */
export interface ZoneContext {
  scene: THREE.Scene;
  physics: RAPIER.World;
  m: TownMaterials;
  zm: ZoneMaterials;
  terrain: Terrain;
  media: Media;
  lights: LightPool;
}

/** What a zone's builder makes: its objects, and how they move. */
export interface ZoneContent {
  id: ZoneId;
  group: THREE.Group;
  /** Called every frame while the camera is in or near the zone. */
  update?(view: ZoneView): void;
}

export interface ZoneView {
  dt: number;
  /** Seconds since the game started. */
  time: number;
  /** Shared wall-clock seconds, the same on every player's screen (for timed events). */
  clock: number;
  camera: THREE.Camera;
  focus: THREE.Vector3;
  /** 0 by day, 1 at night. */
  night: number;
}

// ---------------------------------------------------------------------------
// Merged static geometry, split into chunks so off-screen parts are culled.

const CHUNK = 100;
const IDENTITY_MATRIX = new THREE.Matrix4();

/** Like MeshBuilder, but each piece goes to the chunk its position falls in. */
export class ChunkedBuilder {
  private chunks = new Map<string, MeshBuilder>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4, color?: THREE.ColorRepresentation, options?: MeshOptions): void {
    const x = matrix.elements[12];
    const z = matrix.elements[14];
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.chunks.get(key);
    if (!b) this.chunks.set(key, (b = new MeshBuilder()));
    // Textured round shapes (cylinders, cones, spheres) come with 0..1 UVs: give them UVs in
    // meters, projected in the world, so textures keep their real size. (Boxes from box()
    // already have meter UVs.)
    if ((material as THREE.MeshStandardMaterial).map && !(geometry instanceof THREE.BoxGeometry) && !geometry.userData.keepUv) {
      const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      b.add(withWorldUv(g, 1), material, IDENTITY_MATRIX, color, options);
      g.dispose();
      return;
    }
    b.add(geometry, material, matrix, color, options);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, b] of this.chunks) group.add(b.build(`${name}-${key}`));
    this.chunks.clear();
    return group;
  }
}

/** Many copies of one shape, as instanced meshes split into chunks. */
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  items: { matrix: THREE.Matrix4; color?: THREE.ColorRepresentation }[],
  /** `detail`: small things, only drawn within this many meters of the camera. */
  options: MeshOptions & { chunk?: number; detail?: number } = {},
): THREE.Group {
  const group = new THREE.Group();
  const size = options.chunk ?? 150;
  const buckets = new Map<string, typeof items>();
  for (const item of items) {
    const key = `${Math.floor(item.matrix.elements[12] / size)},${Math.floor(item.matrix.elements[14] / size)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  const color = new THREE.Color();
  // Materials tinted per piece expect a color attribute; give plain shapes a white one.
  if ((material as THREE.MeshStandardMaterial).vertexColors && !geometry.attributes.color) {
    geometry = geometry.clone();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geometry.attributes.position.count * 3).fill(1), 3));
  }
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      if (item.color !== undefined) mesh.setColorAt(i, color.set(item.color));
    });
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.computeBoundingSphere();
    if (options.detail) mesh.userData.maxDistance = options.detail;
    group.add(mesh);
  }
  return group;
}

export function compose(x: number, y: number, z: number, yaw = 0, scale: number | THREE.Vector3Like = 1, pitch = 0, roll = 0): THREE.Matrix4 {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale.x, scale.y, scale.z);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), s);
}

// ---------------------------------------------------------------------------
// Where things can go.

const CLAIM_CELL = 8;

/** Keeps scattered things (trees, rocks) off roads, pads, water and claimed spots. */
export class Placement {
  /** Claimed circles, bucketed by grid cell. */
  private claimed = new Map<number, { x: number; z: number; r: number }[]>();
  private shapes: { shape: Shape; margin: number; bounds: ReturnType<typeof shapeBounds> }[] = [];

  constructor(zone: ZoneId) {
    const world = generateWorld();
    for (const road of world.roads) this.avoid({ type: 'path', path: road.path, width: road.width }, 3);
    const layout = world.zones.find((z) => z.id === zone);
    for (const pad of layout?.pads ?? []) this.avoid(pad.shape, 2);
    for (const h of world.houses) this.claim(h.x, h.z, Math.hypot(h.width, h.depth) / 2 + 4);
  }

  /** Marks a circle as taken. */
  claim(x: number, z: number, r: number): void {
    const c = { x, z, r };
    for (let i = Math.floor((x - r) / CLAIM_CELL); i <= Math.floor((x + r) / CLAIM_CELL); i++) {
      for (let j = Math.floor((z - r) / CLAIM_CELL); j <= Math.floor((z + r) / CLAIM_CELL); j++) {
        const key = (i + 5000) * 10000 + (j + 5000);
        let list = this.claimed.get(key);
        if (!list) this.claimed.set(key, (list = []));
        list.push(c);
      }
    }
  }

  /** Marks a shape as taken. */
  avoid(shape: Shape, margin = 0): void {
    this.shapes.push({ shape, margin, bounds: shapeBounds(shape, margin + 20) });
  }

  /** Whether a thing of radius `r` fits at (x, z). */
  free(x: number, z: number, r = 1, allowWater = false): boolean {
    if (!allowWater && waterAt(x, z)) return false;
    for (let i = Math.floor((x - r) / CLAIM_CELL); i <= Math.floor((x + r) / CLAIM_CELL); i++) {
      for (let j = Math.floor((z - r) / CLAIM_CELL); j <= Math.floor((z + r) / CLAIM_CELL); j++) {
        for (const c of this.claimed.get((i + 5000) * 10000 + (j + 5000)) ?? []) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
      }
    }
    for (const s of this.shapes) {
      const b = s.bounds;
      if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
      if (shapeDistance(s.shape, x, z) < s.margin + r) return false;
    }
    return true;
  }

  /**
   * Up to `count` random free spots in a rectangle, each claimed with radius `r`.
   * `accept` can veto spots (e.g. by height or slope).
   */
  scatter(
    count: number,
    area: { minX: number; minZ: number; maxX: number; maxZ: number },
    r: number,
    seed: number,
    accept: (x: number, z: number, rng: () => number) => boolean = () => true,
    allowWater = false,
  ): { x: number; z: number; rng: () => number }[] {
    const rng = mulberry32(seed);
    const out: { x: number; z: number; rng: () => number }[] = [];
    for (let tries = 0; tries < count * 12 && out.length < count; tries++) {
      const x = area.minX + rng() * (area.maxX - area.minX);
      const z = area.minZ + rng() * (area.maxZ - area.minZ);
      if (!this.free(x, z, r, allowWater) || !accept(x, z, rng)) continue;
      this.claim(x, z, r);
      out.push({ x, z, rng });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Shapes.

/** A lumpy rock: an icosphere with its vertices pushed in and out. */
export function rockGeometry(seed: number, detail = 1, roughness = 0.35): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const offsets = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 - roughness / 2 + rng() * roughness);
    v.multiplyScalar(offsets.get(key)!);
    // Flatter underside, so rocks sit on the ground.
    if (v.y < 0) v.y *= 0.55;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return withWorldUv(g, 1);
}

/** Planar UVs from object x/z and y, scaled by `scale`, for textured props. */
export function withWorldUv(g: THREE.BufferGeometry, scale: number): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const normal = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [nx, ny] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i))];
    if (ny > 0.6) uv.set([x * scale, z * scale], i * 2);
    else if (nx > 0.6) uv.set([z * scale, y * scale], i * 2);
    else uv.set([x * scale, y * scale], i * 2);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A conifer: stacked drooping cones (with snow on top if `snowy`), trunk at the origin. */
export function conifer(snowy: boolean): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; snow: THREE.BufferGeometry | null } {
  const trunk = new THREE.CylinderGeometry(0.12, 0.22, 1, 6).translate(0, 0.5, 0);
  const layers: THREE.BufferGeometry[] = [];
  const snowLayers: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const r = 1 - i * 0.22;
    const y = 0.25 + i * 0.2;
    layers.push(new THREE.ConeGeometry(r * 0.42, 0.34, 9, 1, true).translate(0, y + 0.17, 0));
    if (snowy) snowLayers.push(new THREE.ConeGeometry(r * 0.36, 0.16, 9, 1, true).translate(0, y + 0.27, 0));
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    const g = mergeAll(list);
    g.computeVertexNormals();
    return g;
  };
  return { trunk, crown: merge(layers), snow: snowy ? merge(snowLayers) : null };
}

/** Merges geometries (non-indexed, positions and normals only, plus UVs if all have them). */
export function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!flat.every((g) => g.attributes[name])) continue;
    const size = flat[0].attributes[name].itemSize;
    const total = flat.reduce((n, g) => n + g.attributes[name].count, 0);
    const array = new Float32Array(total * size);
    let offset = 0;
    for (const g of flat) {
      array.set(g.attributes[name].array as Float32Array, offset);
      offset += g.attributes[name].count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

/** A surface of revolution from (radius, height) pairs, with UVs. */
export function lathe(points: [number, number][], segments = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

// ---------------------------------------------------------------------------
// Colliders.

export function cylinderCollider(physics: RAPIER.World, x: number, y: number, z: number, radius: number, height: number): void {
  physics.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y + height / 2, z));
}

export function ballCollider(physics: RAPIER.World, x: number, y: number, z: number, radius: number): void {
  physics.createCollider(RAPIER.ColliderDesc.ball(radius).setTranslation(x, y, z));
}

/** A static collider shaped like `geometry` placed by `matrix` (exact, for solid landmarks). */
export function meshCollider(physics: RAPIER.World, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.applyMatrix4(matrix);
  const vertices = g.attributes.position.array as Float32Array;
  const indices = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), indices));
  g.dispose();
}

/** A static convex collider around `geometry` placed by `matrix`. */
export function hullOf(physics: RAPIER.World, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
  const pos = geometry.attributes.position;
  const points = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    points.set([v.x, v.y, v.z], i * 3);
  }
  const desc = RAPIER.ColliderDesc.convexHull(points);
  if (desc) physics.createCollider(desc);
}

// ---------------------------------------------------------------------------
// Lights.

export interface LightSource {
  position: THREE.Vector3;
  color: THREE.ColorRepresentation;
  intensity: number;
  range: number;
  /** Only lit when this says so (e.g. a fire that's burning, or at night). */
  active?: () => boolean;
  /** Fires flicker. */
  flicker?: boolean;
}

const POOL = 6;

/**
 * A few real point lights shared by every glowing thing in the zones (fires, braziers,
 * neon, lava): each goes to the nearest active sources. A fixed number of lights keeps
 * shaders from recompiling.
 */
export class LightPool {
  private sources: LightSource[] = [];
  private lights: THREE.PointLight[] = [];
  private assigned: (LightSource | null)[] = [];
  private since = Infinity;
  private time = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight('#ffffff', 0, 20, 1.6);
      light.visible = false;
      scene.add(light);
      this.lights.push(light);
      this.assigned.push(null);
    }
  }

  add(source: LightSource): void {
    this.sources.push(source);
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    this.since += dt;
    if (this.since > 0.4) {
      this.since = 0;
      const near = this.sources
        .filter((s) => (s.active?.() ?? true) && s.position.distanceToSquared(camera) < (s.range + 60) ** 2)
        .sort((a, b) => a.position.distanceToSquared(camera) - b.position.distanceToSquared(camera))
        .slice(0, POOL);
      this.lights.forEach((light, i) => {
        const s = near[i] ?? null;
        this.assigned[i] = s;
        light.visible = !!s;
        if (!s) return;
        light.position.copy(s.position);
        light.color.set(s.color);
        light.distance = s.range;
      });
    }
    this.lights.forEach((light, i) => {
      const s = this.assigned[i];
      if (!s) return;
      const flicker = s.flicker ? 0.82 + 0.18 * Math.sin(this.time * 13 + i * 3) * Math.sin(this.time * 7.3 + i) : 1;
      light.intensity = s.intensity * flicker;
    });
  }
}

/** A seeded random generator, re-exported for zone builders. */
export { mulberry32 };

/**
 * A palm tree of unit height: a gently curving ringed trunk, and drooping fronds. Scale
 * it by its height.
 */
export function palm(seed: number): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  const rng = mulberry32(seed);
  const segments: THREE.BufferGeometry[] = [];
  const lean = 0.08 + rng() * 0.1;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const g = new THREE.CylinderGeometry(0.028 - t1 * 0.008, 0.034 - t0 * 0.008, 1 / n + 0.004, 7);
    // Bulge rings: each segment a touch wider at its base.
    g.translate(lean * t0 * t0 * 2, (t0 + t1) / 2, 0);
    segments.push(g);
  }
  const top = new THREE.Vector3(lean * 2, 1, 0);
  const fronds: THREE.BufferGeometry[] = [];
  const count = 9;
  for (let k = 0; k < count; k++) {
    const yaw = (k / count) * Math.PI * 2 + rng() * 0.3;
    const len = 0.42 + rng() * 0.12;
    const pos: number[] = [];
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const a = s / steps;
      const b = (s + 1) / steps;
      // Arching out and drooping down along the frond.
      const point = (t: number, side: number) => {
        const out = t * len;
        const drop = 0.15 * t - 0.35 * t * t;
        const w = Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.07 * side;
        return new THREE.Vector3(Math.cos(yaw) * out - Math.sin(yaw) * w, drop, Math.sin(yaw) * out + Math.cos(yaw) * w).add(top);
      };
      const [p0, p1, q0, q1] = [point(a, -1), point(a, 1), point(b, -1), point(b, 1)];
      const spine0 = point(a, 0).setY(point(a, 0).y + 0.012);
      const spine1 = point(b, 0).setY(point(b, 0).y + 0.012);
      for (const v of [p0, spine0, q0, spine0, spine1, q0, spine0, p1, spine1, p1, q1, spine1]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    fronds.push(g);
  }
  const trunk = mergeAll(segments);
  const crown = mergeAll(fronds);
  return { trunk, fronds: crown };
}

/** Palms at the given spots: two instanced meshes (trunks, fronds) plus trunk colliders. */
export function palms(
  spots: { x: number; y: number; z: number; height: number; yaw: number }[],
  ctx: Pick<ZoneContext, 'physics' | 'm'>,
  frondMaterial: THREE.Material,
  seed = 1,
): THREE.Group {
  const shape = palm(seed);
  const items = spots.map((s) => ({ matrix: compose(s.x, s.y - 0.1, s.z, s.yaw, s.height) }));
  const group = new THREE.Group();
  group.add(instanced(shape.trunk, ctx.m.bark, items.map((i) => ({ ...i, color: '#b09878' }))));
  group.add(instanced(shape.fronds, frondMaterial, items.map((i, k) => ({ ...i, color: k % 3 ? '#4f7a32' : '#5d8a3a' }))));
  for (const s of spots) cylinderCollider(ctx.physics, s.x, s.y, s.z, 0.3, s.height * 0.6);
  return group;
}

/**
 * A boat hull, `length` long (bow toward +Z), `beam` wide and `depth` deep, open at the
 * top (deck at y = 0). UVs in meters.
 */
export function hull(length: number, beam: number, depth: number): THREE.BufferGeometry {
  const rings = 14;
  const around = 9;
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const z = (t - 0.5) * length;
    // Pointed bow, rounder stern.
    const width = beam / 2 * (t > 0.6 ? Math.cos(((t - 0.6) / 0.4) * (Math.PI / 2)) ** 0.8 : 0.82 + 0.18 * Math.sin((t / 0.6) * (Math.PI / 2)));
    const keel = depth * (t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.6 : 1);
    const sheer = 0.25 * depth * (t - 0.5) ** 2 * 4;
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI;
      positions.push(-Math.cos(a) * width, -Math.sin(a) * keel + sheer * (1 - Math.sin(a)), z);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let k = 0; k < around; k++) {
      const p = i * (around + 1) + k;
      const q = p + around + 1;
      index.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return withWorldUv(g.toNonIndexed(), 1);
}

/** A fern of unit size: fronds rising from the middle, arching out and drooping. */
export function fern(seed: number, count = 9): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const fronds: THREE.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const yaw = (k / count) * Math.PI * 2 + rng() * 0.4;
    const len = 0.8 + rng() * 0.3;
    const lift = 0.5 + rng() * 0.3;
    const pos: number[] = [];
    const steps = 6;
    const point = (t: number, side: number) => {
      const out = t * len;
      const up = lift * t * (1.6 - 1.4 * t);
      const w = Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.13 * side;
      return new THREE.Vector3(Math.cos(yaw) * out - Math.sin(yaw) * w, up, Math.sin(yaw) * out + Math.cos(yaw) * w);
    };
    for (let s = 0; s < steps; s++) {
      const a = s / steps;
      const b = (s + 1) / steps;
      const [p0, p1, q0, q1, m0, m1] = [point(a, -1), point(a, 1), point(b, -1), point(b, 1), point(a, 0), point(b, 0)];
      m0.y += 0.02;
      m1.y += 0.02;
      for (const v of [p0, m0, q0, m0, m1, q0, m0, p1, m1, p1, q1, m1]) pos.push(v.x, v.y, v.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    fronds.push(g);
  }
  return mergeAll(fronds);
}

/**
 * Billowing puffs (smoke, steam) rising from a source, as one instanced mesh. Each puff
 * grows and drifts with the wind, then shrinks away.
 */
export class Puffs {
  readonly mesh: THREE.InstancedMesh;
  private seeds: { phase: number; dx: number; dz: number; spin: number }[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(
    count: number,
    color: string,
    opacity: number,
    private opts: { x: number; y: number; z: number; spread: number; rise: number; grow: number; life: number; size: number; wind?: [number, number] },
    seed = 1,
  ) {
    const rng = mulberry32(seed);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity, depthWrite: false, flatShading: true });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, count);
    this.mesh.frustumCulled = false;
    this.seeds = Array.from({ length: count }, () => ({ phase: rng(), dx: (rng() - 0.5) * 2, dz: (rng() - 0.5) * 2, spin: rng() * 6 }));
  }

  /** `strength` (0..1+) scales how big and fast the plume is. */
  update(t: number, strength = 1): void {
    const o = this.opts;
    const [wx, wz] = o.wind ?? [0.3, 0.1];
    this.seeds.forEach((s, i) => {
      const age = ((t / o.life + s.phase) % 1) * o.life;
      const k = age / o.life;
      const size = (o.size + age * o.grow) * Math.sin(Math.PI * Math.min(1, k * 1.3)) * strength;
      this.v.set(o.x + s.dx * o.spread + wx * age * o.rise, o.y + age * o.rise * strength, o.z + s.dz * o.spread + wz * age * o.rise);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.spin + t * 0.1);
      this.m.compose(this.v, this.q, this.s.setScalar(Math.max(0.001, size)));
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
