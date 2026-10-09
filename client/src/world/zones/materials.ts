import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';
import type { Surface, ZoneId } from '../../../../shared/world.ts';
import type { TextureSet } from '../../assets/media.ts';
import { splatMaterial } from '../terrain.ts';
import type { TownMaterials } from '../town/materials.ts';
import { getMaxAnisotropy, normalMapFrom } from '../town/textures.ts';

/**
 * Generated stand-in textures (speckled color) for the zones, used until the real
 * photo-scanned ones arrive. Each covers `size` meters.
 */
const STAND_INS: Record<string, { base: string; spread: number; size: number; streaks?: boolean; blocks?: [number, number] }> = {
  snow: { base: '#eef3f8', spread: 18, size: 4 },
  rock: { base: '#7d7a76', spread: 70, size: 4 },
  darkRock: { base: '#3d3a39', spread: 50, size: 4 },
  forest: { base: '#4a5a2e', spread: 60, size: 3 },
  sand: { base: '#d9c08f', spread: 30, size: 3 },
  beach: { base: '#d8c7a0', spread: 30, size: 3 },
  volcanic: { base: '#5a4a3e', spread: 50, size: 3 },
  alien: { base: '#7a6378', spread: 40, size: 4 },
  cobble: { base: '#8a8580', spread: 60, size: 2, blocks: [8, 8] },
  dirt: { base: '#7a5f44', spread: 50, size: 3 },
  paving: { base: '#cdb48a', spread: 30, size: 3, blocks: [4, 4] },
  metal: { base: '#8c9196', spread: 20, size: 2, blocks: [2, 2] },
  castle: { base: '#9a948a', spread: 50, size: 3, blocks: [6, 10] },
  timber: { base: '#ece3cf', spread: 14, size: 3 },
  thatch: { base: '#a88a55', spread: 50, size: 2, streaks: true },
  log: { base: '#8a6248', spread: 40, size: 2, streaks: true },
  sandstone: { base: '#d6bc8a', spread: 30, size: 3, blocks: [4, 6] },
  marble: { base: '#ece9e2', spread: 12, size: 3 },
  clay: { base: '#b4553a', spread: 30, size: 2, blocks: [6, 6] },
  planks: { base: '#8a6440', spread: 30, size: 2, streaks: true },
  mossy: { base: '#6d7356', spread: 50, size: 3, blocks: [5, 8] },
};

