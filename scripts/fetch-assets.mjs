// Downloads the free textures, furniture and car models the game uses, shrinks them for
// the web and writes them to client/public/media, along with media/manifest.json.
//
//   npm run assets
//
// Sources: Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), both CC0 (public
// domain). Raw downloads are cached in .asset-cache/ so re-running is quick.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'client/public/media');
const CACHE = join(ROOT, '.asset-cache');

/**
 * Surface textures, by the name the game uses for them. `size` is how many meters one
 * copy of the texture covers (from the source's own measurements).
 */
const TEXTURES = [
  { name: 'asphalt', from: 'polyhaven', id: 'asphalt_01' },
  { name: 'sidewalk', from: 'polyhaven', id: 'concrete_pavement' },
  { name: 'concrete', from: 'polyhaven', id: 'brushed_concrete_03' },
  { name: 'plaster', from: 'polyhaven', id: 'white_stucco' },
  { name: 'brick', from: 'polyhaven', id: 'large_red_bricks' },
  { name: 'siding', from: 'polyhaven', id: 'white_planks_clean' },
  { name: 'shingles', from: 'polyhaven', id: 'roof_slates_03' },
  { name: 'wood', from: 'polyhaven', id: 'wood_floor' },
  { name: 'tile', from: 'polyhaven', id: 'long_white_tiles' },
  { name: 'bark', from: 'polyhaven', id: 'bark_brown_02' },
  { name: 'grass', from: 'ambientcg', id: 'Grass001', size: 1.4 },
  { name: 'carpet', from: 'ambientcg', id: 'Carpet016', size: 1.7 },
];

/**
 * Furniture models from Poly Haven, with a triangle budget each: dozens of houses are in
 * view at once, so every piece has to be light. (Poly Haven's potted plants are ~45k
 * triangles of separate leaves that can't be simplified, so plants stay generated.)
 */
const MODELS = [
  { id: 'Sofa_01', triangles: 2500 },
  { id: 'sofa_02', triangles: 2500 },
  { id: 'ArmChair_01', triangles: 2000 },
  { id: 'modern_arm_chair_01', triangles: 2000 },
  { id: 'mid_century_lounge_chair', triangles: 2000 },
  { id: 'modern_coffee_table_01', triangles: 1000 },
  { id: 'coffee_table_round_01', triangles: 1000 },
  { id: 'dining_table', triangles: 1200 },
  { id: 'dining_chair_02', triangles: 1000 },
  { id: 'painted_wooden_chair_02', triangles: 1000 },
  { id: 'side_table_01', triangles: 600 },
  { id: 'painted_wooden_nightstand', triangles: 600 },
];

// Poly Haven's API turns away requests without a descriptive user agent.
const HEADERS = { 'user-agent': 'tengame-asset-fetch/1.0 (https://github.com/gabb-coder/tengame)' };

/**
 * The players' car: a concept car from the Khronos glTF samples, by Eric Chadwick
 * (Darmstadt Graphics Group), CC BY 4.0, based on a CC0 model by "Unity Fan".
 */
const CAR = {
  url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',
  source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept',
  license: 'CC BY 4.0, Eric Chadwick / Darmstadt Graphics Group GmbH (from a CC0 model by Unity Fan)',
  triangles: 60000,
};

const TEXTURE_SIZE = 1024;
const MODEL_TEXTURE_SIZE = 512;

