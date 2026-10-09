import * as THREE from 'three';
import { fbm } from '../../../shared/noise.ts';
import { BLOCK_SIZE, CURB_HEIGHT, generateTown, PARK_FOUNTAIN, type Rect, TOWN_HALF_EXTENT } from '../../../shared/town.ts';
import { generateWorld, shapeDistance, type Shape, waterAt, WORLD_HALF, zoneAt, type ZoneId } from '../../../shared/world.ts';
import { JUNGLE } from '../../../shared/zones/jungle.ts';
import { MEDIEVAL } from '../../../shared/zones/medieval.ts';
import { PREHISTORIC } from '../../../shared/zones/prehistoric.ts';
import { ANCIENT } from '../../../shared/zones/ancient.ts';
import { settings } from '../settings.ts';
import type { Terrain } from './terrain.ts';

/** Meters per texel of the map saying where grass grows and how high the ground is. */
const RES = 2;
const SIZE = (2 * WORLD_HALF) / RES;

/** How thick the grass is in each place (0 = none), and how tall it grows. */
const LUSH: Record<ZoneId, number> = { town: 0.95, medieval: 1, jungle: 0.8, prehistoric: 0.5, ancient: 0, arctic: 0, space: 0, cyberpunk: 0, ocean: 0 };
const TALL: Record<ZoneId, number> = { town: 0.75, medieval: 1, jungle: 1.25, prehistoric: 1.15, ancient: 0.8, arctic: 0.5, space: 1, cyberpunk: 0.5, ocean: 0.7 };
/** Lawns in town are kept short. */
const MOWED = 0.32;

/** Grass color at the root and the tip, per zone (index in the shader: row-major zone grid). */
const COLORS: Record<ZoneId, [string, string]> = {
  arctic: ['#5a6a4a', '#9aa880'],
  medieval: ['#2f5a1e', '#8ab84a'],
  space: ['#4a2a6a', '#b88af0'],
  jungle: ['#1e4a1a', '#5a9a2e'],
  town: ['#2f5a22', '#86b04a'],
  cyberpunk: ['#2a3a2a', '#5a7a4a'],
  prehistoric: ['#3a4a1a', '#9aa040'],
  ancient: ['#4a5a22', '#a8b05a'],
  ocean: ['#3a5a2a', '#8ab05a'],
};
const GRID: ZoneId[] = ['arctic', 'medieval', 'space', 'jungle', 'town', 'cyberpunk', 'prehistoric', 'ancient', 'ocean'];

/** Blades and how far out they reach, per graphics setting. */
const QUALITY = { low: null, medium: { count: 34000, radius: 32 }, high: { count: 80000, radius: 46 } } as const;

/**
 * Grass: blades swaying in the wind around the camera, wherever the ground is green (lawns
 * in town, meadows, the jungle floor), parting around your feet. The blades stay put in
 * the world; a patch of them just follows the camera along.
 */
export class Grass {
  readonly mesh: THREE.Mesh;
  private uniforms = {
    map: { value: null as THREE.DataTexture | null },
    center: { value: new THREE.Vector2() },
    tile: { value: 68 },
    time: { value: 0 },
    player: { value: new THREE.Vector3(0, -100, 0) },
    rootColors: { value: GRID.map((z) => new THREE.Color(COLORS[z][0])) },
    tipColors: { value: GRID.map((z) => new THREE.Color(COLORS[z][1])) },
  };
  private geometry: THREE.InstancedBufferGeometry;

