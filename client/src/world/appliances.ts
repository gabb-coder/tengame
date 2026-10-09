import * as THREE from 'three';
import { type Appliance, appliancesOf, fireAppliances } from '../../../shared/appliances.ts';
import type { Interior } from '../../../shared/interior.ts';
import type { House } from '../../../shared/town.ts';
import type { Fire } from '../../../shared/world.ts';
import { houseMatrix } from './town/houses.ts';
import { MeshBuilder, placement } from './town/meshBuilder.ts';
import type { TownMaterials } from './town/materials.ts';
import type { LightPool } from './zones/kit.ts';
import { zoneSeats } from './zones/buttons.ts';

/** Lamps close to the camera that also light the room around them (lights are costly). */
const LAMP_LIGHTS = 2;
const LAMP_LIGHT_RANGE = 18;
/** TVs further than this aren't worth redrawing the picture for. */
const TV_VIEW_DISTANCE = 30;
const TV_FPS = 12;

const lampOnMaterial = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#ffd9a0', emissiveIntensity: 3, roughness: 0.8 });
const burnerMaterial = new THREE.MeshStandardMaterial({ color: '#3a0a00', emissive: '#ff3a0a', emissiveIntensity: 2.4, roughness: 0.6 });
const lampShade = new THREE.CylinderGeometry(0.143, 0.203, 0.302, 20);
const burnerRing = new THREE.TorusGeometry(0.07, 0.009, 6, 24).rotateX(Math.PI / 2);
const BURNERS: [number, number][] = [[-0.13, -0.1], [0.13, -0.1], [-0.13, 0.13], [0.13, 0.13]];
const flameMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.35), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const flameCone = new THREE.ConeGeometry(0.28, 1, 7, 1, true).translate(0, 0.5, 0);
/** Fires in the castle and the old empires burn in raised iron braziers; the rest are campfires. */
const isBrazier = (id: string) => id.startsWith('medieval/') || id.startsWith('ancient/');
/** How high above the ground a fire's flames start. */
const flameBase = (id: string) => (isBrazier(id) ? 1.05 : 0.15);

/**
 * TVs, floor lamps and stoves that players switch on and off. What's on is shared by the
 * room (the server keeps it); this draws it: a moving picture, a glowing lamp, red burners.
 */
