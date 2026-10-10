import * as THREE from 'three';
import { smoothstep } from '../../../../shared/noise.ts';
import { SPACE } from '../../../../shared/zones/space.ts';
import { underwater, waterAt, zoneAt, ZONES, type ZoneId } from '../../../../shared/world.ts';
import type { Media } from '../../assets/media.ts';
import type { Terrain } from '../terrain.ts';
import type { TownMaterials } from '../town/materials.ts';
import { AMBIENCE, type Ambience, blendAmbience, emptyAmbience, UNDERWATER, zoneWeights } from './ambience.ts';
import type { LightPool } from '../lightPool.ts';
import type { ZoneContent, ZoneContext } from './kit.ts';
import type { ZoneMaterials } from './materials.ts';
import { buildAncient } from './ancient.ts';
import { buildCyberpunk } from './cyberpunk.ts';
import { buildArctic } from './arctic.ts';
import { buildJungle } from './jungle.ts';
import { buildMedieval } from './medieval.ts';
import { buildOcean } from './ocean.ts';
import { buildPrehistoric } from './prehistoric.ts';
import { buildSpace } from './space.ts';
import { Npcs } from './npcs.ts';
import { buildPark } from './park.ts';
import { fireworks } from './fireworks.ts';
import { ShootingStars } from './shootingStars.ts';
import { worldSeconds } from '../../game/clock.ts';
import { Weather } from './weather.ts';

/** Zones are only animated while the camera is this close to their middle. */
const ACTIVE_RANGE = 650;
/**
 * Small things stop being drawn this many times their size away (a few pixels by then,
 * in the haze); things this big (radius, m) always are, since they make the skyline.
 */
const SIZE_TO_DISTANCE = 150;
const MIN_DRAW_DISTANCE = 80;
const ALWAYS_DRAWN = 20;
/**
 * Things too far to draw move to a layer the camera doesn't see (their `visible` is left
 * to the game, which shows and hides some of them).
 */
const FAR_LAYER = 31;

interface Detail {
  mesh: THREE.Mesh;
  /** Its bounds, in its own frame. */
  sphere: THREE.Sphere;
  radius: number;
  /** Drawn while its nearest point is closer than this. */
  limit: number;
}

/** How a place changes the rules: gravity, tire grip, water. */
export interface PlaceEffects {
  /** Gravity as a fraction of normal. */
  gravity: number;
  /** Tire grip as a fraction of normal (ice is slippery). */
  grip: number;
  /** Under water (not lava or ice). */
  underwater: boolean;
  /** In lava. */
  lava: boolean;
}

/**
 * Everything in the eight themed zones around the town: their buildings, plants and
 * animals, the weather and haze of each, and how they change the rules (low gravity on
 * the alien world, slippery ice, swimming under the sea).
 */
export class Zones {
  readonly group = new THREE.Group();
  private contents: ZoneContent[] = [];
  private weather = new Weather();
  private stars = new ShootingStars();
  private npcs: Npcs;
  private blended = emptyAmbience();
  private time = 0;
  /** Small things drawn only near the camera, and when to check again. */
  private details: Detail[] = [];
  private sinceDetail = Infinity;
  private center = new THREE.Vector3();
  /** The zone the camera is in. */
  current: ZoneId = 'town';
  /** Whether the camera is under water. */
  submerged = false;

