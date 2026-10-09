import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const tri = (m) => m.listPrimitives().reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
function walk(node, depth) {
  const m = node.getMesh();
  const b = m ? getBounds(node) : null;
  console.log('  '.repeat(depth) + node.getName(), m ? `mesh tris=${tri(m)} mats=${m.listPrimitives().map(p=>p.getMaterial()?.getName()).join(',')}` : '', b ? `min=${b.min.map(v=>v.toFixed(2))} max=${b.max.map(v=>v.toFixed(2))}` : '', node.getTranslation().map(v=>+v.toFixed(2)).join(','), node.getRotation().map(v=>+v.toFixed(2)).join(','), node.getScale().map(v=>+v.toFixed(2)).join(','));
  for (const c of node.listChildren()) walk(c, depth + 1);
}
for (const s of root.listScenes()) for (const n of s.listChildren()) walk(n, 0);
console.log('materials', root.listMaterials().map(m => m.getName()).join(' | '));
console.log('textures', root.listTextures().map(t => `${t.getName()||t.getURI()} ${t.getMimeType()} ${t.getImage()?.byteLength}`).join('\n'));
console.log('extensions', root.listExtensionsUsed().map(e=>e.extensionName).join(','));
console.log('animations', root.listAnimations().map(a=>a.getName()).join(','), 'skins', root.listSkins().length);
