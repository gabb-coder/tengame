import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { Quat, Vec3 } from '../../../shared/protocol.ts';
import type { Input } from './input.ts';
import { createPlayerMesh, PLAYER_SIZE } from './playerMesh.ts';

const MOVE_SPEED = 14; // m/s
const TURN_SPEED = 2.4; // rad/s
const JUMP_SPEED = 6;
const RESPAWN_BELOW_Y = -20;

/**
 * The player's own box, moved with simple velocity control.
 * Milestone 2 replaces this with raycast-vehicle physics.
 */
export class LocalPlayer {
  readonly mesh: THREE.Group;
  private body: RAPIER.RigidBody;
  private heading = 0;
  private forward = new THREE.Vector3();

  constructor(
    private world: RAPIER.World,
    color: string,
    private spawn: THREE.Vector3,
  ) {
    this.mesh = createPlayerMesh(color);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .lockRotations()
        .setLinearDamping(0.5),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(PLAYER_SIZE.x / 2, PLAYER_SIZE.y / 2, PLAYER_SIZE.z / 2).setFriction(0),
      this.body,
    );
  }

  update(input: Input, dt: number): void {
    // Steering flips when reversing, like a car.
    const direction = input.throttle < 0 ? -1 : 1;
    this.heading -= input.steer * TURN_SPEED * dt * (input.throttle === 0 ? 0.6 : direction);
    this.body.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.heading), true);

    this.forward.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const v = this.body.linvel();
    let vy = v.y;
    if (input.jump && this.isGrounded()) vy = JUMP_SPEED;
    const speed = input.throttle * MOVE_SPEED;
    this.body.setLinvel({ x: this.forward.x * speed, y: vy, z: this.forward.z * speed }, true);

    if (this.body.translation().y < RESPAWN_BELOW_Y) {
      this.body.setTranslation(this.spawn, true);
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Copies the physics body into the mesh. Call after the world steps. */
  sync(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  get transform(): { p: Vec3; q: Quat } {
    const { position: p, quaternion: q } = this.mesh;
    return { p: [round(p.x), round(p.y), round(p.z)], q: [round(q.x), round(q.y), round(q.z), round(q.w)] };
  }

  private isGrounded(): boolean {
    const t = this.body.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, PLAYER_SIZE.y / 2 + 0.1, true, undefined, undefined, undefined, this.body);
    return hit !== null;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
