/** Player preferences, kept in this browser between visits. */
export interface Settings {
  /** Master volume, 0..1. */
  volume: number;
  /** Background sounds of each place (wind, birds, rain...), 0..1 of the master volume. */
  ambience: number;
  /** Multiplier on mouse look speed. */
  mouseSensitivity: number;
  invertY: boolean;
  /** Camera field of view in degrees (the car camera widens a little more with speed). */
  fov: number;
  quality: 'low' | 'medium' | 'high';
  units: 'kmh' | 'mph';
  showMinimap: boolean;
  showHelp: boolean;
  showNames: boolean;
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  ambience: 0.7,
  mouseSensitivity: 1,
  invertY: false,
  fov: 62,
  quality: 'medium',
  units: 'kmh',
  showMinimap: true,
  showHelp: true,
  showNames: true,
  showFps: false,
};

const KEY = 'tengame.settings';

function load(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    Object.assign(s, JSON.parse(localStorage.getItem(KEY) ?? '{}'));
    // Settings saved separately by earlier versions.
    const quality = localStorage.getItem('tengame.quality');
    if (quality && !localStorage.getItem(KEY)) s.quality = quality as Settings['quality'];
    if (localStorage.getItem('tengame.hideHelp') === '1' && !localStorage.getItem(KEY)) s.showHelp = false;
  } catch {
    // Storage unavailable (private mode): defaults it is.
  }
  return s;
}

/** The current settings; read freely, change through `updateSettings`. */
export const settings: Readonly<Settings> = load();
const listeners = new Set<(s: Settings) => void>();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered, but still applied.
  }
  for (const l of listeners) l(settings);
}

/** Calls `listener` now and on every change. */
export function onSettings(listener: (s: Settings) => void): void {
  listeners.add(listener);
  listener(settings);
}
