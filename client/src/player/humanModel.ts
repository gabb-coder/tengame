import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Media } from '../assets/media.ts';

/** Height the characters are scaled to, in meters. */
const HEIGHT = 1.76;

/** Bones whose skin a T-shirt, trousers and shoes cover (by skin weight, so edges are soft). */
const SHIRT_BONES = ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r'];
const PANTS_BONES = ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'];
const SHOE_BONES = ['foot_l', 'foot_r', 'ball_l', 'ball_r', 'ball_leaf_l', 'ball_leaf_r'];

const PANTS_COLORS = ['#2b3a55', '#3a3a3c', '#4a4136', '#33404a', '#1f2a3c'];
/** Dark, so feet read as shoes rather than skin. */
const SHOE_COLORS = ['#1a1a1a', '#26262b', '#3b2a1f'];
/** Hair colors; the hair textures are pale on purpose, to be tinted. */
const HAIR_TINTS = ['#2a1d15', '#151110', '#5a3a24', '#a07850', '#6e3220', '#3d2b1f'];
/** Hairstyles per body; some are a pair (hair plus beard). */
const HAIRSTYLES: Record<Body, string[][]> = {
  male: [['Hair_SimpleParted'], ['Hair_Buzzed', 'Hair_Beard'], ['Hair_SimpleParted', 'Hair_Beard'], ['Hair_Buzzed']],
  female: [['Hair_Buns'], ['Hair_BuzzedFemale']],
};

/** Clip names in the animation file, and the ground speed (m/s) each moving one was made for. */
const IDLE = 'Idle_Loop';
const JUMP = 'Jump_Loop';
const SIT = 'Sitting_Idle_Loop';
const GAITS = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const SWIM_IDLE = 'Swim_Idle_Loop';
const SWIM = 'Swim_Fwd_Loop';
/** Clips that play once and then hand back to walking or standing. */
const ONCE = new Set(['Interact', 'PickUp_Table', 'Sword_Attack', 'Spell_Simple_Shoot', 'Hit_Chest']);
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

/** Clothing chosen for a person instead of picked at random (uniforms, costumes). */
export interface Outfit {
  pants?: string;
  shoes?: string;
  body?: Body;
  /** Bald (under a helmet, say). */
  noHair?: boolean;
}

interface HumanAssets {
  bodies: Record<Body, THREE.Object3D>;
  /** Alternative, lighter skin color map per body. */
  lightSkin: Partial<Record<Body, THREE.Texture>>;
  hair: Map<string, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
  /** Natural ground speed per gait clip. */
  speeds: Map<string, number>;
}

/** Stable per-player choice from a list, from their id. */
function pick<T>(list: readonly T[], seed: string, salt: number): T {
  let h = salt;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

/** Loads the people pack; null if it isn't installed or fails. */
export async function loadHumans(media: Media): Promise<HumanAssets | null> {
  const info = await media.humans();
  if (!info) return null;
  const [male, female, anims, maleLight, femaleLight, ...hairs] = await Promise.all([
    media.gltf('human_male.glb'),
    media.gltf('human_female.glb'),
    media.gltf('human_anims.glb'),
    media.colorTexture('humans/skin_male_light.webp'),
    media.colorTexture('humans/skin_female_light.webp'),
    ...info.hair.map((h) => media.gltf(`hair_${h}.glb`)),
  ]);
  if (!male || !female || !anims) return null;
  const hair = new Map<string, THREE.Object3D>();
  info.hair.forEach((name, i) => {
    const g = hairs[i];
    if (g) hair.set(name, g.scene);
  });
  for (const body of [male.scene, female.scene]) addClothingMask(body);
  return {
    bodies: { male: male.scene, female: female.scene },
    lightSkin: { male: maleLight ?? undefined, female: femaleLight ?? undefined },
    hair,
    clips: new Map(anims.animations.map((c) => [c.name, c])),
    speeds: new Map(Object.entries(info.clips).map(([name, c]) => [name, c.speed])),
  };
}

/** Adds a `clothMask` attribute (shirt, pants, shoes) to the body meshes from their skin weights. */
function addClothingMask(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !String((mesh.material as THREE.Material).name).includes('Superhero')) return;
    const bones = mesh.skeleton.bones.map((b) => b.name);
    const sets = [SHIRT_BONES, PANTS_BONES, SHOE_BONES].map((names) => new Set(names.map((n) => bones.indexOf(n))));
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    const mask = new Float32Array(index.count * 3);
    for (let v = 0; v < index.count; v++) {
      for (let k = 0; k < 4; k++) {
        const bone = index.getComponent(v, k);
        const w = weight.getComponent(v, k);
        sets.forEach((set, r) => {
          if (set.has(bone)) mask[v * 3 + r] += w;
        });
      }
    }
    mesh.geometry.setAttribute('clothMask', new THREE.BufferAttribute(mask, 3));
  });
}

