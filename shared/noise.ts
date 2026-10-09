// Deterministic 2D value noise, so every client (and the server) shapes the same hills.

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in 0..1 with features about one unit apart. */
export function valueNoise(x: number, z: number, seed = 0): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // Quintic fade for continuous slopes (no creases at cell edges).
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise in roughly -1..1: `octaves` layers, each twice as fine and half as strong. */
export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x, z, seed + i * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

/** Sharp-crested noise in 0..1, for mountain ridges. */
export function ridged(x: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x, z, seed + i * 31) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

export function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
