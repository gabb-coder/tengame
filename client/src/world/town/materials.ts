import * as THREE from 'three';
import type { HouseStyle, RoofKind } from '../../../../shared/town.ts';
import { createTownTextures, normalMapFrom } from './textures.ts';

export type TownMaterials = ReturnType<typeof createTownMaterials>;

export function createTownMaterials() {
  const t = createTownTextures();
  // Surface relief for each texture (see normalMapFrom), with a strength per material.
  const bump = (tex: THREE.CanvasTexture, strength: number, scale = 1) => ({
    normalMap: normalMapFrom(tex, strength),
    normalScale: new THREE.Vector2(scale, scale),
  });
  const n = {
    asphalt: bump(t.asphalt, 2.5, 0.6),
    grass: bump(t.grass, 3, 0.8),
    sidewalk: bump(t.sidewalk, 6),
    concrete: bump(t.concrete, 2, 0.5),
    plaster: bump(t.plaster, 3, 0.5),
    brick: bump(t.brick, 8),
    siding: bump(t.siding, 6),
    shingles: bump(t.shingles, 6),
    wood: bump(t.wood, 5, 0.7),
    tile: bump(t.tile, 8, 0.8),
    bark: bump(t.bark, 6),
  };
  const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(params);
  // Flat surfaces painted onto other surfaces: pull them toward the camera in the
  // depth buffer so they never flicker against what they lie on.
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };
  const walls: Record<HouseStyle, THREE.MeshStandardMaterial> = {
    plaster: std({ map: t.plaster, ...n.plaster, vertexColors: true, roughness: 0.92 }),
    brick: std({ map: t.brick, ...n.brick, vertexColors: true, roughness: 0.95 }),
    siding: std({ map: t.siding, ...n.siding, vertexColors: true, roughness: 0.8 }),
    // Zone houses: stand-ins until their real textures (see realTextures.ts) arrive.
    timber: std({ map: t.plaster, ...n.plaster, vertexColors: true, roughness: 0.92 }),
    log: std({ map: t.siding, ...n.siding, vertexColors: true, roughness: 0.85 }),
    stone: std({ map: t.brick, ...n.brick, vertexColors: true, roughness: 0.95 }),
  };
  const roof = std({ map: t.shingles, ...n.shingles, vertexColors: true, roughness: 0.9 });
  const roofs: Record<RoofKind, THREE.MeshStandardMaterial> = {
    shingles: roof,
    thatch: std({ map: t.shingles, ...n.shingles, vertexColors: true, roughness: 1 }),
    clay: std({ map: t.shingles, ...n.shingles, vertexColors: true, roughness: 0.85 }),
  };
  return {
    asphalt: std({ map: t.asphalt, ...n.asphalt, color: '#5d6066', roughness: 0.95 }),
    grass: std({ map: t.grass, ...n.grass, color: '#c6d6b0', roughness: 1 }),
    sidewalk: std({ map: t.sidewalk, ...n.sidewalk, color: '#d6d2c8', roughness: 0.9 }),
    concrete: std({ map: t.concrete, ...n.concrete, color: '#cdc8bd', roughness: 0.9 }),
    /** Driveways, paths and pads lying on lawns. */
    paving: std({ map: t.concrete, ...n.concrete, color: '#cdc8bd', roughness: 0.9, ...decal }),
    markingYellow: std({ color: '#d8ae3c', roughness: 0.6, ...decal }),
    markingWhite: std({ color: '#e9e9e4', roughness: 0.6, ...decal }),
    walls,
    roof,
    roofs,
    trim: std({ color: '#f1efe9', roughness: 0.6 }),
    door: std({ vertexColors: true, roughness: 0.45, metalness: 0.05 }),
    floor: std({ map: t.wood, ...n.wood, color: '#b08a62', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    brass: std({ color: '#c9a45c', roughness: 0.3, metalness: 1 }),
    // Windows have two one-sided panes: darker and reflective seen from outside (like real
    // windows in daylight), nearly clear seen from inside.
    glass: new THREE.MeshPhysicalMaterial({
      color: '#a9bfcc',
      roughness: 0.03,
      metalness: 0,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      envMapIntensity: 1.2,
    }),
    glassOutside: new THREE.MeshPhysicalMaterial({
      color: '#33424f',
      roughness: 0.04,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      envMapIntensity: 1.8,
    }),
    /** Outside pane of windows with a light on inside; glows at night. */
    glassOutsideLit: new THREE.MeshPhysicalMaterial({
      color: '#33424f',
      emissive: '#ffcf8a',
      emissiveIntensity: 0,
      roughness: 0.04,
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      envMapIntensity: 1.8,
    }),
    frostedGlass: std({ color: '#e8eef0', roughness: 0.4, transparent: true, opacity: 0.75 }),
    interiorWall: std({ map: t.plaster, ...n.plaster, vertexColors: true, roughness: 0.95 }),
    ceiling: std({ map: t.plaster, color: '#f4f2ee', roughness: 0.95 }),
    tileFloor: std({ map: t.tile, ...n.tile, color: '#ffffff', roughness: 0.35, ...decal }),
    carpetFloor: std({ map: t.carpet, color: '#b9b2a6', roughness: 1, ...decal }),
    fabric: std({ map: t.carpet, vertexColors: true, roughness: 0.95 }),
    furnitureWood: std({ map: t.wood, ...n.wood, vertexColors: true, roughness: 0.55 }),
    lacquer: std({ vertexColors: true, roughness: 0.35 }),
    porcelain: std({ color: '#f6f6f3', roughness: 0.15 }),
    steel: std({ color: '#c8ccd0', roughness: 0.25, metalness: 1 }),
    stone: std({ map: t.concrete, color: '#55585c', roughness: 0.3 }),
    mirror: std({ color: '#ffffff', roughness: 0.02, metalness: 1, envMapIntensity: 1.5 }),
    screen: std({ color: '#0d0f12', roughness: 0.15, metalness: 0.4 }),
    lampShade: std({ color: '#fff3dc', emissive: '#ffe2b0', emissiveIntensity: 0.9, roughness: 0.8 }),
    /** Floor lamps are off until switched on (see world/appliances.ts). */
    floorLampShade: std({ color: '#efe5d2', roughness: 0.85 }),
    leaves: std({ color: '#3f6a34', roughness: 0.8, flatShading: true }),
    pot: std({ color: '#a8603e', roughness: 0.85 }),
    darkMetal: std({ color: '#2b2f33', roughness: 0.45, metalness: 0.7 }),
    lampGlow: std({ color: '#fff7e0', emissive: '#fff1c8', emissiveIntensity: 1.2 }),
    bark: std({ map: t.bark, ...n.bark, color: '#6b5640', roughness: 1 }),
    foliage: std({ color: '#ffffff', roughness: 0.9, flatShading: true }),
    ramp: std({ map: t.concrete, color: '#c27a4f', roughness: 0.8 }),
  };
}
