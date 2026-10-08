import * as THREE from 'three';
import type { Furniture } from '../../../../shared/interior.ts';
import { mulberry32 } from '../../../../shared/town.ts';
import type { TownMaterials } from './materials.ts';
import { box, type MeshBuilder, placement } from './meshBuilder.ts';

const BOOK_COLORS = ['#7a2e2e', '#2e4a7a', '#3c5e3a', '#c9a45c', '#5a4a6e', '#2b2b2b', '#a85a3a', '#d8d2c4'];
const DARK = '#2a2622';

// Shared geometry.
const cylinder = (r: number, h: number, segments = 16) => new THREE.CylinderGeometry(r, r, h, segments);
const sphere = new THREE.IcosahedronGeometry(1, 1);

/**
 * Adds one piece of furniture, built from primitives in its own frame: centered on
 * x/z, bottom at y=0, front facing +Z. `M` is the house's world matrix.
 */
export function buildFurniture(f: Furniture, builder: MeshBuilder, m: TownMaterials, M: THREE.Matrix4): void {
  const L = M.clone().multiply(placement(f.x, f.y, f.z, f.yaw));
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, color?: string, yaw = 0, shadow = true) =>
    builder.add(geo, mat, L.clone().multiply(placement(x, y, z, yaw)), color, { castShadow: shadow });
  /** Box by size, with its bottom at `y`. */
  const b = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, color?: string) => put(box(w, h, d), mat, x, y + h / 2, z, color);
  const legs = (w: number, d: number, h: number, inset: number, color: string, size = 0.05) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(size, h, size, m.furnitureWood, sx * (w / 2 - inset), 0, sz * (d / 2 - inset), color);
  };
  const { w, d, h, color } = f;
  const lighter = shade(color, 0.12);

  switch (f.type) {
    case 'sofa':
    case 'armchair': {
      const arm = 0.18;
      const seat = 0.42;
      legs(w - 0.1, d - 0.1, 0.08, 0.04, DARK, 0.06);
      b(w, seat - 0.08, d, m.fabric, 0, 0.08, 0, color);
      b(w - 2 * arm, 0.5, 0.22, m.fabric, 0, seat, -d / 2 + 0.11, color);
      for (const s of [-1, 1]) b(arm, 0.62 - 0.08, d, m.fabric, s * (w / 2 - arm / 2), 0.08, 0, color);
      // Seat and back cushions.
      const n = f.type === 'sofa' ? 2 : 1;
      const cw = (w - 2 * arm) / n;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + arm + cw * (i + 0.5);
        b(cw - 0.02, 0.14, d - 0.26, m.fabric, x, seat, 0.1, lighter);
        b(cw - 0.06, 0.4, 0.14, m.fabric, x, seat + 0.1, -d / 2 + 0.28, lighter);
      }
      return;
    }
    case 'coffeeTable':
      b(w, 0.05, d, m.furnitureWood, 0, h - 0.05, 0, color);
      b(w - 0.1, 0.03, d - 0.1, m.furnitureWood, 0, 0.12, 0, color);
      legs(w, d, h - 0.05, 0.05, color);
      return;
    case 'tvStand':
      b(w, h, d, m.furnitureWood, 0, 0, 0, color);
      b(w - 0.06, 0.01, 0.01, m.trim, 0, h * 0.5, d / 2, DARK);
      // Flat-screen TV on a small foot.
      b(0.3, 0.02, 0.2, m.screen, 0, h, -0.05);
      b(0.06, 0.08, 0.04, m.screen, 0, h + 0.02, -0.05);
      b(1.3, 0.76, 0.05, m.screen, 0, h + 0.1, -0.05);
      return;
    case 'bookshelf': {
      const t = 0.03;
      for (const s of [-1, 1]) b(t, h, d, m.furnitureWood, s * (w / 2 - t / 2), 0, 0, color);
      b(w, t, d, m.furnitureWood, 0, h - t, 0, color);
      b(w, 0.08, d, m.furnitureWood, 0, 0, 0, color);
      b(w, h, 0.02, m.furnitureWood, 0, 0, -d / 2 + 0.01, shade(color, -0.15));
      const shelves = 4;
      const rng = mulberry32(Math.round(f.x * 100) * 31 + Math.round(f.z * 100));
      for (let i = 0; i < shelves; i++) {
        const y = 0.08 + ((h - 0.1) / shelves) * i;
        if (i > 0) b(w - 2 * t, t, d - 0.02, m.furnitureWood, 0, y - t, 0.01, color);
        // A row of books, leaving a gap now and then.
        let x = -w / 2 + t + 0.02;
        while (x < w / 2 - t - 0.06) {
          const bw = 0.03 + rng() * 0.04;
          const bh = 0.22 + rng() * 0.12;
          if (rng() > 0.12) b(bw, bh, d * 0.75, m.fabric, x + bw / 2, y, 0.02, BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)]);
          x += bw + 0.004;
        }
      }
      return;
    }
    case 'floorLamp':
      put(cylinder(0.16, 0.03), m.darkMetal, 0, 0.015, 0);
      put(cylinder(0.015, h - 0.3, 8), m.darkMetal, 0, (h - 0.3) / 2, 0);
      put(new THREE.CylinderGeometry(0.14, 0.2, 0.3, 20), m.lampShade, 0, h - 0.15, 0, undefined, 0, false);
      return;
    case 'plant': {
      put(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 14), m.pot, 0, 0.175, 0);
      const rng = mulberry32(Math.round(f.x * 1000 + f.z * 7));
      for (let i = 0; i < 6; i++) {
        const r = 0.16 + rng() * 0.1;
        const g = sphere.clone().scale(r, r * 1.3, r);
        put(g, m.leaves, (rng() - 0.5) * 0.25, 0.45 + rng() * (h - 0.6), (rng() - 0.5) * 0.25);
      }
      return;
    }
    case 'rug':
      b(w, 0.012, d, m.fabric, 0, 0.002, 0, color);
      b(w - 0.2, 0.013, d - 0.2, m.fabric, 0, 0.002, 0, lighter);
      return;
    case 'counter': {
      const modules = f.modules ?? 'c'.repeat(Math.round(w / 0.6));
      b(w, 0.1, d - 0.06, m.lacquer, 0, 0, -0.03, DARK); // toe kick
      b(w, 0.78, d - 0.02, m.lacquer, 0, 0.1, -0.01, color);
      b(w + 0.02, 0.04, d + 0.02, m.stone, 0, 0.88, 0);
      [...modules].forEach((kind, i) => {
        const x = -w / 2 + 0.3 + i * 0.6;
        // Door gap and handle on each module.
        b(0.006, 0.7, 0.01, m.lacquer, x + 0.297, 0.14, d / 2, shade(color, -0.3));
        b(0.12, 0.02, 0.025, m.steel, x, 0.78, d / 2 + 0.01);
        if (kind === 's') {
          b(0.48, 0.015, 0.4, m.steel, x, 0.92, 0.02);
          b(0.42, 0.016, 0.34, m.screen, x, 0.921, 0.02, '#3a3f44');
          put(cylinder(0.015, 0.3, 8), m.steel, x, 1.07, -d / 2 + 0.08);
          b(0.03, 0.03, 0.2, m.steel, x, 1.2, -d / 2 + 0.17);
        } else if (kind === 'o') {
          b(0.56, 0.012, 0.5, m.screen, x, 0.92, 0.02);
          for (const [dx, dz] of [[-0.13, -0.1], [0.13, -0.1], [-0.13, 0.13], [0.13, 0.13]]) {
            put(new THREE.TorusGeometry(0.07, 0.008, 6, 20).rotateX(Math.PI / 2), m.darkMetal, x + dx, 0.935, 0.02 + dz);
          }
          b(0.56, 0.4, 0.01, m.screen, x, 0.3, d / 2 + 0.005);
        }
      });
      return;
    }
    case 'upperCabinets': {
      b(w, h, d, m.lacquer, 0, 0, 0, color);
      const n = Math.round(w / 0.6);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.3 + i * 0.6;
        b(0.006, h - 0.04, 0.01, m.lacquer, x + 0.297, 0.02, d / 2, shade(color, -0.3));
        b(0.02, 0.12, 0.025, m.steel, x + 0.24, 0.06, d / 2 + 0.01);
      }
      return;
    }
    case 'fridge':
      b(w, h, d, m.lacquer, 0, 0, 0, color);
      b(w - 0.02, 0.008, 0.01, m.lacquer, 0, h * 0.62, d / 2, '#9a9a98');
      for (const y of [h * 0.68, h * 0.4]) b(0.025, 0.3, 0.03, m.steel, w / 2 - 0.08, y, d / 2 + 0.02);
      return;
    case 'diningTable':
      b(w, 0.05, d, m.furnitureWood, 0, h - 0.05, 0, color);
      legs(w, d, h - 0.05, 0.07, color, 0.06);
      return;
    case 'chair':
      b(w, 0.05, d, m.furnitureWood, 0, 0.43, 0, color);
      legs(w, d, 0.43, 0.03, color, 0.035);
      for (const s of [-1, 1]) b(0.035, 0.45, 0.035, m.furnitureWood, s * (w / 2 - 0.03), 0.48, -d / 2 + 0.03, color);
      b(w - 0.04, 0.16, 0.025, m.furnitureWood, 0, 0.72, -d / 2 + 0.03, color);
      return;
    case 'bed': {
      const wood = '#7a5a3c';
      b(w + 0.08, 0.28, d, m.furnitureWood, 0, 0.02, 0, wood);
      b(w, 0.22, d - 0.08, m.fabric, 0, 0.3, 0.02, '#f2f0ec');
      // Blanket over the lower two thirds, draped a little over the sides.
      b(w + 0.04, 0.06, d * 0.66, m.fabric, 0, 0.47, d * 0.17, color);
      for (const s of [-1, 1]) b(0.02, 0.18, d * 0.66, m.fabric, s * (w / 2 + 0.03), 0.33, d * 0.17, color);
      const pillows = w > 1.2 ? 2 : 1;
      for (let i = 0; i < pillows; i++) {
        const pw = w / pillows - 0.1;
        b(pw, 0.12, 0.38, m.fabric, -w / 2 + (w / pillows) * (i + 0.5), 0.52, -d / 2 + 0.3, '#fbfaf7');
      }
      b(w + 0.1, h, 0.08, m.furnitureWood, 0, 0, -d / 2 + 0.04, wood);
      return;
    }
    case 'nightstand':
      b(w, h, d, m.furnitureWood, 0, 0, 0, color);
      b(w - 0.06, 0.005, 0.01, m.trim, 0, h * 0.55, d / 2, DARK);
      b(0.1, 0.015, 0.02, m.steel, 0, h * 0.75, d / 2 + 0.01);
      // Table lamp.
      put(cylinder(0.06, 0.02), m.darkMetal, 0, h + 0.01, -0.03);
      put(cylinder(0.012, 0.22, 8), m.darkMetal, 0, h + 0.13, -0.03);
      put(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 16), m.lampShade, 0, h + 0.3, -0.03, undefined, 0, false);
      return;
    case 'wardrobe':
      b(w, h, d, m.furnitureWood, 0, 0, 0, color);
      b(0.008, h - 0.1, 0.01, m.trim, 0, 0.05, d / 2, DARK);
      for (const s of [-1, 1]) b(0.02, 0.25, 0.03, m.steel, s * 0.06, h * 0.5, d / 2 + 0.015);
      return;
    case 'desk':
      b(w, 0.04, d, m.furnitureWood, 0, h - 0.04, 0, color);
      for (const s of [-1, 1]) b(0.04, h - 0.04, d, m.furnitureWood, s * (w / 2 - 0.02), 0, 0, color);
      b(w - 0.08, 0.3, 0.02, m.furnitureWood, 0, h - 0.34, -d / 2 + 0.02, color);
      // Laptop.
      b(0.34, 0.015, 0.24, m.darkMetal, 0.1, h, 0.04);
      put(box(0.34, 0.22, 0.01), m.screen, 0.1, h + 0.11, -0.08);
      return;
    case 'bathtub': {
      const rim = 0.08;
      b(w, 0.12, d, m.porcelain, 0, 0, 0);
      for (const s of [-1, 1]) {
        b(rim, h - 0.12, d, m.porcelain, s * (w / 2 - rim / 2), 0.12, 0);
        b(w - 2 * rim, h - 0.12, rim, m.porcelain, 0, 0.12, s * (d / 2 - rim / 2));
      }
      put(cylinder(0.02, 0.25, 8), m.steel, -w / 2 + 0.15, h + 0.12, -d / 2 + 0.06);
      b(0.03, 0.03, 0.14, m.steel, -w / 2 + 0.15, h + 0.24, -d / 2 + 0.12);
      return;
    }
    case 'shower':
      b(w, 0.08, d, m.porcelain, 0, 0, 0);
      b(0.02, h - 0.1, d, m.frostedGlass, w / 2 - 0.01, 0.08, 0);
      b(w, h - 0.1, 0.02, m.frostedGlass, 0, 0.08, d / 2 - 0.01);
      put(cylinder(0.012, 0.6, 8), m.steel, 0, h - 0.4, -d / 2 + 0.04);
      put(cylinder(0.1, 0.02), m.steel, 0, h - 0.1, -d / 2 + 0.15);
      return;
    case 'toilet':
      b(0.32, 0.38, 0.45, m.porcelain, 0, 0, 0.06);
      b(0.4, 0.06, 0.5, m.porcelain, 0, 0.38, 0.08);
      b(0.38, 0.03, 0.46, m.porcelain, 0, 0.44, 0.08);
      b(0.4, 0.36, 0.18, m.porcelain, 0, 0.42, -d / 2 + 0.09);
      return;
    case 'vanity':
      b(w, 0.75, d - 0.04, m.lacquer, 0, 0, -0.02, color);
      b(w, 0.1, d, m.porcelain, 0, 0.75, 0);
      b(w * 0.55, 0.012, d * 0.55, m.steel, 0, 0.851, 0.02);
      put(cylinder(0.015, 0.2, 8), m.steel, 0, 0.95, -d / 2 + 0.08);
      // Mirror on the wall above.
      b(0.7, 0.8, 0.02, m.trim, 0, 1.15, -d / 2 + 0.01);
      b(0.64, 0.74, 0.021, m.mirror, 0, 1.18, -d / 2 + 0.012);
      return;
  }
}

/** Lighter (amount > 0) or darker version of a hex color. */
function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}
