import { touchDevice } from './device.ts';
import { settings } from './settings.ts';
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
/** Radians of camera turn per pixel a finger drags across the screen. */
const DRAG_SENSITIVITY = 0.006;
/** How far the on-screen stick goes before it moves you at all, and how far is running. */
const STICK_DEAD = 0.15;
const STICK_RUN = 0.9;
/** Driving with the stick: past this far is full throttle or full lock, so pushing on a diagonal is too. */
const STICK_FULL = 0.7;

/**
 * Tracks held keys and mouse movement, and on phones and tablets the on-screen stick,
 * buttons and finger drags (see TouchControls). Ignores keys typed into form fields.
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  private mouse = { x: 0, y: 0 };
  private dragged = { x: 0, y: 0 };
  /** Where the on-screen stick is pushed: x right, y forward, within the unit circle. */
  private stick = { x: 0, y: 0 };
  /** Off while a menu is open: game keys and mouse look are ignored. */
  enabled = true;
  /** Clicking the game captures the mouse for looking around (not when racing: nothing to look at). */
  capturePointer = true;

  constructor(private pointerTarget: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || !this.enabled) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
      // Keep Space/arrows from scrolling or clicking focused buttons.
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.held.clear());

    // Click the game to capture the mouse for looking around; Esc releases it. (Fingers drag to look instead.)
    pointerTarget.addEventListener('click', () => {
      if (!this.pointerLocked && this.enabled && this.capturePointer && !touchDevice) void pointerTarget.requestPointerLock?.();
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
    const { x, y } = this.stick;
    return {
      throttle: Math.max(this.any('KeyW', 'ArrowUp') ? 1 : 0, push(y)),
      brake: Math.max(this.any('KeyS', 'ArrowDown') ? 1 : 0, push(-y)),
      steer: clamp((this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0) + push(x) - push(-x)),
      handbrake: this.any('Space'),
    };
  }

  get foot(): FootControls {
    // The stick walks as fast as it's pushed (past the dead zone), and runs pushed all the way.
    const { x, y } = this.stick;
    const length = Math.hypot(x, y);
    const k = length > STICK_DEAD ? Math.min(1, (length - STICK_DEAD) / (1 - STICK_DEAD)) / length : 0;
    return {
      forward: clamp((this.any('KeyW') ? 1 : 0) - (this.any('KeyS') ? 1 : 0) + y * k),
      strafe: clamp((this.any('KeyD') ? 1 : 0) - (this.any('KeyA') ? 1 : 0) + x * k),
      run: this.any('ShiftLeft', 'ShiftRight') || length >= STICK_RUN,
      jump: this.any('Space'),
    };
  }

  /** Pushes the on-screen stick: x right, y forward, each -1..1 (0, 0 lets go). */
  setStick(x: number, y: number): void {
    const length = Math.hypot(x, y);
    const k = this.enabled ? 1 / Math.max(1, length) : 0;
    this.stick.x = x * k;
    this.stick.y = y * k;
  }

  /** Pushed far enough to run (for showing it on the stick). */
  get stickRunning(): boolean {
    return Math.hypot(this.stick.x, this.stick.y) >= STICK_RUN;
  }

  /** A finger dragged across the screen by this many pixels: looks around, like the mouse. */
  drag(dx: number, dy: number): void {
    if (!this.enabled) return;
    this.dragged.x += dx;
    this.dragged.y += dy;
  }

  /** An on-screen button held down or let go: just as if `code` were a key on the keyboard. */
  hold(code: string, down: boolean): void {
    if (!down) this.held.delete(code);
    else if (this.enabled && !this.held.has(code)) {
      this.pressed.add(code);
      this.held.add(code);
    }
  }

  /** An on-screen button tapped: a quick press of `code`. */
  tap(code: string): void {
    if (this.enabled) this.pressed.add(code);
  }

  /**
   * Camera turn since the last call, in radians: mouse (when captured), fingers dragged, and arrow keys.
   * `yaw` positive turns left; `pitch` positive looks down.
   */
  takeLook(dt: number): { yaw: number; pitch: number } {
    const sensitivity = MOUSE_SENSITIVITY * settings.mouseSensitivity;
    const drag = DRAG_SENSITIVITY * settings.mouseSensitivity;
    const x = this.mouse.x * sensitivity + this.dragged.x * drag;
    const y = this.mouse.y * sensitivity + this.dragged.y * drag;
    const yaw = -x + ((this.any('ArrowLeft') ? 1 : 0) - (this.any('ArrowRight') ? 1 : 0)) * KEY_LOOK_SPEED * dt;
    const pitch = y * (settings.invertY ? -1 : 1) + ((this.any('ArrowDown') ? 1 : 0) - (this.any('ArrowUp') ? 1 : 0)) * KEY_LOOK_SPEED * dt * 0.6;
    this.mouse.x = this.mouse.y = 0;
    this.dragged.x = this.dragged.y = 0;
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
    this.dragged.x = this.dragged.y = 0;
    this.stick.x = this.stick.y = 0;
  }

  /** Forget presses nobody asked about this frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  private any(...codes: string[]): boolean {
    return codes.some((k) => this.held.has(k));
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** How hard the stick is pushed one way (`v` along it), 0..1: none in the dead zone, all well before the edge. */
function push(v: number): number {
  return Math.max(0, Math.min(1, (v - STICK_DEAD) / (STICK_FULL - STICK_DEAD)));
}
