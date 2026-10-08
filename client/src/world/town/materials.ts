import * as THREE from 'three';
import type { HouseStyle } from '../../../../shared/town.ts';
import { createTownTextures } from './textures.ts';

export type TownMaterials = ReturnType<typeof createTownMaterials>;

export function createTownMaterials() {
  const t = createTownTextures();
  const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(params);
  // Flat surfaces painted onto other surfaces: pull them toward the camera in the
  // depth buffer so they never flicker against what they lie on.
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };
  const walls: Record<HouseStyle, THREE.MeshStandardMaterial> = {
    plaster: std({ map: t.plaster, vertexColors: true, roughness: 0.92 }),
    brick: std({ map: t.brick, vertexColors: true, roughness: 0.95 }),
    siding: std({ map: t.siding, vertexColors: true, roughness: 0.8 }),
  };
  return {
    asphalt: std({ map: t.asphalt, color: '#5d6066', roughness: 0.95 }),
    grass: std({ map: t.grass, color: '#c6d6b0', roughness: 1 }),
    sidewalk: std({ map: t.sidewalk, color: '#d6d2c8', roughness: 0.9 }),
    concrete: std({ map: t.concrete, color: '#cdc8bd', roughness: 0.9 }),
    /** Driveways, paths and pads lying on lawns. */
    paving: std({ map: t.concrete, color: '#cdc8bd', roughness: 0.9, ...decal }),
    markingYellow: std({ color: '#d8ae3c', roughness: 0.6, ...decal }),
    markingWhite: std({ color: '#e9e9e4', roughness: 0.6, ...decal }),
    walls,
    roof: std({ map: t.shingles, vertexColors: true, roughness: 0.9 }),
    trim: std({ color: '#f1efe9', roughness: 0.6 }),
    door: std({ vertexColors: true, roughness: 0.45, metalness: 0.05 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#2a3642', roughness: 0.04, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.6 }),
    darkMetal: std({ color: '#2b2f33', roughness: 0.45, metalness: 0.7 }),
    lampGlow: std({ color: '#fff7e0', emissive: '#fff1c8', emissiveIntensity: 1.2 }),
    bark: std({ map: t.bark, color: '#6b5640', roughness: 1 }),
    foliage: std({ color: '#ffffff', roughness: 0.9, flatShading: true }),
    ramp: std({ map: t.concrete, color: '#c27a4f', roughness: 0.8 }),
  };
}