  constructor(terrain: Terrain) {
    this.uniforms.map.value = grassMap(terrain);
    this.geometry = new THREE.InstancedBufferGeometry();
    // One blade: a curved, tapering strip, 1 m tall (scaled per blade).
    const pos: number[] = [];
    const idx: number[] = [];
    const SEG = 3;
    for (let k = 0; k <= SEG; k++) {
      const v = k / SEG;
      const w = 0.05 * (1 - v * 0.9);
      pos.push(-w, v, 0, w, v, 0);
      if (k < SEG) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    this.geometry.setIndex(idx);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `
        attribute vec4 blade;
        uniform sampler2D map;
        uniform vec2 center;
        uniform float tile;
        uniform float time;
        uniform vec3 player;
        uniform vec3 rootColors[9];
        uniform vec3 tipColors[9];
        varying vec3 vGrass;
        ${shader.vertexShader}`
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `// This blade's spot: the copy of its place in the tile nearest the camera.
          vec2 spot = blade.xy * tile;
          spot += tile * floor( ( center - spot ) / tile + 0.5 );
          vec2 uv = ( spot + ${WORLD_HALF.toFixed(1)} ) / ${(2 * WORLD_HALF).toFixed(1)};
          vec4 g = texture2D( map, uv );
          float hash = fract( blade.z * 43.17 + blade.w * 7.31 );
          float dist = distance( spot, center );
          // Thinner toward the edge of the patch, so it fades out instead of ending in a line.
          float fade = 1.0 - smoothstep( tile * 0.32, tile * 0.5, dist );
          float h = ( 0.28 + 0.55 * blade.w ) * g.b * step( hash, g.g ) * fade * ( 0.6 + 0.4 * g.g );
          float yaw = blade.z * 6.2831;
          vec3 local = vec3( position.x * cos( yaw ), position.y * h, position.x * sin( yaw ) );
          // Wind: gusts rolling across the field, bending the tips most.
          float bend = position.y * position.y;
          float gust = sin( time * 1.7 + spot.x * 0.13 + spot.y * 0.09 ) * 0.5 + sin( time * 3.1 + spot.x * 0.4 ) * 0.2;
          local.x += bend * h * ( 0.18 + 0.22 * gust );
          local.z += bend * h * 0.12 * sin( time * 2.3 + spot.y * 0.3 );
          // Pushed aside by whoever walks through.
          vec2 away = spot - player.xz;
          float near = 1.0 - smoothstep( 0.2, 1.1, length( away ) );
          if ( abs( player.y - g.r ) > 2.0 ) near = 0.0;
          local.xz += normalize( away + 1e-4 ) * near * bend * h * 0.9;
          local.y *= 1.0 - near * 0.45;
          vec3 transformed = vec3( spot.x, g.r, spot.y ) + local;
          // Root to tip, by zone, with a little variety.
          float zx = clamp( floor( ( spot.x + 600.0 ) / 400.0 ), 0.0, 2.0 );
          float zz = clamp( floor( ( spot.y + 600.0 ) / 400.0 ), 0.0, 2.0 );
          int zone = int( zz * 3.0 + zx );
          vGrass = mix( rootColors[ zone ], tipColors[ zone ] * ( 0.85 + 0.3 * hash ), position.y );`,
        );
      shader.fragmentShader = `varying vec3 vGrass;\n${shader.fragmentShader}`.replace('#include <color_fragment>', 'diffuseColor.rgb *= vGrass;');
    };
    material.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'grass';
    this.setQuality(settings.quality);
  }

  /** How many blades, and how far out: none on low graphics. */
  setQuality(quality: 'low' | 'medium' | 'high'): void {
    const q = QUALITY[quality];
    this.mesh.visible = !!q;
    if (!q) return;
    this.uniforms.tile.value = q.radius * 2;
    const blades = new Float32Array(q.count * 4);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < q.count; i++) blades.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    this.geometry.setAttribute('blade', new THREE.InstancedBufferAttribute(blades, 4));
    this.geometry.instanceCount = q.count;
  }

  update(dt: number, camera: THREE.Vector3, player: THREE.Vector3 | null): void {
    this.uniforms.time.value += dt;
    this.uniforms.center.value.set(camera.x, camera.z);
    if (player) this.uniforms.player.value.copy(player);
    else this.uniforms.player.value.set(0, -100, 0);
  }
}

/**
 * The grass map: per texel, the ground's height (red), how much grass grows there (green:
 * none on roads, water, paving, steep slopes or under buildings) and how tall (blue).
 */
