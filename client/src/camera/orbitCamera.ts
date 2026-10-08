import * as THREE from 'three';

const DISTANCE = 3.4;
const TARGET_HEIGHT = 1.55;
/** Offset to the right so the character doesn't block the view straight ahead. */
const SHOULDER_OFFSET = 0.45;
const MIN_PITCH = -0.6; // looking up
const MAX_PITCH = 1.2; // looking down
const FOV = 62;

/**
 * Third-person camera for walking: orbits the character with mouse/arrow input,
 * and pulls in when a wall or ceiling would get between them.
 */
export class OrbitCamera {
  /** Direction the camera looks, radians around +Y; 0 looks toward +Z. */
  yaw = 0;
  pitch = 0.25;

  /** See ChaseCamera: distance to the first obstacle from `from` toward `to`, or null. */
  constructor(
    private camera: THREE.PerspectiveCamera,
    private obstruct?: (from: THREE.Vector3, to: THREE.Vector3) => number | null,
  ) {}

  /** Horizontal forward and right directions for camera-relative movement. */
  get basis(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    return {
      forward: new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)),
      right: new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)),
    };
  }

  turn(yaw: number, pitch: number): void {
    this.yaw += yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, MIN_PITCH, MAX_PITCH);
  }

  update(feet: THREE.Vector3): void {
    const { right } = this.basis;
    const target = feet.clone().setY(feet.y + TARGET_HEIGHT).addScaledVector(right, SHOULDER_OFFSET);
    const back = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    let distance = DISTANCE;
    const hit = this.obstruct?.(target, target.clone().addScaledVector(back, DISTANCE));
    if (hit != null) distance = Math.max(hit - 0.25, 0.3);

    this.camera.position.copy(target).addScaledVector(back, distance);
    this.camera.lookAt(target);
    if (this.camera.fov !== FOV) {
      this.camera.fov = FOV;
      this.camera.updateProjectionMatrix();
    }
  }
}
