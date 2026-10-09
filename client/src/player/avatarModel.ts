import * as THREE from 'three';
import type { Media } from '../assets/media.ts';
import { Human, loadHumans, type Outfit } from './humanModel.ts';

/** The realistic people, once loaded (see AvatarModel.load), and every avatar waiting for them. */
let humans: Awaited<ReturnType<typeof loadHumans>> = null;
const avatars = new Set<AvatarModel>();

const SKIN_TONES = ['#f1c7a5', '#e0ac85', '#c68863', '#9a6646', '#6e4a33', '#f5d6bf'];
const HAIR_COLORS = ['#2a1d14', '#4a3020', '#7a5230', '#1b1b1b', '#a87a4a', '#5b4636'];
const PANTS_COLORS = ['#2d3a4f', '#3a3a3a', '#4b4234', '#2f4637'];

const HIP_HEIGHT = 0.9;
const SHOULDER_HEIGHT = 1.42;
const LEG_LENGTH = 0.86;
const ARM_LENGTH = 0.62;

// Shared geometry across all avatars.
const legGeometry = new THREE.CapsuleGeometry(0.075, LEG_LENGTH - 0.15, 4, 10).translate(0, -LEG_LENGTH / 2, 0);
const shoeGeometry = new THREE.BoxGeometry(0.12, 0.08, 0.26).translate(0, -LEG_LENGTH + 0.02, 0.05);
const armGeometry = new THREE.CapsuleGeometry(0.055, ARM_LENGTH - 0.12, 4, 8).translate(0, -ARM_LENGTH / 2, 0);
const handGeometry = new THREE.SphereGeometry(0.055, 10, 8).translate(0, -ARM_LENGTH + 0.02, 0);
const torsoGeometry = new THREE.CapsuleGeometry(0.17, 0.38, 6, 14).scale(1.25, 1, 0.75);
const headGeometry = new THREE.SphereGeometry(0.115, 18, 14).scale(0.92, 1.05, 1);
const hairGeometry = new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.03);
const neckGeometry = new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10);
const shoeMaterial = new THREE.MeshStandardMaterial({ color: '#1e1e1e', roughness: 0.6 });

