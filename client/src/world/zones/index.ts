import * as THREE from 'three';
import { smoothstep } from '../../../../shared/noise.ts';
import { SPACE } from '../../../../shared/zones/space.ts';
import { underwater, waterAt, zoneAt, ZONES, type ZoneId } from '../../../../shared/world.ts';
import type { Media } from '../../assets/media.ts';
import type { Terrain } from '../terrain.ts';
import type { TownMaterials } from '../town/materials.ts';
import { AMBIENCE, type Ambience, blendAmbience, emptyAmbience, UNDERWATER, zoneWeights } from './ambience.ts';
import { LightPool, type ZoneContent, type ZoneContext } from './kit.ts';
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
  readonly lights: LightPool;
  private contents: ZoneContent[] = [];
  private weather = new Weather();
  private stars = new ShootingStars();
  private npcs: Npcs;
  private blended = emptyAmbience();
  private time = 0;
  /** Small things (plants, coral) drawn only near the camera, and when to check again. */
  private details: THREE.Mesh[] = [];
  private sinceDetail = Infinity;
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
  ) {
    this.group.name = 'zones';
    this.lights = new LightPool(scene);
    const ctx: ZoneContext = { scene, physics, m, zm, terrain, media, lights: this.lights };
    for (const build of [buildPark, buildArctic, buildMedieval, buildSpace, buildJungle, buildCyberpunk, buildPrehistoric, buildAncient, buildOcean]) {
      const content = build(ctx);
      this.contents.push(content);
      this.group.add(content.group);
    }
    this.npcs = new Npcs(terrain);
    this.group.add(this.weather.group, this.npcs.group, fireworks.points, this.stars.mesh);
    scene.add(this.group);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.maxDistance) this.details.push(o as THREE.Mesh);
    });
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
      c.group.visible = near;
      if (near) c.update?.(view);
    }
    this.lights.update(dt, cam);
    this.npcs.update(dt, cam);
    fireworks.update(dt);
    this.sinceDetail += dt;
    if (this.sinceDetail > 0.3) {
      this.sinceDetail = 0;
      for (const mesh of this.details) {
        const sphere = (mesh as THREE.InstancedMesh).boundingSphere;
        mesh.visible = !sphere || sphere.center.distanceTo(cam) - sphere.radius < mesh.userData.maxDistance;
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
