import type { Input } from '../input.ts';

/** The stick's reach from its middle (px). Where it waits for a thumb is in the stylesheet. */
const STICK_RADIUS = 56;
/** Where a finger can pick up the stick: this much of the screen from the left and the bottom. */
const STICK_ZONE = { width: 0.42, height: 0.72 };

/**
 * One of the round buttons by the right thumb. `key` is what it presses: an action
 * ('@jump', see Input) or, racing, a key; held, or tapped.
 */
interface Button {
  label: string;
  key: string;
  hold?: boolean;
  /** When it shows: driving, on foot, or on foot with something in reach to use. */
  when: 'car' | 'foot' | 'use';
  /** Its place around the big button: 0 the big one, 1 left, 2 up-left, 3 up; 4 above that. */
  slot: 0 | 1 | 2 | 3 | 4;
}

const BUTTONS: Button[] = [
  { label: 'Jump', key: '@jump', hold: true, when: 'foot', slot: 0 },
  { label: 'Use', key: '@use', when: 'use', slot: 1 },
  { label: 'Punch', key: '@punch', when: 'foot', slot: 2 },
  { label: 'Kick', key: '@kick', when: 'foot', slot: 3 },
  { label: 'Dance', key: '@dance', when: 'foot', slot: 4 },
  { label: 'Brake', key: '@handbrake', hold: true, when: 'car', slot: 0 },
  { label: 'Get out', key: '@getOut', when: 'car', slot: 1 },
  { label: 'New car', key: '@newCar', when: 'car', slot: 2 },
  { label: 'Flip', key: '@flip', when: 'car', slot: 3 },
];

/** Racing: brake, the rear wing, the camera, and back onto the track after an off. */
const RACE_BUTTONS: Button[] = [
  { label: 'Brake', key: 'Space', hold: true, when: 'car', slot: 0 },
  { label: 'DRS', key: 'KeyQ', when: 'car', slot: 1 },
  { label: 'Camera', key: 'KeyC', when: 'car', slot: 2 },
  { label: 'Back on track', key: 'KeyT', when: 'car', slot: 3 },
];

/** What the controls need to know each frame. */
export interface TouchState {
  driving: boolean;
  /** Something in reach to use (a door, a seat, the car...). */
  canUse: boolean;
  muted: boolean;
}

/**
 * Controls for phones and tablets, doing what the keyboard and mouse do on a computer:
 * a stick under the left thumb (walk, or drive: up is the gas, down the brake), dragging
 * anywhere else to look around, round buttons under the right thumb (jump, use, dance;
 * brake, get out, new car, flip), and a row of tools (chat, journal, sound, full screen).
 * Things to do in reach can be tapped where they're named, too.
 */
export class TouchControls {
  private pad = document.createElement('div');
  private stick = document.createElement('div');
  private knob = document.createElement('div');
  private buttons: { spec: Button; el: HTMLButtonElement }[] = [];
  private soundButton: HTMLButtonElement;
  /** The fingers on the stick and looking around, and where they were. */
  private stickFinger: { id: number; x: number; y: number } | null = null;
  private lookFinger: { id: number; x: number; y: number } | null = null;
  private shown = '';

  constructor(
    private input: Input,
    tools: { chat: () => void; racing?: boolean },
  ) {
    // The stick and looking around, on a layer under the HUD: fingers reach it wherever there's no panel.
    this.pad.className = 'touch-pad';
    this.stick.className = 'touch-stick';
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);
    this.pad.append(this.stick);
    document.getElementById('app')!.after(this.pad);
    this.pad.addEventListener('pointerdown', (e) => this.fingerDown(e));
    this.pad.addEventListener('pointermove', (e) => this.fingerMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.pad.addEventListener(type, (e) => this.fingerUp(e.pointerId));
    this.pad.addEventListener('contextmenu', (e) => e.preventDefault());
    this.placeStick(null);

    const cluster = document.createElement('div');
    cluster.className = 'touch-buttons';
    for (const spec of tools.racing ? RACE_BUTTONS : BUTTONS) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `touch-button ${spec.when} slot-${spec.slot}`;
      el.textContent = spec.label;
      el.hidden = true;
      this.press(el, spec.key, spec.hold);
      cluster.append(el);
      this.buttons.push({ spec, el });
    }
    document.getElementById('hud')!.append(cluster);