async function download(url, file) {
  if (existsSync(file)) return file;
  mkdirSync(dirname(file), { recursive: true });
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function json(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

/** Local paths of a texture's color, normal (OpenGL convention), roughness and AO maps. */
async function fetchTextureSource(t) {
  const dir = join(CACHE, 'textures', t.id);
  if (t.from === 'polyhaven') {
    const files = await json(`https://api.polyhaven.com/files/${t.id}`);
    const info = await json(`https://api.polyhaven.com/info/${t.id}`);
    const get = async (key) => {
      const entry = files[key]?.['1k']?.jpg ?? files[key]?.['1k']?.png;
      return entry ? download(entry.url, join(dir, `${key}.${entry.url.split('.').pop()}`)) : null;
    };
    return {
      size: info.dimensions[0] / 1000,
      color: await get('Diffuse'),
      normal: await get('nor_gl'),
      roughness: await get('Rough'),
      ao: await get('AO'),
    };
  }
  const zip = await download(`https://ambientcg.com/get?file=${t.id}_1K-JPG.zip`, join(dir, 'maps.zip'));
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  const find = (suffix) => {
    const name = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.jpg`));
    return name ? join(dir, name) : null;
  };
  return { size: t.size, color: find('Color'), normal: find('NormalGL'), roughness: find('Roughness'), ao: find('AmbientOcclusion') };
}

/** Writes color.webp, normal.webp and arm.webp (R = AO, G = roughness, B = 0, as three.js reads them). */
async function processTexture(t) {
  const src = await fetchTextureSource(t);
  const dir = join(OUT, 'textures', t.name);
  mkdirSync(dir, { recursive: true });
  const fit = (file) => sharp(file).resize(TEXTURE_SIZE, TEXTURE_SIZE, { fit: 'fill' });
  await fit(src.color).webp({ quality: 82 }).toFile(join(dir, 'color.webp'));
  await fit(src.normal).webp({ quality: 90 }).toFile(join(dir, 'normal.webp'));
  const gray = async (file, fallback) =>
    file ? fit(file).toColourspace('b-w').extractChannel(0).raw().toBuffer() : Buffer.alloc(TEXTURE_SIZE * TEXTURE_SIZE, fallback);
  const [ao, rough] = await Promise.all([gray(src.ao, 255), gray(src.roughness, 200)]);
  const arm = Buffer.alloc(TEXTURE_SIZE * TEXTURE_SIZE * 3);
  for (let i = 0; i < TEXTURE_SIZE * TEXTURE_SIZE; i++) {
    arm[i * 3] = ao[i];
    arm[i * 3 + 1] = rough[i];
  }
  await sharp(arm, { raw: { width: TEXTURE_SIZE, height: TEXTURE_SIZE, channels: 3 } })
    .webp({ quality: 85 })
    .toFile(join(dir, 'arm.webp'));
  return { size: Math.round(src.size * 1000) / 1000, source: sourceUrl(t.from, t.id) };
}

async function processModel(io, m) {
  const files = await json(`https://api.polyhaven.com/files/${m.id}`);
  const gltf = files.gltf['1k'].gltf;
  const dir = join(CACHE, 'models', m.id);
  const main = await download(gltf.url, join(dir, gltf.url.split('/').pop()));
  for (const [path, entry] of Object.entries(gltf.include ?? {})) await download(entry.url, join(dir, path));

  const doc = await io.read(main);
  const triangles = doc
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  await doc.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, m.triangles / triangles), error: 0.02 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [MODEL_TEXTURE_SIZE, MODEL_TEXTURE_SIZE], quality: 82 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(OUT, 'models', `${m.id}.glb`);
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  const { min, max } = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  const round = (v) => v.map((n) => Math.round(n * 1000) / 1000);
  return { min: round(min), max: round(max), source: sourceUrl('polyhaven', m.id) };
}

/**
 * The car: drops the Khronos logo (it was on the license plate and badges), swaps the
 * costly see-through glass for tinted transparent glass, removes paint variants, and
 * simplifies it to a budget fit for four cars on screen.
 */
async function processCar(io) {
  const file = await download(CAR.url, join(CACHE, 'car', 'CarConcept.glb'));
  const doc = await io.read(file);
  const root = doc.getRoot();
  for (const name of ['KHR_materials_variants', 'KHR_materials_transmission', 'KHR_materials_iridescence']) {
    root.listExtensionsUsed().find((e) => e.extensionName === name)?.dispose();
  }
  const plate = root.listMaterials().find((m) => m.getName() === 'License');
  const logo = plate?.getBaseColorTexture();
  if (logo) {
    const white = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer();
    logo.setImage(white).setMimeType('image/png');
    for (const m of root.listMaterials()) {
      if (m.getEmissiveTexture() === logo) m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
    }
  }
  const glass = root.listMaterials().find((m) => m.getName() === 'Glass');
  glass?.setBaseColorFactor([0.06, 0.08, 0.1, 0.45]).setAlphaMode('BLEND').setRoughnessFactor(0.05).setMetallicFactor(0);
  const triangles = root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  await doc.transform(
    prune(),
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, CAR.triangles / triangles), error: 0.004 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = join(OUT, 'models', 'car.glb');
  mkdirSync(dirname(out), { recursive: true });
  await io.write(out, doc);
  const { min, max } = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  const round = (v) => v.map((n) => Math.round(n * 1000) / 1000);
  return { min: round(min), max: round(max), source: CAR.source, license: CAR.license };
}

function sourceUrl(from, id) {
  return from === 'polyhaven' ? `https://polyhaven.com/a/${id}` : `https://ambientcg.com/view?id=${id}`;
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO(fetch).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

rmSync(OUT, { recursive: true, force: true });
const manifest = { license: 'CC0 1.0 (public domain) unless an entry says otherwise', textures: {}, models: {} };
for (const t of TEXTURES) {
  manifest.textures[t.name] = await processTexture(t);
  console.log('texture', t.name, '<-', t.id);
}
for (const m of MODELS) {
  manifest.models[m.id] = await processModel(io, m);
  console.log('model', m.id);
}
manifest.models.car = await processCar(io);
console.log('model car');
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const total = execFileSync('du', ['-sh', OUT]).toString().split('\t')[0];
console.log(`wrote ${OUT} (${total})`);
