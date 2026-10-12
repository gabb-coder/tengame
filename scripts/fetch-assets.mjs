// Downloads the free textures, furniture, car and people the game uses, shrinks them for
// the web and writes them to client/public/media, along with media/manifest.json.
//
//   npm run assets            everything
//   npm run assets -- people  just the people and their animations
//
// Sources: Poly Haven (polyhaven.com) and ambientCG (ambientcg.com), both CC0 (public
// domain). Raw downloads are cached in .asset-cache/ so re-running is quick.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { readSkeleton, rebindPerson } from './people.mjs';

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
  // The themed zones around the town. These load after the game starts ("lazy").
  // Ground covers are larger (1024 px); building surfaces are 512 px.
  { name: 'snow', from: 'polyhaven', id: 'snow_02', lazy: true },
  { name: 'forest', from: 'polyhaven', id: 'forrest_ground_01', lazy: true },
  { name: 'sand', from: 'polyhaven', id: 'sand_01', lazy: true, stretch: 3 },
  { name: 'beach', from: 'polyhaven', id: 'coast_sand_01', lazy: true },
  { name: 'volcanic', from: 'polyhaven', id: 'burned_ground_01', lazy: true, stretch: 2.5 },
  { name: 'alien', from: 'polyhaven', id: 'cracked_red_ground', lazy: true },
  { name: 'rock', from: 'polyhaven', id: 'rock_face', lazy: true, res: 512 },
  { name: 'darkRock', from: 'polyhaven', id: 'dark_rock', lazy: true, res: 512 },
  { name: 'cobble', from: 'polyhaven', id: 'cobblestone_floor_01', lazy: true, res: 512 },
  { name: 'dirt', from: 'polyhaven', id: 'rocky_trail', lazy: true, res: 512 },
  { name: 'paving', from: 'polyhaven', id: 'large_sandstone_blocks', lazy: true, res: 512 },
  { name: 'metal', from: 'polyhaven', id: 'metal_plate', lazy: true, res: 512 },
  { name: 'castle', from: 'polyhaven', id: 'castle_wall_slates', lazy: true, res: 512 },
  { name: 'timber', from: 'polyhaven', id: 'medieval_wall_01', lazy: true, res: 512 },
  { name: 'thatch', from: 'polyhaven', id: 'thatch_roof_angled', lazy: true, res: 512 },
  { name: 'log', from: 'polyhaven', id: 'wood_trunk_wall', lazy: true, res: 512 },
  { name: 'sandstone', from: 'polyhaven', id: 'sandstone_blocks_08', lazy: true, res: 512 },
  { name: 'marble', from: 'polyhaven', id: 'marble_01', lazy: true, res: 512 },
  { name: 'clay', from: 'polyhaven', id: 'clay_roof_tiles', lazy: true, res: 512 },
  { name: 'planks', from: 'polyhaven', id: 'brown_planks_03', lazy: true, res: 512 },
  { name: 'mossy', from: 'polyhaven', id: 'mossy_stone_wall', lazy: true, res: 512 },
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

/**
 * How people move: Quaternius "Universal Animation Library" (CC0). itch.io doesn't allow
 * scripted downloads, so get the free [Standard] zip from
 * https://quaternius.itch.io/universal-animation-library and put it in .asset-cache/humans
 * as ual.zip. Without it, people keep their simple stand-in bodies.
 */
