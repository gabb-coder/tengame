import * as THREE from 'three';

const all = new Set<Label>();

/**
 * An HTML element pinned over a point in the scene, like a name tag or a speech bubble.
 * Add it to an object and it follows it; it hides whenever that object does.
 */
export class Label extends THREE.Object3D {
  constructor(readonly element: HTMLElement) {
    super();
    element.style.position = 'absolute';
    element.style.userSelect = 'none';
    all.add(this);
  }

  /** Takes it off the screen for good. */
  dispose(): void {
    all.delete(this);
    this.removeFromParent();
    this.element.remove();
  }
}

/** Whether `o` and everything it hangs from are visible, up to a scene. */
function shownInScene(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) {
    if (!x.visible) return false;
    if ((x as THREE.Scene).isScene) return true;
  }
  return false;
}

/**
 * Draws every `Label` over the 3D view. It only visits the labels themselves: three's
 * CSS2DRenderer walks the whole scene (thousands of objects) every frame to find them.
 */
export class Labels {
  readonly domElement = document.createElement('div');
  private halfWidth = 0.5;
  private halfHeight = 0.5;
  private viewProjection = new THREE.Matrix4();
  private at = new THREE.Vector3();
  private shown: { label: Label; depth: number }[] = [];

  constructor() {
    const s = this.domElement.style;
    s.position = 'fixed';
    s.inset = '0';
    s.overflow = 'hidden';
    s.pointerEvents = 'none';
  }

  setSize(width: number, height: number): void {
    this.halfWidth = width / 2;
    this.halfHeight = height / 2;
  }

  /** Call after rendering the scene, so the labels' places are up to date. */
  render(camera: THREE.Camera): void {
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.shown.length = 0;
    for (const label of all) {
      const style = label.element.style;
      const p = this.at.setFromMatrixPosition(label.matrixWorld).applyMatrix4(this.viewProjection);
      if (!shownInScene(label) || p.z < -1 || p.z > 1) {
        if (style.display !== 'none') style.display = 'none';
        continue;
      }
      if (style.display === 'none') style.display = '';
      const x = p.x * this.halfWidth + this.halfWidth;
      const y = -p.y * this.halfHeight + this.halfHeight;
      style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (label.element.parentNode !== this.domElement) this.domElement.appendChild(label.element);
      this.shown.push({ label, depth: p.z });
    }
    // Nearer labels on top.
    this.shown.sort((a, b) => b.depth - a.depth);
    this.shown.forEach(({ label }, i) => {
      const z = String(i);
      if (label.element.style.zIndex !== z) label.element.style.zIndex = z;
    });
  }
}
