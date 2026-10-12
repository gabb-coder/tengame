import { touchDevice } from './device.ts';
import { type Action, isBound, keyOf, normalizeCode } from './keys.ts';
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
 * Tracks held keys, mouse buttons and mouse movement, and on phones and tablets the
 * on-screen stick, buttons and finger drags (see TouchControls). Ignores keys typed into
 * form fields. Most things are asked for by action ('jump', 'punch'), on whichever key
 * the player has put it (see keys.ts); on-screen buttons press an action itself, as
 * '@jump' and so on.
 */
export class Input {
  private held = new Set<string>();
  private presses = new Set<string>();
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
      const code = normalizeCode(e.code);
      if (!e.repeat) this.presses.add(code);
      this.held.add(code);
      // Keep game keys from doing what they'd do on a page (Space and arrows scroll or
      // click focused buttons, F5 reloads, Alt opens the browser's menu...).
      if (code === 'Space' || code.startsWith('Arrow') || isBound(code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.held.delete(normalizeCode(e.code)));
    addEventListener('blur', () => this.held.clear());
    // Mouse buttons count once the mouse is captured (the first click only captures it).
    document.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked || !this.enabled) return;
      const code = `Mouse${e.button}`;
      this.presses.add(code);
      this.held.add(code);
      // The side buttons would go back a page, out of the game.
      if (e.button > 2) e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      this.held.delete(`Mouse${e.button}`);
      if (e.button > 2 && this.pointerLocked) e.preventDefault();
    });
    // The right button kicks; it shouldn't open the page's menu too.
    pointerTarget.addEventListener('contextmenu', (e) => e.preventDefault());

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
      throttle: Math.max(this.isDown('accelerate') || this.arrow('ArrowUp') ? 1 : 0, push(y)),
      brake: Math.max(this.isDown('brake') || this.arrow('ArrowDown') ? 1 : 0, push(-y)),
      steer: clamp((this.isDown('steerRight') || this.arrow('ArrowRight') ? 1 : 0) - (this.isDown('steerLeft') || this.arrow('ArrowLeft') ? 1 : 0) + push(x) - push(-x)),
      handbrake: this.isDown('handbrake'),
    };
  }

  get foot(): FootControls {
    // The stick walks as fast as it's pushed (past the dead zone), and runs pushed all the way.
    const { x, y } = this.stick;
    const length = Math.hypot(x, y);
    const k = length > STICK_DEAD ? Math.min(1, (length - STICK_DEAD) / (1 - STICK_DEAD)) / length : 0;
    return {
      forward: clamp((this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0) + y * k),
      strafe: clamp((this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0) + x * k),
      run: this.isDown('run') || length >= STICK_RUN,
      jump: this.isDown('jump'),
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

  /** An on-screen button held down or let go: just as if `code` were a key on the keyboard ('@jump' for an action). */
  hold(code: string, down: boolean): void {
    if (!down) this.held.delete(code);
    else if (this.enabled && !this.held.has(code)) {
      this.presses.add(code);
      this.held.add(code);
    }
  }

  /** An on-screen button tapped: a quick press of `code` ('@journal' for an action). */
  tap(code: string): void {
    if (this.enabled) this.presses.add(code);
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
    const yaw = -x + ((this.arrow('ArrowLeft') ? 1 : 0) - (this.arrow('ArrowRight') ? 1 : 0)) * KEY_LOOK_SPEED * dt;
    const pitch = y * (settings.invertY ? -1 : 1) + ((this.arrow('ArrowDown') ? 1 : 0) - (this.arrow('ArrowUp') ? 1 : 0)) * KEY_LOOK_SPEED * dt * 0.6;
    this.mouse.x = this.mouse.y = 0;
    this.dragged.x = this.dragged.y = 0;
    return { yaw, pitch };
  }

  /** True once per key press; call once per frame per key. */
  wasPressed(code: string): boolean {
    return this.presses.delete(code);
  }

  /** True once per press of `action`'s key (or its on-screen button). */
  pressed(action: Action): boolean {
    const code = keyOf(action);
    // Both, so neither press is left over for later.
    const button = this.presses.delete(`@${action}`);
    return (code !== '' && this.presses.delete(code)) || button;
  }

  /** Whether `action`'s key (or its on-screen button) is held down. */
  isDown(action: Action): boolean {
    const code = keyOf(action);
    return (code !== '' && this.held.has(code)) || this.held.has(`@${action}`);
  }

  /** Let go of everything, e.g. when focus moves to the chat box. */
  releaseAll(): void {
    this.held.clear();
    this.presses.clear();
    this.mouse.x = this.mouse.y = 0;
    this.dragged.x = this.dragged.y = 0;
    this.stick.x = this.stick.y = 0;
  }

  /** Forget presses nobody asked about this frame. */
  endFrame(): void {
    this.presses.clear();
  }

  /** An arrow key held: they look around on foot and drive in the car, unless they've been given something else to do. */
  private arrow(code: string): boolean {
    return this.held.has(code) && !isBound(code);
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/** How hard the stick is pushed one way (`v` along it), 0..1: none in the dead zone, all well before the edge. */
function push(v: number): number {
  return Math.max(0, Math.min(1, (v - STICK_DEAD) / (STICK_FULL - STICK_DEAD)));
}