const HUMANS = {
  dir: 'humans',
  /** Clips kept from the 43 in the library; walk/jog/sprint speeds are measured from its root-motion version. */
  clips: [
    ...['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Sitting_Idle_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop'],
    // Emotes and things people do: dancing, talking, pressing buttons, picking things up,
    // fencing, holding a torch, fixing things, casting spells, driving, getting hit, punching.
    ...['Dance_Loop', 'Idle_Talking_Loop', 'Sitting_Talking_Loop', 'Interact', 'PickUp_Table', 'Sword_Idle', 'Sword_Attack', 'Idle_Torch_Loop'],
    // (Kneeling is also the halfway point of getting up after being knocked flat.)
    ...['Fixing_Kneeling', 'Crouch_Idle_Loop', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Driving_Loop', 'Hit_Chest', 'Hit_Head'],
    // (The library has no kick: that one is made up from the standing pose, see Human.)
    ...['Punch_Jab', 'Punch_Cross'],
  ],
  moving: ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Swim_Fwd_Loop'],
};

/**
 * Who people are: realistic, clothed men and women from the Microsoft Rocketbox avatar
 * library (MIT license, https://github.com/microsoft/Microsoft-Rocketbox), refitted to the
 * animation library's skeleton (see people.mjs). Everyday clothes for players and passers-by;
 * the rest are people the game dresses by name (uniforms, costumes under armor).
 */
const PEOPLE = {
  url: 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars',
  everyday: ['Male_Adult_01', 'Male_Adult_04', 'Male_Adult_06', 'Male_Adult_08', 'Male_Adult_10', 'Male_Adult_12', 'Female_Adult_01', 'Female_Adult_04', 'Female_Adult_05', 'Female_Adult_08', 'Female_Adult_12', 'Female_Adult_17'].map((n) => `Adults/${n}`),
  named: [
    ...['Male_Adult_03', 'Male_Adult_05', 'Male_Adult_14', 'Female_Adult_06', 'Female_Party_01', 'Female_Party_02'].map((n) => `Adults/${n}`),
    ...['Police_Male_02', 'Medical_Male_02', 'Medical_Female_03', 'Delivery_Male_01', 'Gardener_Male_01', 'Business_Female_01'].map((n) => `Professions/${n}`),
  ],
  /** Texture sizes: the body's clothes, the face, normal maps, and cut-outs (hair, lashes). */
  sizes: { body: 1024, head: 512, normal: 512, cutout: 512 },
};

const DEFAULT_TEXTURE_SIZE = 1024;
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
  const TEXTURE_SIZE = t.res ?? DEFAULT_TEXTURE_SIZE;
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
  // `stretch` spreads a small texture over more ground, so it repeats less.
  const size = Math.round(src.size * (t.stretch ?? 1) * 1000) / 1000;
  return { size, source: sourceUrl(t.from, t.id), ...(t.lazy ? { lazy: true } : {}) };
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

/** Finds `name` anywhere under `dir`, preferring paths that contain `prefer`. */
function findFile(dir, name, prefer = '') {
  const hits = [];
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name === name) hits.push(p);
    }
  };
  walk(dir);
  return hits.find((p) => p.includes(prefer)) ?? hits[0];
}

