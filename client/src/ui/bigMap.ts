import { TOWN_HALF_EXTENT, type TownLayout } from '../../../shared/town.ts';
import { generateWorld, WORLD_HALF, worldLocationName, ZONES } from '../../../shared/world.ts';
import { arrow, EXTENT, type MapPlayer, type Minimap, TARGET_COLOR, WORLD_EXTENT } from './minimap.ts';

/** Closest zoom, in screen pixels per meter. */
const MAX_SCALE = 5;
/** Zooms (px per m) from which places, and then the town's streets, are named. */
const PLACES_FROM = 1.1;
const STREETS_FROM = 2.4;
/** Zoom for "find me". */
const ME_SCALE = 3;

/**
 * The whole world on one screen, north up: opened from the minimap (click or tap it, or
 * Tab). Drag to move around, scroll or pinch to zoom; the eight lands, places and
 * streets are named, with everyone in the room and the mission target on it.
 */
export class BigMap {
  private overlay = document.getElementById('bigmap')!;
  private canvas = document.getElementById('bigmap-canvas') as HTMLCanvasElement;
  private where = document.getElementById('bigmap-where')!;
  private ctx = this.canvas.getContext('2d')!;
  /** The middle of the view (world meters) and the zoom (screen px per meter). */
  private center = { x: 0, z: 0 };
  private scale = 1;
  /** Keeping the player in the middle, until the map is dragged. */
  private following = false;
  /** Fingers (or the mouse) on the map, and where they are. */
  private pointers = new Map<number, { x: number; y: number }>();
  /** The place under the mouse or last finger, named in the bar. */
  private pointed: { x: number; z: number } | null = null;
  private places = generateWorld().landmarks.filter((l) => l.r <= 100);
  /** Called when the map opens or closes. */
  onToggle: (open: boolean) => void = () => {};

