import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Media } from '../assets/media.ts';
import { choosePerson, DRIVE, Human, type HumanLibrary, loadHumans, type Outfit } from './humanModel.ts';
import { Ragdoll } from './ragdoll.ts';
import type { CarSeatSpot } from '../vehicles/carModel.ts';

/** The realistic people's pack, once loaded (see AvatarModel.load). */
let humans: HumanLibrary | null = null;

const SKIN_TONES = ['#f1c7a5', '#e0ac85', '#c68863', '#9a6646', '#6e4a33', '#f5d6bf'];
const HAIR_COLORS = ['#2a1d14', '#4a3020', '#7a5230', '#1b1b1b', '#a87a4a', '#5b4636'];
const PANTS_COLORS = ['#2d3a4f', '#3a3a3a', '#4b4234', '#2f4637'];

/** Punches and kicks the simple body can do: which limb (arms and legs right then left), and for how long (s). */
const SIMPLE_STRIKES: Record<string, { limb: 'arm' | 'leg'; side: 0 | 1; seconds: number }> = {
  Punch_Jab: { limb: 'arm', side: 1, seconds: 0.4 },
  Punch_Cross: { limb: 'arm', side: 0, seconds: 0.45 },
  Kick: { limb: 'leg', side: 0, seconds: 0.6 },
};

