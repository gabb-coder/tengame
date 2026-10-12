import { TEAMS } from '../../../shared/racing.ts';
import type { Track } from './track.ts';

const SIZE = 360;

/**
 * The circuit in the corner: its whole outline, north up, with every car on it as a dot
 * in its team's color (the player's bigger, ringed in white).
 */
export class RaceMap {
  private ctx: CanvasRenderingContext2D;
  private outline = document.createElement('canvas');
  private scale = 1;
  private x0 = 0;
  private z0 = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private track: Track,
  ) {
    canvas.width = canvas.height = SIZE;
    canvas.title = '';
    canvas.style.cursor = 'default';
    canvas.style.background = 'rgba(12, 16, 22, 0.78)';
    this.ctx = canvas.getContext('2d')!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.x[i]);
      maxX = Math.max(maxX, track.x[i]);
      minZ = Math.min(minZ, track.z[i]);
      maxZ = Math.max(maxZ, track.z[i]);
    }
    // Inside the round frame: a square that fits in the circle.
    const fit = SIZE * 0.66;
    this.scale = fit / Math.max(maxX - minX, maxZ - minZ);
    this.x0 = (minX + maxX) / 2;
    this.z0 = (minZ + maxZ) / 2;
    this.outline.width = this.outline.height = SIZE;
    const g = this.outline.getContext('2d')!;
    g.lineJoin = 'round';
    for (const [width, color] of [
      [16, 'rgba(0,0,0,0.5)'],
      [9, '#d9dde3'],
    ] as const) {
      g.beginPath();
      for (let i = 0; i <= track.n; i += 2) {
        const k = i % track.n;
        const [x, y] = this.at(track.x[k], track.z[k]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.lineWidth = width;
      g.strokeStyle = color;
      g.stroke();
    }
    // The start line.
    const [sx, sy] = this.at(track.x[0], track.z[0]);
    const [nx, ny] = [-track.tz[0], track.tx[0]];
    g.strokeStyle = '#ffd24a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(sx - nx * 14, sy - ny * 14);
    g.lineTo(sx + nx * 14, sy + ny * 14);
    g.stroke();
  }

  private at(x: number, z: number): [number, number] {
    return [SIZE / 2 + (x - this.x0) * this.scale, SIZE / 2 + (z - this.z0) * this.scale];
  }

  /** Draws the cars: `me` last, on top. */
  render(cars: { x: number; z: number; team: number; me: boolean }[]): void {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    c.drawImage(this.outline, 0, 0);
    for (const car of [...cars].sort((a, b) => Number(a.me) - Number(b.me))) {
      const [x, y] = this.at(car.x, car.z);
      c.beginPath();
      c.arc(x, y, car.me ? 13 : 9, 0, Math.PI * 2);
      c.fillStyle = TEAMS[car.team].primary;
      c.fill();
      c.lineWidth = car.me ? 5 : 2.5;
      c.strokeStyle = car.me ? '#ffffff' : 'rgba(0,0,0,0.7)';
      c.stroke();
    }
  }
}
