// Writes Brotli (.br) and gzip (.gz) copies of the built client's text and wasm files,
// so the server can send them compressed without spending CPU on every request.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = new URL('../client/dist/', import.meta.url).pathname;
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.wasm', '.svg']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else yield path;
  }
}

let before = 0;
let after = 0;
for (const file of files(DIST)) {
  if (!COMPRESSIBLE.has(extname(file))) continue;
  const data = readFileSync(file);
  const br = brotliCompressSync(data, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
  });
  writeFileSync(`${file}.br`, br);
  writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
  before += data.length;
  after += br.length;
}
console.log(`compressed client: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB (brotli)`);
