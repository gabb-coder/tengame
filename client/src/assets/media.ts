import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Written by scripts/fetch-assets.mjs. */
interface Manifest {
  textures: Record<string, { size: number }>;
  models: Record<string, { min: [number, number, number]; max: [number, number, number] }>;
  humans?: HumansInfo;
}

/** The people pack, if it was installed (see scripts/fetch-assets.mjs). */
export interface HumansInfo {
  hair: string[];
  /** Ground speed (m/s) each moving animation was made for. */
  clips: Record<string, { speed: number }>;
}

/** A photo-scanned surface: color, normal and AO/roughness maps, covering `size` meters. */
export interface TextureSet {
  color: THREE.Texture;
  normal: THREE.Texture;
  /** R = ambient occlusion, G = roughness. */
  arm: THREE.Texture;
  size: number;
}

export interface Model {
  /** The model's meshes, in its own frame (meters, +Z front, bottom near y = 0). */
  scene: THREE.Group;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

const BASE = '/media/';

/**
 * Real textures and furniture models, downloaded in the background. Everything here is
 * optional: if a file is missing or fails to load, the game keeps its generated stand-in.
 */
export class Media {
  readonly textures: Promise<Map<string, TextureSet>>;
  private manifest: Promise<Manifest | null>;
  private gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private models = new Map<string, Promise<Model | null>>();

  constructor() {
    this.manifest = fetch(`${BASE}manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .catch(() => null);
    this.textures = this.manifest.then((m) => (m ? loadTextures(m) : new Map()));
  }

  /** What the people pack holds, or null if it isn't installed. */
  async humans(): Promise<HumansInfo | null> {
    return (await this.manifest)?.humans ?? null;
  }

  /** Loads any glTF file from media/models, with its animations; null on failure. */
  async gltf(file: string): Promise<GLTF | null> {
    try {
      return await this.gltfLoader.loadAsync(`${BASE}models/${file}`);
    } catch (err) {
      console.warn(`${file} failed to load`, err);
      return null;
    }
  }

  /** Loads a color texture from media/textures, laid out like glTF textures (no flip). */
  async colorTexture(path: string): Promise<THREE.Texture | null> {
    try {
      const tex = await new THREE.TextureLoader().loadAsync(`${BASE}textures/${path}`);
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    } catch {
      return null;
    }
  }

  /** Loads a furniture model once; null if it isn't available. */
  model(id: string): Promise<Model | null> {
    let model = this.models.get(id);
    if (!model) {
      model = this.manifest.then(async (m) => {
        const info = m?.models[id];
        if (!info) return null;
        try {
          const gltf = await this.gltfLoader.loadAsync(`${BASE}models/${id}.glb`);
          return { scene: gltf.scene, min: new THREE.Vector3(...info.min), max: new THREE.Vector3(...info.max) };
        } catch (err) {
          console.warn(`model ${id} failed to load`, err);
          return null;
        }
      });
      this.models.set(id, model);
    }
    return model;
  }
}

async function loadTextures(manifest: Manifest): Promise<Map<string, TextureSet>> {
  const loader = new THREE.TextureLoader();
  const load = async (name: string, map: string, color: boolean) => {
    const tex = await loader.loadAsync(`${BASE}textures/${name}/${map}.webp`);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  const sets = await Promise.all(
    Object.entries(manifest.textures).map(async ([name, { size }]) => {
      try {
        const [color, normal, arm] = await Promise.all([load(name, 'color', true), load(name, 'normal', false), load(name, 'arm', false)]);
        return [name, { color, normal, arm, size }] as const;
      } catch (err) {
        console.warn(`texture ${name} failed to load`, err);
        return null;
      }
    }),
  );
  return new Map(sets.filter((s) => s !== null));
}