function grassMap(terrain: Terrain): THREE.DataTexture {
  const world = generateWorld();
  const town = generateTown();
  const density = new Float32Array(SIZE * SIZE);
  const height = new Float32Array(SIZE * SIZE);
  const tall = new Float32Array(SIZE * SIZE);
  const at = (i: number) => -WORLD_HALF + (i + 0.5) * RES;
  const inRect = (r: Rect, x: number, z: number, m = 0) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
  // Places with paving or floors: no grass.
  const bare: Shape[] = [
    { type: 'rect', minX: MEDIEVAL.castle.x - MEDIEVAL.castle.moatInner, maxX: MEDIEVAL.castle.x + MEDIEVAL.castle.moatInner, minZ: MEDIEVAL.castle.z - MEDIEVAL.castle.moatInner, maxZ: MEDIEVAL.castle.z + MEDIEVAL.castle.moatInner },
    { type: 'rect', minX: MEDIEVAL.square.x - 26, maxX: MEDIEVAL.square.x + 26, minZ: MEDIEVAL.square.z - 26, maxZ: MEDIEVAL.square.z + 26 },
    { type: 'circle', x: MEDIEVAL.smithy.x, z: MEDIEVAL.smithy.z, r: 6 },
    { type: 'circle', x: MEDIEVAL.windmill.x, z: MEDIEVAL.windmill.z, r: 5 },
    { type: 'rect', minX: JUNGLE.temple.x - 17, maxX: JUNGLE.temple.x + 17, minZ: JUNGLE.temple.z - 17, maxZ: JUNGLE.temple.z + 17 },
    { type: 'circle', x: JUNGLE.zipline.to.x, z: JUNGLE.zipline.to.z, r: 5 },
    { type: 'circle', x: PREHISTORIC.cave.x, z: PREHISTORIC.cave.z, r: PREHISTORIC.cave.r + 8 },
    { type: 'circle', x: PREHISTORIC.fossils.x, z: PREHISTORIC.fossils.z, r: 18 },
    ...PREHISTORIC.geysers.map((g) => ({ type: 'circle' as const, x: g.x, z: g.z, r: 3.5 })),
    ...world.fires.map((f) => ({ type: 'circle' as const, x: f.x, z: f.z, r: 3.5 })),
    { type: 'circle', x: PARK_FOUNTAIN.x, z: PARK_FOUNTAIN.z, r: PARK_FOUNTAIN.r + 0.3 },
    { type: 'circle', x: -466, z: 292, r: 7.5 },
    // The playground's rubber mat.
    { type: 'rect', minX: -15, maxX: 15, minZ: 28, maxZ: 40 },
  ];
  const oasis = ANCIENT.oasis;
  for (let j = 0; j < SIZE; j++) {
    const z = at(j);
    for (let i = 0; i < SIZE; i++) {
      const x = at(i);
      const k = j * SIZE + i;
      height[k] = terrain.heightAt(x, z);
      const zone = zoneAt(x, z);
      let d = LUSH[zone];
      tall[k] = TALL[zone];
      if (zone === 'ancient' && Math.hypot(x - oasis.x, z - oasis.z) < oasis.r + 6) d = 0.9;
      if (Math.abs(x) < TOWN_HALF_EXTENT + 1 && Math.abs(z) < TOWN_HALF_EXTENT + 1) {
        // In town: only on the blocks' lawns.
        const block = town.blocks.find((b) => inRect(b, x, z));
        if (block) {
          height[k] = CURB_HEIGHT;
          tall[k] = MOWED;
          d = 1;
          if (block === town.park && Math.max(Math.abs(x - (block.minX + BLOCK_SIZE / 2)), Math.abs(z - (block.minZ + BLOCK_SIZE / 2))) < 29) d = 0;
        } else d = 0;
      }
      if (d > 0 && waterAt(x, z)) d = 0;
      if (d > 0) {
        // Not on steep slopes or high up the volcano.
        const sx = terrain.heightAt(x + 1, z) - terrain.heightAt(x - 1, z);
        const sz = terrain.heightAt(x, z + 1) - terrain.heightAt(x, z - 1);
        if (Math.hypot(sx, sz) / 2 > 0.55) d = 0;
        if (zone === 'prehistoric' && height[k] > 9) d = 0;
      }
      if (d > 0 && bare.some((s) => shapeDistance(s, x, z) < 0)) d = 0;
      // Patchy, like a real meadow.
      if (d > 0) d *= THREE.MathUtils.clamp(0.55 + fbm(x / 18, z / 18, 2, 301) * 1.2, 0, 1);
      density[k] = d;
    }
  }
  // No grass on roads (stamped along each one) or under houses.
  const clear = (x: number, z: number, r: number) => {
    const i0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / RES));
    const i1 = Math.min(SIZE - 1, Math.floor((x + r + WORLD_HALF) / RES));
    const j0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / RES));
    const j1 = Math.min(SIZE - 1, Math.floor((z + r + WORLD_HALF) / RES));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if ((at(i) - x) ** 2 + (at(j) - z) ** 2 < r * r) density[j * SIZE + i] = 0;
  };
  for (const road of world.roads) {
    for (let p = 0; p < road.path.length - 1; p++) {
      const a = road.path[p];
      const b = road.path[p + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= len; s += RES) clear(a.x + ((b.x - a.x) * s) / len, a.z + ((b.z - a.z) * s) / len, road.width / 2 + 1.2);
    }
  }
  for (const h of world.houses) {
    const r = Math.hypot(h.width, h.depth) / 2 + 1;
    clear(h.x, h.z, r);
    // The driveway or path out front.
    const fx = Math.sin(h.rotation);
    const fz = Math.cos(h.rotation);
    for (let s = 0; s < h.setback + h.depth / 2 + 1; s += 1.5) clear(h.x + fx * s + Math.cos(h.rotation) * h.drivewaySide * 2 * (h.rustic ? 0 : 1), h.z + fz * s - Math.sin(h.rotation) * h.drivewaySide * 2 * (h.rustic ? 0 : 1), h.rustic ? 1 : 2.2);
  }
  const data = new Uint16Array(SIZE * SIZE * 4);
  for (let k = 0; k < SIZE * SIZE; k++) {
    data[k * 4] = THREE.DataUtils.toHalfFloat(height[k]);
    data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(density[k]);
    data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(tall[k]);
    data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
