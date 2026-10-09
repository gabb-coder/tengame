import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CURB_HEIGHT, mulberry32, type Tree } from '../../../../shared/town.ts';
import { cylinderCollider } from './colliders.ts';
import type { TownMaterials } from './materials.ts';

const FOLIAGE_COLORS = ['#4f6b33', '#5d7a3a', '#3f5a2e', '#6b7f3c', '#486634'];
export const LAMP_HEIGHT = 6;
export const ARM_LENGTH = 1.6;

/**
 * Deciduous trees as instanced meshes (trunk + three foliage clumps).
 * `colliders` adds trunk colliders; skip it for backdrop trees outside the playable area.
 */
export function buildTrees(trees: Tree[], m: TownMaterials, physics: RAPIER.World | null, seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 7).translate(0, 0.5, 0);
  const clumpGeo = lumpySphere(1, rng);
  const trunks = new THREE.InstancedMesh(trunkGeo, m.bark, trees.length);
  const clumps = new THREE.InstancedMesh(clumpGeo, m.foliage, trees.length * 3);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();

  trees.forEach((t, i) => {
    const base = t.y ?? CURB_HEIGHT;
    const trunkHeight = t.height * 0.45;
    matrix.compose(new THREE.Vector3(t.x, base, t.z), q.identity(), new THREE.Vector3(1, trunkHeight, 1));
    trunks.setMatrixAt(i, matrix);
    const crown = t.height * 0.32;
    color.set(FOLIAGE_COLORS[Math.floor(rng() * FOLIAGE_COLORS.length)]);
    for (let c = 0; c < 3; c++) {
      const r = crown * (c === 0 ? 1 : 0.7 + rng() * 0.2);
      const angle = rng() * Math.PI * 2;
      const spread = c === 0 ? 0 : crown * 0.55;
      const pos = new THREE.Vector3(
        t.x + Math.cos(angle) * spread,
        base + trunkHeight + crown * (c === 0 ? 0.9 : 0.5 + rng() * 0.3),
        t.z + Math.sin(angle) * spread,
      );
      q.setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0));
      matrix.compose(pos, q, new THREE.Vector3(r, r * (0.8 + rng() * 0.2), r));
      clumps.setMatrixAt(i * 3 + c, matrix);
      clumps.setColorAt(i * 3 + c, color.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.06));
    }
    if (physics) cylinderCollider(physics, t.x, base, t.z, 0.25, trunkHeight + crown);
  });

  for (const mesh of [trunks, clumps]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** Street lamps: pole, arm toward local +Z, and a glowing head. */
export function buildLamps(positions: { x: number; z: number; yaw: number }[], m: TownMaterials, physics: RAPIER.World): THREE.Group {
  const group = new THREE.Group();
  const pole = new THREE.CylinderGeometry(0.07, 0.11, LAMP_HEIGHT, 8).translate(0, LAMP_HEIGHT / 2, 0);
  const arm = new THREE.CylinderGeometry(0.04, 0.05, ARM_LENGTH, 6)
    .rotateX(Math.PI / 2)
    .translate(0, LAMP_HEIGHT - 0.1, ARM_LENGTH / 2);
  const head = new THREE.BoxGeometry(0.35, 0.12, 0.6).translate(0, LAMP_HEIGHT - 0.2, ARM_LENGTH);
  const meshes = [
    new THREE.InstancedMesh(pole, m.darkMetal, positions.length),
    new THREE.InstancedMesh(arm, m.darkMetal, positions.length),
    new THREE.InstancedMesh(head, m.lampGlow, positions.length),
  ];
  const matrix = new THREE.Matrix4();
  positions.forEach((p, i) => {
    matrix.makeRotationY(p.yaw).setPosition(p.x, CURB_HEIGHT, p.z);
    meshes.forEach((mesh) => mesh.setMatrixAt(i, matrix));
    cylinderCollider(physics, p.x, CURB_HEIGHT, p.z, 0.12, LAMP_HEIGHT);
  });
  for (const mesh of meshes) {
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

/** Icosphere with its vertices pushed in and out a little so foliage isn't a perfect ball. */
function lumpySphere(radius: number, rng: () => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Displace by direction so shared vertices (split per face) move together.
  const offsets = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 0.82 + rng() * 0.3);
    v.multiplyScalar(offsets.get(key)!);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
