import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** On-foot character tuning. Capsule is 1.7 m tall. */
export const AVATAR = {
  radius: 0.3,
  halfHeight: 0.55,
  walkSpeed: 2.2, // m/s
  runSpeed: 5.5,
  acceleration: 14, // m/s² toward the target speed
  jumpSpeed: 4.6,
  gravity: 16, // a bit stronger than real for snappier jumps
  /** Tallest ledge walked up without jumping: porch steps are 0.4 m. */
  stepHeight: 0.45,
  maxSlope: THREE.MathUtils.degToRad(45),
  turnRate: 10, // how fast the body turns toward the movement direction
} as const;

/** Distance from the feet to the capsule center. */
export const CAPSULE_CENTER = AVATAR.halfHeight + AVATAR.radius;

/**
 * A walking character using Rapier's kinematic character controller: collides with
 * walls, slides along them, climbs steps and stays glued to the ground.
 */
export class CharacterPhysics {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private velocity = new THREE.Vector3();
  grounded = false;
  private measuredSpeed = 0;
  /** Facing, radians around +Y; 0 faces +Z. */
  yaw = 0;

  constructor(
    private world: RAPIER.World,
    feet: THREE.Vector3Like,
  ) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + CAPSULE_CENTER, feet.z),
    );
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(AVATAR.halfHeight, AVATAR.radius), this.body);
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(AVATAR.stepHeight, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(AVATAR.maxSlope);
    this.controller.setApplyImpulsesToDynamicBodies(true);
  }

  get feet(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y - CAPSULE_CENTER, t.z);
  }

  /** Horizontal speed in m/s. */
  /** Horizontal speed actually moved (after collisions), in m/s. Drives the walk animation. */
  get speed(): number {
    return this.measuredSpeed;
  }

  /** Disabled characters don't collide or get hit by rays (e.g. while driving). */
  setEnabled(enabled: boolean): void {
    this.body.setEnabled(enabled);
  }

  teleport(feet: THREE.Vector3Like, yaw = this.yaw): void {
    this.body.setTranslation({ x: feet.x, y: feet.y + CAPSULE_CENTER, z: feet.z }, true);
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + CAPSULE_CENTER, z: feet.z });
    this.velocity.set(0, 0, 0);
    this.measuredSpeed = 0;
    this.yaw = yaw;
  }

  /**
   * One fixed physics step. `move` is the desired horizontal direction in world space
   * with length 0..1; call before `world.step()`.
   */
  step(move: THREE.Vector3, run: boolean, jump: boolean, dt: number): void {
    const target = move.clone().multiplyScalar(run ? AVATAR.runSpeed : AVATAR.walkSpeed);
    // Ease horizontal velocity toward the target; less control in the air.
    const k = 1 - Math.exp(-AVATAR.acceleration * dt * (this.grounded ? 1 : 0.15));
    this.velocity.x += (target.x - this.velocity.x) * k;
    this.velocity.z += (target.z - this.velocity.z) * k;

    // While grounded, move horizontally only (snap-to-ground handles going down):
    // Rapier's autostep doesn't trigger when the requested move points into the ground.
    if (this.grounded && jump) this.velocity.y = AVATAR.jumpSpeed;
    else if (this.grounded) this.velocity.y = 0;
    else this.velocity.y -= AVATAR.gravity * dt;

    const desired = this.velocity.clone().multiplyScalar(dt);
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    // Bumped our head or a wall: don't keep pushing into it.
    if (this.velocity.y > 0 && moved.y < desired.y * 0.5) this.velocity.y = 0;
    // Keep the intended horizontal velocity (it's capped at the target speed), so slopes and
    // stairs don't bleed it away; just record how fast we really went.
    if (dt > 0) this.measuredSpeed += (Math.hypot(moved.x, moved.z) / dt - this.measuredSpeed) * 0.3;

    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z });

    if (move.lengthSq() > 0.01) {
      const targetYaw = Math.atan2(move.x, move.z);
      const diff = Math.atan2(Math.sin(targetYaw - this.yaw), Math.cos(targetYaw - this.yaw));
      this.yaw += diff * (1 - Math.exp(-AVATAR.turnRate * dt));
    }
  }

  /**
   * Whether a standing character would fit with its feet at `feet`.
   * Used to find a free spot when getting out of the car.
   */
  fits(feet: THREE.Vector3Like, ignore?: RAPIER.RigidBody): boolean {
    const shape = new RAPIER.Capsule(AVATAR.halfHeight, AVATAR.radius);
    const hit = this.world.intersectionWithShape(
      { x: feet.x, y: feet.y + CAPSULE_CENTER + 0.05, z: feet.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      undefined,
      undefined,
      this.collider,
      ignore,
    );
    return hit === null;
  }
}
