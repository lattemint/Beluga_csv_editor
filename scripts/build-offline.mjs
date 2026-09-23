/**
 * Offline build: no bundler, no node_modules, no network.
 *
 * Uses Node's built-in TypeScript type stripping (node:module.stripTypeScriptTypes)
 * to turn src/**\/*.ts into browser-loadable dist/src/**\/*.js, copies CSS,
 * and rewrites index.html entry paths.
 *
 * The emitted modules keep their real ESM import graph, so the browser loads
 * them natively via <script type="module">. Same src/ tree that Vite consumes
 * once `pnpm install` is possible.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Node prints an ExperimentalWarning the first time stripTypeScriptTypes is used.
// It is the intended API for this offline path, so keep the output clean whether
// this script is run through npm (which also passes --disable-warning) or directly.
const nativeEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const options = rest[0];
  const type = typeof options === 'string' ? options : options && options.type;
  const message = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (type === 'ExperimentalWarning' && String(message).includes('stripTypeScriptTypes')) return;
  return nativeEmitWarning(warning, ...rest);
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

let tsFiles = 0;
let cssFiles = 0;

/** Rewrite `.ts` specifiers to `.js` so the browser can resolve them. */
function rewriteSpecifiers(code) {
  return code
    .replace(/(\bfrom\s*['"])([^'"]+)\.ts(['"])/g, '$1$2.js$3')
    .replace(/(\bimport\s*['"])([^'"]+)\.ts(['"])/g, '$1$2.js$3')
    .replace(/(\bimport\s*\(\s*['"])([^'"]+)\.ts(['"])/g, '$1$2.js$3');
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const rel = relative(root, full).replace(/\\/g, '/');
    const out = join(distDir, rel);
    mkdirSync(dirname(out), { recursive: true });

    if (name.endsWith('.d.ts')) {
      continue; // ambient declarations only: nothing to emit for the browser
    }
    if (name.endsWith('.ts')) {
      const source = readFileSync(full, 'utf8');
      const js = rewriteSpecifiers(stripTypeScriptTypes(source, { mode: 'strip' }));
      writeFileSync(out.replace(/\.ts$/, '.js'), js, 'utf8');
      tsFiles += 1;
    } else if (name.endsWith('.css')) {
      writeFileSync(out, readFileSync(full, 'utf8'), 'utf8');
      cssFiles += 1;
    }
  }
}

walk(srcDir);

let html = readFileSync(join(root, 'index.html'), 'utf8');
// Rewrite only the two asset attributes. A blanket `.ts"` -> `.js"` would also
// touch unrelated text such as the inline no-flash theme script.
html = html
  .replace(/(src|href)="\/src\/([^"]+)\.ts"/g, '$1="./src/$2.js"')
  .replace(/(src|href)="\/src\/([^"]+)"/g, '$1="./src/$2"');
writeFileSync(join(distDir, 'index.html'), html, 'utf8');

// Dev-only probe pages: a visual verification harness for environments without
// a browser dev server. Copied to dist/.probe/ so they can be screenshotted.
const probeDir = join(root, 'dev', 'probes');
let probes = 0;
if (existsSync(probeDir)) {
  const outDir = join(distDir, '.probe');
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(probeDir)) {
    if (!name.endsWith('.html')) continue;
    writeFileSync(join(outDir, name), readFileSync(join(probeDir, name), 'utf8'), 'utf8');
    probes += 1;
  }
}

// Fixtures the probe pages fetch. Copied byte-for-byte.
const fixtureDir = join(root, 'dev', 'fixtures');
let fixtures = 0;
if (existsSync(fixtureDir)) {
  const outDir = join(distDir, '.probe', 'fixtures');
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(fixtureDir)) {
    writeFileSync(join(outDir, name), readFileSync(join(fixtureDir, name)));
    fixtures += 1;
  }
}

console.log(
  `[offline build] dist/ ready — ${tsFiles} .ts -> .js, ${cssFiles} .css copied, ` +
    `${probes} probe page(s), ${fixtures} fixture(s)`,
);
