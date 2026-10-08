import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const scale = new THREE.Vector3();

/** Static box collider; `center` is in the local space of `matrix`. */
export function boxCollider(
  world: RAPIER.World,
  matrix: THREE.Matrix4,
  center: THREE.Vector3Like,
  size: THREE.Vector3Like,
): RAPIER.Collider {
  const local = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
  new THREE.Matrix4().multiplyMatrices(matrix, local).decompose(position, rotation, scale);
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation),
  );
}

/** Static convex hull from points in the local space of `matrix`. */
export function hullCollider(world: RAPIER.World, matrix: THREE.Matrix4, points: THREE.Vector3[]): RAPIER.Collider | null {
  const flat = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    const w = p.clone().applyMatrix4(matrix);
    flat.set([w.x, w.y, w.z], i * 3);
  });
  const desc = RAPIER.ColliderDesc.convexHull(flat);
  return desc ? world.createCollider(desc) : null;
}

/** Static upright cylinder standing on `y`. */
export function cylinderCollider(world: RAPIER.World, x: number, y: number, z: number, radius: number, height: number): void {
  world.createCollider(RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, y + height / 2, z));
}