export class Appliances {
  readonly list: Appliance[];
  private byId: Map<string, Appliance>;
  /** What's drawn for each switched-on appliance. */
  private shown = new Map<string, THREE.Object3D>();
  private tv = new TvPicture();
  private lights: THREE.PointLight[] = [];
  private tvClock = 0;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    houses: House[],
    interiors: Map<string, Interior>,
    fires: Fire[] = [],
    m?: TownMaterials,
    lights?: LightPool,
  ) {
    this.list = [...houses.flatMap((h) => appliancesOf(h, interiors.get(h.id)!)), ...fireAppliances(fires)];
    this.byId = new Map(this.list.map((a) => [a.id, a]));
    if (m) scene.add(firePits(fires, m));
    // A lit fire lights up its surroundings.
    for (const f of fires) {
      lights?.add({ position: new THREE.Vector3(f.x, f.y + flameBase(f.id) + 0.8, f.z), color: '#ff9a4a', intensity: 22, range: 14, flicker: true, active: () => this.isOn(f.id) });
    }
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const light = new THREE.PointLight('#ffd9a8', 0, 7, 1.6);
      light.visible = false;
      scene.add(light);
      this.lights.push(light);
    }
  }

  get(id: string): Appliance | undefined {
    return this.byId.get(id);
  }

    isOn(id: string): boolean {
    return this.shown.has(id);
  }

  setOn(id: string, on: boolean): void {
    const a = this.byId.get(id);
    if (!a || on === this.isOn(id)) return;
    if (!on) {
      this.shown.get(id)!.removeFromParent();
      this.shown.delete(id);
      return;
    }
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    if (a.kind === 'fire') {
      group.matrix.copy(placement(a.world.x, a.floorY + flameBase(a.id), a.world.z));
      for (let k = 0; k < 5; k++) {
        const flame = new THREE.Mesh(flameCone, flameMaterial);
        const ang = (k / 5) * Math.PI * 2;
        flame.position.set(k ? Math.cos(ang) * 0.18 : 0, 0, k ? Math.sin(ang) * 0.18 : 0);
        flame.userData.phase = k * 1.7;
        group.add(flame);
      }
      group.updateMatrixWorld(true);
      this.scene.add(group);
      this.shown.set(id, group);
      return;
    }
    const f = a.furniture!;
    group.matrix.copy(houseMatrix(a.house!).multiply(placement(f.x, f.y, f.z, f.yaw)).multiply(placement(a.local.x, a.local.y, a.local.z)));
    if (a.kind === 'tv') group.add(new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.7), this.tv.material));
    else if (a.kind === 'lamp') group.add(new THREE.Mesh(lampShade, lampOnMaterial));
    else
      for (const [x, z] of BURNERS) {
        const ring = new THREE.Mesh(burnerRing, burnerMaterial);
        ring.position.set(x, 0.006, z);
        group.add(ring);
      }
    group.updateMatrixWorld(true);
    this.scene.add(group);
    this.shown.set(id, group);
  }

  /** Distance to the nearest lit fire (outdoors), or Infinity. */
  nearestFire(p: THREE.Vector3Like): number {
    let best = Infinity;
    for (const id of this.shown.keys()) {
      const a = this.byId.get(id)!;
      if (a.kind === 'fire') best = Math.min(best, Math.hypot(p.x - a.world.x, p.y - a.world.y, p.z - a.world.z));
    }
    return best;
  }

  /** Whether a lit fire is within `range` of `p`. */
  litFireNear(p: THREE.Vector3Like, range: number): boolean {
    for (const id of this.shown.keys()) {
      const a = this.byId.get(id)!;
      if (a.kind === 'fire' && Math.hypot(p.x - a.world.x, p.z - a.world.z) < range && Math.abs(p.y - a.floorY) < 3) return true;
    }
    return false;
  }

  /** The closest appliance within reach of someone standing at `feet`, on the same floor. */
  nearest(feet: THREE.Vector3Like, reach: number, kind?: Appliance['kind']): { appliance: Appliance; distance: number } | null {
    let best: { appliance: Appliance; distance: number } | null = null;
    for (const a of this.list) {
      if ((kind && a.kind !== kind) || Math.abs(feet.y - a.floorY) > 0.8) continue;
      const d = Math.hypot(feet.x - a.world.x, feet.z - a.world.z);
      if (d <= reach && (!best || d < best.distance)) best = { appliance: a, distance: d };
    }
    return best;
  }

  /** Animates TV pictures and puts the room lights on the lamps nearest `camera`. */
  update(camera: THREE.Vector3, dt: number): void {
    const on = [...this.shown.keys()].map((id) => this.byId.get(id)!);
    // Flames lick and flicker.
    this.time += dt;
    for (const a of on) {
      if (a.kind !== 'fire' || Math.hypot(camera.x - a.world.x, camera.z - a.world.z) > 90) continue;
      const group = this.shown.get(a.id)!;
      for (const flame of group.children) {
        const p = flame.userData.phase as number;
        const h = 0.7 + 0.35 * Math.sin(this.time * 9 + p) * Math.sin(this.time * 5.3 + p * 2) + (flame.position.x === 0 ? 0.5 : 0);
        flame.scale.set(1 + 0.15 * Math.sin(this.time * 7 + p), h, 1 + 0.15 * Math.cos(this.time * 6 + p));
        flame.updateMatrix();
      }
      group.updateMatrixWorld(true);
    }
    const near = (a: Appliance, max: number) => Math.hypot(camera.x - a.world.x, camera.z - a.world.z) < max;

    this.tvClock += dt;
    if (this.tvClock >= 1 / TV_FPS && on.some((a) => a.kind === 'tv' && near(a, TV_VIEW_DISTANCE))) {
      this.tv.draw(this.tvClock);
      this.tvClock = 0;
    }

    const lamps = on
      .filter((a) => a.kind === 'lamp' && near(a, LAMP_LIGHT_RANGE))
      .sort((a, b) => Math.hypot(camera.x - a.world.x, camera.z - a.world.z) - Math.hypot(camera.x - b.world.x, camera.z - b.world.z));
    this.lights.forEach((light, i) => {
      const lamp = lamps[i];
      light.visible = !!lamp;
      if (!lamp) return;
      light.position.set(lamp.world.x, lamp.world.y, lamp.world.z);
      light.intensity = 6;
    });
  }
}

