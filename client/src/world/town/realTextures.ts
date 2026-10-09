import * as THREE from 'three';
import type { TextureSet } from '../../assets/media.ts';
import type { TownMaterials } from './materials.ts';
import { getMaxAnisotropy, TEXTURE_TILE } from './textures.ts';

interface Swap {
  material: THREE.MeshStandardMaterial;
  texture: string;
  /** Meters per texture repeat in the geometry's UVs (see TEXTURE_TILE); furniture uses 1. */
  tile: number;
  /** New base color, multiplied with the photo (the old one tinted a plain pattern). */
  color?: THREE.ColorRepresentation;
  /**
   * How much per-piece colors (house paint, roof color) tint this surface: 1 fully, 0 not
   * at all. Photos of red brick or wood already have their color.
   */
  tint?: number;
  normalScale?: number;
  /** A fixed roughness instead of the texture's (for scans that came out too shiny). */
  roughness?: number;
  /** Turns the texture 90° (vertical planks become horizontal siding). */
  rotate?: boolean;
}

/**
 * Swaps the generated textures on the town's materials for real photo-scanned ones,
 * keeping each surface's real-world scale. Materials without a loaded texture are left alone.
 */
export function applyRealTextures(m: TownMaterials, textures: Map<string, TextureSet>): void {
  const T = TEXTURE_TILE;
  const swaps: Swap[] = [
    { material: m.asphalt, texture: 'asphalt', tile: T.asphalt, color: '#e4e4e4' },
    { material: m.grass, texture: 'grass', tile: T.grass, color: '#ffffff', roughness: 1 },
    { material: m.sidewalk, texture: 'sidewalk', tile: T.sidewalk, color: '#ffffff' },
    { material: m.concrete, texture: 'concrete', tile: T.concrete, color: '#e2e6ea' },
    { material: m.paving, texture: 'concrete', tile: T.concrete, color: '#e2e6ea' },
    { material: m.ramp, texture: 'concrete', tile: T.concrete },
    { material: m.walls.plaster, texture: 'plaster', tile: T.plaster, tint: 1, normalScale: 1.5 },
    { material: m.walls.brick, texture: 'brick', tile: T.brick, tint: 0.25 },
    { material: m.walls.siding, texture: 'siding', tile: T.siding, tint: 1, rotate: true },
    { material: m.roof, texture: 'shingles', tile: T.shingles, tint: 0.6 },
    { material: m.walls.timber, texture: 'timber', tile: T.timber, tint: 0.6 },
    { material: m.walls.log, texture: 'log', tile: T.log, tint: 0.35 },
    { material: m.walls.stone, texture: 'castle', tile: T.stone, tint: 0.35 },
    { material: m.roofs.thatch, texture: 'thatch', tile: T.shingles, tint: 0.6, color: new THREE.Color(1.9, 1.6, 1.1) },
    { material: m.roofs.clay, texture: 'clay', tile: T.shingles, tint: 0.3 },
    { material: m.floor, texture: 'wood', tile: T.wood, color: '#ffffff' },
    { material: m.interiorWall, texture: 'plaster', tile: T.plaster, tint: 1, normalScale: 0.35 },
    { material: m.ceiling, texture: 'plaster', tile: T.plaster, normalScale: 0.2 },
    { material: m.tileFloor, texture: 'tile', tile: T.tile, color: '#ffffff' },
    { material: m.carpetFloor, texture: 'carpet', tile: T.carpet, color: '#e2dccf', roughness: 1 },
    { material: m.fabric, texture: 'carpet', tile: 1, tint: 1, roughness: 1 },
    { material: m.furnitureWood, texture: 'wood', tile: 1, tint: 0.55 },
    { material: m.bark, texture: 'bark', tile: T.bark, color: '#ffffff' },
  ];
  for (const s of swaps) {
    const set = textures.get(s.texture);
    if (!set) continue;
    const scaled = (tex: THREE.Texture) => {
      const t = tex.clone(); // shares the image; only the repeat differs
      const repeat = s.tile / set.size;
      t.repeat.set(repeat, repeat);
      if (s.rotate) t.rotation = Math.PI / 2;
      t.anisotropy = getMaxAnisotropy();
      t.needsUpdate = true;
      return t;
    };
    const mat = s.material;
    mat.map = scaled(set.color);
    mat.normalMap = scaled(set.normal);
    mat.normalScale.setScalar(s.normalScale ?? 1);
    const arm = scaled(set.arm);
    mat.aoMap = arm;
    // Otherwise the map holds the real roughness (it's multiplied by this).
    mat.roughnessMap = s.roughness === undefined ? arm : null;
    mat.roughness = s.roughness ?? 1;
    if (s.color !== undefined) mat.color.set(s.color);
    if (s.tint !== undefined && mat.vertexColors) setTintStrength(mat, s.tint);
    mat.needsUpdate = true;
  }
}

/** Blends vertex colors toward white, so they tint a photo texture instead of repainting it. */
function setTintStrength(mat: THREE.MeshStandardMaterial, strength: number): void {
  const uniform = { value: strength };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tintStrength = uniform;
    shader.fragmentShader = `uniform float tintStrength;\n${shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#if defined( USE_COLOR )\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, tintStrength );\n#endif',
    )}`;
  };
  mat.customProgramCacheKey = () => `tint-${strength}`;
}
