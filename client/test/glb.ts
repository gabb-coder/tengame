// Loading the game's real models in tests, without their textures (which only a browser can decode).
import { readFileSync } from 'node:fs';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** A model file without its textures. */
export function untextured(file: string): ArrayBuffer {
  const glb = readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
  const strip = (o: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(o)) {
      if (key.endsWith('Texture')) delete o[key];
      else if (value && typeof value === 'object') strip(value as Record<string, unknown>);
    }
  };
  (json.materials ?? []).forEach(strip);
  delete json.textures;
  delete json.images;
  delete json.samplers;
  json.extensionsUsed = json.extensionsUsed?.filter((e: string) => e !== 'EXT_texture_webp');
  json.extensionsRequired = json.extensionsRequired?.filter((e: string) => e !== 'EXT_texture_webp');

  const text = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, ' ')]);
  const bin = glb.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length + bin.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([header, chunk, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

/** One of the game's models (`public/media/models/<name>`), without textures. */
export function loadModel(name: string): Promise<GLTF> {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(untextured(`public/media/models/${name}`), '');
}