const HIP_HEIGHT = 0.9;
/** Sitting, the hip joints are this far above the surface (m). */
const HIPS_ABOVE_SEAT = 0.1;
const SEAT_ORIGIN = new THREE.Vector3();
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
  /** Their realistic person has been asked for (they load the first time someone's seen). */
  private wanted = false;
  private disposed = false;
  /** Sitting on something (see placeSeated). */
  seated = false;
  /** In a car (see rideIn): how far back they lean, and at the wheel, where the left hand holds it from the hips. */
  private inCar: { lean: number; grip: THREE.Vector3 | null } | null = null;
  /** In the water, swimming. */
  swimming = false;
  /** A clip to play instead of standing about (see Human.action); cleared when a one-shot ends. */
  action: string | null = null;
  /** Hobbling on a hurt leg, 0..1. */
  limp = 0;
  /** The simple body's punch or kick, and how far into it (s). */
  private simpleStrike: { name: string; t: number } | null = null;
  /** Knocked flying and gone limp: the body physics throws about (see fling). */
  private ragdoll: Ragdoll | null = null;
  /** The simple body has no bones to go limp with: it just lies flat. */
  private flat = false;
  /** Things worn or carried, hung on the realistic person's bones once they're loaded. */
  private gear = new Map<string, { make: () => { bone: string; object: THREE.Object3D }; object: THREE.Object3D | null; on: boolean }>();
  /** Called when the realistic person replaces the simple one (to dress them up). */
  onHuman: (human: Human) => void = () => {};

  /**
   * Loads the realistic people's pack in the background. Each avatar becomes their person
   * once they're first animated (in view) and that person has loaded. Until then (or if
   * they never do), avatars are built from shapes.
   */
  static load(media: Media): void {
    void loadHumans(media).then((library) => {
      humans = library;
    });
  }

  constructor(
    shirtColor: string,
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
    this.root.position.set(seat.x - hips.x, seat.y + HIPS_ABOVE_SEAT - hips.y, seat.z - hips.z);
  }

  /**
   * Sits in a car seat (see CarModel.seat), moving into it if need be: at the wheel, or
   * riding along. Call each frame instead of `animate`.
   */
  rideIn(seat: CarSeatSpot, dt: number): void {
    if (this.root.parent !== seat.place) seat.place.add(this.root);
    if (this.down) this.unfling();
    const { grip } = seat;
    const hands = grip && (this.inCar?.grip ?? new THREE.Vector3()).copy(grip).setY(grip.y - HIPS_ABOVE_SEAT);
    this.inCar = { lean: seat.lean, grip: hands };
    this.animate(0, dt);
    this.placeSeated(SEAT_ORIGIN, 0);
  }

  /** Out of the car, back into the world (`scene`): put somewhere by the caller next. */
  leaveCar(scene: THREE.Object3D): void {
    if (!this.inCar) return;
    this.inCar = null;
    scene.add(this.root);
    this.root.rotation.set(0, 0, 0);
  }

  /** Where a sitting body's hips are, in the world: on the seat. */
  seatPosition(): THREE.Vector3 {
    const hips = this.human ? this.human.hipsLocal() : new THREE.Vector3(0, HIP_HEIGHT, 0);
    return this.root.localToWorld(hips);
  }

  /** Stops following model loading, for an avatar that's being removed. */
  dispose(): void {
    this.disposed = true;
  }

  /** Asks for this avatar's person, the first time they're seen once the pack is in. */
  private wantHuman(): void {
    if (this.wanted || !humans) return;
    this.wanted = true;
    const library = humans;
    const person = choosePerson(library, this.seed, this.outfit);
    void library.person(person.name).then((model) => {
      if (!model || this.disposed || this.human) return;
      // Not mid-fall: the simple body lying flat can't hand over to a limp one.
      if (this.flat) {
        this.wanted = false;
        return;
      }
      this.human = new Human(library, model, person, this.seed);
      this.root.remove(this.body);
      this.root.add(this.human.root);
      this.onHuman(this.human);
      for (const [name, g] of this.gear) if (g.on) this.setGear(name, true, g.make);
    });
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

  /**
   * Knocked flying by a car at `v` (m/s): goes limp where they stand, and physics throws
   * the body about until it comes to rest (see Ragdoll).
   */
  fling(physics: RAPIER.World, v: THREE.Vector3Like): void {
    this.unfling();
    this.seated = false;
    this.action = null;
    if (!this.human) {
      this.flat = true;
      return;
    }
    this.human.goLimp();
    this.ragdoll = new Ragdoll(physics, this.human, v);
  }

  /** Limp (flying, or lying where they fell). */
  get down(): boolean {
    return this.ragdoll !== null || this.flat;
  }

  /** Lying still, ready to get up. */
  get resting(): boolean {
    return this.ragdoll?.resting ?? this.flat;
  }

  /** Where the hips are, while limp; otherwise above the feet. */
  hips(out = new THREE.Vector3()): THREE.Vector3 {
    return this.ragdoll ? this.ragdoll.hips(out) : out.copy(this.root.position).setY(this.root.position.y + HIP_HEIGHT);
  }

  /** How hard the limp body last hit something (the ground, a wall), 0..1; then forgets it. */
  takeImpact(): number {
    return this.ragdoll?.takeImpact() ?? 0;
  }

  /**
   * Gets up from wherever the body lies, onto feet at height `ground` under the hips:
   * kneeling, then standing, facing the way the body lay. Returns where they'll stand and
   * which way they'll face.
   */
  getUp(ground: number): { position: THREE.Vector3; yaw: number } {
    const at = this.hips().setY(ground);
    let yaw = this.root.rotation.y;
    if (this.ragdoll && this.human) {
      yaw = this.ragdoll.lying().yaw;
      // Keep the hips where they lie while the body's frame moves under them.
      const pelvis = this.human.bone('pelvis')!;
      pelvis.updateWorldMatrix(true, false);
      const lying = pelvis.matrixWorld.clone();
      this.root.position.copy(at);
      this.root.rotation.set(0, yaw, 0);
      this.root.updateMatrixWorld(true);
      lying.premultiply(pelvis.parent!.matrixWorld.clone().invert()).decompose(pelvis.position, pelvis.quaternion, new THREE.Vector3());
      this.ragdoll.dispose();
      this.ragdoll = null;
      this.human.getUp();
    } else {
      this.root.position.copy(at);
      this.unfling();
    }
    return { position: at, yaw };
  }

  /** Still getting up. */
  get rising(): boolean {
    return this.human?.rising ?? false;
  }

  /** Back on their feet at once (getting into a car, say), however they lay or rose. */
  unfling(): void {
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.flat = false;
    this.human?.stopLimp();
    this.body.rotation.x = 0;
  }

  /** Advances the walk cycle. `speed` in m/s; `airborne` tucks the legs. */
  animate(speed: number, dt: number, airborne = false): void {
    this.wantHuman();
    if (this.ragdoll) {
      // The body's frame follows the hips about, so it's drawn (and labelled) where it lies.
      const hips = this.ragdoll.hips();
      this.root.position.set(hips.x, hips.y - 0.5, hips.z);
      this.ragdoll.pose();
      return;
    }
    if (this.human) {
      const car = this.inCar;
      this.human.seated = this.seated || !!car;
      this.human.inCar = car && { lean: car.lean };
      this.human.wheel = car?.grip ?? null;
      this.human.swimming = this.swimming;
      // In a car the act waits: the driver's hands are on the wheel.
      const action = car ? (car.grip ? DRIVE : null) : this.action;
      if (this.human.action !== action) this.human.action = action;
      this.human.hobble = this.limp;
      this.human.animate(speed, dt, airborne);
      // A one-shot that finished clears itself.
      if (!car) this.action = this.human.action;
      return;
    }
    if (this.flat) {
      this.body.rotation.x = -Math.PI / 2;
      this.body.position.y = 0.15;
      return;
    }
    // The simple body can't dance or wave; one-shots end at once, but for a punch or kick.
    const strike = this.action ? SIMPLE_STRIKES[this.action] : undefined;
    if (!strike) this.simpleStrike = null;
    else if (this.simpleStrike?.name !== this.action) this.simpleStrike = { name: this.action!, t: 0 };
    else if ((this.simpleStrike.t += dt) >= strike.seconds) {
      this.action = this.simpleStrike = null;
    }
    if (this.action && !strike) this.action = null;
    if (this.seated || this.inCar) {
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
    // Out and back: an arm straight ahead, or a leg up in front.
    if (strike && this.simpleStrike) {
      const k = Math.sin(Math.PI * Math.min(1, this.simpleStrike.t / strike.seconds));
      if (strike.limb === 'arm') this.arms[strike.side].rotation.x = -1.5 * k;
      else this.legs[strike.side].rotation.x = -1.3 * k;
    }
  }
}