function standIn(name: string): { map: THREE.CanvasTexture; normal: THREE.CanvasTexture; size: number } {
  const s = STAND_INS[name];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(name.length * 977 + name.charCodeAt(0));
  ctx.fillStyle = s.base;
  ctx.fillRect(0, 0, 256, 256);
  const base = new THREE.Color(s.base);
  for (let i = 0; i < 9000; i++) {
    const l = (rng() - 0.5) * s.spread;
    const c = base.clone().offsetHSL(0, 0, l / 255);
    ctx.fillStyle = `rgba(${c.r * 255},${c.g * 255},${c.b * 255},${0.3 + rng() * 0.5})`;
    const r = 1 + rng() * 2.5;
    ctx.fillRect(rng() * 256, rng() * 256, s.streaks ? r * 0.6 : r, s.streaks ? r * 6 : r);
  }
  if (s.blocks) {
    const [cols, rows] = s.blocks;
    ctx.strokeStyle = 'rgba(30,25,20,0.45)';
    ctx.lineWidth = 3;
    for (let r = 0; r < rows; r++) {
      const y = (r * 256) / rows;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
      for (let c = 0; c < cols; c++) {
        const x = ((c + (r % 2) * 0.5) * 256) / cols;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 256 / rows);
        ctx.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = getMaxAnisotropy();
  return { map, normal: normalMapFrom(map, s.blocks ? 6 : 3), size: s.size };
}

/** Each zone's ground texture and the rock on its slopes. */
const TERRAIN: Record<ZoneId, { ground: string; rock: string; color?: string; roughness?: number }> = {
  town: { ground: 'grass', rock: 'rock' },
  arctic: { ground: 'snow', rock: 'rock', roughness: 0.75 },
  medieval: { ground: 'grass', rock: 'rock' },
  space: { ground: 'alien', rock: 'darkRock', color: '#c9b3d6' },
  jungle: { ground: 'forest', rock: 'mossy', color: '#8fb070' },
  cyberpunk: { ground: 'cobble', rock: 'rock', color: '#6a6a70' },
  prehistoric: { ground: 'volcanic', rock: 'darkRock' },
  ancient: { ground: 'sand', rock: 'sandstone', color: '#f6dcaa' },
  ocean: { ground: 'beach', rock: 'rock' },
};

/** Road surfaces: texture and tint. */
const ROADS: Record<Surface, { texture: string; color: string }> = {
  asphalt: { texture: 'asphalt', color: '#5d6066' },
  cobble: { texture: 'cobble', color: '#ffffff' },
  dirt: { texture: 'dirt', color: '#ffffff' },
  sandstone: { texture: 'paving', color: '#ffffff' },
  metal: { texture: 'metal', color: '#9aa2ab' },
  snow: { texture: 'asphalt', color: '#a9b1ba' },
};

export type ZoneMaterials = ReturnType<typeof createZoneMaterials>;

/**
 * Materials for the zones: ground, roads, water, and building surfaces. They start with
 * generated textures; `applyZoneTextures` swaps in the real ones when they've loaded.
 */
export function createZoneMaterials(town: TownMaterials) {
  const tex = new Map<string, { map: THREE.Texture; normal: THREE.Texture; size: number }>();
  const get = (name: string) => {
    if (name === 'grass') return { map: town.grass.map!, normal: town.grass.normalMap!, size: 8 };
    if (name === 'asphalt') return { map: town.asphalt.map!, normal: town.asphalt.normalMap!, size: 6 };
    if (!tex.has(name)) tex.set(name, standIn(name));
    return tex.get(name)!;
  };
  /** A texture's copy repeating once per `size` meters of UV (UVs here are in meters). */
  const scaled = (t: THREE.Texture, size: number) => {
    const c = t.clone();
    c.repeat.set(1 / size, 1 / size);
    c.needsUpdate = true;
    return c;
  };
  const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(params);

  const terrain = {} as Record<ZoneId, THREE.MeshStandardMaterial>;
  for (const [zone, t] of Object.entries(TERRAIN) as [ZoneId, (typeof TERRAIN)[ZoneId]][]) {
    const g = get(t.ground);
    const r = get(t.rock);
    terrain[zone] = splatMaterial(
      { map: scaled(g.map, g.size), normalMap: scaled(g.normal, g.size), color: t.color ?? '#ffffff', roughness: t.roughness ?? 0.95 },
      { map: r.map, normalMap: r.normal, ratio: g.size / r.size },
    );
    terrain[zone].userData.textures = t;
  }

  const roads = {} as Record<Surface, THREE.MeshStandardMaterial>;
  for (const [surface, r] of Object.entries(ROADS) as [Surface, (typeof ROADS)[Surface]][]) {
    const t = get(r.texture);
    roads[surface] = std({ map: scaled(t.map, t.size), normalMap: scaled(t.normal, t.size), color: r.color, roughness: 0.92 });
    roads[surface].userData.texture = r.texture;
  }

  /** A building surface with UVs in meters. */
  const surface = (name: string, params: THREE.MeshStandardMaterialParameters = {}) => {
    const t = get(name);
    const m = std({ map: scaled(t.map, t.size), normalMap: scaled(t.normal, t.size), roughness: 0.9, ...params });
    m.userData.texture = name;
    return m;
  };

  const waterNormal = waterNormalMap();
  // Glowing pieces glow in their own color (vertex or instance color), not plain white.
  const glow = std({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 2.2, roughness: 0.4 });
  glow.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif',
    );
  };
  return {
    terrain,
    roads,
    castle: surface('castle', { vertexColors: true }),
    sandstone: surface('sandstone', { vertexColors: true }),
    marble: surface('marble', { vertexColors: true, roughness: 0.5 }),
    mossy: surface('mossy', { vertexColors: true }),
    planks: surface('planks', { vertexColors: true }),
    metal: surface('metal', { vertexColors: true, metalness: 0.6, roughness: 0.45 }),
    rock: surface('rock', { vertexColors: true }),
    sand: surface('sand', { vertexColors: true }),
    darkRock: surface('darkRock', { vertexColors: true }),
    snow: surface('snow', { vertexColors: true, roughness: 0.8 }),
    thatch: surface('thatch', { vertexColors: true }),
    clay: surface('clay', { vertexColors: true }),
    /** Leaves and fronds: thin, so seen from both sides. */
    fronds: std({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }),
    /** Smooth painted or plastic surfaces, colored per piece. */
    paint: std({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
    /** Glowing colored surfaces (neon, crystals, screens), colored per piece. */
    glow,
    water: new THREE.MeshStandardMaterial({
      color: '#2d6b74',
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.4,
    }),
    sea: new THREE.MeshStandardMaterial({
      color: '#1e5a6e',
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.5,
    }),
    lava: new THREE.MeshStandardMaterial({ color: '#2a0800', emissive: '#ff5a10', emissiveIntensity: 2.6, emissiveMap: lavaTexture(), roughness: 0.8 }),
    ice: new THREE.MeshStandardMaterial({ color: '#d3e7f2', roughness: 0.04, metalness: 0.05, map: iceTexture(), envMapIntensity: 1.6 }),
    /** Clear ice and glass (glaciers, domes, tunnels). */
    glacier: new THREE.MeshPhysicalMaterial({ color: '#9cd2ec', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.88, envMapIntensity: 1.6, flatShading: true }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#cfe8f2', roughness: 0.04, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.8 }),
  };
}

/** Swaps the stand-in textures for real ones as they become available. */
export function applyZoneTextures(m: ZoneMaterials, textures: Map<string, TextureSet>): void {
  const scaled = (t: THREE.Texture, size: number) => {
    const c = t.clone();
    c.repeat.set(1 / size, 1 / size);
    c.anisotropy = getMaxAnisotropy();
    c.needsUpdate = true;
    return c;
  };
  for (const mat of Object.values(m.terrain)) {
    const { ground, rock } = mat.userData.textures as { ground: string; rock: string };
    const g = textures.get(ground);
    const r = textures.get(rock);
    if (g) {
      mat.map = scaled(g.color, g.size);
      mat.normalMap = scaled(g.normal, g.size);
      mat.roughnessMap = scaled(g.arm, g.size);
      mat.roughness = 1;
    }
    const u = mat.userData.rock as { rockMap: { value: THREE.Texture }; rockNormalMap: { value: THREE.Texture | null }; rockRoughnessMap: { value: THREE.Texture | null }; rockRatio: { value: number } };
    const gSize = g?.size ?? STAND_INS[ground]?.size ?? 8;
    if (r) {
      u.rockMap.value = r.color;
      u.rockNormalMap.value = r.normal;
      u.rockRoughnessMap.value = r.arm;
      u.rockRatio.value = gSize / r.size;
    } else {
      u.rockRatio.value = gSize / (STAND_INS[rock]?.size ?? 4);
    }
    // Without a roughness map for both, the shader would read an empty texture.
    if (!r || !g) mat.roughnessMap = null;
    mat.needsUpdate = true;
  }
  const swap = (mat: THREE.MeshStandardMaterial, name: string) => {
    const set = textures.get(name);
    if (!set) return;
    mat.map = scaled(set.color, set.size);
    mat.normalMap = scaled(set.normal, set.size);
    mat.roughnessMap = scaled(set.arm, set.size);
    mat.roughness = 1;
    mat.needsUpdate = true;
  };
  for (const mat of Object.values(m.roads)) swap(mat, mat.userData.texture);
  for (const mat of Object.values(m)) {
    if (mat instanceof THREE.MeshStandardMaterial && typeof mat.userData.texture === 'string' && !Object.values(m.roads).includes(mat)) swap(mat, mat.userData.texture);
  }
}

/** Gentle overlapping ripples, as a tiling normal map. */
function waterNormalMap(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(5);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 6 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = rng() < 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${l},${l},${l},0.12)`);
    g.addColorStop(1, `rgba(${l},${l},${l},0)`);
    ctx.fillStyle = g;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
  }
  const height = new THREE.CanvasTexture(canvas);
  const normal = normalMapFrom(height, 4);
  normal.repeat.set(1 / 9, 1 / 9);
  return normal;
}

/** Glowing cracks over dark crust. */
function lavaTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(17);
  ctx.fillStyle = '#ff9a30';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 8 + rng() * 22;
    ctx.fillStyle = `rgba(${40 + rng() * 40},${10 + rng() * 10},0,${0.6 + rng() * 0.4})`;
    ctx.beginPath();
    for (let a = 0; a < 7; a++) {
      const ang = (a / 7) * Math.PI * 2;
      const rr = r * (0.6 + rng() * 0.4);
      ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 12, 1 / 12);
  return t;
}

/** Pale ice with white cracks and frozen bubbles. */
function iceTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(23);
  ctx.fillStyle = '#c9dde8';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rng() * 0.25})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 1 + rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 40; i++) {
    let x = rng() * size;
    let y = rng() * size;
    ctx.lineWidth = 0.5 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rng() - 0.5) * 60;
      y += (rng() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / 20, 1 / 20);
  return t;
}
