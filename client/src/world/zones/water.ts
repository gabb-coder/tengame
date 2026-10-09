import * as THREE from 'three';
import type { Shape, Water } from '../../../../shared/world.ts';
import { ribbon } from './roads.ts';
import type { ZoneMaterials } from './materials.ts';

/**
 * Surfaces for every body of water, lava and ice: the sea, rivers, ponds, the moat, the
 * volcano's lava lake and the frozen lake. Ripples drift and lava churns over time.
 */
export class WaterBodies {
  readonly group = new THREE.Group();
  private time = 0;

  constructor(
    waters: Water[],
    private zm: ZoneMaterials,
  ) {
    this.group.name = 'water';
    for (const w of waters) {
      const material = w.kind === 'sea' ? zm.sea : w.kind === 'lava' ? zm.lava : w.kind === 'ice' ? zm.ice : zm.water;
      // Rivers and ponds overlap their banks a little, so no gap shows at the shore.
      const geometry = surface(w.shape, w.level, w.kind === 'water' ? 3 : 0);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = w.kind === 'ice';
      mesh.renderOrder = w.kind === 'sea' || w.kind === 'water' ? 2 : 0;
      this.group.add(mesh);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    for (const mat of [this.zm.sea, this.zm.water]) {
      mat.normalMap!.offset.set(t * 0.006, t * 0.004);
    }
    const lava = this.zm.lava;
    lava.emissiveMap!.offset.set(Math.sin(t * 0.05) * 0.1, t * 0.004);
    lava.emissiveIntensity = 2.4 + Math.sin(t * 1.3) * 0.25 + Math.sin(t * 3.1) * 0.12;
  }
}

/** A flat surface covering `shape` at height `y`, grown by `grow` meters. */
function surface(shape: Shape, y: number, grow: number): THREE.BufferGeometry | null {
  switch (shape.type) {
    case 'rect': {
      const g = new THREE.PlaneGeometry(shape.maxX - shape.minX + 2 * grow, shape.maxZ - shape.minZ + 2 * grow, 1, 1);
      g.rotateX(-Math.PI / 2).translate((shape.minX + shape.maxX) / 2, y, (shape.minZ + shape.maxZ) / 2);
      return worldUv(g);
    }
    case 'circle': {
      const g = new THREE.CircleGeometry(shape.r + grow, 48);
      g.rotateX(-Math.PI / 2).translate(shape.x, y, shape.z);
      return worldUv(g);
    }
    case 'ring': {
      // Four strips around the square.
      const o = shape.outer + grow;
      const i = shape.inner - grow;
      const parts = [
        [shape.x, shape.z - (o + i) / 2, 2 * o, o - i],
        [shape.x, shape.z + (o + i) / 2, 2 * o, o - i],
        [shape.x - (o + i) / 2, shape.z, o - i, 2 * i],
        [shape.x + (o + i) / 2, shape.z, o - i, 2 * i],
      ].map(([x, z, w, d]) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x, y, z).toNonIndexed());
      const merged = new THREE.BufferGeometry();
      const positions = parts.flatMap((p) => [...(p.attributes.position.array as Float32Array)]);
      merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      merged.computeVertexNormals();
      return worldUv(merged);
    }
    case 'path':
      return ribbon(
        shape.path.map((p) => ({ x: p.x, y, z: p.z })),
        shape.width + 2 * grow,
      );
  }
}

/** UVs from world x/z (meters), so ripples keep their size on any surface. */
function worldUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) uv.set([pos.getX(i), -pos.getZ(i)], i * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
