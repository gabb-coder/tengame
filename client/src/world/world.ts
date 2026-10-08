import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TOWN_HALF_EXTENT } from '../../../shared/town.ts';
import { createTownMaterials, type TownMaterials } from './town/materials.ts';
import { flatRect } from './town/meshBuilder.ts';
import { setMaxAnisotropy, TEXTURE_TILE } from './town/textures.ts';
import { buildTown, type Town } from './town/town.ts';

const GROUND_SIZE = 1400;

/** Renderer, sky and lighting, physics world, and the town. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.3, 2000);
  readonly physics: RAPIER.World;
  readonly sun: THREE.DirectionalLight;
  readonly town: Town;

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

    this.sun = this.addSkyAndLights();
    const materials = createTownMaterials();
    this.addGround(materials);
    this.town = buildTown(this.scene, this.physics, materials);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Keeps the shadow-casting area centered on the player. */
  followSun(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(new THREE.Vector3(40, 80, 30));
    this.sun.target.position.copy(target);
  }

  private addSkyAndLights(): THREE.DirectionalLight {
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(50));

    const sky = new Sky();
    sky.scale.setScalar(1500);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.5;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);

    // Image-based lighting from the sky gives materials realistic reflections.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.scene.environment = pmrem.fromScene(envScene).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();

    this.scene.fog = new THREE.Fog('#b9c7d6', 160, 750);

    const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -70;
    s.right = s.top = 70;
    s.near = 1;
    s.far = 250;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#4a4034', 0.4));
    return sun;
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
