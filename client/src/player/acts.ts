import * as THREE from 'three';
import type { Act, Gear } from '../../../shared/protocol.ts';
import type { AvatarModel } from './avatarModel.ts';

/** The animation clip each act plays (null: no special pose). */
const ACT_CLIPS: Record<Act, string | null> = {
  dance: 'Dance_Loop',
  talk: 'Idle_Talking_Loop',
  interact: 'Interact',
  pickup: 'PickUp_Table',
  // Arm out in front, as if holding a torch: just right for holding a rod.
  fish: 'Idle_Torch_Loop',
  hit: 'Hit_Chest',
  jet: null,
  // Knocked flying by a car: physics throws the limp body about, then it gets up (see AvatarModel.fling).
  tumble: null,
  down: null,
  getup: null,
};

/** Acts that play once (the player's state keeps naming them only while they play). */
export const ONE_SHOT_ACTS = new Set<Act>(['interact', 'pickup', 'hit', 'getup']);

const graphite = new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.4, metalness: 0.6 });
const cork = new THREE.MeshStandardMaterial({ color: '#b08a5a', roughness: 0.9 });
const tankWhite = new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.35, metalness: 0.3 });
const steel = new THREE.MeshStandardMaterial({ color: '#8a9098', roughness: 0.3, metalness: 0.9 });
const stripe = new THREE.MeshStandardMaterial({ color: '#e05a1a', roughness: 0.5 });
const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

/** A fishing rod held in the right hand, pointing forward and up. */
export function fishingRod(): { bone: string; object: THREE.Object3D } {
  const rod = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 2.1, 6).translate(0, 1.05, 0), graphite);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 8).translate(0, 0.05, 0), cork);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12).rotateZ(Math.PI / 2), steel);
  reel.position.set(0.03, 0.22, 0);
  rod.add(pole, grip, reel);
  // Tip forward and up from the fist.
  rod.rotation.x = 1.0;
  rod.name = 'rod';
  return { bone: 'hand_r', object: rod };
}

/** Where the rod's tip is, in the world (for drawing the line). */
export function rodTip(avatar: AvatarModel, out: THREE.Vector3): THREE.Vector3 | null {
  const rod = avatar.gearObject('rod');
  if (!rod || !rod.visible) return null;
  return rod.localToWorld(out.set(0, 2.1, 0));
}

/** Two tanks on the back with nozzles that blaze while thrusting. */
export function jetpack(): { bone: string; object: THREE.Object3D } {
  const pack = new THREE.Group();
  for (const side of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.36, 4, 12), tankWhite);
    tank.position.set(side * 0.1, 0, -0.2);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, 0.05, 12), stripe);
    band.position.set(side * 0.1, 0.1, -0.2);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.1, 10), steel);
    nozzle.position.set(side * 0.1, -0.31, -0.2);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.7, 8, 1, true).translate(0, -0.35, 0), flame);
    fire.position.set(side * 0.1, -0.36, -0.2);
    fire.name = 'flame';
    fire.visible = false;
    pack.add(tank, band, nozzle, fire);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.05), graphite);
  frame.position.set(0, 0.02, -0.13);
  pack.add(frame);
  pack.name = 'jetpack';
  return { bone: 'spine_03', object: pack };
}

/**
 * Shows what a character is doing: the act's pose, a rod while fishing, the jetpack and
 * its flames. Call every frame; `fresh` is false while the same one-shot act continues
 * (so it isn't replayed).
 */
export function showAct(avatar: AvatarModel, act: Act | null | undefined, gear: Gear | null | undefined, swimming: boolean, previous: Act | null | undefined, time: number): void {
  avatar.swimming = swimming;
  if (act !== previous) avatar.action = act ? ACT_CLIPS[act] : null;
  // Looping acts keep going for as long as they're named.
  else if (act && !ONE_SHOT_ACTS.has(act) && ACT_CLIPS[act] && avatar.action !== ACT_CLIPS[act]) avatar.action = ACT_CLIPS[act];
  avatar.setGear('rod', act === 'fish', fishingRod);
  avatar.setGear('jetpack', gear === 'jetpack', jetpack);
  const pack = avatar.gearObject('jetpack');
  if (pack) {
    pack.traverse((o) => {
      if (o.name !== 'flame') return;
      o.visible = act === 'jet';
      o.scale.y = 0.8 + Math.sin(time * 40 + o.position.x * 9) * 0.25;
    });
  }
}