/** The animations people share, and how fast each moving one goes. */
async function processHumans(io) {
  const cache = join(CACHE, HUMANS.dir);
  const zip = join(cache, 'ual.zip');
  if (!existsSync(zip)) {
    console.log('people: skipped (put ual.zip in .asset-cache/humans, see HUMANS in this script)');
    return null;
  }
  if (!existsSync(join(cache, 'ual'))) execFileSync('unzip', ['-o', '-q', zip, '-d', join(cache, 'ual')]);
  const out = join(OUT, 'models');
  mkdirSync(out, { recursive: true });
  const result = { license: 'People: MIT, Microsoft (Rocketbox). Animations: CC0, Quaternius.', source: 'https://github.com/microsoft/Microsoft-Rocketbox', people: [], clips: {} };

  // Animations: just the clips we use, without the library's mannequin mesh.
  const library = findFile(join(cache, 'ual'), 'UAL1_Standard.glb');
  const anims = await io.read(library);
  const skeleton = readSkeleton(anims.getRoot().listNodes().find((n) => n.getName() === 'root'));
  const all = anims.getRoot().listAnimations();
  const kept = new Set(all.filter((a) => HUMANS.clips.includes(a.getName())).flatMap((a) => a.listSamplers().flatMap((s) => [s.getInput(), s.getOutput()])));
  for (const a of all) {
    if (HUMANS.clips.includes(a.getName())) continue;
    // Disposing an animation leaves its keyframe data behind; drop what no kept clip shares.
    for (const s of a.listSamplers()) for (const data of [s.getInput(), s.getOutput()]) if (data && !kept.has(data)) data.dispose();
    a.dispose();
  }
  for (const m of anims.getRoot().listMeshes()) m.dispose();
  for (const n of anims.getRoot().listNodes()) n.setMesh(null).setSkin(null);
  await anims.transform(prune({ keepLeaves: true }), resample({ tolerance: 2e-4 }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(out, 'human_anims.glb'), anims);

  // Natural speed of each moving clip, from the root-motion version: distance the root
  // bone travels per second. Matching it to the player's speed keeps feet from sliding.
  const rm = await io.read(findFile(join(cache, 'ual'), 'UAL1_Standard_RM.glb'));
  for (const a of rm.getRoot().listAnimations()) {
    if (!HUMANS.moving.includes(a.getName())) continue;
    const ch = a.listChannels().find((c) => c.getTargetNode()?.getName() === 'root' && c.getTargetPath() === 'translation');
    const s = ch?.getSampler();
    if (!s) continue;
    const t = s.getInput().getArray();
    const v = s.getOutput().getArray();
    const n = t.length - 1;
    const dist = Math.hypot(v[n * 3] - v[0], v[n * 3 + 2] - v[2], v[n * 3 + 1] - v[1]);
    result.clips[a.getName()] = { speed: Math.round((dist / (t[n] - t[0])) * 1000) / 1000 };
  }

  // The people, on that skeleton.
  for (const path of [...PEOPLE.everyday, ...PEOPLE.named]) {
    const name = path.split('/').pop();
    const dir = join(CACHE, 'people', name);
    const fetchOnce = async (file, from) => {
      const at = join(dir, file);
      if (existsSync(at)) return readFileSync(at);
      const res = await fetch(`${PEOPLE.url}/${path}/${from}/${file}`, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} for ${path}/${file}`);
      mkdirSync(dir, { recursive: true });
      const data = Buffer.from(await res.arrayBuffer());
      writeFileSync(at, data);
      return data;
    };
    const { doc, height } = await rebindPerson({
      fbx: await fetchOnce(`${name}.fbx`, 'Export'),
      texture: (file) => fetchOnce(file, 'Textures'),
      skeleton,
      sizes: PEOPLE.sizes,
      name,
    });
    await doc.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    await io.write(join(out, `person_${name}.glb`), doc);
    result.people.push({ name, body: name.includes('Female') ? 'female' : 'male', height, everyday: PEOPLE.everyday.includes(path) });
    console.log('person', name, `${height} m`);
  }
  return result;
}

function sourceUrl(from, id) {
  return from === 'polyhaven' ? `https://polyhaven.com/a/${id}` : `https://ambientcg.com/view?id=${id}`;
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO(fetch).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

if (process.argv[2] === 'people') {
  // Just the people: the rest of the media stays as it is.
  const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'));
  for (const old of readdirSync(join(OUT, 'models'))) if (/^(person_|human_|hair_)/.test(old)) rmSync(join(OUT, 'models', old));
  rmSync(join(OUT, 'textures', 'humans'), { recursive: true, force: true });
  manifest.humans = (await processHumans(io)) ?? undefined;
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('people:', manifest.humans?.people.length ?? 0, JSON.stringify(manifest.humans?.clips));
  process.exit(0);
}

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
const humans = await processHumans(io);
if (humans) {
  manifest.humans = humans;
  console.log('people:', humans.people.length, JSON.stringify(humans.clips));
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const total = execFileSync('du', ['-sh', OUT]).toString().split('\t')[0];
console.log(`wrote ${OUT} (${total})`);