/** Paints a T-shirt, trousers and shoes onto the body's skin material. */
function dress(material: THREE.MeshStandardMaterial, shirt: string, pants: string, shoes: string): THREE.MeshStandardMaterial {
  const m = material.clone();
  const uniforms = {
    shirtColor: { value: new THREE.Color(shirt) },
    pantsColor: { value: new THREE.Color(pants) },
    shoeColor: { value: new THREE.Color(shoes) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute vec3 clothMask;\nvarying vec3 vCloth;\n${shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvCloth = clothMask;',
    )}`;
    shader.fragmentShader = `uniform vec3 shirtColor;\nuniform vec3 pantsColor;\nuniform vec3 shoeColor;\nvarying vec3 vCloth;\n${shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
	vec3 cloth = smoothstep( vec3( 0.42 ), vec3( 0.58 ), vCloth );
	float clothed = clamp( cloth.x + cloth.y + cloth.z, 0.0, 1.0 );
	vec3 fabric = ( shirtColor * cloth.x + pantsColor * cloth.y + shoeColor * cloth.z ) / max( cloth.x + cloth.y + cloth.z, 1e-4 );
	// A hint of the skin map's shading reads as folds in the cloth.
	float shade = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) / 0.45;
	diffuseColor.rgb = mix( diffuseColor.rgb, fabric * mix( 1.0, clamp( shade, 0.7, 1.2 ), 0.25 ), clothed );`,
      )
      // Cloth hides most of the body's surface detail (muscles, toes).
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n\tnormal = normalize( mix( normal, nonPerturbedNormal, clothed * 0.8 ) );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = mix( roughnessFactor, 0.92, clothed );')}`;
  };
  m.customProgramCacheKey = () => 'dressed';
  return m;
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
function soreStep(body: Body, sore: 'l' | 'r', mixer: THREE.AnimationMixer, actions: Map<string, THREE.AnimationAction>, bones: Map<string, THREE.Object3D>, root: THREE.Object3D): number {
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
 * A realistic animated person (Quaternius Universal Base Characters), feet at the origin,
 * facing +Z. Looks (body, skin, hair, clothes) are picked from `seed`; the shirt is `shirtColor`.
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

  constructor(
    private assets: HumanAssets,
    shirtColor: string,
    seed: string,
    outfit: Outfit = {},
  ) {
    const body: Body = outfit.body ?? pick(['male', 'female'], seed, 7);
    const scene = cloneSkinned(assets.bodies[body]);
    const lightSkin = pick([false, true], seed, 8) ? assets.lightSkin[body] : undefined;
    const hairTint = pick(HAIR_TINTS, seed, 3);

    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.name.includes('Superhero')) {
        mesh.material = dress(mat, shirtColor, outfit.pants ?? pick(PANTS_COLORS, seed, 2), outfit.shoes ?? pick(SHOE_COLORS, seed, 4));
        if (lightSkin) (mesh.material as THREE.MeshStandardMaterial).map = lightSkin;
      } else if (mat.name.includes('Hair')) {
        // Eyebrows share the hair material.
        mesh.material = mat.clone();
        (mesh.material as THREE.MeshStandardMaterial).color.set(hairTint);
      }
    });

    // Hair is modeled in the body's space; hang it on the head bone so it follows.
    scene.updateMatrixWorld(true);
    const head = scene.getObjectByName('Head');
    if (head) {
      const toHead = head.matrixWorld.clone().invert();
      for (const name of outfit.noHair ? [] : pick(HAIRSTYLES[body], seed, 5)) {
        const template = assets.hair.get(name);
        if (!template) continue;
        const hair = template.clone();
        hair.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
          (mesh.material as THREE.MeshStandardMaterial).color.set(hairTint);
        });
        hair.applyMatrix4(toHead);
        head.add(hair);
      }
    }

    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    scene.scale.multiplyScalar(HEIGHT / size.y);
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
    const gaits = (names: string[]) => names.filter((g) => this.actions.has(g) && assets.speeds.has(g)).map((g) => ({ name: g, speed: assets.speeds.get(g)! }));
    this.stops = {
      land: [{ name: IDLE, speed: 0 }, ...gaits(GAITS)],
      swim: [{ name: this.actions.has(SWIM_IDLE) ? SWIM_IDLE : IDLE, speed: 0 }, ...gaits([SWIM])],
    };

    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o);
    });
    this.sore = pick(['l', 'r'], seed, 9);
    this.soreStep = soreStep(body, this.sore, this.mixer, this.actions, this.bones, this.root);
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
    if (act && ONCE.has(this.action!) && this.actionClock >= act.getClip().duration - 0.15) this.action = this.playing = null;
    if (this.action && act && !this.seated) {
      target.set(this.action, 1);
    } else if (this.seated && this.actions.has(SIT)) {
      target.set(this.action === 'Sitting_Talking_Loop' ? this.action : SIT, 1);
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
      else action.time = (action.time + dt) % duration;
    }
    this.mixer.update(0);
    if (!this.swimming && !this.seated && !this.action) this.hobbleBones(speed);
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