/** Picks stable per-player looks from their id. */
function pick<T>(list: readonly T[], seed: string, salt: number): T {
  let h = salt;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/**
 * Simple humanoid built from primitives, feet at the origin, facing +Z.
 * `animate` swings arms and legs according to walking speed.
 */
export class AvatarModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private phase = 0;
  private swing = 0;
  private human: Human | null = null;
  /** Sitting on something (see placeSeated). */
  seated = false;
  /** In the water, swimming. */
  swimming = false;
  /** A clip to play instead of standing about (see Human.action); cleared when a one-shot ends. */
  action: string | null = null;
  /** Things worn or carried, hung on the realistic person's bones once they're loaded. */
  private gear = new Map<string, { make: () => { bone: string; object: THREE.Object3D }; object: THREE.Object3D | null; on: boolean }>();
  /** Called when the realistic person replaces the simple one (to dress them up). */
  onHuman: (human: Human) => void = () => {};

  /**
   * Loads the realistic people in the background; every avatar, existing or new, switches
   * to one once they arrive. Until then (or if they never do), avatars are built from shapes.
   */
  static load(media: Media): void {
    void loadHumans(media).then((assets) => {
      if (!assets) return;
      humans = assets;
      for (const avatar of avatars) avatar.useHuman();
    });
  }

  constructor(
    private shirtColor: string,
    private seed: string,
    private outfit: Outfit = {},
  ) {
    const skin = new THREE.MeshStandardMaterial({ color: pick(SKIN_TONES, seed, 1), roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: pick(PANTS_COLORS, seed, 2), roughness: 0.9 });
    const hair = new THREE.MeshStandardMaterial({ color: pick(HAIR_COLORS, seed, 3), roughness: 0.95 });

    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.1, HIP_HEIGHT, 0);
      leg.add(new THREE.Mesh(legGeometry, pants), new THREE.Mesh(shoeGeometry, shoeMaterial));
      this.legs.push(leg);
      this.body.add(leg);

      const arm = new THREE.Group();
      arm.position.set(side * 0.26, SHOULDER_HEIGHT, 0);
      arm.rotation.z = side * 0.08;
      arm.add(new THREE.Mesh(armGeometry, shirt), new THREE.Mesh(handGeometry, skin));
      this.arms.push(arm);
      this.body.add(arm);
    }

    const torso = new THREE.Mesh(torsoGeometry, shirt);
    torso.position.y = 1.2;
    const neck = new THREE.Mesh(neckGeometry, skin);
    neck.position.y = 1.53;
    const head = new THREE.Mesh(headGeometry, skin);
    head.position.y = 1.66;
    const hairCap = new THREE.Mesh(hairGeometry, hair);
    hairCap.position.set(0, 1.675, -0.01);
    hairCap.rotation.x = -0.25;
    this.body.add(torso, neck, head, hairCap);

    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.root.add(this.body);
    avatars.add(this);
    if (humans) queueMicrotask(() => this.useHuman());
  }

  /**
   * Places a sitting body so its hips rest on `seat` (a seat's top surface), facing `yaw`.
   * Call after `animate`, which poses it.
   */
  placeSeated(seat: THREE.Vector3, yaw: number): void {
    this.root.rotation.y = yaw;
    const hips = this.human ? this.human.hipsLocal() : new THREE.Vector3(0, HIP_HEIGHT, 0);
    hips.applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
    // Hip joints sit a little above the surface you sit on.
    this.root.position.set(seat.x - hips.x, seat.y + 0.1 - hips.y, seat.z - hips.z);
  }

  /** Where a sitting body's hips are, in the world: on the seat. */
  seatPosition(): THREE.Vector3 {
    const hips = this.human ? this.human.hipsLocal() : new THREE.Vector3(0, HIP_HEIGHT, 0);
    return this.root.localToWorld(hips);
  }

    /** Stops following model loading, for an avatar that's being removed. */
  dispose(): void {
    avatars.delete(this);
  }

  private useHuman(): void {
    if (!humans || this.human) return;
    this.human = new Human(humans, this.shirtColor, this.seed, this.outfit);
    this.root.remove(this.body);
    this.root.add(this.human.root);
    this.onHuman(this.human);
    for (const [name, g] of this.gear) if (g.on) this.setGear(name, true, g.make);
  }

  /**
   * Shows or hides a piece of gear (a fishing rod, a jetpack). `make` builds it the first
   * time: the object and the bone it hangs on (see Human.attach).
   */
  setGear(name: string, on: boolean, make: () => { bone: string; object: THREE.Object3D }): void {
    let g = this.gear.get(name);
    if (!g) this.gear.set(name, (g = { make, object: null, on }));
    g.on = on;
    if (on && !g.object && this.human) {
      const { bone, object } = make();
      if (this.human.attach(bone, object)) g.object = object;
    }
    if (g.object) g.object.visible = on;
  }

  /** The gear object, if it's been made (to animate it, e.g. a jetpack's flames). */
  gearObject(name: string): THREE.Object3D | null {
    return this.gear.get(name)?.object ?? null;
  }

  /** Advances the walk cycle. `speed` in m/s; `airborne` tucks the legs. */
  animate(speed: number, dt: number, airborne = false): void {
    if (this.human) {
      this.human.seated = this.seated;
      this.human.swimming = this.swimming;
      if (this.human.action !== this.action) this.human.action = this.action;
      this.human.animate(speed, dt, airborne);
      // A one-shot that finished clears itself.
      this.action = this.human.action;
      return;
    }
    // The simple body can't dance or wave; one-shots end at once.
    if (this.action && !this.action.endsWith('_Loop')) this.action = null;
    if (this.seated) {
      // Thighs forward, arms resting: as close to sitting as this simple body gets.
      for (const leg of this.legs) leg.rotation.x = -1.45;
      for (const arm of this.arms) arm.rotation.x = -0.5;
      this.body.position.y = 0;
      this.body.rotation.x = 0;
      return;
    }
    // Stride length grows with speed, so cadence doesn't get silly when running.
    const stride = 0.9 + Math.min(speed, 6) * 0.12;
    this.phase += (speed / stride) * Math.PI * dt;
    const target = Math.min(speed / 2.2, 1) * (speed > 3.5 ? 0.85 : 0.55);
    this.swing += (target - this.swing) * (1 - Math.exp(-dt * 10));

    const s = Math.sin(this.phase) * this.swing;
    const legTuck = airborne ? 0.5 : 0;
    this.legs[0].rotation.x = s + legTuck;
    this.legs[1].rotation.x = -s - legTuck * 0.4;
    this.arms[0].rotation.x = -s * 0.9;
    this.arms[1].rotation.x = s * 0.9;
    // Bob twice per stride, and lean slightly into a run.
    this.body.position.y = Math.abs(Math.cos(this.phase)) * this.swing * 0.06;
    this.body.rotation.x = Math.min(speed / 5.5, 1) * 0.12;
  }
}
