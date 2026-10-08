import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface MeshOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
}

interface Bucket {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  options: MeshOptions;
}

/**
 * Collects many small static pieces and merges them into one mesh per material,
 * so a whole block of houses costs a handful of draw calls.
 */
export class MeshBuilder {
  private buckets = new Map<THREE.Material, Bucket>();

  /**
   * Adds `geometry` transformed by `matrix`. The geometry is copied, not consumed.
   * `color` tints this piece via vertex colors (for materials with `vertexColors`).
   */
  add(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    matrix: THREE.Matrix4,
    color?: THREE.ColorRepresentation,
    options: MeshOptions = {},
  ): void {
    let bucket = this.buckets.get(material);
    if (!bucket) {
      bucket = { material, geometries: [], options: { castShadow: true, receiveShadow: true, ...options } };
      this.buckets.set(material, bucket);
    }
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    // Every piece gets a color attribute so all geometries can be merged.
    const c = new THREE.Color(color ?? 0xffffff);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    bucket.geometries.push(g);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const { material, geometries, options } of this.buckets.values()) {
      const merged = mergeGeometries(geometries);
      geometries.forEach((g) => g.dispose());
      if (!merged) throw new Error(`could not merge geometry for ${name}`);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = options.castShadow ?? true;
      mesh.receiveShadow = options.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/**
 * Box whose UVs are in meters / `tile`, so textures keep a constant scale on any size of box.
 * Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each).
 */
export function box(width: number, height: number, depth: number, tile = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(width, height, depth);
  const faceSizes: [number, number][] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  faceSizes.forEach(([u, v], face) => {
    for (let i = face * 4; i < face * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * u) / tile, (uv.getY(i) * v) / tile);
  });
  return g;
}

/** Horizontal rectangle facing up (or down, for ceilings), with UVs in world meters / `tile`. */
export function flatRect(minX: number, minZ: number, maxX: number, maxZ: number, y: number, tile = 1, facingDown = false): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const up = [minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, minX, y, minZ, maxX, y, maxZ, maxX, y, minZ];
  const down = [minX, y, minZ, maxX, y, maxZ, minX, y, maxZ, minX, y, minZ, maxX, y, minZ, maxX, y, maxZ];
  const positions = facingDown ? down : up;
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / tile, -positions[i + 2] / tile);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array(18).fill(0).map((_, i) => (i % 3 === 1 ? (facingDown ? -1 : 1) : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Box spanning `min`..`max` whose UVs come from its position (meters / `tile`), so
 * textures line up across neighboring boxes, e.g. wall segments around windows.
 */
export function projectedBox(min: THREE.Vector3Like, max: THREE.Vector3Like, tile = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z).translate(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );
  const pos = g.attributes.position as THREE.BufferAttribute;
  const normal = g.attributes.normal as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [nx, ny] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i))];
    if (ny > 0.5) uv.setXY(i, x / tile, z / tile);
    else if (nx > 0.5) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  return g;
}

/** A rectangle in a wall's plane: `u` along the wall, `v` up. */
export interface WallRect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Splits a wall from `lo` to `hi` (along it) and `bottom` to `top` into solid pieces
 * around rectangular openings, which may overlap along the wall (a window above a door).
 * The wall is cut into vertical strips at every opening edge; each strip is filled
 * between the openings that span it. Neighboring strips with the same layout merge.
 */
export function wallPieces(lo: number, hi: number, bottom: number, top: number, openings: { center: number; width: number; bottom: number; top: number }[]): WallRect[] {
  const eps = 1e-4;
  const holes = openings
    .filter((o) => o.top > bottom && o.bottom < top)
    .map((o) => ({ u0: Math.max(lo, o.center - o.width / 2), u1: Math.min(hi, o.center + o.width / 2), v0: Math.max(bottom, o.bottom), v1: Math.min(top, o.top) }))
    .filter((o) => o.u1 - o.u0 > eps);
  const cuts = [...new Set([lo, hi, ...holes.flatMap((o) => [o.u0, o.u1])])].sort((a, b) => a - b);
  const pieces: WallRect[] = [];
  let previous: { key: string; pieces: WallRect[] } | null = null;
  for (let i = 0; i < cuts.length - 1; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    if (b - a < eps) continue;
    const spanning = holes.filter((o) => o.u0 <= a + eps && o.u1 >= b - eps).sort((x, y) => x.v0 - y.v0);
    const strip: WallRect[] = [];
    let cursor = bottom;
    for (const o of spanning) {
      if (o.v0 > cursor + eps) strip.push({ u0: a, u1: b, v0: cursor, v1: o.v0 });
      cursor = Math.max(cursor, o.v1);
    }
    if (cursor < top - eps) strip.push({ u0: a, u1: b, v0: cursor, v1: top });
    const key = strip.map((r) => `${r.v0.toFixed(4)}:${r.v1.toFixed(4)}`).join('|');
    if (previous && previous.key === key) {
      // Same vertical layout as the strip to the left: widen those pieces instead.
      for (const r of previous.pieces) r.u1 = b;
      continue;
    }
    pieces.push(...strip);
    previous = { key, pieces: strip };
  }
  return pieces;
}

export const IDENTITY = new THREE.Matrix4();

/** Matrix from position, yaw and optional pitch/roll. */
export function placement(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
}
