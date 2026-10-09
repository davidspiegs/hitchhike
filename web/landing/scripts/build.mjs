import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, cp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ASSETS = '/_hitchhike-assets/';
const ASSETS = [
  'styles.css', 'src/app.js', 'src/demo.js', 'assets/hitchhike-bus-logo.png', 'assets/hitchhike-bus-mark.png', 'assets/hitchhike-bus-conversation.png',
  'assets/hitchhike-share.jpg',
  ...['chatgpt.svg', 'muse.svg', 'grok-bot.svg', 'claude.svg', 'grok.png', 'codex.png', 'claude-code.png', 'droid.svg', 'omp.svg']
    .map((name) => 'assets/agents/' + name),
];
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

  // Hash dependencies first. The app's hash must cover its final import URL,
  // so changing demo.js also changes the entry module requested by the HTML.
  const demo = addAsset('src/demo.js', await readFile(resolve(root, 'src/demo.js')));
  const app = await readFile(resolve(root, 'src/app.js'), 'utf8');
  const rewrittenApp = app.replace(/(['"])\.\/demo\.js\1/g, (_, quote) => `${quote}./${demo}${quote}`);
  assert.notEqual(rewrittenApp, app, 'Expected the app entry to import ./demo.js');
  addAsset('src/app.js', rewrittenApp);
  for (const source of ASSETS.filter((path) => !path.startsWith('src/'))) {
    addAsset(source, await readFile(resolve(root, source)));
  }

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
