import * as THREE from 'three';
import { mulberry32 } from '../../../../shared/town.ts';
import type { Scenery } from '../../../../shared/circuits.ts';
import type { TextureSet } from '../../assets/media.ts';
import { getMaxAnisotropy, normalMapFrom } from '../../world/town/textures.ts';

/** Made-up sponsors for the advertising boards (no real brands). */
export const SPONSORS: { name: string; bg: string; fg: string }[] = [
  { name: 'VELOCITA', bg: '#c8102e', fg: '#ffffff' },
  { name: 'NORTHSTAR OIL', bg: '#0b2a5b', fg: '#ffd23f' },
  { name: 'APEX TYRES', bg: '#111111', fg: '#f6c200' },
  { name: 'TENGAME', bg: '#ffffff', fg: '#e4572e' },
  { name: 'KAIZEN WATCHES', bg: '#1a1a1a', fg: '#d4af37' },
  { name: 'BLUE PEAK', bg: '#1c6dd0', fg: '#ffffff' },
  { name: 'ORBITAL TELECOM', bg: '#6b2fa3', fg: '#ffffff' },
  { name: 'FRESCO COLA', bg: '#e11d48', fg: '#ffffff' },
];

/**
 * The circuit's surfaces. UVs are in meters; each texture repeats once per its real size.
 * Photo textures (from media) are used where they've loaded, drawn ones otherwise.
 */
export class RaceMaterials {
  readonly asphalt: THREE.MeshStandardMaterial;
  /** Run-off areas: older, paler asphalt. */
  readonly runoff: THREE.MeshStandardMaterial;
  readonly paint: THREE.MeshStandardMaterial;
  readonly kerb: THREE.MeshStandardMaterial;
  /** Tyre walls wrapped in red and white belting. */
  readonly tyreWall: THREE.MeshStandardMaterial;
  readonly grass: THREE.MeshStandardMaterial;
  readonly gravel: THREE.MeshStandardMaterial;
  readonly sand: THREE.MeshStandardMaterial;
  readonly ground: THREE.MeshStandardMaterial;
  readonly concrete: THREE.MeshStandardMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly fence: THREE.MeshStandardMaterial;
  readonly painted: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly boards: THREE.MeshStandardMaterial;
  readonly crowd: THREE.MeshStandardMaterial;
  readonly building: THREE.MeshStandardMaterial;
  readonly bark: THREE.MeshStandardMaterial;
  readonly leaves: THREE.MeshStandardMaterial;
  readonly water: THREE.MeshStandardMaterial;
  /** Lamps (floodlight heads, gantry lights): glow in their own vertex color. */
  readonly lamp: THREE.MeshStandardMaterial;

  constructor(textures: Map<string, TextureSet>, scenery: Scenery) {
    const desert = scenery === 'desert';
    const photo = (name: string, params: THREE.MeshStandardMaterialParameters = {}, color = '#ffffff') => {
      const set = textures.get(name);
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...params });
      if (set) {
        m.map = scaled(set.color, set.size);
        m.normalMap = scaled(set.normal, set.size);
        m.roughnessMap = scaled(set.arm, set.size);
      }
      return m;
    };
    this.asphalt = photo('asphalt', { vertexColors: true }, '#8a8a8a');
    this.runoff = photo('asphalt', { vertexColors: true }, '#a9a6a0');
    this.paint = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.kerb = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.tyreWall = new THREE.MeshStandardMaterial({ map: beltTexture(), roughness: 0.8 });
    this.grass = photo('grass', { vertexColors: true }, '#c6d7a8');
    const gravel = gravelTexture();
    this.gravel = new THREE.MeshStandardMaterial({ map: gravel, normalMap: normalMapFrom(gravel, 3), roughness: 1, color: desert ? '#e6d2a8' : '#ffffff' });
    this.sand = photo('sand', { vertexColors: true }, '#f0e2c4');
    // Sand in the desert, paving in the city, grass elsewhere.
    this.ground = desert ? photo('sand', { vertexColors: true }, '#f2dfbd') : scenery === 'city' ? photo('sidewalk', { vertexColors: true }, '#c9c6bf') : photo('grass', { vertexColors: true }, '#b9cc9a');
    this.concrete = photo('concrete', { vertexColors: true }, '#e8e8e4');
    this.metal = new THREE.MeshStandardMaterial({ color: '#c4c9cf', roughness: 0.35, metalness: 0.85 });
    this.rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.fence = new THREE.MeshStandardMaterial({ map: fenceTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3, color: '#5f666d' });
    this.painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
    this.glass = new THREE.MeshStandardMaterial({ color: '#30475e', roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 });
    const boards = boardsTexture();
    this.boards = new THREE.MeshStandardMaterial({ map: boards, emissiveMap: boards, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.6, side: THREE.DoubleSide });
    this.crowd = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.building = buildingMaterial();
    this.bark = photo('bark', {}, '#8a7a68');
    this.leaves = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
    this.water = new THREE.MeshStandardMaterial({ color: '#1e4f66', roughness: 0.04, metalness: 0.2, envMapIntensity: 1.6, transparent: true, opacity: 0.92 });
    const lamp = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 2, roughness: 0.4 });
    lamp.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif',
      );
    };
    this.lamp = lamp;
  }

  /** Lit windows at night (0 by day, 1 at night). */
  setNight(night: number): void {
    this.building.emissiveIntensity = 0.05 + night * 1.6;
    this.boards.emissiveIntensity = night * 0.5;
  }
}

