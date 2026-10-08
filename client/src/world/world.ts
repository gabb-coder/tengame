import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const GROUND_SIZE = 400;

/** Renderer, lighting and a test area with static obstacles and ramps. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  readonly physics: RAPIER.World;
  readonly sun: THREE.DirectionalLight;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.sun = this.addSkyAndLights();
    this.addGround();
    this.addObstacles();
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

    this.scene.fog = new THREE.Fog('#b9c7d6', 120, 600);

    const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -60;
    s.right = s.top = 60;
    s.near = 1;
    s.far = 250;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight('#cfe3ff', '#4a4034', 0.4));
    return sun;
  }

  private addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshStandardMaterial({ color: '#5d6b4f', roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / 5, '#3d4834', '#4f5c43');
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(GROUND_SIZE / 2, 0.5, GROUND_SIZE / 2).setTranslation(0, -0.5, 0));
  }

  private addObstacles(): void {
    const concrete = new THREE.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.85 });
    const rng = mulberry32(42); // same layout for every player

    for (let i = 0; i < 24; i++) {
      const size = new THREE.Vector3(2 + rng() * 6, 1 + rng() * 5, 2 + rng() * 6);
      const angle = rng() * Math.PI * 2;
      const dist = 25 + rng() * 120;
      const pos = new THREE.Vector3(Math.cos(angle) * dist, size.y / 2, Math.sin(angle) * dist);
      this.addBox(size, pos, new THREE.Quaternion(), concrete);
    }

    // A few ramps to jump off.
    const rampMat = new THREE.MeshStandardMaterial({ color: '#c46a3a', roughness: 0.7 });
    for (const [x, z, yaw] of [
      [0, -40, 0],
      [40, 10, Math.PI / 2],
      [-35, 25, -Math.PI / 3],
    ]) {
      const size = new THREE.Vector3(6, 0.4, 12);
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(15), yaw, 0, 'YXZ'));
      this.addBox(size, new THREE.Vector3(x, 1.4, z), rot, rampMat);
    }
  }

  private addBox(size: THREE.Vector3, pos: THREE.Vector3, rot: THREE.Quaternion, material: THREE.Material): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.copy(pos);
    mesh.quaternion.copy(rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(rot),
    );
  }
}

/** Small seeded PRNG so every client generates the same layout. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