  constructor(
    scene: THREE.Scene,
    physics: import('@dimforge/rapier3d-compat').World,
    m: TownMaterials,
    private zm: ZoneMaterials,
    terrain: Terrain,
    media: Media,
    lights: LightPool,
  ) {
    this.group.name = 'zones';
    lights.add(fireworks.light);
    const ctx: ZoneContext = { scene, physics, m, zm, terrain, media, lights };
    for (const build of [buildPark, buildArctic, buildMedieval, buildSpace, buildJungle, buildCyberpunk, buildPrehistoric, buildAncient, buildOcean]) {
      const content = build(ctx);
      this.contents.push(content);
      this.group.add(content.group);
    }
    this.npcs = new Npcs(terrain, physics);
    this.group.add(this.weather.group, this.npcs.group, fireworks.points, this.stars.mesh);
    scene.add(this.group);
    this.group.updateMatrixWorld(true);
    for (const c of this.contents) {
      c.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const instanced = mesh as THREE.InstancedMesh;
        // Left alone: things that move about without their bounds following (herds,
        // particles), and sets of copies spread over a wide area, unless marked as details.
        if (!mesh.isMesh || !mesh.frustumCulled) return;
        if (instanced.isInstancedMesh && mesh.userData.maxDistance === undefined) return;
        if (instanced.isInstancedMesh && !instanced.boundingSphere) instanced.computeBoundingSphere();
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        const sphere = (instanced.isInstancedMesh ? instanced.boundingSphere : mesh.geometry.boundingSphere)!.clone();
        const radius = sphere.radius * mesh.matrixWorld.getMaxScaleOnAxis();
        const limit = mesh.userData.maxDistance ?? (radius < ALWAYS_DRAWN ? Math.max(MIN_DRAW_DISTANCE, radius * SIZE_TO_DISTANCE) : 0);
        if (limit) this.details.push({ mesh, sphere, radius, limit });
      });
    }
  }

  /**
   * Animates the zones near the camera, and returns how the place should look (for the
   * sky and haze). `sheltered`: indoors, where no rain falls.
   */
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, night: number, sheltered = false): Ambience {
    this.time += dt;
    const cam = camera.position;
    const view = { dt, time: this.time, clock: worldSeconds(), camera, focus, night };
    for (const c of this.contents) {
      const z = ZONES[c.id];
      const near = Math.max(Math.abs(cam.x - z.x), Math.abs(cam.z - z.z)) < ACTIVE_RANGE;
      // Hidden things still have their places worked out every frame unless told not to.
      c.group.visible = c.group.matrixWorldAutoUpdate = near;
      if (near) c.update?.(view);
    }
    this.npcs.update(dt, cam);
    fireworks.update(dt);
    this.sinceDetail += dt;
    if (this.sinceDetail > 0.3) {
      this.sinceDetail = 0;
      for (const d of this.details) {
        const at = this.center.copy(d.sphere.center).applyMatrix4(d.mesh.matrixWorld);
        d.mesh.layers.set(at.distanceTo(cam) - d.radius < d.limit ? 0 : FAR_LAYER);
      }
    }

    this.current = zoneAt(cam.x, cam.z);
    const submerged = underwater(cam.x, cam.y, cam.z);
    if (submerged !== this.submerged) {
      // Seen from below, the surface is a bright ceiling of rippled light, not a mirror.
      const sea = this.zm.sea;
      sea.envMapIntensity = submerged ? 0.15 : 1.5;
      sea.opacity = submerged ? 0.95 : 0.86;
      sea.color.set(submerged ? '#2a8aa0' : '#1e5a6e');
    }
    this.submerged = submerged;
    const parts: [Ambience, number][] = [...zoneWeights(cam.x, cam.z)].map(([id, w]) => [AMBIENCE[id], w]);
    const ambience = blendAmbience(parts, this.blended);
    if (this.submerged) {
      // Deeper is darker.
      const w = waterAt(cam.x, cam.z);
      const depth = w ? w.level - cam.y : 0;
      blendAmbience([[UNDERWATER, 1]], ambience);
      ambience.fogDay.multiplyScalar(1 - Math.min(0.6, depth * 0.03));
      ambience.fogFar = 85 - Math.min(40, depth * 2);
    }
    this.weather.update(dt, cam, ambience.weather, night, sheltered);
    this.stars.update(dt, cam, this.submerged ? 0 : Math.max(0, night - 0.4) * (1 - ambience.overcast) * 1.6);
    return ambience;
  }
}

/** The rules at (x, y, z). */
export function placeEffects(x: number, y: number, z: number): PlaceEffects {
  // The alien world's low gravity fades in past the highways bordering it.
  const inside = Math.min(x - ZONES.space.x + 200, ZONES.space.z + 200 - z);
  const space = smoothstep(inside, 0, 25);
  const water = waterAt(x, z);
  const onIce = water?.kind === 'ice' && y < water.level + 1.5;
  const snowy = zoneAt(x, z) === 'arctic';
  return {
    gravity: 1 - (1 - SPACE.gravity) * space,
    grip: onIce ? 0.22 : snowy ? 0.85 : 1,
    underwater: underwater(x, y, z),
    lava: water?.kind === 'lava' && y < water.level + 0.6,
  };
}