/** A copy of a texture that repeats once per `size` meters of UV. */
function scaled(t: THREE.Texture, size: number): THREE.Texture {
  const c = t.clone();
  c.repeat.set(1 / size, 1 / size);
  c.anisotropy = getMaxAnisotropy();
  c.needsUpdate = true;
  return c;
}

function canvas(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1], color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(...repeat);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = getMaxAnisotropy();
  return tex;
}

/** Red and white kerb blocks, one pair every 2 m along the track (v), across the kerb (u, 0..1). */
function kerbTexture(): THREE.CanvasTexture {
  return canvas(
    32,
    128,
    (ctx) => {
      ctx.fillStyle = '#c81d1d';
      ctx.fillRect(0, 0, 32, 64);
      ctx.fillStyle = '#efefea';
      ctx.fillRect(0, 64, 32, 64);
      // A worn, darker outer edge.
      const g = ctx.createLinearGradient(0, 0, 32, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 128);
    },
    [1, 0.5],
  );
}

/** Red and white belting round a tyre wall: a band of each every 2 m along it (u). */
function beltTexture(): THREE.CanvasTexture {
  return canvas(
    64,
    16,
    (ctx) => {
      ctx.fillStyle = '#d42020';
      ctx.fillRect(0, 0, 32, 16);
      ctx.fillStyle = '#f0f0ea';
      ctx.fillRect(32, 0, 32, 16);
    },
    [0.5, 1],
  );
}

/** Gravel trap: a meter of small stones. */
function gravelTexture(): THREE.CanvasTexture {
  const rng = mulberry32(7);
  return canvas(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#a99c86';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const x = rng() * 256;
        const y = rng() * 256;
        const r = 1.5 + rng() * 3.5;
        const l = 45 + rng() * 35;
        ctx.fillStyle = `hsl(${30 + rng() * 20}, ${8 + rng() * 14}%, ${l}%)`;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
        // Wrap round the edges so it tiles.
        if (x < 6 || y < 6) {
          ctx.beginPath();
          ctx.ellipse(x + (x < 6 ? 256 : 0), y + (y < 6 ? 256 : 0), r, r * 0.8, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
    [1, 1],
  );
}

/** Chain-link catch fencing: wire diamonds every 10 cm, see-through between. 1 m square. */
function fenceTexture(): THREE.CanvasTexture {
  return canvas(
    128,
    128,
    (ctx) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.lineWidth = 2;
      for (let k = -128; k <= 256; k += 13) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + 128, 128);
        ctx.moveTo(k, 128);
        ctx.lineTo(k + 128, 0);
        ctx.stroke();
      }
    },
    [1, 1],
  );
}

/** The sponsors' boards, side by side: board k covers u from k/8 to (k+1)/8. */
function boardsTexture(): THREE.CanvasTexture {
  const w = 2048;
  const h = 128;
  return canvas(
    w,
    h,
    (ctx) => {
      const each = w / SPONSORS.length;
      SPONSORS.forEach((s, k) => {
        ctx.fillStyle = s.bg;
        ctx.fillRect(k * each, 0, each, h);
        ctx.fillStyle = s.fg;
        ctx.font = `bold ${Math.round(h * 0.52)}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = s.name;
        let size = h * 0.52;
        while (ctx.measureText(text).width > each * 0.86 && size > 10) {
          size -= 2;
          ctx.font = `bold ${Math.round(size)}px Arial, Helvetica, sans-serif`;
        }
        ctx.fillText(text, k * each + each / 2, h / 2 + 2);
      });
    },
    [1, 1],
  );
}

/**
 * Office and apartment blocks: rows of windows, a floor every 3.4 m and a window every
 * 3 m (UVs count windows and floors), some lit at night.
 */
function buildingMaterial(): THREE.MeshStandardMaterial {
  const rng = mulberry32(11);
  const size = 512;
  const cells = 16;
  const cell = size / cells;
  const lit: boolean[] = [];
  const map = canvas(size, size, (ctx) => {
    ctx.fillStyle = '#d9d6cf';
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        const dark = 0.2 + rng() * 0.25;
        ctx.fillStyle = `rgb(${Math.round(60 * dark + 30)}, ${Math.round(80 * dark + 40)}, ${Math.round(100 * dark + 55)})`;
        ctx.fillRect(c * cell + cell * 0.14, r * cell + cell * 0.18, cell * 0.72, cell * 0.62);
        lit.push(rng() < 0.45);
      }
    }
  });
  const glow = canvas(size, size, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    let k = 0;
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (lit[k++]) {
          const warm = rng();
          ctx.fillStyle = warm < 0.7 ? '#ffd9a0' : '#cfe4ff';
          ctx.fillRect(c * cell + cell * 0.14, r * cell + cell * 0.18, cell * 0.72, cell * 0.62);
        }
      }
    }
  });
  for (const t of [map, glow]) t.repeat.set(1 / cells, 1 / cells);
  return new THREE.MeshStandardMaterial({ map, emissiveMap: glow, emissive: '#ffffff', emissiveIntensity: 0.05, roughness: 0.6, vertexColors: true });
}
