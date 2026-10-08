import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';

// Procedural textures drawn on canvases, so the town needs no image assets yet.
// Each is tinted by its material's color; textures stay light and neutral.

let maxAnisotropy = 8;
export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = value;
}

export function getMaxAnisotropy(): number {
  return maxAnisotropy;
}

function canvasTexture(size: number, seed: number, draw: (ctx: CanvasRenderingContext2D, rng: () => number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, mulberry32(seed));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Normal map from a texture's brightness (darker = lower), so grooves like mortar,
 * plank gaps and shingle edges catch the light. `strength` scales the bumps.
 */
export function normalMapFrom(tex: THREE.CanvasTexture, strength: number): THREE.CanvasTexture {
  const src = tex.image as HTMLCanvasElement;
  const size = src.width;
  const data = src.getContext('2d')!.getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) height[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(size, size);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Canvas rows run down while texture V runs up, hence the sign on Y.
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const normal = new THREE.CanvasTexture(canvas);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.colorSpace = THREE.NoColorSpace;
  normal.anisotropy = maxAnisotropy;
  return normal;
}

/** Fills with a base gray and sprinkles `count` dots of varying lightness. */
function speckle(ctx: CanvasRenderingContext2D, rng: () => number, base: number, spread: number, count: number, maxRadius: number): void {
  const size = ctx.canvas.width;
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const l = Math.round(base + (rng() - 0.5) * spread);
    ctx.fillStyle = `rgba(${l},${l},${l},${0.25 + rng() * 0.5})`;
    const r = 0.5 + rng() * maxRadius;
    ctx.fillRect(rng() * size, rng() * size, r, r);
  }
}

/** Large soft blotches for low-frequency variation (wear, patchy grass). */
function blotches(ctx: CanvasRenderingContext2D, rng: () => number, count: number, color: string, alpha: number): void {
  const size = ctx.canvas.width;
  for (let i = 0; i < count; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.05 + rng() * 0.15);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', String(alpha * rng())));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    // Draw wrapped copies so the texture tiles seamlessly.
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
  }
}

export interface TownTextures {
  asphalt: THREE.CanvasTexture;
  grass: THREE.CanvasTexture;
  sidewalk: THREE.CanvasTexture;
  concrete: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  brick: THREE.CanvasTexture;
  siding: THREE.CanvasTexture;
  shingles: THREE.CanvasTexture;
  bark: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  tile: THREE.CanvasTexture;
  carpet: THREE.CanvasTexture;
}

/** Meters covered by one repeat of each texture. */
export const TEXTURE_TILE = {
  asphalt: 6,
  grass: 8,
  sidewalk: 2,
  concrete: 3,
  plaster: 3,
  brick: 2.4,
  siding: 2.4,
  shingles: 2,
  bark: 1,
  wood: 2,
  tile: 0.6,
  carpet: 1,
} as const;

