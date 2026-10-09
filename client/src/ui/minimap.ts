import { ASPHALT_WIDTH, TOWN_HALF_EXTENT, type TownLayout } from '../../../shared/town.ts';
import { generateWorld, SEA_LEVEL, type Shape, TERRAIN_HALF, TERRAIN_STEP, WORLD_HALF, worldLocationName, zoneAt, type ZoneId } from '../../../shared/world.ts';

/** Resolution of the pre-drawn town map. */
const PX_PER_M = 2;
const EXTENT = TOWN_HALF_EXTENT;
/** The world map around it: coarser, and covering everything out to the edge. */
const WORLD_PX_PER_M = 1;
const WORLD_EXTENT = WORLD_HALF + 60;
/** Meters from the center to the rim: closer when slow, further out at speed. */
const MIN_RANGE = 70;
const MAX_RANGE = 190;
const TARGET_COLOR = '#ffd24a';

export interface MapPlayer {
  x: number;
  z: number;
  /** Facing, as a yaw where 0 is +Z. */
  yaw: number;
  color: string;
}

/**
 * Round, heading-up map in the corner: roads, houses, players and the next mission
 * target, plus the name of the street or house you're at.
 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private world: HTMLCanvasElement;
  private range = MIN_RANGE;
  private lastLabel = '';

  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement,
    layout: TownLayout,
    /** Ground heights on the terrain grid (see Terrain), for shading hills. */
    heights: Float32Array,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.base = drawTown(layout);
    this.world = drawWorld(heights);
    const size = canvas.clientWidth || 180;
    canvas.width = canvas.height = Math.round(size * Math.min(devicePixelRatio, 2));
  }

  /**
   * `heading` is the camera's yaw (the map turns so that's up); `speed` in m/s zooms out.
   */
  update(self: MapPlayer, heading: number, speed: number, others: MapPlayer[], target: { x: number; z: number } | null, dt: number): void {
    const wanted = MIN_RANGE + Math.min(1, Math.abs(speed) / 30) * (MAX_RANGE - MIN_RANGE);
    this.range += (wanted - this.range) * Math.min(1, dt * 1.5);

    const { ctx, canvas } = this;
    const r = canvas.width / 2;
    const scale = r / this.range; // canvas pixels per meter
    // Rotating by this turns the heading direction (sin h, cos h) to straight up.
    const turn = heading - Math.PI;
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    /** World point to map pixels, relative to the center. */
    const project = (x: number, z: number) => {
      const [dx, dz] = [(x - self.x) * scale, (z - self.z) * scale];
      return { x: cos * dx - sin * dz, y: sin * dx + cos * dz };
    };

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#26321f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(r, r);
    ctx.imageSmoothingEnabled = true;
    ctx.save();
    ctx.rotate(turn);
    ctx.scale(scale / WORLD_PX_PER_M, scale / WORLD_PX_PER_M);
    ctx.translate(-(self.x + WORLD_EXTENT) * WORLD_PX_PER_M, -(self.z + WORLD_EXTENT) * WORLD_PX_PER_M);
    ctx.drawImage(this.world, 0, 0);
    ctx.restore();
    ctx.save();
    ctx.rotate(turn);
    ctx.scale(scale / PX_PER_M, scale / PX_PER_M);
    ctx.translate(-(self.x + EXTENT) * PX_PER_M, -(self.z + EXTENT) * PX_PER_M);
    ctx.drawImage(this.base, 0, 0);
    ctx.restore();

    const edge = r - 10 * (r / 90);
    const unit = r / 90; // marker size scales with the canvas
    const clampToEdge = (p: { x: number; y: number }) => {
      const d = Math.hypot(p.x, p.y);
      return d > edge ? { x: (p.x / d) * edge, y: (p.y / d) * edge, clamped: true } : { ...p, clamped: false };
    };

    if (target) {
      const p = clampToEdge(project(target.x, target.z));
      ctx.fillStyle = TARGET_COLOR;
      ctx.strokeStyle = '#3a2a00';
      ctx.lineWidth = unit;
      ctx.beginPath();
      const s = (p.clamped ? 5 : 7) * unit;
      ctx.moveTo(p.x, p.y - s);
      ctx.lineTo(p.x + s, p.y);
      ctx.lineTo(p.x, p.y + s);
      ctx.lineTo(p.x - s, p.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    for (const o of others) {
      const p = clampToEdge(project(o.x, o.z));
      arrow(ctx, p.x, p.y, turn - o.yaw, (p.clamped ? 4 : 6) * unit, o.color);
    }
    arrow(ctx, 0, 0, turn - self.yaw, 7.5 * unit, self.color);

    // "N" on the rim, where north (-Z) is.
    ctx.font = `700 ${11 * unit}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = { x: sin * edge, y: -cos * edge };
    ctx.fillStyle = 'rgba(10, 12, 16, 0.75)';
    ctx.beginPath();
    ctx.arc(n.x, n.y, 8 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('N', n.x, n.y + 0.5 * unit);
    ctx.restore();

    const text = worldLocationName(self.x, self.z);
    if (text !== this.lastLabel) {
      this.lastLabel = text;
      this.label.textContent = text;
      this.label.hidden = !text;
    }
  }
}

/** A player marker: an arrow at (x, y), pointing along +Y rotated by `angle`. */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Drawn pointing +Y (which is +Z before the rotation).
  ctx.beginPath();
  ctx.moveTo(0, size);
  ctx.lineTo(size * 0.75, -size * 0.75);
  ctx.lineTo(0, -size * 0.3);
  ctx.lineTo(-size * 0.75, -size * 0.75);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.22;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** The whole town, drawn once: sidewalks, asphalt, lawns, the park and house roofs. */
function drawTown(layout: TownLayout): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(EXTENT * 2 * PX_PER_M);
  const ctx = canvas.getContext('2d')!;
  const px = (v: number) => (v + EXTENT) * PX_PER_M;
  const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => ctx.fillRect(px(minX), px(minZ), (maxX - minX) * PX_PER_M, (maxZ - minZ) * PX_PER_M);

  const e = TOWN_HALF_EXTENT;
  ctx.fillStyle = '#8d9091';
  rect(-e, -e, e, e);

  ctx.fillStyle = '#4a4f56';
  for (const road of layout.roads) {
    const [a, b] = [road.center - ASPHALT_WIDTH / 2, road.center + ASPHALT_WIDTH / 2];
    if (road.axis === 'x') rect(-e, a, e, b);
    else rect(a, -e, b, e);
  }
  ctx.strokeStyle = '#b8963c';
  ctx.lineWidth = 0.4 * PX_PER_M;
  ctx.setLineDash([3 * PX_PER_M, 3 * PX_PER_M]);
  ctx.beginPath();
  for (const road of layout.roads) {
    const c = px(road.center);
    if (road.axis === 'x') {
      ctx.moveTo(px(-e), c);
      ctx.lineTo(px(e), c);
    } else {
      ctx.moveTo(c, px(-e));
      ctx.lineTo(c, px(e));
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  for (const b of layout.blocks) {
    ctx.fillStyle = b === layout.park ? '#4f7a3f' : '#3e5735';
    rect(b.minX, b.minZ, b.maxX, b.maxZ);
  }
  ctx.fillStyle = '#5d8a49';
  for (const t of layout.trees) {
    ctx.beginPath();
    ctx.arc(px(t.x), px(t.z), 1.6 * PX_PER_M, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#6c665c';
  ctx.lineWidth = 0.6 * PX_PER_M;
  for (const h of layout.houses) {
    // Houses only ever face north or south, so their footprints are axis-aligned.
    ctx.fillStyle = '#d8d0c0';
    rect(h.x - h.width / 2, h.z - h.depth / 2, h.x + h.width / 2, h.z + h.depth / 2);
    ctx.strokeRect(px(h.x - h.width / 2), px(h.z - h.depth / 2), h.width * PX_PER_M, h.depth * PX_PER_M);
  }
  return canvas;
}

/** Map colors for each zone's ground. */
const ZONE_COLORS: Record<ZoneId, [number, number, number]> = {
  town: [62, 87, 53],
  arctic: [222, 232, 240],
  medieval: [79, 118, 63],
  space: [84, 64, 98],
  jungle: [44, 86, 36],
  cyberpunk: [58, 58, 68],
  prehistoric: [104, 88, 70],
  ancient: [216, 192, 140],
  ocean: [214, 200, 160],
};

/**
 * Everything outside the town, drawn once: each zone's ground shaded by its hills, the
 * water, the roads, and the houses.
 */
function drawWorld(heights: Float32Array): HTMLCanvasElement {
  const world = generateWorld();
  const size = Math.ceil(WORLD_EXTENT * 2 * WORLD_PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const px = (v: number) => (v + WORLD_EXTENT) * WORLD_PX_PER_M;

  // Ground: one pixel per terrain cell, lit from the north-west, then scaled up smoothly.
  const n = Math.round((2 * TERRAIN_HALF) / TERRAIN_STEP) + 1;
  const cells = Math.ceil((WORLD_EXTENT * 2) / TERRAIN_STEP);
  const small = document.createElement('canvas');
  small.width = small.height = cells;
  const sctx = small.getContext('2d')!;
  const img = sctx.createImageData(cells, cells);
  const h = (x: number, z: number) => {
    const i = Math.min(n - 1, Math.max(0, Math.round((x + TERRAIN_HALF) / TERRAIN_STEP)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z + TERRAIN_HALF) / TERRAIN_STEP)));
    return heights[i * n + j];
  };
  for (let a = 0; a < cells; a++) {
    for (let b = 0; b < cells; b++) {
      const x = -WORLD_EXTENT + (a + 0.5) * TERRAIN_STEP;
      const z = -WORLD_EXTENT + (b + 0.5) * TERRAIN_STEP;
      const y = h(x, z);
      const zone = zoneAt(x, z);
      let [r, g, bl] = ZONE_COLORS[zone];
      // Hillshade: brighter on slopes facing the light, darker away from it.
      const shade = 1 + Math.max(-0.45, Math.min(0.45, (h(x - 4, z - 4) - h(x + 4, z + 4)) * 0.06));
      // Snowy peaks.
      if ((zone === 'arctic' || zone === 'medieval') && y > 50) [r, g, bl] = [236, 240, 244];
      if (zone === 'ocean' && y < SEA_LEVEL) {
        const depth = Math.min(1, (SEA_LEVEL - y) / 18);
        [r, g, bl] = [60 - depth * 40, 140 - depth * 70, 170 - depth * 60];
      }
      const k = (b * cells + a) * 4;
      img.data[k] = Math.min(255, r * shade);
      img.data[k + 1] = Math.min(255, g * shade);
      img.data[k + 2] = Math.min(255, bl * shade);
      img.data[k + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, size, size);

  // Water (the sea is in the ground colors already).
  const fill = (shape: Shape) => {
    ctx.beginPath();
    switch (shape.type) {
      case 'circle':
        ctx.arc(px(shape.x), px(shape.z), shape.r * WORLD_PX_PER_M, 0, Math.PI * 2);
        break;
      case 'rect':
        ctx.rect(px(shape.minX), px(shape.minZ), (shape.maxX - shape.minX) * WORLD_PX_PER_M, (shape.maxZ - shape.minZ) * WORLD_PX_PER_M);
        break;
      case 'ring':
        ctx.rect(px(shape.x - shape.outer), px(shape.z - shape.outer), shape.outer * 2 * WORLD_PX_PER_M, shape.outer * 2 * WORLD_PX_PER_M);
        ctx.rect(px(shape.x + shape.inner), px(shape.z - shape.inner), -shape.inner * 2 * WORLD_PX_PER_M, shape.inner * 2 * WORLD_PX_PER_M);
        break;
      case 'path':
        ctx.lineWidth = shape.width * WORLD_PX_PER_M;
        ctx.lineCap = 'round';
        shape.path.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z))));
        ctx.stroke();
        return;
    }
    ctx.fill('evenodd');
  };
  for (const w of world.waters) {
    if (w.kind === 'sea') continue;
    ctx.fillStyle = ctx.strokeStyle = w.kind === 'lava' ? '#e8601a' : w.kind === 'ice' ? '#b8dcef' : '#3a86a8';
    fill(w.shape);
  }

  // Roads, with a dashed center line on the bigger ones.
  ctx.lineJoin = ctx.lineCap = 'round';
  for (const road of world.roads) {
    ctx.strokeStyle = road.surface === 'dirt' ? '#8a6a48' : road.surface === 'cobble' || road.surface === 'sandstone' ? '#9a9286' : '#4a4f56';
    ctx.lineWidth = road.width * WORLD_PX_PER_M;
    ctx.beginPath();
    road.path.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z))));
    ctx.stroke();
  }
  // Houses out in the zones.
  ctx.fillStyle = '#d8d0c0';
  for (const house of world.houses) {
    if (Math.abs(house.x) < TOWN_HALF_EXTENT && Math.abs(house.z) < TOWN_HALF_EXTENT) continue;
    ctx.fillRect(px(house.x - house.width / 2), px(house.z - house.depth / 2), house.width * WORLD_PX_PER_M, house.depth * WORLD_PX_PER_M);
  }
  // Landmarks: a small marker each.
  ctx.fillStyle = 'rgba(255, 220, 120, 0.9)';
  for (const l of world.landmarks) {
    if (l.r > 100) continue;
    ctx.beginPath();
    ctx.arc(px(l.x), px(l.z), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}
