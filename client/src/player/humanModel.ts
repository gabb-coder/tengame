import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Media, PersonInfo } from '../assets/media.ts';

/** How tall people are (m), when the pack doesn't say. */
const HEIGHT = 1.76;
/** Heights the pack's people are kept within (m). */
const SHORTEST = 1.5;
const TALLEST = 1.95;

/** Clip names in the animation file, and the ground speed (m/s) each moving one was made for. */
const IDLE = 'Idle_Loop';
/** The kick isn't a clip (see KICK_STEPS), but plays like one. */
const KICK = 'Kick';
const JUMP = 'Jump_Loop';
const SIT = 'Sitting_Idle_Loop';
/** Hands on the wheel. */
export const DRIVE = 'Driving_Loop';
/** Clips that play sitting down, instead of just sitting. */
const SEATED = new Set(['Sitting_Talking_Loop', DRIVE]);
/**
 * Sitting in a car's low seat, not on a chair: how far forward of straight down the thighs
 * and the shins point (radians: legs out toward the pedals, where a chair has the feet
 * under the knees).
 */
const CAR_LEGS = { thigh: 1.7, shin: 1.35 };
const GAITS = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const SWIM_IDLE = 'Swim_Idle_Loop';
const SWIM = 'Swim_Fwd_Loop';
/** Clips that play once and then hand back to walking or standing. */
const ONCE = new Set(['Interact', 'PickUp_Table', 'Sword_Attack', 'Spell_Simple_Shoot', 'Hit_Chest', 'Hit_Head', 'Punch_Jab', 'Punch_Cross', KICK]);
/**
 * A front kick, which the library doesn't have: made from standing with fists up (the
 * jab's first moment), by swinging the right leg and leaning the back. Each step: seconds
 * in; how much of the kick's pose to take over from the standing one (0..1); how far
 * forward of straight down the right thigh points, and how bent its knee is; how far the
 * body leans back; and how much the other knee gives (radians). The knee comes up, the
 * foot snaps out straight at hip height at about 0.3 s, and comes back.
 */
const GUARD = 'Punch_Jab';
const KICK_STEPS: [number, number, number, number, number, number][] = [
  [0, 0, 0.6, 1.4, 0, 0],
  [0.16, 1, 1.3, 1.9, 0.1, 0.15],
  [0.3, 1, 1.5, 0.05, 0.24, 0.2],
  [0.42, 1, 1.4, 0.2, 0.22, 0.2],
  [0.6, 1, 1.0, 1.6, 0.1, 0.15],
  [0.82, 0, 0.4, 0.8, 0, 0],
];
export const KICK_SECONDS = KICK_STEPS[KICK_STEPS.length - 1][0];
/**
 * Getting up off the ground: from however the body lies, onto one knee (a moment of the
 * kneeling clip), then up to standing; seconds for each.
 */
const KNEEL = 'Fixing_Kneeling';
const KNEEL_AT = 0.6;
const TO_KNEE = 1.1;
const TO_FEET = 0.9;
/** A hurt leg: how much less time is spent on it, how stiff its knee is, how far you lean over it. */
const HOBBLE_HURRY = 0.45;
const HOBBLE_STIFF = 0.6;
const HOBBLE_LEAN = 0.1;

/** The body's sideways axis (its left), which legs swing about and the back bends about. */
const SIDEWAYS = new THREE.Vector3(1, 0, 0);

/** Turns a bone by `turn`, a turn in the world's frame, on top of how it's turned already. */
function turnInWorld(bone: THREE.Object3D, turn: THREE.Quaternion): void {
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(turn).multiply(parent));
  bone.updateMatrixWorld(true);
}

