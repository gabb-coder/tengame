// Builds the racing mode's circuits from real ones: each track's shape (bacinger/f1-circuits,
// MIT licence) traced into a smooth centre line every few meters, with the real rise and fall
// of the ground under it and the lie of the land around it (NASA's SRTM survey, public
// domain, through the OpenTopoData service). Writes client/public/media/circuits/<id>.json.
//
//   npm run circuits
//
// Downloads are cached in .asset-cache/circuits/, so re-running is quick.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIRCUITS } from '../shared/circuits.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'client/public/media/circuits');
const CACHE = join(ROOT, '.asset-cache/circuits');
const SHAPES = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson';
const SURVEY = 'https://api.opentopodata.org/v1/srtm30m';

/** Meters between centre-line points. */
const SPACING = 4;
/** Meters between surveyed heights along the track, and on the grid around it. */
const ALONG = 20;
const GRID = 75;
/** Land surveyed around the track (m). */
const MARGIN = 900;
/** Heights along the track are smoothed over this distance (m): the survey is rough. */
const SMOOTH = 70;
const SMOOTH_STREET = 90;
/**
 * Crests and dips no sharper than this radius (m): a real track's are gentle, and a
 * survey's leftover ripples would throw a car into the air at 300 km/h.
 */
const CREST_RADIUS = 1100;
/** Room under a bridge (m), and how far each ramp up to it runs. */
const CLEARANCE = 7.5;
const BRIDGE_FLAT = 40;
const BRIDGE_RAMP = 260;
const EARTH = 6371000;

mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const shapes = JSON.parse(await cached('f1-circuits.geojson', async () => text(SHAPES)));
for (const info of CIRCUITS) {
  const feature = shapes.features.find((f) => f.properties.id === info.source);
  if (!feature) throw new Error(`no shape for ${info.id}`);
  const data = await build(info, feature);
  writeFileSync(join(OUT, `${info.id}.json`), JSON.stringify(data));
  const ys = [];
  for (let i = 1; i < data.points.length; i += 3) ys.push(data.points[i] / 100);
  console.log(
    `${info.id}: ${Math.round(data.length)} m (official ${feature.properties.length} m), ${data.points.length / 3} points,` +
      ` heights ${Math.min(...ys).toFixed(1)}..${Math.max(...ys).toFixed(1)} m, steepest ${(steepest(ys) * 100).toFixed(1)}%,` +
      ` land ${data.terrain.cols}x${data.terrain.rows}${data.sea !== null ? `, sea at ${data.sea.toFixed(1)} m` : ''}${data.bridges.length ? `, ${data.bridges.length} bridge` : ''}`,
  );
}

