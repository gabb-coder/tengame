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

/** Horizontal rectangle facing up, with UVs in world meters / `tile`. */
export function flatRect(minX: number, minZ: number, maxX: number, maxZ: number, y: number, tile = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = [minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, minX, y, minZ, maxX, y, maxZ, maxX, y, minZ];
  const uvs: number[] = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / tile, -positions[i + 2] / tile);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
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
