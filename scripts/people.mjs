// Realistic people from the Microsoft Rocketbox avatar library (MIT license), refitted to
// the skeleton of the Universal Animation Library so its clips play on them unchanged.
//
// Rocketbox people are 3ds Max "biped" rigs: other bone names, other bone axes, other
// proportions. Each one is rebound to the animation library's skeleton: that skeleton is
// posed to match the person as modeled (every bone turned to lie along the same limb, and
// moved to the same joint), bound there, and each of the person's bones hands its share of
// the skin to the matching bone. The clips then turn the same joints the same way, on this
// person's own proportions.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
import sharp from 'sharp';

/** The Rocketbox bone (without its "Bip01_" prefix) for each bone of the animation skeleton. */
const BIPED = { pelvis: 'Pelvis', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', Head: 'Head' };
for (const [s, S] of [
  ['l', 'L'],
  ['r', 'R'],
]) {
  Object.assign(BIPED, {
    [`clavicle_${s}`]: `${S}_Clavicle`,
    [`upperarm_${s}`]: `${S}_UpperArm`,
    [`lowerarm_${s}`]: `${S}_Forearm`,
    [`hand_${s}`]: `${S}_Hand`,
    [`thigh_${s}`]: `${S}_Thigh`,
    [`calf_${s}`]: `${S}_Calf`,
    [`foot_${s}`]: `${S}_Foot`,
    [`ball_${s}`]: `${S}_Toe0`,
  });
  // Biped fingers: Finger0 (thumb) to Finger4 (little finger), then 01, 02 for the next joints.
  ['thumb', 'index', 'middle', 'ring', 'pinky'].forEach((finger, i) =>
    ['', '1', '2'].forEach((joint, j) => {
      BIPED[`${finger}_0${j + 1}_${s}`] = `${S}_Finger${i}${joint}`;
    }),
  );
}

/**
 * How each bone is turned to lie along the person's limb: toward the joint it leads to,
 * and (where a bone has a clear width, like the hips or a hand) with its sides level with theirs.
 */
const AIM = { pelvis: ['spine_01', 'thigh_l', 'thigh_r'], spine_01: ['spine_02'], spine_02: ['spine_03'], spine_03: ['neck_01', 'clavicle_l', 'clavicle_r'], neck_01: ['Head'] };
for (const s of ['l', 'r']) {
  Object.assign(AIM, {
    [`clavicle_${s}`]: [`upperarm_${s}`],
    [`upperarm_${s}`]: [`lowerarm_${s}`],
    [`lowerarm_${s}`]: [`hand_${s}`],
    [`hand_${s}`]: [`middle_01_${s}`, `index_01_${s}`, `pinky_01_${s}`],
    [`thigh_${s}`]: [`calf_${s}`],
    [`calf_${s}`]: [`foot_${s}`],
    [`foot_${s}`]: [`ball_${s}`],
  });
  for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    AIM[`${finger}_01_${s}`] = [`${finger}_02_${s}`];
    AIM[`${finger}_02_${s}`] = [`${finger}_03_${s}`];
  }
}

/**
 * The animation skeleton, parents first: name, parent, and its pose at rest (offset and
 * turn from its parent). `root` is the node named "root" in a glTF document.
 */
export function readSkeleton(root) {
  const bones = [];
  const walk = (node, parent) => {
    bones.push({
      name: node.getName(),
      parent,
      t: new THREE.Vector3(...node.getTranslation()),
      r: new THREE.Quaternion(...node.getRotation()),
    });
    for (const child of node.listChildren()) walk(child, node.getName());
  };
  walk(root, null);
  return bones;
}

/** Reads a TGA into raw RGBA, top row first. */
function readTga(buffer) {
  const { width, height, data } = new TGALoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return { width, height, data: Buffer.from(data.buffer, data.byteOffset, width * height * 4) };
}

async function webp(tga, size, alpha = false) {
  const { width, height, data } = readTga(tga);
  let image = sharp(data, { raw: { width, height, channels: 4 } }).resize(size, size);
  if (!alpha) image = image.removeAlpha();
  return image.webp({ quality: 82, alphaQuality: 90 }).toBuffer();
}

/**
 * One person as a glTF document on the animation skeleton (`skeleton`, see readSkeleton),
 * scaled so their hips are at the skeleton's hip height, and how tall they really are (m).
 * `fbx` is their FBX; `texture(file)` fetches one of their TGA maps (null if there's none);
 * `sizes` are the texture sizes to write (body, head, normal maps, cut-outs like hair).
 */
