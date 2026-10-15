/**
 * Build the served client bundle.
 *
 * The Host serves one file per plugin (`./client` from the package exports), so the
 * vendored KaTeX build and our panel source are concatenated into `client.js`.
 * Sources stay separate for review; this script is the only writer of the artifact.
 *
 *   node build.mjs           rebuild client.js
 *   node build.mjs --check   fail when client.js is missing or out of date
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcPath = join(here, 'src', 'client.js');
const katexPath = join(here, 'vendor', 'katex.min.js');
const outPath = join(here, 'client.js');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const [source, katex] = await Promise.all([
  readFile(srcPath, 'utf8'),
  readFile(katexPath, 'utf8'),
]);

const banner = [
  '/* GENERATED FILE — do not edit.',
  ` * vendor/katex.min.js  sha256:${sha256(katex)}  (KaTeX 0.16.22, MIT — see vendor/katex.LICENSE)`,
  ` * src/client.js        sha256:${sha256(source)}`,
  ' * rebuild: node build.mjs',
  ' */',
  '',
].join('\n');

const bundle = `${banner}${katex}\n${source}`;

if (process.argv.includes('--check')) {
  let current = null;
  try {
    current = await readFile(outPath, 'utf8');
  } catch (error) {
    console.error('build.mjs --check: client.js is missing — run `node build.mjs`');
    process.exit(1);
  }
  if (current !== bundle) {
    console.error('build.mjs --check: client.js is out of date — run `node build.mjs`');
    process.exit(1);
  }
  console.log(`build.mjs --check: client.js is up to date (${bundle.length} bytes)`);
  process.exit(0);
}

await writeFile(outPath, bundle, 'utf8');
console.log(`client.js written: ${bundle.length} bytes (katex ${katex.length} + source ${source.length})`);
