import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { generateWorld, WORLD_HALF } from '../../../shared/world.ts';
import { DayNight } from './dayNight.ts';
import { Terrain } from './terrain.ts';
import { boxCollider } from './town/colliders.ts';
import { createTownMaterials, type TownMaterials } from './town/materials.ts';
import { IDENTITY } from './town/meshBuilder.ts';
import { setMaxAnisotropy } from './town/textures.ts';
import { buildTown, type Town } from './town/town.ts';
import { createZoneMaterials, type ZoneMaterials } from './zones/materials.ts';
import { buildWorldRoads } from './zones/roads.ts';
import { WaterBodies } from './zones/water.ts';
import { Zones } from './zones/index.ts';
import type { Media } from '../assets/media.ts';

/** Renderer, sky and time of day, physics world, the ground, the town and the zones. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
  readonly physics: RAPIER.World;
  readonly dayNight: DayNight;
  readonly town: Town;
  readonly materials: TownMaterials;
  readonly zoneMaterials: ZoneMaterials;
  readonly terrain: Terrain;
  readonly water: WaterBodies;
  readonly zones: Zones;

  constructor(container: HTMLElement, media: Media) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.dayNight = new DayNight(this.renderer, this.scene);
    this.materials = createTownMaterials();
    this.zoneMaterials = createZoneMaterials(this.materials);
    const layout = generateWorld();
    this.terrain = new Terrain(this.physics, this.zoneMaterials.terrain);
    this.scene.add(this.terrain.group);
    this.town = buildTown(this.scene, this.physics, this.materials, layout.zones.map((z) => z.houses));
    this.scene.add(buildWorldRoads(layout.roads, this.zoneMaterials, this.materials, this.physics, (x, z) => this.terrain.heightAt(x, z)));
    this.water = new WaterBodies(layout.waters, this.zoneMaterials);
    this.scene.add(this.water.group);
    this.zones = new Zones(this.scene, this.physics, this.materials, this.zoneMaterials, this.terrain, media);
    addBoundary(this.physics);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

}

/** Invisible walls around the world's edge. */
function addBoundary(physics: RAPIER.World): void {
  const e = WORLD_HALF + 4;
  const height = 200;
  for (const [x, z, sx, sz] of [
    [0, -e, 2 * e, 2],
    [0, e, 2 * e, 2],
    [-e, 0, 2, 2 * e],
    [e, 0, 2, 2 * e],
  ]) {
    boxCollider(physics, IDENTITY, { x, y: height / 2 - 30, z }, { x: sx, y: height, z: sz });
  }
}
