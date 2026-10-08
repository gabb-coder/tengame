import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TOWN_HALF_EXTENT } from '../../../shared/town.ts';
import { DayNight } from './dayNight.ts';
import { createTownMaterials, type TownMaterials } from './town/materials.ts';
import { flatRect } from './town/meshBuilder.ts';
import { setMaxAnisotropy, TEXTURE_TILE } from './town/textures.ts';
import { buildTown, type Town } from './town/town.ts';

const GROUND_SIZE = 1400;

/** Renderer, sky and time of day, physics world, and the town. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
  readonly physics: RAPIER.World;
  readonly dayNight: DayNight;
  readonly town: Town;
  readonly materials: TownMaterials;

  constructor(container: HTMLElement) {
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
    this.addGround(this.materials);
    this.town = buildTown(this.scene, this.physics, this.materials);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Grass around the town. The town covers its own area, so nothing overlaps here. */
  private addGround(materials: TownMaterials): void {
    const half = GROUND_SIZE / 2;
    const e = TOWN_HALF_EXTENT;
    for (const [x0, z0, x1, z1] of [
      [-half, -half, half, -e],
      [-half, e, half, half],
      [-half, -e, -e, e],
      [e, -e, half, e],
    ]) {
      const ground = new THREE.Mesh(flatRect(x0, z0, x1, z1, 0, TEXTURE_TILE.grass), materials.grass);
      ground.receiveShadow = true;
      this.scene.add(ground);
    }
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0));
  }
}