  constructor(
    private layers: Pick<Minimap, 'base' | 'world'>,
    private town: TownLayout,
  ) {
    const button = (id: string, use: () => void) => document.getElementById(id)!.addEventListener('click', use);
    button('bigmap-in', () => this.zoom(1.6));
    button('bigmap-out', () => this.zoom(1 / 1.6));
    button('bigmap-me', () => {
      this.following = true;
      this.scale = Math.max(this.scale, ME_SCALE);
    });
    button('bigmap-close', () => this.close());

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.pointed = this.toWorld(e.offsetX, e.offsetY);
    });
    c.addEventListener('pointermove', (e) => this.move(e));
    for (const type of ['pointerup', 'pointercancel'] as const) c.addEventListener(type, (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.pointed = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY);
    });
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  /** Opens on the whole world. */
  open(): void {
    if (this.isOpen) return;
    this.overlay.hidden = false;
    this.center = { x: 0, z: 0 };
    this.scale = this.fit;
    this.following = false;
    this.pointed = null;
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.overlay.hidden = true;
    this.pointers.clear();
    this.onToggle(false);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Draws the map while it's open; call each frame. */
  update(self: MapPlayer, others: MapPlayer[], target: { x: number; z: number } | null): void {
    if (!this.isOpen) return;
    const { canvas, ctx } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    if (this.following) this.center = { x: self.x, z: self.z };
    this.keepOnMap();
    const { scale } = this;
    const sx = (x: number) => w / 2 + (x - this.center.x) * scale;
    const sy = (z: number) => h / 2 + (z - this.center.z) * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#10151b';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.layers.world, sx(-WORLD_EXTENT), sy(-WORLD_EXTENT), 2 * WORLD_EXTENT * scale, 2 * WORLD_EXTENT * scale);
    ctx.drawImage(this.layers.base, sx(-EXTENT), sy(-EXTENT), 2 * EXTENT * scale, 2 * EXTENT * scale);

    // Names: the lands; places in them closer up; the town's streets closer still.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const label = (text: string, x: number, y: number, size: number, weight = 700, color = '#fff') => {
      ctx.font = `${weight} ${size}px system-ui, sans-serif`;
      ctx.lineWidth = size * 0.28;
      ctx.strokeStyle = 'rgba(8, 10, 14, 0.85)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const zoneSize = Math.min(30, Math.max(13, scale * 22));
    for (const zone of Object.values(ZONES)) {
      if (zone.id === 'town') {
        if (scale < STREETS_FROM) label('Tengame Town', sx(0), sy(0), zoneSize);
        continue;
      }
      label(zone.name.toUpperCase(), sx(zone.x), sy(zone.z) - zoneSize * 0.6, zoneSize);
      label(zone.theme, sx(zone.x), sy(zone.z) + zoneSize * 0.5, zoneSize * 0.55, 600, '#d8dde4');
    }
    if (scale >= PLACES_FROM) {
      for (const p of this.places) {
        ctx.fillStyle = '#ffd78a';
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.z), 3, 0, Math.PI * 2);
        ctx.fill();
        label(p.name, sx(p.x), sy(p.z) - 11, 12, 600, '#ffe7b8');
      }
    }
    if (scale >= STREETS_FROM) this.streetNames(sx, sy, w, h, label);

    if (target) {
      const [x, y, s] = [sx(target.x), sy(target.z), 9];
      ctx.fillStyle = TARGET_COLOR;
      ctx.strokeStyle = '#3a2a00';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const o of others) {
      arrow(ctx, sx(o.x), sy(o.z), -o.yaw, 8, o.color);
      if (o.name) label(o.name, sx(o.x), sy(o.z) - 17, 12, 700);
    }
    arrow(ctx, sx(self.x), sy(self.z), -self.yaw, 11, self.color);
    label('You', sx(self.x), sy(self.z) - 21, 13, 800);

    const at = this.pointed ?? self;
    const name = worldLocationName(at.x, at.z) || 'Beyond the edge of the world';
    const text = this.pointed ? name : `You're at ${name}`;
    if (this.where.textContent !== text) this.where.textContent = text;
  }

  /** Street names along the town's roads, at a few points in view. */
  private streetNames(sx: (x: number) => number, sy: (z: number) => number, w: number, h: number, label: (text: string, x: number, y: number, size: number, weight?: number, color?: string) => void): void {
    const ctx = this.ctx;
    const e = TOWN_HALF_EXTENT;
    // Between the crossings, where the names don't sit on another road.
    const gaps = this.town.roads.filter((r) => r.axis === 'x').map((r) => r.center);
    const mids = gaps.slice(1).map((c, i) => (c + gaps[i]) / 2);
    for (const road of this.town.roads) {
      for (const along of mids) {
        const [x, y] = road.axis === 'x' ? [sx(along), sy(road.center)] : [sx(road.center), sy(along)];
        if (x < -50 || x > w + 50 || y < -50 || y > h + 50 || Math.abs(along) > e) continue;
        ctx.save();
        ctx.translate(x, y);
        if (road.axis === 'z') ctx.rotate(-Math.PI / 2);
        label(road.name, 0, 0, 11, 600, '#f3f0e6');
        ctx.restore();
      }
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (e.pointerType === 'mouse' || p) this.pointed = this.toWorld(e.offsetX, e.offsetY);
    if (!p) return;
    const was = { ...p };
    p.x = e.offsetX;
    p.y = e.offsetY;
    if (this.pointers.size === 1) {
      // Dragging moves the map under the finger.
      this.following = false;
      this.center.x -= (p.x - was.x) / this.scale;
      this.center.z -= (p.y - was.y) / this.scale;
    } else if (this.pointers.size === 2) {
      // Pinching: zoom by how much the fingers spread, about the point between them.
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(was.x - other.x, was.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      if (before > 10) this.zoom(after / before, (p.x + other.x) / 2, (p.y + other.y) / 2);
    }
  }

  /** Zooms by `factor`, keeping the point at (x, y) on the screen where it is (the middle if not given). */
  private zoom(factor: number, x = this.canvas.clientWidth / 2, y = this.canvas.clientHeight / 2): void {
    const at = this.toWorld(x, y);
    this.scale = Math.min(MAX_SCALE, Math.max(this.fit * 0.8, this.scale * factor));
    if (this.following && x === this.canvas.clientWidth / 2 && y === this.canvas.clientHeight / 2) return;
    this.following = false;
    this.center.x = at.x - (x - this.canvas.clientWidth / 2) / this.scale;
    this.center.z = at.z - (y - this.canvas.clientHeight / 2) / this.scale;
  }

  private toWorld(x: number, y: number): { x: number; z: number } {
    return { x: this.center.x + (x - this.canvas.clientWidth / 2) / this.scale, z: this.center.z + (y - this.canvas.clientHeight / 2) / this.scale };
  }

  /** The zoom that shows the whole world. */
  private get fit(): number {
    return Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / (2 * (WORLD_HALF + 40));
  }

  /** Not so far off that the world's out of sight. */
  private keepOnMap(): void {
    const limit = WORLD_HALF + 40;
    this.center.x = Math.max(-limit, Math.min(limit, this.center.x));
    this.center.z = Math.max(-limit, Math.min(limit, this.center.z));
  }
}
