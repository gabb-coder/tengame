import * as THREE from 'three';

/**
 * Shooting stars: on clear nights, now and then a streak of light flashes across the sky.
 * Each player sees their own (they're far too quick to notice the difference).
 */
export class ShootingStars {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private wait = 4;
  private life = 0;
  private from = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    // A thin streak, bright at its head and fading along its tail (the head is at +Y).
    const g = new THREE.CylinderGeometry(0.9, 0, 90, 4, 1, true).translate(0, -45, 0);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** `clear`: how clear and dark the sky is (0 by day or under cloud, 1 on a clear night). */
  update(dt: number, camera: THREE.Vector3, clear: number): void {
    if (this.life > 0) {
      this.life -= dt;
      const k = 1 - this.life / 0.9;
      this.mesh.position.copy(this.from).addScaledVector(this.dir, k * 420).add(camera);
      this.material.opacity = Math.sin(Math.PI * Math.min(1, k)) * clear;
      this.mesh.visible = this.life > 0;
      return;
    }
    this.wait -= dt;
    if (this.wait > 0 || clear < 0.3) return;
    this.wait = 5 + Math.random() * 14;
    this.life = 0.9;
    // Somewhere high in the sky, falling at a slant.
    const a = Math.random() * Math.PI * 2;
    this.from.set(Math.cos(a) * 900, 520 + Math.random() * 260, Math.sin(a) * 900);
    this.dir.set(-Math.cos(a) * 0.6 + (Math.random() - 0.5) * 0.8, -0.45, -Math.sin(a) * 0.6 + (Math.random() - 0.5) * 0.8).normalize();
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
  }
}
