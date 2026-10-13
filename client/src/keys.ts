import { touchDevice } from './device.ts';
import { onSettings, settings } from './settings.ts';

/**
 * Where an action works: on foot, driving, or any time. Two actions can share a key only
 * if they never work at the same time (W walks on foot and accelerates in the car).
 */
type Group = 'foot' | 'car' | 'any';

interface ActionInfo {
  label: string;
  group: Group;
  /** The key (or mouse button) it starts on. See `normalizeCode` for how keys are named. */
  key: string;
  /** Only a key on the keyboard will do (its screen listens for key presses itself). */
  keyboard?: boolean;
}

/** Everything a key does in free roam and missions, in the order the Keys page lists them. */
export const ACTIONS = {
  forward: { label: 'Walk forward', group: 'foot', key: 'KeyW' },
  back: { label: 'Walk back', group: 'foot', key: 'KeyS' },
  left: { label: 'Walk left', group: 'foot', key: 'KeyA' },
  right: { label: 'Walk right', group: 'foot', key: 'KeyD' },
  run: { label: 'Run', group: 'foot', key: 'Shift' },
  jump: { label: 'Jump (and fly a jetpack)', group: 'foot', key: 'Space' },
  use: { label: 'Use (doors, seats, the car)', group: 'foot', key: 'KeyE' },
  punch: { label: 'Punch', group: 'foot', key: 'Mouse0' },
  kick: { label: 'Kick', group: 'foot', key: 'Mouse2' },
  dance: { label: 'Dance', group: 'foot', key: 'KeyG' },
  remote: { label: 'TV remote (sitting down)', group: 'foot', key: 'KeyR' },
  accelerate: { label: 'Accelerate', group: 'car', key: 'KeyW' },
  brake: { label: 'Brake and reverse', group: 'car', key: 'KeyS' },
  steerLeft: { label: 'Steer left', group: 'car', key: 'KeyA' },
  steerRight: { label: 'Steer right', group: 'car', key: 'KeyD' },
  handbrake: { label: 'Handbrake', group: 'car', key: 'Space' },
  getOut: { label: 'Get out', group: 'car', key: 'KeyE' },
  changeSeat: { label: 'Change seats (take the wheel, or let a friend drive)', group: 'car', key: 'KeyC' },
  flip: { label: 'Flip upright', group: 'car', key: 'KeyR' },
  newCar: { label: 'New car', group: 'car', key: 'KeyT' },
  journal: { label: 'Journal', group: 'any', key: 'KeyJ' },
  map: { label: 'Big map', group: 'any', key: 'Tab', keyboard: true },
  chat: { label: 'Chat', group: 'any', key: 'Enter', keyboard: true },
  mute: { label: 'Sound on and off', group: 'any', key: 'KeyM' },
  fullscreen: { label: 'Full screen', group: 'any', key: 'KeyF' },
  help: { label: 'Show and hide key help', group: 'any', key: 'KeyH' },
  skipTime: { label: 'Skip ahead 2 hours (free roam)', group: 'any', key: 'KeyN' },
} as const satisfies Record<string, ActionInfo>;

export type Action = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as Action[];
/** Each action's key; '' for none. */
export type KeyMap = Record<Action, string>;

export const GROUPS: { group: Group; title: string }[] = [
  { group: 'foot', title: 'On foot' },
  { group: 'car', title: 'Driving' },
  { group: 'any', title: 'Any time' },
];

export const DEFAULT_KEYS = Object.fromEntries(ACTION_IDS.map((a) => [a, ACTIONS[a].key])) as KeyMap;

/** Esc always opens the menu (and lets go of the mouse: the browser insists). */
export const RESERVED = new Set(['Escape']);

/** Whether two actions can both happen at once, so they can't share a key. */
function overlap(a: Action, b: Action): boolean {
  const [ga, gb] = [ACTIONS[a].group, ACTIONS[b].group];
  return ga === gb || ga === 'any' || gb === 'any';
}

/**
 * The name a key goes by here: the code the browser gives it (where it is on the
 * keyboard, so it works the same on any layout), except that the left and right Shift,
 * Ctrl, Alt and Cmd keys count as one. Mouse buttons are 'Mouse0' (left), 'Mouse1'
 * (middle), 'Mouse2' (right) and so on.
 */
export function normalizeCode(code: string): string {
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  return side ? side[1] : code;
}

/** The keys for each action: the defaults, with the player's own changes (as saved) on top. */
export function resolveKeys(saved: unknown): KeyMap {
  const keys = { ...DEFAULT_KEYS };
  if (!saved || typeof saved !== 'object') return keys;
  for (const [action, code] of Object.entries(saved)) {
    if (!(action in ACTIONS) || typeof code !== 'string' || code.length > 40 || refusal(action as Action, code)) continue;
    keys[action as Action] = code;
  }
  return keys;
}

/** Just the player's changes from the defaults, for saving. */
export function changedKeys(keys: KeyMap): Partial<KeyMap> {
  return Object.fromEntries(ACTION_IDS.filter((a) => keys[a] !== DEFAULT_KEYS[a]).map((a) => [a, keys[a]]));
}

/** Can `action` be on `code` at all? Null if so, otherwise why not. */
export function refusal(action: Action, code: string): string | null {
  if (RESERVED.has(code)) return 'Esc always opens the menu';
  if (code.startsWith('Mouse') && 'keyboard' in ACTIONS[action]) return `${ACTIONS[action].label} needs a key on the keyboard`;
  return null;
}

