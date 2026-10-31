import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, cp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ASSETS = '/_hitchhike-assets/';
const ENTRY = 'src/app.js';
const ASSETS = [
  'styles.css', ENTRY, 'src/demo.js', 'src/sign.js', 'src/motion.js',
  'assets/hitchhike-bus-logo.png', 'assets/hitchhike-bus-mark.png', 'assets/hitchhike-bus-conversation.png',
  'assets/hitchhike-share.jpg', 'assets/hitchhike-wordmark.png', 'assets/hitchhike-bus-mark.svg',
  ...['chatgpt.svg', 'muse.svg', 'grok-bot.svg', 'claude.svg', 'grok.png', 'codex.png', 'claude-code.png', 'droid.svg', 'omp.svg',
    'pi.svg', 'openclaw.svg']
    .map((name) => 'assets/agents/' + name),
  ...['InterDisplay-ExtraBold', 'InterDisplay-SemiBold', 'Inter-Regular', 'Inter-Medium', 'Inter-SemiBold',
    'JetBrainsMono-Medium', 'JetBrainsMono-SemiBold']
    .map((name) => `assets/fonts/${name}.woff2`),
];
const MODULES = ASSETS.filter((path) => path.startsWith('src/') && path !== ENTRY);
// Static `from './x.js'`, side-effect `import './x.js'` and dynamic `import('./x.js')` specifiers.
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([^'"]+)\2/;
const CSS_ASSET_URL = /url\(\s*(['"]?)\.\/(assets\/[^'")\s]+)\1\s*\)/g;
const digest = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

export async function buildLanding({ root = defaultRoot, output = resolve(root, 'dist') } = {}) {
  const generated = new Map();
  function addAsset(source, content) {
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const extension = extname(source);
    const filename = `${basename(source, extension)}.${digest(bytes)}${extension}`;
    generated.set(source, { filename, bytes });
    return filename;
  }

  // Hash dependencies before their dependants. An entry's hash must cover its
  // final import URLs, so changing demo.js also changes the module the HTML
  // requests; the stylesheet's hash likewise covers its font and image URLs.
  for (const source of ASSETS.filter((path) => path !== 'styles.css' && !path.startsWith('src/'))) {
    addAsset(source, await readFile(resolve(root, source)));
  }
  for (const source of MODULES) {
    const module = await readFile(resolve(root, source), 'utf8');
    assert.doesNotMatch(module, RELATIVE_IMPORT, `${source} must not import relative modules; only ${ENTRY} is rewritten`);
    addAsset(source, module);
  }
  const imported = new Set();
  const app = (await readFile(resolve(root, ENTRY), 'utf8')).replace(new RegExp(RELATIVE_IMPORT, 'g'), (_, prefix, quote, name) => {
    const dependency = generated.get('src/' + name);
    assert.ok(dependency, `${ENTRY} imports ./${name}, which is not a hashed module`);
    imported.add('src/' + name);
    return `${prefix}${quote}./${dependency.filename}${quote}`;
  });
  for (const source of MODULES) {
    assert.ok(imported.has(source), `Expected the app entry to import ./${basename(source)}`);
  }
  addAsset(ENTRY, app);

  const css = (await readFile(resolve(root, 'styles.css'), 'utf8')).replace(CSS_ASSET_URL, (_, quote, source) => {
    const asset = generated.get(source);
    assert.ok(asset, `styles.css references ./${source}, which is not a hashed asset`);
    // The stylesheet and its assets share PUBLIC_ASSETS, so the URL stays relative.
    return `url(${quote}./${asset.filename}${quote})`;
  });
  assert.doesNotMatch(css, /url\(\s*['"]?\.\/assets\//, 'Unversioned asset URL in styles.css');
  addAsset('styles.css', css);

  let html = await readFile(resolve(root, 'index.html'), 'utf8');
  for (const [source, { filename }] of generated) {
    html = html.replaceAll(`https://hitchhike.dev/${source}`, `https://hitchhike.dev${PUBLIC_ASSETS}${filename}`);
    html = html.replaceAll(`./${source}`, PUBLIC_ASSETS + filename);
  }

  await rm(output, { recursive: true, force: true });
  await mkdir(resolve(output, PUBLIC_ASSETS.slice(1)), { recursive: true });
  for (const { filename, bytes } of generated.values()) {
    await writeFile(resolve(output, PUBLIC_ASSETS.slice(1), filename), bytes);
    assert.equal(filename.split('.').at(-2), digest(bytes), 'Asset name must match final content');
  }
  await writeFile(resolve(output, 'index.html'), html);
  for (const source of ASSETS) {
    assert.equal(html.includes(`./${source}`), false, `Unversioned HTML reference: ${source}`);
  }

  // Keep the original URLs available while previously loaded pages transition.
  // New HTML never references these mutable compatibility aliases.
  for (const source of ASSETS) {
    await mkdir(dirname(resolve(output, source)), { recursive: true });
    await cp(resolve(root, source), resolve(output, source));
  }
  // Preserve the exact bytes of the already-published manual version. Do not
  // regenerate an old version name from new source during a deployment.
  const legacy = resolve(root, 'scripts/legacy/20260927a');
  try {
    if ((await stat(legacy)).isDirectory()) await cp(legacy, output, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return Object.fromEntries([...generated].map(([source, { filename }]) => [source, PUBLIC_ASSETS + filename]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const assets = await buildLanding();
  console.log(`Built static site into dist/ with ${Object.keys(assets).length} content-hashed assets.`);
}
