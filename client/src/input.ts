import type { CarControls } from './vehicles/carPhysics.ts';

export interface FootControls {
  /** -1..1 backward/forward. */
  forward: number;
  /** -1..1 left/right. */
  strafe: number;
  run: boolean;
  jump: boolean;
}

/** Radians of camera turn per pixel of mouse movement. */
const MOUSE_SENSITIVITY = 0.0025;
/** Radians per second when turning the camera with the arrow keys. */
const KEY_LOOK_SPEED = 2.2;

/** Tracks held keys and mouse movement. Ignores keys typed into form fields. */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private mouse = { x: 0, y: 0 };

  constructor(private pointerTarget: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Keep Space/arrows from scrolling or clicking focused buttons.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());

    // Click the game to capture the mouse for looking around; Esc releases it.
    pointerTarget.addEventListener('click', () => {
      if (!this.pointerLocked) void pointerTarget.requestPointerLock?.();
    });
    addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouse.x += e.movementX;
      this.mouse.y += e.movementY;
    });
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.pointerTarget;
  }

  get car(): CarControls {
    return {
      throttle: this.any('KeyW', 'ArrowUp') ? 1 : 0,
      brake: this.any('KeyS', 'ArrowDown') ? 1 : 0,
      steer: (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0),
      handbrake: this.any('Space'),
    };
  }

  get foot(): FootControls {
    return {
      forward: (this.any('KeyW') ? 1 : 0) - (this.any('KeyS') ? 1 : 0),
      strafe: (this.any('KeyD') ? 1 : 0) - (this.any('KeyA') ? 1 : 0),
      run: this.any('ShiftLeft', 'ShiftRight'),
      jump: this.any('Space'),
    };
  }

  /**
   * Camera turn since the last call, in radians: mouse (when captured) plus arrow keys.
   * `yaw` positive turns left; `pitch` positive looks down.
   */
  takeLook(dt: number): { yaw: number; pitch: number } {
    const yaw = -this.mouse.x * MOUSE_SENSITIVITY + ((this.any('ArrowLeft') ? 1 : 0) - (this.any('ArrowRight') ? 1 : 0)) * KEY_LOOK_SPEED * dt;
    const pitch = this.mouse.y * MOUSE_SENSITIVITY + ((this.any('ArrowDown') ? 1 : 0) - (this.any('ArrowUp') ? 1 : 0)) * KEY_LOOK_SPEED * dt * 0.6;
    this.mouse.x = this.mouse.y = 0;
    return { yaw, pitch };
  }

  /** True once per key press; call once per frame per key. */
  wasPressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** Let go of everything, e.g. when focus moves to the chat box. */
  releaseAll(): void {
    this.held.clear();
    this.pressed.clear();
    this.mouse.x = this.mouse.y = 0;
  }

  /** Forget presses nobody asked about this frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  private any(...codes: string[]): boolean {
    return codes.some((k) => this.held.has(k));
  }
}
