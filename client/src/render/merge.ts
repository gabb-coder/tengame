import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Replaces all the meshes under `root` with one mesh per material, directly under `root`,
 * looking the same. A model made of a hundred parts then costs a handful of draws instead
 * of a hundred. Subtrees in `keep` (parts that move by themselves) are left alone.
 */
export function mergeByMaterial(root: THREE.Object3D, keep: THREE.Object3D[] = []): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const parts: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (keep.includes(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.visible && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) parts.push(mesh);
    o.children.forEach(visit);
  };
  root.children.forEach(visit);
  if (!parts.length) return;

  const byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const mesh of parts) {
    const matrix = toRoot.clone().multiply(mesh.matrixWorld);
    const materials = [mesh.material].flat();
    // A mesh with several materials splits into its groups.
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      const g = slice(mesh.geometry, group.start, group.count, material.vertexColors).applyMatrix4(matrix);
      // A mirrored part would turn inside out once its mirroring is baked in.
      if (matrix.determinant() < 0) flipWinding(g);
      const list = byMaterial.get(material) ?? [];
      list.push(g);
      byMaterial.set(material, list);
    }
  }

  // Take the parts out, then the empty groups that held them.
  for (const mesh of parts) mesh.removeFromParent();
  const prune = (o: THREE.Object3D) => {
    [...o.children].forEach(prune);
    const container = o.type === 'Group' || o.type === 'Object3D';
    if (o !== root && container && !keep.includes(o) && o.children.length === 0) o.removeFromParent();
  };
  prune(root);

  const castShadow = parts.some((p) => p.castShadow);
  const receiveShadow = parts.some((p) => p.receiveShadow);
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    root.add(mesh);
  }
}

/**
 * A standalone indexed copy of part of `source`, with the same few attributes whatever it
 * started with (so the copies can be merged): position, normal, uv and, for materials that
 * use them, vertex colors.
 */
function slice(source: THREE.BufferGeometry, start: number, count: number, colors: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = source.attributes.position.count;
  const copy = (name: string, itemSize: number, fill: number) => {
    const a = source.getAttribute(name);
    const out = new Float32Array(n * itemSize).fill(fill);
    if (a) for (let i = 0; i < n; i++) for (let k = 0; k < Math.min(itemSize, a.itemSize); k++) out[i * itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  };
  copy('position', 3, 0);
  if (source.getAttribute('normal')) copy('normal', 3, 0);
  copy('uv', 2, 0);
  if (colors) copy('color', 3, 1);
  const index = source.index ? Array.from(source.index.array) : Array.from({ length: n }, (_, i) => i);
  g.setIndex(index.slice(start, Math.min(index.length, start + count)));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Reverses the order of each triangle's corners, turning it to face the other way. */
function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.index!;
  for (let i = 0; i + 2 < index.count; i += 3) {
    const b = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, b);
  }
}
