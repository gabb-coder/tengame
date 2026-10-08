import * as THREE from 'three';

export const PLAYER_SIZE = new THREE.Vector3(1.6, 1, 2.6);

/** Placeholder vehicle-shaped box; replaced by a real car model in milestone 2. */
export function createPlayerMesh(color: string): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_SIZE.x, PLAYER_SIZE.y, PLAYER_SIZE.z),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Dark windshield strip on the front so the heading is visible.
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(PLAYER_SIZE.x * 0.9, 0.35, 0.6),
    new THREE.MeshStandardMaterial({ color: '#1b2430', roughness: 0.1, metalness: 0.8 }),
  );
  glass.position.set(0, PLAYER_SIZE.y / 2 + 0.1, -0.5);
  glass.castShadow = true;
  group.add(glass);

  return group;
}