export function createTownTextures(): TownTextures {
  return {
    asphalt: canvasTexture(512, 1, (ctx, rng) => {
      speckle(ctx, rng, 120, 90, 26000, 2);
      blotches(ctx, rng, 14, 'rgba(60,60,60,A)', 0.25);
    }),
    grass: canvasTexture(512, 2, (ctx, rng) => {
      ctx.fillStyle = '#6f8f4e';
      ctx.fillRect(0, 0, 512, 512);
      blotches(ctx, rng, 18, 'rgba(120,140,60,A)', 0.5);
      blotches(ctx, rng, 14, 'rgba(50,80,40,A)', 0.4);
      for (let i = 0; i < 16000; i++) {
        const g = 90 + rng() * 80;
        ctx.strokeStyle = `rgba(${g * 0.6},${g},${g * 0.4},0.5)`;
        const x = rng() * 512;
        const y = rng() * 512;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 4);
        ctx.stroke();
      }
    }),
    sidewalk: canvasTexture(256, 3, (ctx, rng) => {
      speckle(ctx, rng, 200, 40, 5000, 1.5);
      // Expansion joints: one slab per texture repeat.
      ctx.strokeStyle = 'rgba(90,90,90,0.6)';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 256, 256);
    }),
    concrete: canvasTexture(256, 4, (ctx, rng) => {
      speckle(ctx, rng, 190, 50, 6000, 1.5);
      blotches(ctx, rng, 6, 'rgba(120,120,110,A)', 0.2);
    }),
    plaster: canvasTexture(256, 5, (ctx, rng) => {
      speckle(ctx, rng, 235, 30, 9000, 1.2);
      blotches(ctx, rng, 8, 'rgba(180,175,165,A)', 0.15);
    }),
    brick: canvasTexture(256, 6, (ctx, rng) => {
      ctx.fillStyle = '#a9a49b'; // mortar, recessed (darker reads as lower in the normal map)
      ctx.fillRect(0, 0, 256, 256);
      const rows = 16;
      const h = 256 / rows;
      for (let r = 0; r < rows; r++) {
        const offset = r % 2 ? 0 : 16;
        for (let c = -1; c < 8; c++) {
          const l = 200 + rng() * 55;
          ctx.fillStyle = `rgb(${l},${l * 0.95},${l * 0.92})`;
          ctx.fillRect(c * 32 + offset + 1, r * h + 1, 30, h - 2);
        }
      }
    }),
    siding: canvasTexture(256, 7, (ctx, rng) => {
      speckle(ctx, rng, 235, 20, 4000, 1);
      // Horizontal lap boards with a shadow line under each.
      for (let y = 0; y < 256; y += 16) {
        const g = ctx.createLinearGradient(0, y, 0, y + 16);
        g.addColorStop(0, 'rgba(255,255,255,0.15)');
        g.addColorStop(0.85, 'rgba(0,0,0,0.05)');
        g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, 256, 16);
      }
    }),
    shingles: canvasTexture(256, 8, (ctx, rng) => {
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 16; r++) {
        const offset = (r % 2) * 16;
        for (let c = -1; c < 8; c++) {
          const l = 150 + rng() * 90;
          ctx.fillStyle = `rgb(${l},${l},${l})`;
          ctx.fillRect(c * 32 + offset + 1, r * 16, 30, 15);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(c * 32 + offset + 1, r * 16 + 13, 30, 2);
        }
      }
    }),
    wood: canvasTexture(256, 10, (ctx, rng) => {
      // Floorboards: 8 planks per repeat, staggered ends, fine grain lines.
      const plank = 32;
      for (let r = 0; r < 8; r++) {
        const offset = rng() * 256;
        for (let start = -offset; start < 256; start += 128 + rng() * 64) {
          const l = 175 + rng() * 60;
          ctx.fillStyle = `rgb(${l},${l * 0.93},${l * 0.85})`;
          ctx.fillRect(start, r * plank, 256, plank);
          ctx.fillStyle = 'rgba(60,40,20,0.5)';
          ctx.fillRect(start, r * plank, 2, plank);
        }
        ctx.fillStyle = 'rgba(60,40,20,0.45)';
        ctx.fillRect(0, r * plank, 256, 1.5);
        for (let g = 0; g < 10; g++) {
          ctx.strokeStyle = `rgba(90,60,30,${0.08 + rng() * 0.1})`;
          const y = r * plank + 3 + rng() * (plank - 6);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(80, y + (rng() - 0.5) * 4, 170, y + (rng() - 0.5) * 4, 256, y);
          ctx.stroke();
        }
      }
    }),
    tile: canvasTexture(256, 11, (ctx, rng) => {
      // Two by two tiles per repeat with grout lines.
      ctx.fillStyle = '#bdbab3';
      ctx.fillRect(0, 0, 256, 256);
      for (let ty = 0; ty < 2; ty++) {
        for (let tx = 0; tx < 2; tx++) {
          const l = 228 + rng() * 20;
          ctx.fillStyle = `rgb(${l},${l},${l - 4})`;
          ctx.fillRect(tx * 128 + 3, ty * 128 + 3, 122, 122);
          blotches(ctx, rng, 2, 'rgba(200,198,190,A)', 0.25);
        }
      }
    }),
    carpet: canvasTexture(256, 12, (ctx, rng) => {
      speckle(ctx, rng, 215, 40, 30000, 1);
      blotches(ctx, rng, 10, 'rgba(180,180,180,A)', 0.15);
    }),
    bark: canvasTexture(128, 9, (ctx, rng) => {
      speckle(ctx, rng, 150, 60, 1500, 1.5);
      ctx.strokeStyle = 'rgba(40,30,20,0.5)';
      for (let i = 0; i < 40; i++) {
        const x = rng() * 128;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (rng() - 0.5) * 10, 128);
        ctx.stroke();
      }
    }),
  };
}