async function build(info, feature) {
  const coords = feature.geometry.coordinates.slice();
  const [a, b] = [coords[0], coords.at(-1)];
  if (a[0] === b[0] && a[1] === b[1]) coords.pop();
  // Flat projection around the middle of the track: x east, z south, in meters.
  const lon0 = (Math.min(...coords.map((c) => c[0])) + Math.max(...coords.map((c) => c[0]))) / 2;
  const lat0 = (Math.min(...coords.map((c) => c[1])) + Math.max(...coords.map((c) => c[1]))) / 2;
  const kx = (Math.cos((lat0 * Math.PI) / 180) * EARTH * Math.PI) / 180;
  const kz = (EARTH * Math.PI) / 180;
  const toLocal = ([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * kz];
  const toLatLon = (x, z) => [lat0 - z / kz, lon0 + x / kx];

  const line = resample(spline(coords.map(toLocal)), SPACING);
  const n = line.length;
  const length = n * SPACING;

  // Heights along the track: surveyed every ALONG m, then smoothed.
  const every = Math.round(ALONG / SPACING);
  const alongPoints = line.filter((_, i) => i % every === 0);
  const along = await survey(`${info.id}-along`, alongPoints.map(([x, z]) => toLatLon(x, z)));
  let ys = line.map((_, i) => {
    const k = i / every;
    const k0 = Math.floor(k) % along.length;
    const k1 = (k0 + 1) % along.length;
    const t = k - Math.floor(k);
    return (along[k0] ?? 0) * (1 - t) + (along[k1] ?? 0) * t;
  });
  ys = easeCrests(smoothLoop(ys, (info.style === 'street' ? SMOOTH_STREET : SMOOTH) / SPACING));
  if (info.flat) ys = ys.map(() => 0);
  const base = Math.min(...ys);
  ys = ys.map((y) => y - base);

  // Where the track crosses itself, lift one pass over the other.
  const bridges = [];
  for (const [i, j] of crossings(line)) {
    const [over, under] = (info.bridge === 'earlier') === i < j ? [i, j] : [j, i];
    const lift = Math.max(0, ys[under] + CLEARANCE - ys[over]);
    for (let k = 0; k < n; k++) {
      const d = Math.abs(loopDistance(k, over, n)) * SPACING;
      const ramp = d < BRIDGE_FLAT ? 1 : d < BRIDGE_FLAT + BRIDGE_RAMP ? 0.5 * (1 + Math.cos((Math.PI * (d - BRIDGE_FLAT)) / BRIDGE_RAMP)) : 0;
      ys[k] += lift * ramp;
    }
    bridges.push({ over: over * SPACING, under: under * SPACING });
  }

  // The land around: a grid of surveyed heights.
  const xs = line.map((p) => p[0]);
  const zs = line.map((p) => p[1]);
  const x0 = Math.floor((Math.min(...xs) - MARGIN) / GRID) * GRID;
  const z0 = Math.floor((Math.min(...zs) - MARGIN) / GRID) * GRID;
  const cols = Math.ceil((Math.max(...xs) + MARGIN - x0) / GRID) + 1;
  const rows = Math.ceil((Math.max(...zs) + MARGIN - z0) / GRID) + 1;
  const spots = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) spots.push(toLatLon(x0 + c * GRID, z0 + r * GRID));
  const ground = await survey(`${info.id}-grid`, spots);
  // By the sea the survey reads 0 (or nothing) over the water; inland, that's a gap in the
  // survey, filled from the land around it.
  const sea = info.coast ? -base - (info.flat ? 2.5 : 0) : null;
  const dry = (h) => h !== null && h > 0;
  const heights = ground.map((h, k) => {
    if (!dry(h)) {
      if (sea !== null) return Math.round((sea - 4) * 10);
      const c = Math.floor(k / rows);
      const r = k % rows;
      const around = [];
      for (let dc = -3; dc <= 3; dc++) for (let dr = -3; dr <= 3; dr++) {
        const v = ground[(c + dc) * rows + (r + dr)];
        if (c + dc >= 0 && c + dc < cols && r + dr >= 0 && r + dr < rows && dry(v)) around.push(v);
      }
      h = around.length ? around.reduce((a, b) => a + b, 0) / around.length : base;
    }
    return Math.round(((info.flat ? base : h) - base) * 10);
  });

  return {
    id: info.id,
    length,
    points: line.flatMap(([x, z], i) => [Math.round(x * 100), Math.round(ys[i] * 100), Math.round(z * 100)]),
    terrain: { x0, z0, step: GRID, cols, rows, heights },
    sea,
    bridges,
  };
}

