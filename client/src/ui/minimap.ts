import { ASPHALT_WIDTH, locationName, TOWN_HALF_EXTENT, type TownLayout } from '../../../shared/town.ts';

/** Resolution of the pre-drawn town map. */
const PX_PER_M = 2;
/** Grass drawn around the town on the map, in meters. */
const MARGIN = 60;
const EXTENT = TOWN_HALF_EXTENT + MARGIN;
/** Meters from the center to the rim: closer when slow, further out at speed. */
const MIN_RANGE = 70;
const MAX_RANGE = 140;
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
  private range = MIN_RANGE;
  private lastLabel = '';

  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement,
    private layout: TownLayout,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.base = drawTown(layout);
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
    ctx.save();
    ctx.rotate(turn);
    ctx.scale(scale / PX_PER_M, scale / PX_PER_M);
    ctx.translate(-(self.x + EXTENT) * PX_PER_M, -(self.z + EXTENT) * PX_PER_M);
    ctx.imageSmoothingEnabled = true;
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

    const text = locationName(this.layout, self.x, self.z);
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

  ctx.fillStyle = '#26321f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