    // Whatever's in reach can be tapped where its prompt names it.
    document.getElementById('hud-prompt')!.addEventListener('pointerdown', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('.act[data-key]');
      if (act) input.tap(act.dataset.key!);
    });

    // Tools beside the menu button: chat, journal, sound, full screen; skipping time by the clock.
    const tool = (label: string, title: string, use: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'secondary touch-tool';
      el.textContent = label;
      el.title = title;
      el.addEventListener('click', use);
      return el;
    };
    this.soundButton = tool('Sound on', 'Sound on or off', () => input.tap('@mute'));
    const row = document.createElement('div');
    row.className = 'hud-buttons touch-tools';
    row.append(tool('Chat', 'Chat', tools.chat));
    if (!tools.racing) row.append(tool('Journal', 'Journal', () => input.tap('@journal')));
    row.append(this.soundButton);
    if (document.fullscreenEnabled) row.append(tool('Full screen', 'Full screen', () => input.tap('@fullscreen')));
    document.querySelector('.hud-room .hud-buttons')!.after(row);
    if (!tools.racing) document.getElementById('hud-clock-hint')!.replaceChildren(tool('+2 h', 'Skip ahead two hours', () => input.tap('@skipTime')));

    // Words that name keys say what to tap instead.
    const fuel = document.querySelector('.fuel-row span:last-child');
    if (fuel) fuel.textContent = 'Jetpack fuel · hold Jump to fly';
    relabel('set-mouseSensitivity', 'Look sensitivity');
    relabel('set-invertY', 'Invert look up/down');

    // Fingers lifted while the game was hidden may never say so.
    document.addEventListener('visibilitychange', () => this.letGo());
    // Safari zooms the page on a pinch, whatever the page says.
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  /** Shows the buttons for what the player is doing; call each frame. */
  update(state: TouchState): void {
    const key = `${state.driving}|${state.canUse}|${state.muted}`;
    if (key !== this.shown) {
      this.shown = key;
      for (const { spec, el } of this.buttons) {
        const show = spec.when === 'car' ? state.driving : !state.driving && (spec.when === 'foot' || state.canUse);
        if (el.hidden === show) el.hidden = !show;
        // A button that vanishes under a finger lets go.
        if (!show && spec.hold) this.input.hold(spec.key, false);
      }
      this.soundButton.textContent = state.muted ? 'Sound off' : 'Sound on';
    }
    this.stick.classList.toggle('running', !state.driving && this.input.stickRunning);
  }

  /** A button pressing `key`: held down while touched, or pressed once. */
  private press(el: HTMLButtonElement, key: string, hold = false): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('down');
      if (hold) this.input.hold(key, true);
      else this.input.tap(key);
    });
    const up = () => {
      el.classList.remove('down');
      if (hold) this.input.hold(key, false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(type, up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private fingerDown(e: PointerEvent): void {
    this.pad.setPointerCapture(e.pointerId);
    const finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const inZone = e.clientX < innerWidth * STICK_ZONE.width && e.clientY > innerHeight * (1 - STICK_ZONE.height);
    if (!this.stickFinger && inZone) {
      // The stick comes to the thumb, all of it on the screen.
      finger.x = Math.max(finger.x, STICK_RADIUS + 8);
      finger.y = Math.min(finger.y, innerHeight - STICK_RADIUS - 8);
      this.stickFinger = finger;
      this.placeStick(finger);
      this.fingerMove(e);
    } else if (!this.lookFinger) this.lookFinger = finger;
  }

  private fingerMove(e: PointerEvent): void {
    const stick = this.stickFinger;
    if (stick?.id === e.pointerId) {
      const dx = e.clientX - stick.x;
      const dy = e.clientY - stick.y;
      const k = Math.min(1, STICK_RADIUS / Math.max(1, Math.hypot(dx, dy)));
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.input.setStick((dx * k) / STICK_RADIUS, (-dy * k) / STICK_RADIUS);
    }
    const look = this.lookFinger;
    if (look?.id === e.pointerId) {
      this.input.drag(e.clientX - look.x, e.clientY - look.y);
      look.x = e.clientX;
      look.y = e.clientY;
    }
  }

  private fingerUp(id: number): void {
    if (this.stickFinger?.id === id) {
      this.stickFinger = null;
      this.input.setStick(0, 0);
      this.placeStick(null);
    }
    if (this.lookFinger?.id === id) this.lookFinger = null;
  }

  private letGo(): void {
    if (this.stickFinger) this.fingerUp(this.stickFinger.id);
    this.lookFinger = null;
  }

  /** Puts the stick under a thumb, or back where it waits (faintly) when there's none. */
  private placeStick(at: { x: number; y: number } | null): void {
    this.stick.style.left = at ? `${at.x}px` : '';
    this.stick.style.top = at ? `${at.y}px` : '';
    if (!at) this.knob.style.transform = '';
    this.stick.classList.toggle('active', !!at);
  }
}

/** Renames a setting (the text before its control). */
function relabel(id: string, text: string): void {
  const label = document.getElementById(id)?.closest('label');
  const words = label && [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
  if (words) words.textContent = `${text} `;
}
