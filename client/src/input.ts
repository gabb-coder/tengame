import type { CarControls } from './vehicles/carPhysics.ts';

/** Tracks held keys. Ignores keys typed into form fields. */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Keep Space/arrows from scrolling or clicking focused buttons.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());
  }

  get car(): CarControls {
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: this.any('Space'),
    };
  }

  /** True once per key press; call once per frame per key. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Forget presses nobody asked about this frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  private any(...codes: string[]): boolean {
    return codes.some((k) => this.held.has(k));
  }
}