/** Eases in and out, 0..1. */
const ease = (t: number) => {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** A clip to blend in at a speed (m/s): standing still, walking, jogging, sprinting, swimming. */
interface Gait {
  name: string;
  speed: number;
}

type Body = 'male' | 'female';

/** Who someone is, rather than picked at random (uniforms, costumes, people with names). */
export interface Outfit {
  body?: Body;
  /** Who they may be, by name (e.g. 'Police_Male_02'): one is picked. Otherwise, someone in everyday clothes. */
  people?: string[];
}

/**
 * The people pack: animations everyone shares, and the people themselves, each one loaded
 * the first time someone is them.
 */
export interface HumanLibrary {
  people: PersonInfo[];
  clips: Map<string, THREE.AnimationClip>;
  /** Natural ground speed per gait clip. */
  speeds: Map<string, number>;
  /** A person's model (loaded once, then shared), or null if it won't load. */
  person(name: string): Promise<THREE.Object3D | null>;
}

/** Stable per-player choice from a list, from their id. */
function pick<T>(list: readonly T[], seed: string, salt: number): T {
  let h = salt;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** Loads the people pack's animations; null if it isn't installed or fails. */
export async function loadHumans(media: Media): Promise<HumanLibrary | null> {
  const info = await media.humans();
  if (!info?.people?.length) return null;
  const anims = await media.gltf('human_anims.glb');
  if (!anims) return null;
  const models = new Map<string, Promise<THREE.Object3D | null>>();
  return {
    people: info.people,
    clips: new Map(anims.animations.map((c) => [c.name, turnsOnly(c)])),
    speeds: new Map(Object.entries(info.clips).map(([name, c]) => [name, c.speed])),
    person(name) {
      let model = models.get(name);
      if (!model) models.set(name, (model = media.gltf(`person_${name}.glb`).then((g) => g?.scene ?? null)));
      return model;
    },
  };
}

/**
 * A clip's turns of each joint, and where the hips go: the library's clips also set every
 * bone's length (its mannequin's), but people keep their own.
 */
function turnsOnly(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position' || t.name === 'root.position');
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Who someone is: one of `outfit.people`, or else someone in everyday clothes (of `outfit.body`). */
export function choosePerson(library: HumanLibrary, seed: string, outfit: Outfit = {}): PersonInfo {
  const named = (outfit.people ?? []).flatMap((name) => library.people.filter((p) => p.name === name));
  if (named.length) return pick(named, seed, 7);
  const body = outfit.body ?? pick(['male', 'female'] as const, seed, 7);
  const everyday = library.people.filter((p) => p.everyday && p.body === body);
  return pick(everyday.length ? everyday : library.people, seed, 6);
}

/** Workspace for posing, kept to save making new ones every frame. */
const relative = new THREE.Matrix4();
const scratch = {
  toRoot: new THREE.Matrix4(),
  inverse: new THREE.Matrix4(),
  local: new THREE.Matrix4(),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
  target: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  parentQ: new THREE.Quaternion(),
};

/** Where in the walk cycle each body's left and right foot is most planted (worked out once). */
const plantedAt = new Map<string, number>();

/**
 * When the `sore` foot carries the weight, as a fraction of the walk cycle: when it's
 * lowest compared with the other one (which is then mid-swing). Leaves the walk unweighted.
 */
function soreStep(body: string, sore: 'l' | 'r', mixer: THREE.AnimationMixer, actions: Map<string, THREE.AnimationAction>, bones: Map<string, THREE.Object3D>, root: THREE.Object3D): number {
  const key = `${body}:${sore}`;
  const known = plantedAt.get(key);
  if (known !== undefined) return known;
  const walk = actions.get(GAITS[0]);
  const idle = actions.get(IDLE);
  const foot = bones.get(`foot_${sore}`);
  const other = bones.get(`foot_${sore === 'l' ? 'r' : 'l'}`);
  if (!walk || !idle || !foot || !other) return 0;
  idle.setEffectiveWeight(0);
  walk.setEffectiveWeight(1);
  const [a, b] = [new THREE.Vector3(), new THREE.Vector3()];
  let best = 0;
  let lowest = Infinity;
  const SAMPLES = 24;
  for (let i = 0; i < SAMPLES; i++) {
    walk.time = (i / SAMPLES) * walk.getClip().duration;
    mixer.update(0);
    root.updateMatrixWorld(true);
    const d = foot.getWorldPosition(a).y - other.getWorldPosition(b).y;
    if (d < lowest) [lowest, best] = [d, i / SAMPLES];
  }
  walk.setEffectiveWeight(0);
  idle.setEffectiveWeight(1);
  walk.time = 0;
  plantedAt.set(key, best);
  return best;
}

/**
 * A realistic animated person (from Microsoft's Rocketbox avatars, moving with Quaternius's
 * Universal Animation Library), feet at the origin, facing +Z.
 */
export class Human {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private weights = new Map<string, number>();
  /** Shared step cycle of the walk/jog/sprint clips, 0..1. */
  private phase = 0;
  /** Sitting down (plays the sitting pose instead of standing or walking). */
  seated = false;
  /** Sitting in a car: legs out in front (see CAR_LEGS) and leaning back this far (radians: the head behind the hips). */
  inCar: { lean: number } | null = null;
  /** Driving: where the hands hold the wheel, relative to the hips (m; left hand, then right, mirrored). */
  wheel: THREE.Vector3 | null = null;
  /** In the water: swim strokes instead of steps. */
  swimming = false;
  /**
   * Something to do instead of standing about (a clip name such as 'Dance_Loop'). Looping
   * clips play until this changes; one-shot clips (see ONCE) play once and then clear it.
   */
  action: string | null = null;
  private actionClock = 0;
  private playing: string | null = null;
  private pelvis: THREE.Object3D | undefined;
  /** Rest pose then gaits by speed, on land and in water (worked out once). */
  private stops: { land: Gait[]; swim: Gait[] };
  /** How much each clip should play this frame (kept to save making a new one each time). */
  private target = new Map<string, number>();
  /** Every bone by name, and how each is turned standing at ease: relative to `root`, and to its parent. */
  private bones = new Map<string, THREE.Object3D>();
  private atEase = new Map<string, THREE.Quaternion>();
  private atEaseLocal = new Map<string, THREE.Quaternion>();
  /** Limp, posed by physics (see Ragdoll): the animations leave the bones alone. */
  private ragdolled = false;
  /**
   * Bones moved after the animations set them (by a ragdoll, getting up, hobbling), with
   * the values the animations gave them. The mixer only rewrites a bone when its animation
   * changes, so these are put back before it runs, or the changes would pile up.
   */
  private moved = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  /**
   * Getting up off the ground: how each bone lay (turned and placed relative to `root`),
   * and how far along it is (s).
   */
  private rise: { from: { bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[]; t: number } | null = null;
  /** Hobbling on a hurt leg (0..1), and which one hurts. */
  hobble = 0;
  private sore: 'l' | 'r';
  /** Where in the walk cycle the sore foot is planted, most heavily (0..1). */
  private soreStep = 0;

  constructor(assets: HumanLibrary, model: THREE.Object3D, person: PersonInfo, seed: string) {
    const scene = cloneSkinned(model);
    scene.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    // Each as tall as they really are (the pack's people all have the animations' hip height).
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const scale = THREE.MathUtils.clamp(person.height || HEIGHT, SHORTEST, TALLEST) / size.y;
    scene.scale.multiplyScalar(scale);
    this.root.add(scene);

    this.mixer = new THREE.AnimationMixer(scene);
    this.pelvis = scene.getObjectByName('pelvis');
    for (const [name, clip] of assets.clips) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(name === IDLE ? 1 : 0);
      // Times are set by hand each frame so the gaits stay in step with each other.
      action.timeScale = 0;
      this.actions.set(name, action);
      this.weights.set(name, name === IDLE ? 1 : 0);
    }
    // Shorter people take shorter steps.
    const gaits = (names: string[]) => names.filter((g) => this.actions.has(g) && assets.speeds.has(g)).map((g) => ({ name: g, speed: assets.speeds.get(g)! * scale }));
    this.stops = {
      land: [{ name: IDLE, speed: 0 }, ...gaits(GAITS)],
      swim: [{ name: this.actions.has(SWIM_IDLE) ? SWIM_IDLE : IDLE, speed: 0 }, ...gaits([SWIM])],
    };

    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o);
    });
    this.sore = pick(['l', 'r'], seed, 9);
    this.soreStep = soreStep(person.name, this.sore, this.mixer, this.actions, this.bones, this.root);
    // Standing at ease (the idle clip's first moment): what a ragdoll's joints bend away from.
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const toRoot = this.root.matrixWorld.clone().invert();
    const m = new THREE.Matrix4();
    const [p, s] = [new THREE.Vector3(), new THREE.Vector3()];
    for (const [name, bone] of this.bones) {
      const q = new THREE.Quaternion();
      m.multiplyMatrices(toRoot, bone.matrixWorld).decompose(p, q, s);
      this.atEase.set(name, q);
      this.atEaseLocal.set(name, bone.quaternion.clone());
    }
  }

  /** A bone by name ('pelvis', 'thigh_l', 'Head'...). */
  bone(name: string): THREE.Object3D | undefined {
    return this.bones.get(name);
  }

  /** How a bone is turned standing at ease, relative to `root` (see Ragdoll). */
  standing(name: string): THREE.Quaternion {
    return this.atEase.get(name) ?? new THREE.Quaternion();
  }

  /** Goes limp: physics poses the bones now (see Ragdoll), not the animations. */
  goLimp(): void {
    for (const bone of this.bones.values()) this.keep(bone);
    this.ragdolled = true;
  }

  /** Back to the animations at once, however the bones lay (limp, or halfway up). */
  stopLimp(): void {
    this.ragdolled = false;
    this.rise = null;
    this.putBack();
  }

  /** Notes how the animations left `bone`, before changing it. */
  private keep(bone: THREE.Object3D): void {
    if (!this.moved.has(bone)) this.moved.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
  }

  private putBack(): void {
    for (const [bone, { q, p }] of this.moved) {
      bone.quaternion.copy(q);
      bone.position.copy(p);
    }
    this.moved.clear();
  }

  /**
   * Gets up off the ground from however the bones lie now (after a ragdoll): onto one knee,
   * then up. Place `root` where they'll stand, facing the way they'll face, first.
   */
  getUp(): void {
    this.ragdolled = false;
    this.action = this.playing = null;
    this.root.updateMatrixWorld(true);
    const toRoot = this.root.matrixWorld.clone().invert();
    const from = [...this.bones.values()].map((bone) => {
      const q = new THREE.Quaternion();
      const p = new THREE.Vector3();
      relative.multiplyMatrices(toRoot, bone.matrixWorld).decompose(p, q, scratch.s);
      return { bone, q, p };
    });
    this.rise = { from, t: 0 };
  }

  /** Still getting up. */
  get rising(): boolean {
    return this.rise !== null;
  }

  /** Lies, kneels, then stands: blends from the pose it was left in to kneeling, then to standing. */
  private animateRise(dt: number): void {
    const r = this.rise!;
    r.t += dt;
    const fromPose = 1 - ease(r.t / TO_KNEE);
    const up = ease((r.t - TO_KNEE) / TO_FEET);
    for (const [name, action] of this.actions) {
      const w = name === KNEEL ? 1 - up : name === IDLE ? up : 0;
      action.setEffectiveWeight(w);
      this.weights.set(name, w);
    }
    this.actions.get(KNEEL)!.time = KNEEL_AT;
    this.actions.get(IDLE)!.time = 0;
    this.mixer.update(0);
    if (fromPose > 0) this.blendFrom(r.from, fromPose);
    if (r.t >= TO_KNEE + TO_FEET) this.rise = null;
  }

  /**
   * Blends the animated pose toward one where each bone is turned (and the hips placed) as
   * in `from`, relative to `root`, by `k` (1: all `from`). Turning each limb straight toward
   * its new direction, rather than joint by joint, keeps arms and legs from flailing about.
   */
  private blendFrom(from: { bone: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[], k: number): void {
    this.root.updateMatrixWorld(true);
    const toRoot = scratch.toRoot.copy(this.root.matrixWorld).invert();
    const blended = new Map<THREE.Object3D, THREE.Matrix4>();
    for (const { bone, q, p } of from) {
      this.keep(bone);
      const parent = bone.parent!;
      // Bones above in the chain have been blended already; the rest of the model hasn't moved.
      const parentM = blended.get(parent) ?? new THREE.Matrix4().multiplyMatrices(toRoot, parent.matrixWorld);
      parentM.decompose(scratch.p, scratch.parentQ, scratch.s);
      relative.multiplyMatrices(toRoot, bone.matrixWorld).decompose(scratch.target, scratch.q, scratch.s);
      scratch.q.slerp(q, k);
      bone.quaternion.copy(scratch.parentQ.invert().multiply(scratch.q));
      if (bone === this.pelvis) bone.position.copy(scratch.target.lerp(p, k).applyMatrix4(scratch.inverse.copy(parentM).invert()));
      blended.set(bone, new THREE.Matrix4().multiplyMatrices(parentM, scratch.local.compose(bone.position, bone.quaternion, bone.scale)));
    }
  }

  /**
   * Hobbling: spends less of each step on the sore leg, swings it stiff-kneed, and leans
   * over it while it's planted.
   */
  private hobbleBones(speed: number): void {
    const h = this.hobble * Math.min(1, speed / 0.5);
    if (h <= 0) return;
    const planted = Math.max(0, Math.cos((this.phase - this.soreStep) * Math.PI * 2));
    const calf = this.bones.get(`calf_${this.sore}`);
    const rest = this.atEaseLocal.get(`calf_${this.sore}`);
    if (calf && rest) {
      this.keep(calf);
      calf.quaternion.slerp(rest, HOBBLE_STIFF * h);
    }
    const spine = this.bones.get('spine_01');
    const spineAtEase = this.atEase.get('spine_01');
    if (spine && spineAtEase) {
      this.keep(spine);
      // The body's forward axis, in the spine's own frame.
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(spineAtEase.clone().invert());
      // Turning the spine about the forward axis tips it right; lean the other way for a sore left leg.
      const lean = (this.sore === 'l' ? -1 : 1) * HOBBLE_LEAN * h * planted;
      spine.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(forward, lean));
    }
  }

  /**
   * Blends idle, walk, jog and sprint to match `speed` (m/s), or plays the jump pose in the
   * air, swim strokes in water, sitting, or the current `action`.
   */
  animate(speed: number, dt: number, airborne: boolean): void {
    if (this.ragdolled) return;
    this.putBack();
    if (this.rise) return this.animateRise(dt);
    const target = this.target;
    for (const name of this.actions.keys()) target.set(name, 0);
    let stride = 1;
    // A new action starts from its beginning; a finished one-shot clears itself.
    if (this.action !== this.playing) {
      this.playing = this.action;
      this.actionClock = 0;
    }
    const act = this.action && this.actions.get(this.action);
    const kicking = this.action === KICK;
    // (A one-shot clip this pack doesn't have ends at once.)
    const length = act ? act.getClip().duration - 0.15 : kicking ? KICK_SECONDS : 0;
    if (this.action && ONCE.has(this.action) && this.actionClock >= length) this.action = this.playing = null;
    if (this.action === KICK && !this.seated) {
      target.set(this.actions.has(GUARD) ? GUARD : IDLE, 1);
    } else if (this.action && act && !this.seated) {
      target.set(this.action, 1);
    } else if (this.seated && this.actions.has(SIT)) {
      target.set(this.action && SEATED.has(this.action) && this.actions.has(this.action) ? this.action : SIT, 1);
    } else if (airborne && !this.swimming && this.actions.has(JUMP)) {
      target.set(JUMP, 1);
    } else {
      // Gaits in order of speed; blend the two around the current speed.
      const stops = this.swimming ? this.stops.swim : this.stops.land;
      const rest = stops[0].name;
      let i = 0;
      while (i < stops.length - 2 && speed > stops[i + 1].speed) i++;
      const [a, b] = [stops[i], stops[i + 1] ?? stops[i]];
      const w = b === a ? 0 : THREE.MathUtils.clamp((speed - a.speed) / (b.speed - a.speed), 0, 1);
      target.set(a.name, 1 - w);
      target.set(b.name, w);
      // Distance covered per step cycle, blended like the clips.
      const cycle = (g: { name: string; speed: number }) => g.speed * this.actions.get(g.name)!.getClip().duration;
      stride = a.name === rest ? cycle(b) : THREE.MathUtils.lerp(cycle(a), cycle(b), w);
    }
    // A sore leg hurries through its steps and lingers on the good one.
    const hurry = this.swimming ? 0 : HOBBLE_HURRY * this.hobble * Math.cos((this.phase - this.soreStep) * Math.PI * 2);
    this.phase = (this.phase + (speed / Math.max(stride, 0.1)) * (1 + hurry) * dt) % 1;
    this.actionClock += dt;

    const k = 1 - Math.exp(-dt * 10);
    for (const [name, action] of this.actions) {
      const weight = this.weights.get(name)! + (target.get(name)! - this.weights.get(name)!) * k;
      // Skip clips that have faded out entirely (most of the library, most of the time).
      if (weight < 1e-3 && this.weights.get(name)! < 1e-3) {
        if (action.getEffectiveWeight() !== 0) action.setEffectiveWeight(0);
        this.weights.set(name, 0);
        continue;
      }
      this.weights.set(name, weight);
      action.setEffectiveWeight(weight);
      const duration = action.getClip().duration;
      if (GAITS.includes(name) || name === SWIM) action.time = this.phase * duration;
      else if (name === this.playing) action.time = ONCE.has(name) ? Math.min(this.actionClock, duration - 0.01) : this.actionClock % duration;
      // Kicking, fists up as at the start of a jab.
      else if (name === GUARD && this.playing === KICK) action.time = 0;
      else action.time = (action.time + dt) % duration;
    }
    this.mixer.update(0);
    if (this.playing === KICK) this.kickBones(this.actionClock);
    if (this.seated && this.inCar) this.carBones(this.inCar.lean);
    if (!this.swimming && !this.seated && !this.action) this.hobbleBones(speed);
  }

  /** Poses the made-up front kick, `t` seconds in (see KICK_STEPS). */
  private kickBones(t: number): void {
    let i = 0;
    while (i < KICK_STEPS.length - 2 && t > KICK_STEPS[i + 1][0]) i++;
    const [a, b] = [KICK_STEPS[i], KICK_STEPS[i + 1]];
    const k = ease((t - a[0]) / (b[0] - a[0]));
    const [w, thigh, knee, lean, give] = [1, 2, 3, 4, 5].map((j) => a[j] + (b[j] - a[j]) * k);
    this.root.updateMatrixWorld(true);
    scratch.toRoot.copy(this.root.matrixWorld).invert();
    // About the sideways axis, a negative turn leans the back back, or swings a leg forward.
    this.turnBone('spine_01', -lean * 0.6);
    this.turnBone('spine_02', -lean * 0.4);
    // The kicking leg: the thigh, then the shin to the knee's bend, each part of the way there.
    const thighNow = this.legAngle('thigh_r', 'calf_r');
    this.turnBone('thigh_r', -(thigh - thighNow) * w);
    const shinNow = this.legAngle('calf_r', 'foot_r');
    const thighThen = this.legAngle('thigh_r', 'calf_r');
    this.turnBone('calf_r', -(thighThen - knee - shinNow) * w);
    this.turnBone('thigh_l', -give * 0.6);
    this.turnBone('calf_l', give);
  }

  /** Sitting in a car: leaning back against the seat, with the legs out in front (see CAR_LEGS). */
  private carBones(lean: number): void {
    this.root.updateMatrixWorld(true);
    scratch.toRoot.copy(this.root.matrixWorld).invert();
    // Back against the seat: the head this far behind the hips, however the clip sits.
    const hips = this.bones.get('pelvis')!.getWorldPosition(scratch.p).applyMatrix4(scratch.toRoot);
    const head = this.bones.get('Head')!.getWorldPosition(scratch.target).applyMatrix4(scratch.toRoot);
    this.turnBone('spine_01', -lean - Math.atan2(head.z - hips.z, head.y - hips.y));
    for (const side of ['l', 'r']) {
      const thighNow = this.legAngle(`thigh_${side}`, `calf_${side}`);
      this.turnBone(`thigh_${side}`, -(CAR_LEGS.thigh - thighNow));
      const shinNow = this.legAngle(`calf_${side}`, `foot_${side}`);
      this.turnBone(`calf_${side}`, -(CAR_LEGS.shin - shinNow));
    }
    const wheel = this.wheel;
    if (!wheel) return;
    // Hands on the wheel, wherever the shoulders have ended up.
    const pelvis = this.bones.get('pelvis')!.getWorldPosition(new THREE.Vector3());
    for (const [side, x] of [['l', 1], ['r', -1]] as const) {
      const grip = this.root.localToWorld(this.root.worldToLocal(pelvis.clone()).add(scratch.p.set(wheel.x * x, wheel.y, wheel.z)));
      this.reach(`upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`, grip);
    }
  }

  /**
   * Bends an arm (or leg) so its end reaches `target` (in the world): the middle joint
   * opens or closes to the right distance, then the top one points it there.
   */
  private reach(top: string, middle: string, end: string, target: THREE.Vector3): void {
    const [a, b, c] = [top, middle, end].map((n) => this.bones.get(n));
    if (!a || !b || !c) return;
    this.keep(a);
    this.keep(b);
    const s = a.getWorldPosition(new THREE.Vector3());
    const e = b.getWorldPosition(new THREE.Vector3());
    const h = c.getWorldPosition(new THREE.Vector3());
    const upper = s.distanceTo(e);
    const lower = e.distanceTo(h);
    const want = THREE.MathUtils.clamp(s.distanceTo(target), Math.abs(upper - lower) + 0.01, upper + lower - 0.01);
    const toTop = s.clone().sub(e);
    const toEnd = h.clone().sub(e);
    const axis = toTop.clone().cross(toEnd);
    if (axis.lengthSq() > 1e-8) {
      const now = toTop.angleTo(toEnd);
      const then = Math.acos(THREE.MathUtils.clamp((upper * upper + lower * lower - want * want) / (2 * upper * lower), -1, 1));
      turnInWorld(b, scratch.q.setFromAxisAngle(axis.normalize(), then - now));
    }
    const reached = c.getWorldPosition(new THREE.Vector3()).sub(s).normalize();
    turnInWorld(a, scratch.q.setFromUnitVectors(reached, target.clone().sub(s).normalize()));
  }

  /** How far forward of straight down a bone points (toward the joint below it), as seen from the side, in `root`'s frame. */
  private legAngle(name: string, below: string): number {
    const from = this.bones.get(name)!.getWorldPosition(scratch.p).applyMatrix4(scratch.toRoot);
    const to = this.bones.get(below)!.getWorldPosition(scratch.target).applyMatrix4(scratch.toRoot);
    return Math.atan2(to.z - from.z, from.y - to.y);
  }

  /**
   * Turns a bone by `angle` about the body's sideways axis (as seen from `root`), on top of
   * however the animations turned it. Bones above it must be turned first.
   */
  private turnBone(name: string, angle: number): void {
    const bone = this.bones.get(name);
    if (!bone || !angle) return;
    this.keep(bone);
    // The parent's turn relative to `root`, P: the bone turns by P⁻¹ R P in its own frame.
    relative.multiplyMatrices(scratch.toRoot, bone.parent!.matrixWorld).decompose(scratch.p, scratch.parentQ, scratch.s);
    scratch.q.setFromAxisAngle(SIDEWAYS, angle).premultiply(scratch.parentQ.clone().invert()).multiply(scratch.parentQ);
    bone.quaternion.premultiply(scratch.q);
    bone.updateMatrixWorld(true);
  }

  /**
   * Hangs `object` on a bone so it moves with it (a helmet on the head, a sword in the
   * hand). `object` is modeled in meters around the bone's position, facing +Z like the
   * person. Call before the person is moved or animated.
   */
  attach(boneName: string, object: THREE.Object3D): boolean {
    const bone = this.root.getObjectByName(boneName);
    if (!bone) return false;
    this.root.updateMatrixWorld(true);
    const boneInRoot = this.root.matrixWorld.clone().invert().multiply(bone.matrixWorld);
    const at = new THREE.Matrix4().makeTranslation(new THREE.Vector3().setFromMatrixPosition(boneInRoot));
    object.applyMatrix4(boneInRoot.invert().multiply(at));
    bone.add(object);
    return true;
  }

  /** Where the hips are, relative to the feet origin (in `root`'s own frame, unrotated). */
  hipsLocal(): THREE.Vector3 {
    if (!this.pelvis) return new THREE.Vector3(0, 0.95, 0);
    this.root.updateMatrixWorld(true);
    return this.root.worldToLocal(this.pelvis.getWorldPosition(new THREE.Vector3()));
  }
}