/** A closed centripetal Catmull-Rom spline through `points`, densely sampled. */
function spline(points) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) || 1e-4;
    const t2 = t1 + (Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) || 1e-4);
    const t3 = t2 + (Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) || 1e-4);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5));
    for (let s = 0; s < steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      const lerp = (a, b, ta, tb) => [0, 1].map((k) => ((tb - t) / (tb - ta)) * a[k] + ((t - ta) / (tb - ta)) * b[k]);
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

/** Points evenly `spacing` apart (near enough) around the closed line. */
function resample(line, spacing) {
  const n = line.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(line[i % n][0] - line[i - 1][0], line[i % n][1] - line[i - 1][1]));
  const total = cum[n];
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const s = k * step;
    while (cum[j + 1] < s) j++;
    const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = line[j];
    const b = line[(j + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  // Even out the spacing exactly: the line's length is count * spacing from here on.
  const scale = spacing / step;
  return out.map(([x, z]) => [x * scale, z * scale]);
}

/** Gaussian blur of values around a loop; `sigma` in points. */
function smoothLoop(values, sigma) {
  const n = values.length;
  const reach = Math.ceil(sigma * 3);
  const weights = Array.from({ length: 2 * reach + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma)));
  const total = weights.reduce((a, b) => a + b, 0);
  return values.map((_, i) => {
    let sum = 0;
    for (let k = -reach; k <= reach; k++) sum += values[(i + k + n) % n] * weights[k + reach];
    return sum / total;
  });
}

/** Rounds off any crest or dip sharper than CREST_RADIUS, keeping the climbs and drops. */
function easeCrests(values) {
  const n = values.length;
  const k = 5;
  const limit = 1 / CREST_RADIUS;
  const ys = values.slice();
  for (let pass = 0; pass < 400; pass++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const a = ys[(i - k + n) % n];
      const c = ys[(i + k) % n];
      const bend = (a - 2 * ys[i] + c) / (k * SPACING) ** 2;
      worst = Math.max(worst, Math.abs(bend));
      if (Math.abs(bend) > limit) ys[i] += ((a + c) / 2 - ys[i]) * 0.5 * (1 - limit / Math.abs(bend));
    }
    if (worst <= limit * 1.05) break;
  }
  return smoothLoop(ys, 2);
}

/** Pairs of point indices where the closed line crosses itself. */
function crossings(line) {
  const n = line.length;
  const found = [];
  for (let i = 0; i < n; i++) {
    const a = line[i];
    const b = line[(i + 1) % n];
    for (let j = i + 20; j < n; j++) {
      if (Math.abs(loopDistance(i, j, n)) < 20) continue;
      const c = line[j];
      const d = line[(j + 1) % n];
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      const u = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
      if (t >= 0 && t < 1 && u >= 0 && u < 1 && !found.some(([p, q]) => Math.abs(p - i) < 30 && Math.abs(q - j) < 30)) found.push([i, j]);
    }
  }
  return found;
}

/** Signed distance (in points) from `b` to `a` the short way round a loop of `n`. */
function loopDistance(a, b, n) {
  let d = (a - b) % n;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

function steepest(ys) {
  let max = 0;
  for (let i = 0; i < ys.length; i++) {
    const j = (i + 5) % ys.length;
    max = Math.max(max, Math.abs(ys[j] - ys[i]) / (5 * SPACING));
  }
  return max;
}

/** Ground heights (m) at [lat, lon] spots from the survey, 100 at a time; null where it has none. */
async function survey(name, spots) {
  const key = `${name}-${spots.length}-${spots[0].map((v) => v.toFixed(5)).join(',')}.json`;
  return JSON.parse(
    await cached(key, async () => {
      const heights = [];
      for (let i = 0; i < spots.length; i += 100) {
        const batch = spots.slice(i, i + 100);
        const url = `${SURVEY}?locations=${batch.map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|')}`;
        let body;
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(url);
          if (res.ok) {
            body = await res.json();
            break;
          }
          if (attempt >= 4) throw new Error(`${res.status} from the survey`);
          await sleep(3000 * (attempt + 1));
        }
        heights.push(...body.results.map((r) => r.elevation));
        // The free service asks for at most one request a second.
        await sleep(1100);
        process.stdout.write(`\r  ${name}: ${Math.min(i + 100, spots.length)}/${spots.length}   `);
      }
      process.stdout.write('\n');
      return JSON.stringify(heights);
    }),
  );
}

async function cached(name, make) {
  const file = join(CACHE, name);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const data = await make();
  writeFileSync(file, data);
  return data;
}

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
