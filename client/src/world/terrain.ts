import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { fbm, smoothstep } from '../../../shared/noise.ts';
import { SEA_LEVEL, TERRAIN_HALF, TERRAIN_STEP, terrainSamples, waterAt, zoneAt, type ZoneId } from '../../../shared/world.ts';

/** Ground meshes are cut into square chunks this big, so off-screen ones are skipped. */
const CHUNK = 200;
/** The town draws its own ground (blocks, roads, sidewalks) inside this square. */
const TOWN_HOLE = 156;

/**
 * The ground everywhere outside the town's blocks: one height grid shared by a Rapier
 * heightfield (for driving and walking) and chunked meshes (one material per zone), so
 * what you see is exactly what you drive on.
 */
export class Terrain {
  readonly n: number;
  readonly heights: Float32Array;
  readonly group = new THREE.Group();

  constructor(physics: RAPIER.World, materials: Record<ZoneId, THREE.Material>) {
    const step = TERRAIN_STEP;
    this.heights = terrainSamples(step);
    this.n = Math.round((2 * TERRAIN_HALF) / step) + 1;
    const cells = this.n - 1;
    const size = 2 * TERRAIN_HALF;
    physics.createCollider(RAPIER.ColliderDesc.heightfield(cells, cells, this.heights, { x: size, y: 1, z: size }).setFriction(0.9));

    this.group.name = 'terrain';
    const perChunk = CHUNK / step;
    for (let cz = -TERRAIN_HALF; cz < TERRAIN_HALF; cz += CHUNK) {
      for (let cx = -TERRAIN_HALF; cx < TERRAIN_HALF; cx += CHUNK) {
        const zone = zoneAt(cx + CHUNK / 2, cz + CHUNK / 2);
        const geometry = this.chunk((cx + TERRAIN_HALF) / step, (cz + TERRAIN_HALF) / step, perChunk, zone);
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, materials[zone]);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = `terrain-${zone}`;
        this.group.add(mesh);
      }
    }
  }

  /** Ground height at (x, z), interpolated like the heightfield's triangles. */
  heightAt(x: number, z: number): number {
    const fx = (x + TERRAIN_HALF) / TERRAIN_STEP;
    const fz = (z + TERRAIN_HALF) / TERRAIN_STEP;
    const i = Math.min(this.n - 2, Math.max(0, Math.floor(fx)));
    const j = Math.min(this.n - 2, Math.max(0, Math.floor(fz)));
    const u = fx - i;
    const v = fz - j;
    const h = (a: number, b: number) => this.heights[a * this.n + b];
    // Same diagonal split as the mesh below.
    return u + v < 1 ? h(i, j) + (h(i + 1, j) - h(i, j)) * u + (h(i, j + 1) - h(i, j)) * v : h(i + 1, j + 1) + (h(i, j + 1) - h(i + 1, j + 1)) * (1 - u) + (h(i + 1, j) - h(i + 1, j + 1)) * (1 - v);
  }

  /** One chunk's mesh: grid cells i0.., j0.. (x, z), or null if it's all under the town. */
  private chunk(i0: number, j0: number, cells: number, zone: ZoneId): THREE.BufferGeometry | null {
    const { n, heights } = this;
    const step = TERRAIN_STEP;
    const at = (i: number, j: number) => ({ x: -TERRAIN_HALF + i * step, z: -TERRAIN_HALF + j * step });
    const verts = cells + 1;
    const positions = new Float32Array(verts * verts * 3);
    const uvs = new Float32Array(verts * verts * 2);
    const colors = new Float32Array(verts * verts * 3);
    const rock = new Float32Array(verts * verts);
    const normals = new Float32Array(verts * verts * 3);
    const tint = new THREE.Color();
    for (let a = 0; a < verts; a++) {
      for (let b = 0; b < verts; b++) {
        const i = i0 + a;
        const j = j0 + b;
        const k = a * verts + b;
        const { x, z } = at(i, j);
        const y = heights[i * n + j];
        positions.set([x, y, z], k * 3);
        uvs.set([x, -z], k * 2);
        // Normal from neighboring samples (central differences).
        const hx = heights[Math.min(n - 1, i + 1) * n + j] - heights[Math.max(0, i - 1) * n + j];
        const hz = heights[i * n + Math.min(n - 1, j + 1)] - heights[i * n + Math.max(0, j - 1)];
        const nrm = new THREE.Vector3(-hx, 2 * step, -hz).normalize();
        normals.set([nrm.x, nrm.y, nrm.z], k * 3);
        const look = groundLook(zone, x, y, z, nrm.y, tint);
        rock[k] = look;
        colors.set([tint.r, tint.g, tint.b], k * 3);
      }
    }
    const index: number[] = [];
    for (let a = 0; a < cells; a++) {
      for (let b = 0; b < cells; b++) {
        const { x, z } = at(i0 + a, j0 + b);
        // Leave a hole where the town's blocks and roads are.
        if (x >= -TOWN_HOLE && x + step <= TOWN_HOLE && z >= -TOWN_HOLE && z + step <= TOWN_HOLE) continue;
        const p = a * verts + b;
        const q = (a + 1) * verts + b;
        // Triangles (i,j)-(i,j+1)-(i+1,j) and (i+1,j+1)-(i+1,j)-(i,j+1), counter-clockwise from above.
        index.push(p, p + 1, q, q + 1, q, p + 1);
      }
    }
    if (index.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('rock', new THREE.BufferAttribute(rock, 1));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * How the ground looks at a point: returns how rocky it is (0 = the zone's ground cover,
 * 1 = bare rock) and sets `tint` to a color the textures are multiplied by.
 */
function groundLook(zone: ZoneId, x: number, y: number, z: number, up: number, tint: THREE.Color): number {
  const steep = 1 - smoothstep(up, 0.72, 0.9);
  const vary = fbm(x / 35, z / 35, 2, 91) * 0.08;
  let rock = steep;
  tint.setRGB(1 + vary, 1 + vary, 1 + vary);
  switch (zone) {
    case 'arctic':
    case 'medieval': {
      // Snowy peaks: high ground stays white even where it's steep.
      const snow = smoothstep(y, zone === 'arctic' ? 35 : 70, zone === 'arctic' ? 60 : 100);
      rock *= 1 - snow * 0.85;
      if (zone === 'arctic') tint.offsetHSL(0.55, 0.05, 0);
      break;
    }
    case 'ocean': {
      // Wet, darker sand under water, darkest in the deep.
      const depth = Math.max(0, SEA_LEVEL - y);
      const dark = 1 - Math.min(0.55, depth * 0.035);
      tint.multiplyScalar(dark);
      if (depth > 0) tint.lerp(new THREE.Color(0.75, 0.85, 0.85), 0.2);
      rock = steep * 0.7 + smoothstep(fbm(x / 20, z / 20, 2, 92), 0.25, 0.5) * 0.4 * (depth > 2 ? 1 : 0);
      break;
    }
    case 'prehistoric': {
      // The volcano's upper slopes are bare, dark rock.
      rock = Math.max(rock, smoothstep(y, 18, 45));
      break;
    }
    case 'jungle': {
      const w = waterAt(x, z);
      if (w && y < w.level + 0.5) rock = Math.max(rock, 0.6);
      break;
    }
    default:
      break;
  }
  return Math.min(1, Math.max(0, rock));
}

/**
 * A ground material that blends its own texture with a rock texture by each vertex's
 * `rock` amount (steep slopes, peaks), tinted by vertex colors.
 */
export function splatMaterial(base: THREE.MeshStandardMaterialParameters, rock: { map: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; ratio: number }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ ...base, vertexColors: true });
  const uniforms = {
    rockMap: { value: rock.map },
    rockNormalMap: { value: rock.normalMap ?? null },
    rockRoughnessMap: { value: rock.roughnessMap ?? null },
    rockRatio: { value: rock.ratio },
  };
  mat.userData.rock = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rock;\nvarying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = rock;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vRock;\nuniform sampler2D rockMap;\nuniform sampler2D rockNormalMap;\nuniform sampler2D rockRoughnessMap;\nuniform float rockRatio;',
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = mix( texture2D( map, vMapUv ), texture2D( rockMap, vMapUv * rockRatio ), vRock );
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace('texture2D( normalMap, vNormalMapUv ).xyz', 'mix( texture2D( normalMap, vNormalMapUv ).xyz, texture2D( rockNormalMap, vNormalMapUv * rockRatio ).xyz, vRock )')
      .replace('texture2D( roughnessMap, vRoughnessMapUv )', 'mix( texture2D( roughnessMap, vRoughnessMapUv ), texture2D( rockRoughnessMap, vRoughnessMapUv * rockRatio ), vRock )');
  };
  return mat;
}
