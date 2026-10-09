import * as THREE from 'three';
import { smoothstep } from '../../../../shared/noise.ts';
import { ZONE_SIZE, type ZoneId } from '../../../../shared/world.ts';

/** Particles falling or drifting around the camera. */
export type WeatherKind = 'snow' | 'rain' | 'ash' | 'dust' | 'spores' | 'bubbles';

/** How a place feels: its haze, sky and light. Zones blend into each other. */
export interface Ambience {
  /** Haze color by day and by night. */
  fogDay: THREE.Color;
  fogNight: THREE.Color;
  /** Haze starts at `fogNear` meters and hides everything past `fogFar`. */
  fogNear: number;
  fogFar: number;
  /** 0 = blue sky, 1 = the black sky of space (stars by day). */
  space: number;
  /** Overcast: 0 = clear, 1 = heavy smog or cloud (dimmer sun, grey sky). */
  overcast: number;
  /** Multiplies the sunlight. */
  sun: number;
  /** How strongly each kind of weather falls here (0..1). */
  weather: Partial<Record<WeatherKind, number>>;
}

const c = (hex: string) => new THREE.Color(hex);

export const AMBIENCE: Record<ZoneId, Ambience> = {
  town: { fogDay: c('#b9c7d6'), fogNight: c('#0b1222'), fogNear: 160, fogFar: 750, space: 0, overcast: 0, sun: 1, weather: {} },
  arctic: { fogDay: c('#dce6ee'), fogNight: c('#0c1828'), fogNear: 90, fogFar: 560, space: 0, overcast: 0.35, sun: 0.95, weather: { snow: 1 } },
  medieval: { fogDay: c('#c3d2dc'), fogNight: c('#0c1424'), fogNear: 140, fogFar: 720, space: 0, overcast: 0, sun: 1, weather: {} },
  space: { fogDay: c('#3a2c52'), fogNight: c('#0b0816'), fogNear: 140, fogFar: 760, space: 1, overcast: 0, sun: 1.1, weather: {} },
  jungle: { fogDay: c('#a3b79c'), fogNight: c('#08140e'), fogNear: 45, fogFar: 380, space: 0, overcast: 0.25, sun: 0.9, weather: { spores: 1 } },
  cyberpunk: { fogDay: c('#4e3f66'), fogNight: c('#160c26'), fogNear: 50, fogFar: 460, space: 0, overcast: 1, sun: 0.4, weather: { rain: 1 } },
  prehistoric: { fogDay: c('#c0a084'), fogNight: c('#1e0f0a'), fogNear: 90, fogFar: 560, space: 0, overcast: 0.45, sun: 0.85, weather: { ash: 1 } },
  ancient: { fogDay: c('#e4d2ac'), fogNight: c('#151018'), fogNear: 140, fogFar: 700, space: 0, overcast: 0.1, sun: 1.05, weather: { dust: 0.6 } },
  ocean: { fogDay: c('#bad5e6'), fogNight: c('#0a1426'), fogNear: 160, fogFar: 800, space: 0, overcast: 0, sun: 1, weather: {} },
};

/** Under the sea: murky blue-green that swallows everything past a few dozen meters. */
export const UNDERWATER: Ambience = {
  fogDay: c('#1b6a7e'),
  fogNight: c('#04161e'),
  fogNear: 2,
  fogFar: 75,
  space: 0,
  overcast: 0.6,
  sun: 0.55,
  weather: { bubbles: 1 },
};

/** Distance over which one zone's feel fades into the next. */
const BLEND = 70;

/** How much each zone's feel applies at (x, z): 1 deep inside, fading out across borders. */
export function zoneWeights(x: number, z: number): Map<ZoneId, number> {
  const weights = new Map<ZoneId, number>();
  const H = ZONE_SIZE / 2;
  // Per axis: weights of the three columns (rows), crossfading around ±H.
  const axis = (v: number): [number, number, number] => {
    const lo = smoothstep(v, -H - BLEND / 2, -H + BLEND / 2);
    const hi = smoothstep(v, H - BLEND / 2, H + BLEND / 2);
    return [1 - lo, lo - hi, hi];
  };
  const wx = axis(x);
  const wz = axis(z);
  const grid: ZoneId[][] = [
    ['arctic', 'medieval', 'space'],
    ['jungle', 'town', 'cyberpunk'],
    ['prehistoric', 'ancient', 'ocean'],
  ];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) if (wz[r] * wx[col] > 0.001) weights.set(grid[r][col], wz[r] * wx[col]);
  return weights;
}

/** The blended feel of a set of weighted ambiences (written into `out`). */
export function blendAmbience(parts: [Ambience, number][], out: Ambience): Ambience {
  out.fogDay.setRGB(0, 0, 0);
  out.fogNight.setRGB(0, 0, 0);
  out.fogNear = out.fogFar = out.space = out.overcast = out.sun = 0;
  out.weather = {};
  let total = 0;
  for (const [, w] of parts) total += w;
  for (const [a, raw] of parts) {
    const w = raw / total;
    out.fogDay.r += a.fogDay.r * w;
    out.fogDay.g += a.fogDay.g * w;
    out.fogDay.b += a.fogDay.b * w;
    out.fogNight.r += a.fogNight.r * w;
    out.fogNight.g += a.fogNight.g * w;
    out.fogNight.b += a.fogNight.b * w;
    out.fogNear += a.fogNear * w;
    out.fogFar += a.fogFar * w;
    out.space += a.space * w;
    out.overcast += a.overcast * w;
    out.sun += a.sun * w;
    for (const [k, v] of Object.entries(a.weather) as [WeatherKind, number][]) out.weather[k] = (out.weather[k] ?? 0) + v * w;
  }
  return out;
}

export function emptyAmbience(): Ambience {
  return { ...AMBIENCE.town, fogDay: new THREE.Color(), fogNight: new THREE.Color(), weather: {} };
}
