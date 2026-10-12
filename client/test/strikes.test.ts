// Punches and kicks: what they land on, and how the body moves to throw them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import type { PersonInfo } from '../src/assets/media.ts';
import { Impacts, strikeHit, type Target } from '../src/game/impacts.ts';
import { Human, type HumanLibrary, KICK_SECONDS } from '../src/player/humanModel.ts';
import { loadModel } from './glb.ts';

/** Someone (or something) standing at x, z: a person unless told otherwise. */
function standing(x: number, z: number, more: Partial<Target> & { y?: number } = {}): Target {
  const { y = 0, ...rest } = more;
  return { at: (out) => out.set(x, y, z), radius: 0.35, height: 1.8, minSpeed: 1.2, mass: 80, harm: 0.03, hit: () => {}, ...rest };
}

function world(...targets: Target[]): Impacts {
  const impacts = new Impacts();
  for (const t of targets) impacts.addMoving(t);
  return impacts;
}

const feet = new THREE.Vector3(0, 0, 0);

test('a punch lands on whoever is right in front, within arm’s reach', () => {
  const close = standing(0, 1);
  assert.equal(strikeHit(world(close), 'punch', feet, 0), close);
  // Facing away, or off to the side, or too far: a miss.
  assert.equal(strikeHit(world(close), 'punch', feet, Math.PI), null);
  assert.equal(strikeHit(world(standing(1.3, 0.6)), 'punch', feet, 0), null);
  assert.equal(strikeHit(world(standing(0, 1.4)), 'punch', feet, 0), null);
  // Turned toward them, it lands.
  const aside = standing(1, 0);
  assert.equal(strikeHit(world(aside), 'punch', feet, Math.PI / 2), aside);
});

test('a kick reaches a little further, and low enough for small things', () => {
  const far = standing(0, 1.35);
  assert.equal(strikeHit(world(far), 'kick', feet, 0), far);
  const penguin = standing(0, 0.8, { radius: 0.3, height: 0.8, mass: 25 });
  assert.equal(strikeHit(world(penguin), 'kick', feet, 0), penguin);
  // A punch goes over its head; and nobody can reach a bird up in the sky.
  assert.equal(strikeHit(world(penguin), 'punch', feet, 0), null);
  assert.equal(strikeHit(world(standing(0, 1, { y: 4 })), 'kick', feet, 0), null);
});

test('only the nearest of two in a row gets hit', () => {
  const front = standing(0.1, 0.7);
  const behind = standing(-0.1, 1.1);
  assert.equal(strikeHit(world(behind, front), 'punch', feet, 0), front);
});

test('a kick at the bin ahead hits the bin, not the hedge alongside', () => {
  const bin = standing(0, 1.1, { radius: 0.35, height: 1.05, mass: 25 });
  const hedge = standing(0.95, 0.3, { radius: 0.6, height: 0.9, mass: 90 });
  assert.equal(strikeHit(world(hedge, bin), 'kick', feet, 0), bin);
  // Turned toward the hedge, it's the hedge.
  assert.equal(strikeHit(world(hedge, bin), 'kick', feet, Math.PI / 2), hedge);
});

/** One of the game's real people, with the shared animations (as the game loads them). */
async function person(): Promise<Human> {
  const manifest = JSON.parse(readFileSync('public/media/manifest.json', 'utf8'));
  const people: PersonInfo[] = manifest.humans.people;
  const info = people.find((p) => p.everyday && p.body === 'male')!;
  const anims = await loadModel('human_anims.glb');
  const model = await loadModel(`person_${info.name}.glb`);
  // Just the turns of each joint (see turnsOnly in humanModel.ts).
  const turns = (c: THREE.AnimationClip) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position' || t.name === 'root.position'));
  const library: HumanLibrary = {
    people,
    clips: new Map(anims.animations.map((c) => [c.name, turns(c)])),
    speeds: new Map(Object.entries(manifest.humans.clips as Record<string, { speed: number }>).map(([name, c]) => [name, c.speed])),
    person: async () => model.scene,
  };
  return new Human(library, model.scene, info, 'fighter');
}

test('a kick lifts the knee, snaps the foot out at hip height and puts it back, standing on the other leg', async () => {
  const human = await person();
  const at = (bone: string) => human.root.worldToLocal(human.bone(bone)!.getWorldPosition(new THREE.Vector3()));
  const play = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-6; t += 1 / 60) human.animate(0, 1 / 60, false);
  };
  play(0.5);
  const footBefore = at('foot_r');
  const otherFoot = at('foot_l');
  const head = at('Head');

  human.action = 'Kick';
  play(0.2);
  assert.ok(at('calf_r').y > 0.65, `the knee comes up (${at('calf_r').y.toFixed(2)} m)`);
  play(0.1);
  // Facing +Z: the foot is out in front, at about hip height.
  const out = at('foot_r');
  assert.ok(out.z > 0.6 && out.y > 0.6, `the foot is out at ${out.toArray().map((v) => v.toFixed(2))}`);
  assert.ok(at('Head').z < head.z - 0.05, 'leaning back for balance');
  assert.ok(at('foot_l').distanceTo(otherFoot) < 0.05, 'the standing foot stays put');

  play(KICK_SECONDS - 0.3 + 0.3);
  assert.equal(human.action, null, 'the kick ends by itself');
  assert.ok(at('foot_r').distanceTo(footBefore) < 0.06, 'and the foot is back on the ground');
});

test('a jab throws the left fist out in front', async () => {
  const human = await person();
  const hand = () => human.root.worldToLocal(human.bone('hand_l')!.getWorldPosition(new THREE.Vector3()));
  for (let i = 0; i < 30; i++) human.animate(0, 1 / 60, false);
  const before = hand();
  human.action = 'Punch_Jab';
  for (let i = 0; i < 12; i++) human.animate(0, 1 / 60, false);
  const out = hand();
  assert.ok(out.z > before.z + 0.5 && out.y > 1.2, `the fist goes out to ${out.toArray().map((v) => v.toFixed(2))}`);
});