/**
 * Puts `action` on `code`. Anything else that was on that key and can happen at the same
 * time swaps onto the key `action` had (or is left without one, if that would clash too).
 * Returns the new keys and what had to move.
 */
export function rebind(current: KeyMap, action: Action, code: string): { keys: KeyMap; moved: { action: Action; to: string }[] } {
  const keys = { ...current };
  const old = keys[action];
  keys[action] = code;
  const moved: { action: Action; to: string }[] = [];
  if (!code || old === code) return { keys, moved };
  for (const other of ACTION_IDS) {
    if (other === action || keys[other] !== code || !overlap(other, action)) continue;
    const clash = !old || refusal(other, old) !== null || ACTION_IDS.some((a) => a !== other && keys[a] === old && overlap(a, other));
    keys[other] = clash ? '' : old;
    moved.push({ action: other, to: keys[other] });
  }
  return { keys, moved };
}

// What a key is called on screen.
const NAMES: Record<string, string> = {
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
  Space: 'Space',
  Shift: 'Shift',
  Control: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Cmd',
  CapsLock: 'Caps Lock',
  Backspace: 'Backspace',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadEnter: 'Num Enter',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ContextMenu: 'Menu',
};

/** What this keyboard's keys have printed on them (a French keyboard's KeyQ is A), once known. */
let printed = new Map<string, string>();
type LayoutKeyboard = { getLayoutMap?: () => Promise<Map<string, string>> };
const keyboard = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { keyboard?: LayoutKeyboard }).keyboard;
void keyboard
  ?.getLayoutMap?.()
  .then((layout) => {
    printed = new Map([...layout].map(([code, key]) => [code, key.toUpperCase()]));
    for (const l of listeners) l();
  })
  .catch(() => {});

/** A key's name on screen: 'W', 'Space', 'Left click', '↑'. Empty for none. */
export function keyLabel(code: string): string {
  if (!code) return '';
  const own = printed.get(code);
  if (own && own.trim()) return own;
  if (NAMES[code]) return NAMES[code];
  const letter = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code);
  if (letter) return letter[1];
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Num ${numpad[1].replace('Add', '+').replace('Subtract', '-').replace('Multiply', '*').replace('Divide', '/').replace('Decimal', '.')}`;
  // 'PrintScreen' -> 'Print Screen'.
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Whether this game's keys are the player's own (free roam and missions) or the usual ones (racing). */
let custom = false;
let keys: KeyMap = { ...DEFAULT_KEYS };
/** Every key some action is on. */
let bound = new Set<string>();
const listeners = new Set<() => void>();

function refresh(): void {
  keys = custom ? resolveKeys(settings.keys) : { ...DEFAULT_KEYS };
  bound = new Set(Object.values(keys).filter(Boolean));
  for (const l of listeners) l();
}
onSettings(refresh);

/** Free roam and missions use the player's own keys; racing keeps the usual ones. */
export function useCustomKeys(on: boolean): void {
  custom = on;
  refresh();
}

/** The key `action` is on right now ('' if none). */
export function keyOf(action: Action): string {
  return keys[action];
}

/** All the keys right now. */
export function currentKeys(): Readonly<KeyMap> {
  return keys;
}

/** Whether some action is on `code`. */
export function isBound(code: string): boolean {
  return bound.has(code);
}

/** What `action`'s key is called: 'E', 'Left click'... ('' if it has none). */
export function labelOf(action: Action): string {
  return keyLabel(keys[action]);
}

/** Calls `listener` now and whenever the keys (or how they're named) change. */
export function onKeys(listener: () => void): void {
  listeners.add(listener);
  listener();
}

/**
 * Walking keys as one word when they're all letters ('WASD'), otherwise named one by one
 * ('A D', '↑ ← ↓ →').
 */
export function keysWord(...actions: Action[]): string {
  const labels = actions.map(labelOf).filter(Boolean);
  return labels.length > 2 && labels.every((l) => /^[A-Z0-9]$/.test(l)) ? labels.join('') : labels.join(' ');
}

/** Which action each key named in the game's words starts on (as in "Press J", "hold Space"). */
const WORDS: Record<string, Action> = { J: 'journal', G: 'dance', T: 'newCar', E: 'use', Enter: 'chat' };
const BUTTON_FOR: Partial<Record<Action, string>> = { journal: 'Journal', dance: 'Dance', newCar: 'New car', use: 'Use' };

/**
 * Words that name keys ("Press J", "hold Space") as the keys really are: the player's own,
 * or on a phone or tablet the buttons to tap.
 */
export function keyWords(text: string): string {
  if (touchDevice) {
    return text
      .replace(/Press Enter to chat/g, 'Tap Chat to talk')
      .replace(/Press ([JGTE])\b/g, (whole, key: string) => (BUTTON_FOR[WORDS[key]] ? `Tap ${BUTTON_FOR[WORDS[key]]}` : whole))
      .replace(/([Hh])old Space/g, '$1old Jump');
  }
  if (!custom) return text;
  return text
    .replace(/Press (Enter|[JGTE])\b/g, (whole, key: string) => (labelOf(WORDS[key]) ? `Press ${labelOf(WORDS[key])}` : whole))
    .replace(/([Hh])old Space/g, (whole, h: string) => (labelOf('jump') ? `${h}old ${labelOf('jump')}` : whole));
}