/** The fire pits themselves (lit or not): stones and logs, or an iron brazier. */
function firePits(fires: Fire[], m: TownMaterials): THREE.Group {
  const b = new MeshBuilder();
  const stone = new THREE.DodecahedronGeometry(0.22, 0);
  const log = new THREE.CylinderGeometry(0.08, 0.09, 0.9, 6).rotateZ(Math.PI / 2);
  const seatLog = new THREE.CylinderGeometry(0.22, 0.24, 1.8, 9).rotateX(Math.PI / 2);
  for (const f of fires) {
    if (isBrazier(f.id)) {
      b.add(new THREE.CylinderGeometry(0.45, 0.25, 0.35, 12, 1, true).translate(0, 0.95, 0), m.darkMetal, placement(f.x, f.y, f.z));
      b.add(new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2).translate(0, 0.9, 0), m.darkMetal, placement(f.x, f.y, f.z));
      for (let k = 0; k < 3; k++) b.add(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).rotateZ(0.25).translate(0.12, 0.45, 0).rotateY((k / 3) * Math.PI * 2), m.darkMetal, placement(f.x, f.y, f.z));
      for (let k = 0; k < 3; k++) b.add(log.clone().scale(0.5, 0.6, 0.6), m.bark, placement(f.x, f.y + 0.98, f.z, k * 1.1));
      continue;
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.add(stone, m.concrete, placement(f.x + Math.cos(a) * 0.65, f.y + 0.08, f.z + Math.sin(a) * 0.65, a), '#8a8680');
    }
    for (let k = 0; k < 3; k++) b.add(log, m.bark, placement(f.x, f.y + 0.12 + k * 0.05, f.z, k * 1.05, 0, 0.15));
    // Two logs to sit on, either side of the fire.
    for (const side of [-1, 1]) {
      const x = f.x + side * 2.3;
      b.add(seatLog, m.bark, placement(x, f.y + 0.2, f.z));
      for (const dz of [-0.45, 0.45]) {
        zoneSeats.push({ id: `${f.id}/log${side}${dz}`, position: new THREE.Vector3(x, f.y + 0.42, f.z + dz), yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2, floorY: f.y, label: 'log by the fire' });
      }
    }
  }
  return b.build('fire-pits');
}

/**
 * A made-up TV broadcast drawn on a small canvas: it cycles through a few "channels"
 * (news, nature, a cartoon, football) so a switched-on TV looks alive.
 */
class TvPicture {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  readonly material: THREE.MeshBasicMaterial;
  private time = 0;

  constructor() {
    this.canvas.width = 192;
    this.canvas.height = 108;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    // Unlit, so the screen glows on its own, day or night.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) });
    this.draw(0);
  }

  draw(dt: number): void {
    this.time += dt;
    const t = this.time;
    const { ctx } = this;
    const [w, h] = [this.canvas.width, this.canvas.height];
    const channel = Math.floor(t / 8) % 4;
    if (channel === 0) {
      // News: a presenter silhouette in a studio, with a scrolling ticker.
      ctx.fillStyle = '#1b3a6b';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#2c5aa0';
      ctx.fillRect(110, 12, 70, 44);
      ctx.fillStyle = '#e8c9a8';
      ctx.beginPath();
      ctx.arc(60, 42, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#20242c';
      ctx.fillRect(38, 56, 44, 40);
      ctx.fillStyle = '#c0182a';
      ctx.fillRect(0, 86, w, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('BREAKING: Tengame town gets real furniture  •  Weather: sunny  •  ', w - ((t * 40) % (w * 3)), 101);
    } else if (channel === 1) {
      // Nature: hills under a moving sun.
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#5aa7e6');
      sky.addColorStop(1, '#cfe7f7');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath();
      ctx.arc(30 + ((t * 8) % (w - 40)), 26, 10, 0, Math.PI * 2);
      ctx.fill();
      for (const [y, c, s] of [[70, '#4f8f3a', 0.04], [82, '#3c7a2d', 0.06]] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x * s + t * 0.4) * 8);
        ctx.lineTo(w, h);
        ctx.fill();
      }
    } else if (channel === 2) {
      // Cartoon: a bouncing ball.
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff8a3d';
      ctx.fillRect(0, 88, w, 20);
      const x = 20 + ((t * 50) % (w - 40));
      const y = 80 - Math.abs(Math.sin(t * 4)) * 55;
      ctx.fillStyle = '#e8364a';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Football: players running on a pitch.
      ctx.fillStyle = '#2f8a3c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d8f0d8';
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.beginPath();
      ctx.moveTo(w / 2, 6);
      ctx.lineTo(w / 2, h - 6);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#e8364a' : '#2e6fd8';
        ctx.beginPath();
        ctx.arc(w / 2 + Math.sin(t * 0.7 + i * 1.7) * 70, h / 2 + Math.cos(t * 0.9 + i * 2.3) * 32, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(w / 2 + Math.sin(t * 1.3) * 60, h / 2 + Math.cos(t * 1.1) * 25, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Scanlines and a vignette sell it as a screen.
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    this.texture.needsUpdate = true;
  }
}