export async function rebindPerson({ fbx, texture, skeleton, sizes, name }) {
  // The loader asks for textures; they're read separately, so it gets blanks.
  const manager = new THREE.LoadingManager();
  manager.addHandler(/.*/, { load: () => new THREE.Texture(), setPath() { return this; }, setCrossOrigin() { return this; } });
  const group = new FBXLoader(manager).parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength), '');
  group.updateMatrixWorld(true);
  let mesh = null;
  group.traverse((o) => {
    if (o.isSkinnedMesh && !mesh) mesh = o;
  });
  const bipedBones = mesh.skeleton.bones;

  // Where each of the person's joints is, as modeled (in meters, standing on y = 0, facing +Z).
  const bindOf = (i) => mesh.skeleton.boneInverses[i].clone().invert();
  const joint = new Map();
  bipedBones.forEach((b, i) => joint.set(b.name, new THREE.Vector3().setFromMatrixPosition(bindOf(i)).multiplyScalar(0.01)));
  const theirs = (bone) => BIPED[bone] && joint.get(`Bip01_${BIPED[bone]}`);

  // The animation skeleton at rest, to scale the person to its hip height.
  const rest = new Map();
  for (const b of skeleton) {
    const parent = rest.get(b.parent);
    const R = parent ? parent.R.clone().multiply(b.r) : b.r.clone();
    const X = parent ? parent.X.clone().add(b.t.clone().applyQuaternion(parent.R)) : b.t.clone();
    rest.set(b.name, { R, X });
  }
  const scale = rest.get('pelvis').X.y / theirs('pelvis').y;
  for (const p of joint.values()) p.multiplyScalar(scale);
  const top = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(mesh.bindMatrix).max.y;
  const height = Math.round(top) / 100;

  // Pose the animation skeleton on the person, parents first.
  const posed = new Map();
  for (const b of skeleton) {
    const parent = posed.get(b.parent);
    let R = parent ? parent.R.clone().multiply(b.r) : b.r.clone();
    // A bone with no joint of theirs (finger tips, toe tips) keeps its length, stretched like its parent's.
    const X = theirs(b.name)?.clone() ?? (parent ? parent.X.clone().add(b.t.clone().multiplyScalar(parent.stretch).applyQuaternion(parent.R)) : b.t.clone());
    let stretch = parent?.stretch ?? 1;
    const aim = AIM[b.name];
    const child = aim && skeleton.find((c) => c.name === aim[0]);
    if (child && theirs(child.name)) {
      const want = theirs(child.name).clone().sub(X);
      stretch = want.length() / child.t.length();
      let have = child.t.clone().normalize().applyQuaternion(R);
      const turn = new THREE.Quaternion().setFromUnitVectors(have, want.clone().normalize());
      R = turn.multiply(R);
      if (aim.length === 3) {
        // Then about that line, to bring the sides level: from one side joint to the other.
        const [a, c] = [aim[1], aim[2]].map((n) => skeleton.find((s) => s.name === n));
        const along = want.clone().normalize();
        have = a.t.clone().sub(c.t).applyQuaternion(R);
        const side = theirs(a.name).clone().sub(theirs(c.name));
        for (const v of [have, side]) v.addScaledVector(along, -v.dot(along)).normalize();
        const angle = Math.atan2(along.dot(new THREE.Vector3().crossVectors(have, side)), have.dot(side));
        R = new THREE.Quaternion().setFromAxisAngle(along, angle).multiply(R);
      }
    }
    posed.set(b.name, { R, X, stretch });
  }

  // Bones of theirs with no match (the face, the root) go with their nearest matched ancestor.
  const ours = new Map(Object.entries(BIPED).map(([bone, biped]) => [`Bip01_${biped}`, bone]));
  const index = new Map(skeleton.map((b, i) => [b.name, i]));
  const target = bipedBones.map((b) => {
    for (let o = b; o; o = o.parent) if (ours.has(o.name)) return index.get(ours.get(o.name));
    return index.get('pelvis');
  });

  // The skin: positions and normals as modeled, its weights handed to the matching bones.
  const toWorld = mesh.bindMatrix.clone().premultiply(new THREE.Matrix4().makeScale(0.01 * scale, 0.01 * scale, 0.01 * scale));
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrix);
  const geometry = mesh.geometry;
  const materials = [mesh.material].flat();
  const parts = materials.map(() => []);
  for (const g of geometry.groups) parts[g.materialIndex ?? 0].push(g);
  const primitives = [];
  materials.forEach((material, m) => {
    const groups = parts[m];
    const count = groups.reduce((n, g) => n + g.count, 0);
    if (!count) return;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const joints = new Float32Array(count * 4);
    const weights = new Float32Array(count * 4);
    const v = new THREE.Vector3();
    let k = 0;
    for (const g of groups) {
      for (let i = g.start; i < g.start + g.count; i++, k++) {
        v.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(toWorld).toArray(position, k * 3);
        v.fromBufferAttribute(geometry.attributes.normal, i).applyMatrix3(normalMatrix).normalize().toArray(normal, k * 3);
        // glTF counts texture rows from the top.
        uv[k * 2] = geometry.attributes.uv.getX(i);
        uv[k * 2 + 1] = 1 - geometry.attributes.uv.getY(i);
        const share = new Map();
        for (let j = 0; j < 4; j++) {
          const w = geometry.attributes.skinWeight.getComponent(i, j);
          if (w <= 0) continue;
          const bone = target[geometry.attributes.skinIndex.getComponent(i, j)];
          share.set(bone, (share.get(bone) ?? 0) + w);
        }
        const top = [...share].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
        top.forEach(([bone, w], j) => {
          joints[k * 4 + j] = bone;
          weights[k * 4 + j] = w / sum;
        });
      }
    }
    const part = new THREE.BufferGeometry();
    part.setAttribute('position', new THREE.BufferAttribute(position, 3));
    part.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    part.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    part.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
    part.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    primitives.push({ material: material.name, geometry: mergeVertices(part, 1e-5) });
  });

  // The document: the skeleton (at the animations' rest turns, on this person's
  // proportions), bound where it was posed, and the skin.
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(true);
  const buffer = doc.createBuffer();
  const scene = doc.createScene(name);
  const nodes = new Map();
  for (const b of skeleton) {
    const parent = posed.get(b.parent);
    const p = posed.get(b.name);
    // The offset from the parent, in the parent's own frame: it holds however the parent turns.
    const t = parent ? p.X.clone().sub(parent.X).applyQuaternion(parent.R.clone().invert()) : p.X.clone();
    const node = doc.createNode(b.name).setTranslation(t.toArray()).setRotation(b.r.toArray());
    nodes.set(b.name, node);
    if (b.parent) nodes.get(b.parent).addChild(node);
    else scene.addChild(node);
  }
  const ibm = new Float32Array(skeleton.length * 16);
  skeleton.forEach((b, i) => {
    const { R, X } = posed.get(b.name);
    new THREE.Matrix4().compose(X, R, new THREE.Vector3(1, 1, 1)).invert().toArray(ibm, i * 16);
  });
  const skin = doc.createSkin().setSkeleton(nodes.get(skeleton[0].name));
  for (const b of skeleton) skin.addJoint(nodes.get(b.name));
  skin.setInverseBindMatrices(doc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buffer));

  const tex = async (file, size, alpha) => {
    const data = await texture(file);
    return data ? doc.createTexture(file).setImage(await webp(data, size, alpha)).setMimeType('image/webp') : null;
  };
  const body = doc.createMesh(name);
  for (const { material, geometry: g } of primitives) {
    // m002_body: m002_body_color.tga and m002_body_normal.tga; m002_opacity: m002_opacity_color.tga.
    const cutout = material.endsWith('_opacity');
    const head = material.endsWith('_head');
    const mat = doc.createMaterial(material).setMetallicFactor(0).setRoughnessFactor(head ? 0.62 : 0.82);
    const color = await tex(`${material}_color.tga`, cutout ? sizes.cutout : head ? sizes.head : sizes.body, cutout);
    if (color) mat.setBaseColorTexture(color);
    if (!cutout) {
      const normal = await tex(`${material}_normal.tga`, sizes.normal, false);
      if (normal) mat.setNormalTexture(normal);
    } else mat.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    const accessor = (attr, type, array) => doc.createAccessor(attr).setType(type).setArray(array).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setMaterial(mat)
      .setIndices(accessor('indices', 'SCALAR', new Uint32Array(g.index.array)))
      .setAttribute('POSITION', accessor('position', 'VEC3', g.attributes.position.array))
      .setAttribute('NORMAL', accessor('normal', 'VEC3', g.attributes.normal.array))
      .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2', g.attributes.uv.array))
      .setAttribute('JOINTS_0', accessor('joints', 'VEC4', Uint8Array.from(g.attributes.skinIndex.array)))
      .setAttribute('WEIGHTS_0', accessor('weights', 'VEC4', g.attributes.skinWeight.array));
    body.addPrimitive(prim);
  }
  scene.addChild(doc.createNode(name).setMesh(body).setSkin(skin));
  doc.getRoot().setDefaultScene(scene);
  return { doc, height };
}
