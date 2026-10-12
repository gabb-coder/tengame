import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { TextureSet } from '../../assets/media.ts';
import { isNightRace } from '../../../../shared/circuits.ts';
import type { CircuitLayout } from '../layout.ts';
import type { DrsZone, RacingLine } from '../racingLine.ts';
import type { Track } from '../track.ts';
import { buildBarriers } from './barriers.ts';
import { Ground } from './ground.ts';
import { RaceMaterials } from './materials.ts';
import { buildScenery } from './scenery.ts';
import { buildBridges, buildFloodlights, buildGantry, buildGrandstands, buildMarshalPosts, buildPits, type StartLights } from './structures.ts';
import { buildSurfaces, mergeGeometries, SurfaceColliders, type SurfaceKind } from './surfaces.ts';

export type { SurfaceKind } from './surfaces.ts';

/** How much to build: the share of seats with someone in them, and how much scenery. */
export interface CircuitDetail {
  crowd: number;
  scenery: number;
}

/** A circuit, built: everything you see, everything you hit, and the start lights. */
export interface Circuit {
  group: THREE.Group;
  ground: Ground;
  lights: StartLights;
  materials: RaceMaterials;
  /** What kind of surface a collider is (null for barriers and the like). */
  surfaceOf(collider: RAPIER.Collider | null): SurfaceKind | null;
  /** Lit windows and boards, by how dark it is (0..1). */
  setNight(night: number): void;
}

/**
 * Builds the whole circuit into `physics` and returns what to draw: the land, the track
 * and its run-off, barriers, grandstands, pits, the start gantry, and the country round it.
 */
export function buildCircuit(track: Track, line: RacingLine, layout: CircuitLayout, drs: DrsZone[], textures: Map<string, TextureSet>, physics: RAPIER.World, detail: CircuitDetail): Circuit {
  const group = new THREE.Group();
  group.name = 'circuit';
  const m = new RaceMaterials(textures, track.info.scenery);
  const kinds = new Map<number, SurfaceKind>();

  const colliders = new SurfaceColliders();
  group.add(buildSurfaces(track, line, layout, drs, m, colliders));
  for (const [kind, parts] of colliders.parts) {
    const c = physics.createCollider(trimesh(mergeGeometries(parts)).setFriction(0.9));
    kinds.set(c.handle, kind);
  }

  const ground = new Ground(track, layout, m, physics);
  kinds.set(ground.collider.handle, 'grass');
  group.add(ground.group);

  const inStand = (i: number, side: 1 | -1) =>
    layout.grandstands.some((g) => g.side === side && track.wrap(i * track.spacing - g.from) <= track.wrap(g.to - g.from) + 8);
  const barriers = buildBarriers(track, layout, m, inStand);
  group.add(barriers.group);
  physics.createCollider(trimesh(barriers.solid).setFriction(0.25).setRestitution(0.15));

  group.add(buildGrandstands(track, layout.grandstands, m, detail.crowd));
  group.add(buildPits(track, layout, m));
  const lights = buildGantry(track, layout, m);
  group.add(lights.group);
  group.add(buildBridges(track, ground, m));
  group.add(buildMarshalPosts(track, layout, m));
  if (isNightRace(track.info)) group.add(buildFloodlights(track, layout, m));
  group.add(buildScenery(track, layout, ground, m, detail.scenery));

  return {
    group,
    ground,
    lights,
    materials: m,
    surfaceOf: (collider) => (collider ? (kinds.get(collider.handle) ?? null) : null),
    setNight: (night) => m.setNight(night),
  };
}

function trimesh(g: THREE.BufferGeometry): RAPIER.ColliderDesc {
  const positions = g.attributes.position.array as Float32Array;
  const index = new Uint32Array(g.index!.array as ArrayLike<number>);
  return RAPIER.ColliderDesc.trimesh(new Float32Array(positions), index);
}
