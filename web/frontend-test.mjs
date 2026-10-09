/** Static deployment and browser-auth contract checks. No real provider/API calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdtemp, readFile, readdir, readlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-frontend-test-'));
process.once('exit', () => rmSync(temporary, { recursive: true, force: true }));
const destination = join(temporary, 'web/dist');
const testEnv = { ...process.env, VERCEL_ENV: 'development', HITCHHIKE_API_URL: '', HITCHHIKE_CLERK_FRONTEND_API: '', HITCHHIKE_CLERK_PUBLISHABLE_KEY: '', HITCHHIKE_SITE_URL: '', HITCHHIKE_RELEASE: '', VERCEL_GIT_COMMIT_SHA: '', HITCHHIKE_ALLOW_EXAMPLE_CONFIG: '' };
const buildFrontend = (outputRoot, env = testEnv) => execFileSync(process.execPath, [join(root, 'web/build.mjs'), '--output-root', outputRoot], { cwd: root, stdio: 'pipe', env });
async function fingerprint(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => [entry.name, entry.isSymbolicLink() ? ['symlink', await readlink(join(directory, entry.name))] : entry.isDirectory() ? await fingerprint(join(directory, entry.name)) : createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex')]));
    return files.sort(([a], [b]) => a.localeCompare(b));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const preservedPaths = [join(root, 'web/dist'), join(root, '.vercel/output')];
const beforeBuild = await Promise.all(preservedPaths.map(fingerprint));
buildFrontend(temporary);
const html = Object.fromEntries(await Promise.all(['app', 'app-next', 'sign-in', 'connect', 'privacy', 'terms'].map(async (page) => [page, await readFile(join(destination, page, 'index.html'), 'utf8')])));
const landingHtml = await readFile(join(destination, 'index.html'), 'utf8');
const docsPaths = ['docs', 'docs/use-cases', 'docs/connect', 'docs/using-hitchhike', 'docs/background', 'docs/troubleshooting'];
const docsHtml = Object.fromEntries(await Promise.all(docsPaths.map(async (page) => [page, await readFile(join(destination, page, 'index.html'), 'utf8')])));
const docsMarkdown = await readFile(join(destination, 'docs.md'), 'utf8');
const llmsText = await readFile(join(destination, 'llms.txt'), 'utf8');
const output = JSON.parse(await readFile(join(temporary, '.vercel/output/config.json'), 'utf8'));
const inline = (page) => [...page.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)); };
let count = 0;
const check = async (label, fn) => { await fn(); console.log(`ok ${++count} - ${label}`); };

await check('frontend checks leave existing deployment output unchanged', async () => {
  assert.deepEqual(await Promise.all(preservedPaths.map(fingerprint)), beforeBuild);
  assert.equal(await readFile(join(temporary, '.vercel/output/static/app/index.html'), 'utf8'), html.app);
});

await check('production builds reject missing or example public configuration before changing output', async () => {
  const rejectedRoot = join(temporary, 'rejected-production');
  await mkdir(join(rejectedRoot, 'web/dist'), { recursive: true });
  await mkdir(join(rejectedRoot, '.vercel/output'), { recursive: true });
  await writeFile(join(rejectedRoot, 'web/dist/keep.txt'), 'existing frontend');
  await writeFile(join(rejectedRoot, '.vercel/output/keep.txt'), 'existing deployment');
  const production = { ...testEnv, VERCEL_ENV: 'production' };
  const configured = {
    ...production, HITCHHIKE_API_URL: 'https://api.production-fixture.invalid',
    HITCHHIKE_CLERK_FRONTEND_API: 'https://clerk.production-fixture.invalid',
    HITCHHIKE_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.production-fixture.invalid$').toString('base64'),
    HITCHHIKE_SITE_URL: 'https://www.production-fixture.invalid',
  };
  for (const env of [production, { ...configured, HITCHHIKE_CLERK_FRONTEND_API: '' }, { ...configured, HITCHHIKE_SITE_URL: '' },
    { ...configured, HITCHHIKE_API_URL: 'https://api.example.test' },
    { ...configured, HITCHHIKE_CLERK_FRONTEND_API: 'https://clerk.example.test' },
    { ...configured, HITCHHIKE_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==' },
    { ...configured, HITCHHIKE_SITE_URL: 'https://www.example.test' }]) {
    assert.throws(() => buildFrontend(rejectedRoot, env), (error) => {
      assert.match(error.stderr.toString(), /Production builds (require explicit public configuration|cannot use example.test)/);
      return true;
    });
    assert.equal(await readFile(join(rejectedRoot, 'web/dist/keep.txt'), 'utf8'), 'existing frontend');
    assert.equal(await readFile(join(rejectedRoot, '.vercel/output/keep.txt'), 'utf8'), 'existing deployment');
  }
  assert.throws(() => buildFrontend(rejectedRoot, { ...configured, HITCHHIKE_SITE_URL: '' }), (error) => {
    assert.match(error.stderr.toString(), /Production builds require explicit public configuration: HITCHHIKE_SITE_URL\b/);
    return true;
  });
  buildFrontend(join(temporary, 'configured-production'), configured);
  const app = await readFile(join(temporary, 'configured-production/web/dist/app/index.html'), 'utf8');
  assert.match(app, /https:\/\/api\.production-fixture\.invalid/);
  assert.doesNotMatch(app, /example\.test/);
  const landing = await readFile(join(temporary, 'configured-production/web/dist/index.html'), 'utf8');
  assert.match(landing, /rel="preconnect" href="https:\/\/clerk\.production-fixture\.invalid" crossorigin="anonymous"/);
  assert.match(landing, /https:\/\/clerk\.production-fixture\.invalid\/npm\/@clerk\/clerk-js@6\/dist\/clerk\.browser\.js/);
  assert.doesNotMatch(landing, /example\.test|pk_(live|test)_/);
  assert.match(landing, /<link rel="canonical" href="https:\/\/www\.production-fixture\.invalid\/">/);
});

await check('builds outside Vercel development and preview need explicit public settings or an example opt-in', async () => {
  const unset = { ...testEnv };
  delete unset.VERCEL_ENV;
  const strictRoot = join(temporary, 'strict-config');
  assert.throws(() => buildFrontend(strictRoot, unset), (error) => {
    assert.match(error.stderr.toString(), /Set HITCHHIKE_API_URL, HITCHHIKE_CLERK_FRONTEND_API, HITCHHIKE_CLERK_PUBLISHABLE_KEY and HITCHHIKE_SITE_URL, or set HITCHHIKE_ALLOW_EXAMPLE_CONFIG=1 to build with the example\.test placeholders/);
    return true;
  });
  assert.equal(await fingerprint(join(strictRoot, 'web/dist')), null);
  buildFrontend(strictRoot, { ...unset, HITCHHIKE_ALLOW_EXAMPLE_CONFIG: '1' });
  assert.match(await readFile(join(strictRoot, 'web/dist/index.html'), 'utf8'), /<link rel="canonical" href="https:\/\/www\.example\.test\/">/);
  buildFrontend(join(temporary, 'preview-config'), { ...unset, VERCEL_ENV: 'preview' });
});

class Node {
  hidden = false; disabled = false; textContent = ''; value = ''; children = []; listeners = {};
  focus() { this.focused = true; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  setAttribute(key, value) { this[key] = value; }
  replaceChildren(...children) { this.children = children; if (children[0]?.value) this.value = children[0].value; }
  querySelector() { this.link ||= new Node(); return this.link; }
}
function browser({ query = '', session = true, response } = {}) {
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const calls = [], appended = [];
  const buttons = [Object.assign(new Node(), { value: 'allow' }), Object.assign(new Node(), { value: 'deny' })];
  node('oauth-consent').querySelectorAll = () => buttons;
  const clerk = {
    session: session ? { getToken: async (options) => { calls.push(['token', options]); return 'fixture-session-token'; } } : null,
    load: async (options) => { calls.push(['load', options]); },
    mountSignIn: (target, options) => {
      calls.push(['mount', options]);
      target.querySelector = () => new Node();
      queueMicrotask(() => target.observer?.check());
    },
  };
  const window = { Clerk: clerk, __internal_ClerkUICtor: function () {} };
  const context = createContext({
    window,
    document: { getElementById: node, createElement: () => new Node(), head: { appendChild(script) { appended.push(script); queueMicrotask(() => script.onload()); } } },
    location: { origin: 'https://hitchhike.dev', search: query, replace: (url) => calls.push(['replace', url]), assign: (url) => calls.push(['assign', url]), reload: () => calls.push(['reload']) },
    history: { replaceState: (...args) => calls.push(['history', ...args]) },
    fetch: async (url, options) => { calls.push(['fetch', url, options]); return response ? response(url, options) : { ok: true, status: 200, json: async () => ({ authenticated: true }) }; },
    MutationObserver: class {
      constructor(check) { this.check = check; }
      observe(target) { this.target = target; target.observer = this; }
      disconnect() { delete this.target.observer; }
    },
    URL, URLSearchParams, setTimeout, clearTimeout, Promise, console,
  });
  return { node, nodes, buttons, calls, appended, window, context, run: (source) => new Script(source).runInContext(context) };
}

await check('all private/static pages have exact script hashes and no reusable nonce', async () => {
  assert.equal(output.version, 3);
  for (const [page, source] of Object.entries(html)) {
    assert.doesNotMatch(source, /\bnonce=/);
    const route = output.routes.find((route) => route.dest === '/' + page + '/index.html');
    assert.ok(route);
    for (const script of inline(source)) {
      new Script(script);
      const hash = createHash('sha256').update(script).digest('base64');
      assert.ok(route.headers['Content-Security-Policy'].includes(`'sha256-${hash}'`));
    }
    assert.doesNotMatch(route.headers['Content-Security-Policy'].split(';').find((part) => part.trimStart().startsWith('script-src')), /unsafe-inline|nonce-/);
    assert.match(route.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
    if (['app', 'sign-in', 'connect'].includes(page)) assert.equal(route.headers['Cache-Control'], 'no-store');
  }
});

await check('public guide routes are readable, indexable, and use hashed shared assets without authentication', async () => {
  for (const [path, source] of Object.entries(docsHtml)) {
    const route = output.routes.find((entry) => entry.dest === '/' + path + '/index.html');
    assert.ok(route, `Missing public guide route: ${path}`);
    assert.equal(route.headers['X-Robots-Tag'], undefined);
    assert.doesNotMatch(source, /name="robots" content="noindex"|nonce=|AgentConnectAuth|pk_(live|test)_|__session|clerk\.example/);
    assert.match(source, /<main class="docs-article" id="main">/);
    assert.match(source, /<details class="docs-mobile-nav"><summary>Explore the guides<\/summary>/);
    assert.match(source, /href="\/_hitchhike-assets\/styles\.[a-f0-9]{16}\.css"/);
    assert.match(source, /src="\/_hitchhike-assets\/hitchhike-bus-logo\.[a-f0-9]{16}\.png"/);
    assert.match(source, /rel="alternate" type="text\/markdown" href="\/docs\.md"/);
    assert.equal((source.match(/<h1>/g) || []).length, 1);
    for (const script of inline(source)) {
      new Script(script);
      assert.ok(route.headers['Content-Security-Policy'].includes("'sha256-" + createHash('sha256').update(script).digest('base64') + "'"));
    }
    assert.doesNotMatch(route.headers['Content-Security-Policy'], /api\.example|clerk\.example|protect\.clerk|challenges\.cloudflare/);
  }
  for (const page of ['app', 'app-next', 'sign-in', 'connect', 'terms']) {
    assert.equal(output.routes.find((route) => route.dest === '/' + page + '/index.html').headers['X-Robots-Tag'], 'noindex');
  }
});

await check('guide navigation, provider anchors, and public text links resolve in the build', async () => {
  const pages = { '': landingHtml, ...html, ...docsHtml };
  for (const [path, source] of Object.entries({ '': landingHtml, ...docsHtml })) {
    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, new Set(ids).size, `Duplicate element ID in ${path}`);
    for (const [, href] of source.matchAll(/\bhref="([^"]+)"/g)) {
      if (!href.startsWith('/') && !href.startsWith('#')) continue;
      const url = new URL(href, 'https://hitchhike.dev/' + path);
      const target = url.pathname === '/' ? '' : url.pathname.slice(1);
      if (target in pages) {
        if (url.hash) assert.ok(pages[target].includes('id="' + url.hash.slice(1) + '"'), `Missing target ${href} from ${path}`);
      } else {
        assert.ok((await readFile(join(destination, target))).length, `Missing public file ${href}`);
      }
    }
  }
  for (const id of ['chatgpt-and-dots', 'claude', 'grok-bot-and-muse', 'coding-agents']) {
    assert.ok(docsHtml['docs/connect'].includes('id="' + id + '"'), `Landing provider anchor missing: ${id}`);
  }
  assert.doesNotMatch(docsMarkdown + llmsText, /github\.com\/davidspiegs/);
  for (const page of docsPaths) assert.ok(llmsText.includes('https://www.example.test/' + page));
});

await check('agent text comes from page content and retains prompts, provider boundaries, and deployment endpoint', async () => {
  const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[name]));
  for (const source of Object.values(docsHtml)) {
    for (const [, value] of source.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)) {
      assert.ok(docsMarkdown.includes(decode(value)), 'A copyable page prompt is missing from the same-source Markdown');
    }
  }
  assert.ok(docsMarkdown.includes('https://api.example.test/mcp'));
  const configuredMarkdown = await readFile(join(temporary, 'configured-production/web/dist/docs.md'), 'utf8');
  assert.ok(configuredMarkdown.includes('https://api.production-fixture.invalid/mcp'));
  assert.doesNotMatch(configuredMarkdown, /api\.example\.test/);
  assert.match(docsMarkdown, /Ordinary ChatGPT is experimental/);
  assert.match(docsMarkdown, /hosted wake adapter is disabled/);
  assert.match(docsMarkdown, /30 days after the conversation’s last message/);
  assert.match(docsMarkdown, /If helpful, you may/);
  assert.match(docsMarkdown, /Register automatically/);
  assert.doesNotMatch(docsMarkdown, /\]\(\//, 'Standalone Markdown must use absolute internal links');
});

await check('Markdown, agent index, robots, and sitemap have explicit safe content types and routing', async () => {
  const expected = { '/docs.md': 'text/markdown; charset=utf-8', '/llms.txt': 'text/plain; charset=utf-8', '/robots.txt': 'text/plain; charset=utf-8', '/sitemap.xml': 'application/xml; charset=utf-8' };
  for (const [path, contentType] of Object.entries(expected)) {
    const route = output.routes.find((entry) => entry.dest === path);
    assert.ok(route);
    assert.equal(route.headers['Content-Type'], contentType);
    assert.equal(route.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(route.headers['X-Robots-Tag'], undefined);
    assert.ok(new RegExp(route.src).test(path));
    assert.equal(new RegExp(route.src).test(path.replace('.', 'X')), false, 'Text route must escape literal dots');
    assert.equal(await readFile(join(temporary, '.vercel/output/static', path.slice(1)), 'utf8'), await readFile(join(destination, path.slice(1)), 'utf8'));
  }
  const robots = await readFile(join(destination, 'robots.txt'), 'utf8');
  assert.match(robots, /Disallow: \/app\n/);
  assert.doesNotMatch(robots, /Disallow: \/docs/);
  const sitemap = await readFile(join(destination, 'sitemap.xml'), 'utf8');
  for (const page of docsPaths) assert.ok(sitemap.includes('<loc>https://www.example.test/' + page + '</loc>'));
  assert.doesNotMatch(sitemap, /<loc>https:\/\/www\.example\.test\/(?:app|app-next|sign-in|connect)<\/loc>/);
});

await check('guide copy controls report real success and select readable text if clipboard access fails', async () => {
  const script = inline(docsHtml.docs).at(-1);
  for (const mode of ['success', 'denied', 'missing']) {
    const calls = [], field = { value: 'Read https://hitchhike.dev/docs.md', focus() { calls.push('focus'); }, select() { calls.push('select'); }, setSelectionRange(start, end) { calls.push(['selection', start, end]); } };
    const status = { hidden: true, textContent: '' };
    const button = { hidden: true, disabled: false, getAttribute: () => 'fixture-copy', addEventListener(event, handler) { this[event] = handler; } };
    const context = createContext({
      navigator: mode === 'missing' ? {} : { clipboard: { async writeText(value) { calls.push(['copy', value]); if (mode === 'denied') throw new Error('denied'); } } },
      document: { querySelectorAll: () => [button], getElementById: () => field, querySelector: () => status },
    });
    new Script(script).runInContext(context);
    assert.equal(button.hidden, false);
    await button.click();
    assert.equal(button.disabled, false); assert.equal(status.hidden, false);
    if (mode === 'success') {
      assert.deepEqual(calls, [['copy', field.value]]);
      assert.match(status.textContent, /^Copied\./);
    } else {
      assert.ok(calls.includes('focus') && calls.includes('select'));
      assert.match(status.textContent, /Clipboard access was unavailable/);
      assert.doesNotMatch(status.textContent, /^Copied\./);
    }
  }
});

await check('guide prompts expand on narrow viewports and resize only once per width-change frame', async () => {
  const script = inline(docsHtml.docs).at(-1), frames = [], measurements = [];
  let measuredHeight = 120;
  const field = { style: { height: '600px' }, get scrollHeight() { measurements.push(this.style.height); return measuredHeight; } };
  const unavailable = { style: { height: '150px' } };
  const window = { innerWidth: 1280, addEventListener(event, handler) { this[event] = handler; }, requestAnimationFrame(handler) { frames.push(handler); } };
  const context = createContext({ window, document: { querySelectorAll: (selector) => selector === '.docs-copy textarea' ? [field, unavailable, {}] : [] } });
  new Script(script).runInContext(context);
  assert.equal(field.style.height, '122px');
  assert.equal(unavailable.style.height, '150px', 'Missing layout measurements preserve the readable fallback');
  window.resize();
  assert.equal(frames.length, 0, 'Height-only keyboard resizing should not trigger layout work');
  window.innerWidth = 390; measuredHeight = 420;
  window.resize(); window.resize();
  assert.equal(frames.length, 1, 'Repeated resize events should share one animation frame');
  frames.shift()();
  assert.equal(field.style.height, '422px', 'The full prompt should become visible at the narrow width');
  window.innerWidth = 1100; measuredHeight = 180;
  window.resize(); frames.shift()();
  assert.equal(field.style.height, '182px', 'Reset height before measuring so the field can shrink again');
  window.innerWidth = 320; measuredHeight = 10000;
  window.resize(); frames.shift()();
  assert.equal(field.style.height, '4096px', 'Unexpected long content has a bounded automatic height');
  assert.ok(measurements.every((height) => height === 'auto'));
});

await check('landing assets stay intact and hosted CTA targets frontend sign-in', async () => {
  const landing = landingHtml;
  assert.match(landing, /href="\/sign-in"/);
  assert.doesNotMatch(landing, /hitchhike\.dev\/auth\/start/);
  assert.match(landing, /_hitchhike-assets\/app\.[a-f0-9]{16}\.js/);
  assert.match(landing, /_hitchhike-assets\/styles\.[a-f0-9]{16}\.css/);
  assert.match(html.connect, /_hitchhike-assets\/connect\.[a-f0-9]{16}\.js/);
  const immutableRoute = output.routes.find((route) => route.src === '^/_hitchhike-assets/(.*)$');
  assert.match(immutableRoute.headers['Cache-Control'], /immutable/);
  const homeRoute = output.routes.find((route) => route.dest === '/index.html');
  assert.equal(homeRoute.headers['Cache-Control'], 'no-store');
  assert.equal(homeRoute.headers['Vercel-CDN-Cache-Control'], 'no-store');
  assert.equal(await readFile(join(destination, 'styles.css'), 'utf8'), await readFile(join(root, 'web/landing/styles.css'), 'utf8'));
  assert.equal(await readFile(join(destination, 'src/demo.js'), 'utf8'), await readFile(join(root, 'web/landing/src/demo.js'), 'utf8'));
});

const repository = 'https://github.com/davidspiegs/hitchhike';
await check('landing and guide pages link to the repository and self-hosting guide without target attributes', async () => {
  const header = landingHtml.match(/<nav class="primary-nav"[^>]*>[\s\S]*?<\/nav>/)[0];
  const footer = landingHtml.match(/<footer class="site-footer wrap">[\s\S]*?<\/footer>/)[0];
  assert.ok(header.includes(`<a class="nav-github" href="${repository}" rel="noopener noreferrer">GitHub</a>`));
  assert.ok(footer.includes(`<a href="${repository}" rel="noopener noreferrer">Source</a>`));
  assert.ok(footer.includes(`<a href="${repository}/blob/main/docs/self-hosting.md" rel="noopener noreferrer">Self-hosting</a>`));
  assert.ok(footer.includes('<p>Source available under the Elastic License 2.0. Use Hitchhike hosted or run it in your own Cloudflare account.</p>'));
  for (const source of Object.values(docsHtml)) {
    assert.ok(source.includes(`<a href="${repository}" rel="noopener noreferrer">GitHub</a>`));
    assert.ok(source.includes(`<a href="${repository}" rel="noopener noreferrer">Source</a>`));
    assert.ok(source.includes(`<a href="${repository}/blob/main/docs/self-hosting.md" rel="noopener noreferrer">Self-hosting</a>`));
  }
  for (const source of [landingHtml, ...Object.values(docsHtml)]) assert.doesNotMatch(source, /target=/);
  assert.doesNotMatch(docsMarkdown + llmsText, /github\.com/);
});

await check('HITCHHIKE_SITE_URL replaces the hosted origin in canonical, social, sitemap, robots, and agent text', async () => {
  const siteRoot = join(temporary, 'site-url');
  buildFrontend(siteRoot, { ...testEnv, HITCHHIKE_SITE_URL: 'https://site.example' });
  const dist = join(siteRoot, 'web/dist');
  const landing = await readFile(join(dist, 'index.html'), 'utf8');
  assert.match(landing, /<link rel="canonical" href="https:\/\/site\.example\/">/);
  assert.match(landing, /<meta property="og:url" content="https:\/\/site\.example\/">/);
  assert.match(landing, /<meta property="og:image" content="https:\/\/site\.example\/_hitchhike-assets\/hitchhike-share\.[a-f0-9]{16}\.jpg">/);
  assert.match(landing, /<meta name="twitter:image" content="https:\/\/site\.example\/_hitchhike-assets\/hitchhike-share\.[a-f0-9]{16}\.jpg">/);
  assert.match(landing, /Read https:\/\/site\.example\/docs\.md and explain/);
  const robots = await readFile(join(dist, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/site\.example\/sitemap\.xml$/m);
  const sitemap = await readFile(join(dist, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('<url><loc>https://site.example/</loc></url>'));
  for (const page of docsPaths) assert.ok(sitemap.includes('<loc>https://site.example/' + page + '</loc>'));
  const guide = await readFile(join(dist, 'docs/index.html'), 'utf8');
  assert.match(guide, /<link rel="canonical" href="https:\/\/site\.example\/docs">/);
  assert.match(guide, /using https:\/\/site\.example\/docs\/connect and https:\/\/site\.example\/docs\.md/);
  const markdown = await readFile(join(dist, 'docs.md'), 'utf8');
  assert.match(markdown, /^Public source: https:\/\/site\.example\/docs$/m);
  assert.ok(markdown.includes('](https://site.example/docs/connect)'));
  const llms = await readFile(join(dist, 'llms.txt'), 'utf8');
  for (const page of docsPaths) assert.ok(llms.includes('https://site.example/' + page));
  for (const text of [landing, robots, sitemap, guide, markdown, llms]) assert.doesNotMatch(text, /https:\/\/hitchhike\.dev/);
});

await check('release metadata comes only from HITCHHIKE_RELEASE and links tags to the public release page', async () => {
  assert.doesNotMatch(landingHtml, /hitchhike-release|data-release/);
  const releaseLink = (html) => html.match(/<a class="release" data-release href="([^"]+)" rel="noopener noreferrer">([^<]+)<\/a>/);
  const commitOnly = join(temporary, 'released-commit-only');
  buildFrontend(commitOnly, { ...testEnv, VERCEL_GIT_COMMIT_SHA: 'abc123def456' });
  const commitOnlyLanding = await readFile(join(commitOnly, 'web/dist/index.html'), 'utf8');
  assert.doesNotMatch(commitOnlyLanding, /hitchhike-release|data-release|abc123def456/);
  const tagged = join(temporary, 'released-tag');
  buildFrontend(tagged, { ...testEnv, HITCHHIKE_RELEASE: 'v0.1.0', VERCEL_GIT_COMMIT_SHA: 'abc123def456' });
  const taggedLanding = await readFile(join(tagged, 'web/dist/index.html'), 'utf8');
  assert.match(taggedLanding, /<meta name="hitchhike-release" content="v0\.1\.0">/);
  assert.ok(taggedLanding.indexOf('hitchhike-release') < taggedLanding.indexOf('</head>'));
  const taggedLink = releaseLink(taggedLanding);
  assert.ok(taggedLink, 'Footer release link missing');
  assert.equal(taggedLink[1], repository + '/releases/tag/v0.1.0');
  assert.equal(taggedLink[2], 'Release v0.1.0');
  assert.equal((taggedLanding.match(/data-release/g) || []).length, 1);
  assert.doesNotMatch(taggedLanding, /abc123def456/);
  const commit = join(temporary, 'released-commit');
  buildFrontend(commit, { ...testEnv, HITCHHIKE_RELEASE: 'abc123def456' });
  const commitLanding = await readFile(join(commit, 'web/dist/index.html'), 'utf8');
  assert.match(commitLanding, /<meta name="hitchhike-release" content="abc123def456">/);
  const commitLink = releaseLink(commitLanding);
  assert.ok(commitLink, 'Footer release link missing');
  assert.equal(commitLink[1], repository + '/commit/abc123def456');
  assert.equal(commitLink[2], 'Release abc123def456');
  const trimmed = join(temporary, 'released-trimmed');
  buildFrontend(trimmed, { ...testEnv, HITCHHIKE_RELEASE: ' v0.1.0-rc.1 ' });
  const trimmedLanding = await readFile(join(trimmed, 'web/dist/index.html'), 'utf8');
  assert.match(trimmedLanding, /<meta name="hitchhike-release" content="v0\.1\.0-rc\.1">/);
  assert.equal(releaseLink(trimmedLanding)[1], repository + '/releases/tag/v0.1.0-rc.1');
  const invalid = join(temporary, 'released-invalid');
  buildFrontend(invalid, { ...testEnv, HITCHHIKE_RELEASE: 'abc123"><script>alert(1)</script>' });
  const invalidLanding = await readFile(join(invalid, 'web/dist/index.html'), 'utf8');
  assert.doesNotMatch(invalidLanding, /hitchhike-release|data-release|alert\(1\)/);
});

const clerkBundles = ['https://clerk.example.test/npm/@clerk/ui@1/dist/ui.browser.js', 'https://clerk.example.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js'];
await check('landing hints allow only the public Clerk scripts without auth API or frame permissions', async () => {
  assert.match(landingHtml, /rel="dns-prefetch" href="https:\/\/clerk\.example\.test"/);
  assert.match(landingHtml, /rel="preconnect" href="https:\/\/clerk\.example\.test" crossorigin="anonymous"/);
  assert.ok(landingHtml.indexOf('rel="preconnect"') < landingHtml.indexOf('<script'));
  assert.equal(landingHtml.match(/name="hitchhike-sign-in-assets" content="([^"]+)"/)[1], clerkBundles.join(' '));
  assert.doesNotMatch(landingHtml, /<script[^>]+src="https:\/\/clerk\.|AgentConnectAuth|pk_(live|test)_/);
  const policy = output.routes.find((route) => route.dest === '/index.html').headers['Content-Security-Policy'];
  const directives = Object.fromEntries(policy.split('; ').map((directive) => { const [name, ...sources] = directive.split(' '); return [name, sources.filter(Boolean)]; }));
  assert.deepEqual(directives['script-src'], ["'self'", ...clerkBundles]);
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['frame-src'], ["'none'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
  assert.doesNotMatch(policy, /api\.example\.test|protect\.clerk\.com|challenges\.cloudflare\.com/);
});

const landingAppPath = landingHtml.match(/<script type="module" src="([^"]+)"/)[1];
const landingApp = (await readFile(join(destination, landingAppPath.slice(1)), 'utf8')).replace(/^import[^\n]+\n/gm, '');
function landingBrowser({ connection, assets = clerkBundles.join(' ') } = {}) {
  const links = [new Node(), new Node()], appended = [];
  const context = createContext({
    initHandoffDemo() {}, initStarterPrompt() {}, navigator: { connection },
    document: {
      querySelector: () => assets ? { content: assets } : null,
      querySelectorAll: () => links,
      createElement: (tagName) => ({ tagName }),
      head: { appendChild: (hint) => appended.push(hint) },
    },
  });
  new Script(landingApp).runInContext(context);
  return { links, appended };
}
await check('sign-in intent warms two scripts once without executing Clerk or intercepting navigation', async () => {
  for (const event of ['pointerenter', 'focus', 'touchstart']) {
    const b = landingBrowser();
    assert.equal(b.appended.length, 0);
    b.links[0].listeners[event]();
    assert.deepEqual(b.appended.map((hint) => hint.href), clerkBundles);
    assert.ok(b.appended.every((hint) => hint.tagName === 'link' && hint.rel === 'preload' && hint.as === 'script' && hint.crossOrigin === 'anonymous' && hint.fetchPriority === 'low'));
    for (const link of b.links) for (const warm of Object.values(link.listeners)) warm();
    assert.equal(b.appended.length, 2);
    assert.equal(b.links[0].listeners.click, undefined);
  }
});
await check('landing skips speculative scripts for data saver, slow connections, and standalone previews', async () => {
  for (const connection of [{ saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }]) {
    const b = landingBrowser({ connection });
    b.links[0].listeners.pointerenter(); b.links[0].listeners.focus(); b.links[0].listeners.touchstart();
    assert.equal(b.appended.length, 0);
  }
  const standalone = landingBrowser({ assets: '' });
  assert.equal(standalone.appended.length, 0);
  assert.equal(Object.keys(standalone.links[0].listeners).length, 0);
});

await check('dashboard sends bearer, CSRF and idempotency to absolute API without cookies', async () => {
  const script = inline(html.app).at(-1);
  const start = script.indexOf('async function api(path, opts)');
  const source = script.slice(start, script.indexOf('\n\n  function status', start));
  const calls = [];
  const context = createContext({
    HOSTED: true, CLERK: true, API_URL: 'https://api.example.test', csrfToken: 'fixture-csrf',
    window: { AgentConnectAuth: { getToken: async () => 'fixture-bearer' } },
    fetch: async (...args) => { calls.push(args); return { ok: true, status: 200, json: async () => ({ ready: true }) }; },
    signOut: () => assert.fail('Unexpected sign-out'),
  });
  new Script(source).runInContext(context);
  await context.api('/v1/admin/agents/demo/setup', { method: 'POST', body: {}, idempotencyKey: 'fixture-idempotency' });
  assert.equal(calls[0][0], 'https://api.example.test/v1/admin/agents/demo/setup');
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(calls[0][1].headers.authorization, 'Bearer fixture-bearer');
  assert.equal(calls[0][1].headers['X-CSRF-Token'], 'fixture-csrf');
  assert.equal(calls[0][1].headers['Idempotency-Key'], 'fixture-idempotency');
});

await check('sign-in defaults to /app and uses only public Clerk configuration', async () => {
  const b = browser(); b.run(inline(html['sign-in'])[0]); await b.window.AgentConnectAuth.ready;
  assert.equal(b.window.AgentConnectAuth.returnTo, '/app');
  assert.equal(b.window.AgentConnectAuth.apiUrl, 'https://api.example.test');
  assert.equal(b.appended[1].src, 'https://clerk.example.test/npm/@clerk/clerk-js@6/dist/clerk.browser.js');
  assert.equal(b.appended[1].nonce, undefined);
  assert.equal(Buffer.from(b.appended[1]['data-clerk-publishable-key'].slice(8), 'base64').toString(), 'clerk.example.test$');
});

await check('guest sign-in releases its placeholder when Clerk renders controls', async () => {
  const b = browser({ session: false });
  inline(html['sign-in']).forEach((script) => b.run(script)); await settle();
  assert.equal(b.node('auth-placeholder').hidden, true);
  assert.equal(b.node('auth-panel')['data-ready'], 'true');
  assert.equal(b.node('auth-panel')['aria-busy'], 'false');
  assert.equal(b.node('sign-in').observer, undefined);
  assert.equal(b.calls.some((call) => call[0] === 'fetch'), false);
});

await check('sign-in preserves OAuth continuation but strips Clerk transport and rejects ambiguous/external returns', async () => {
  const values = [
    ['/connect?client_id=fixture&state=kept&__clerk_handshake=discard', '/connect?client_id=fixture&state=kept'],
    ['/connect?client_id=one&client_id=two', '/app'],
    ['https://evil.example/connect?state=no', '/app'],
    ['/app?token=no#secret', '/app'],
    ['/auth/logout', '/app'],
  ];
  for (const [value, expected] of values) {
    const b = browser({ query: '?return_to=' + encodeURIComponent(value) });
    b.run(inline(html['sign-in'])[0]); await b.window.AgentConnectAuth.ready;
    assert.equal(b.window.AgentConnectAuth.returnTo, expected);
  }
});

await check('existing sign-in verifies API session without cookies then opens preserved return path', async () => {
  const b = browser({ query: '?return_to=' + encodeURIComponent('/connect?state=kept') });
  inline(html['sign-in']).forEach((script) => b.run(script)); await settle();
  const request = b.calls.find((call) => call[0] === 'fetch');
  assert.equal(request[1], 'https://api.example.test/auth/clerk/session');
  assert.equal(request[2].credentials, 'omit');
  assert.equal(request[2].headers.Authorization, 'Bearer fixture-session-token');
  assert.equal(b.calls.find((call) => call[0] === 'replace')[1], '/connect?state=kept');
});

const connectSource = await readFile(join(root, 'web/connect.js'), 'utf8');
const consent = {
  clientName: '<img src=x onerror=alert(1)>', redirectOrigin: 'https://client.example', email: 'fixture@example.test',
  csrfToken: 'fixture-csrf', requestId: 'fixture-request', scopes: ['relay:read', 'relay:send'],
  agents: [{ id: 'agent-fixture', name: '<script>fixture</script>', can_request: 1, can_work: 1 }],
};
function consentBrowser(options = {}) {
  const b = browser({ query: '?client_id=fixture&state=kept&__clerk_handshake=discard', ...options });
  b.run(inline(html.connect)[0]); b.run(connectSource);
  return b;
}
await check('consent renders API-provided values as text and sends sanitized GET with fresh bearer', async () => {
  const b = consentBrowser({ response: async () => ({ ok: true, status: 200, json: async () => consent }) });
  await settle();
  assert.equal(b.node('client-name').textContent, consent.clientName);
  assert.equal(b.node('agent-id').children[0].textContent, 'Choose a connection…');
  assert.equal(b.node('agent-id').children[1].textContent, consent.agents[0].name + ' — send and work (' + consent.agents[0].id + ')');
  assert.equal(b.node('agent-id').value, '');
  assert.equal(b.node('consent-allow').disabled, true);
  const request = b.calls.find((call) => call[0] === 'fetch');
  assert.equal(request[1], 'https://api.example.test/oauth/authorize?client_id=fixture&state=kept');
  assert.equal(request[2].credentials, 'omit'); assert.equal(request[2].redirect, 'error');
  assert.equal(request[2].headers.Accept, 'application/json');
  assert.equal(request[2].headers.Authorization, 'Bearer fixture-session-token');
  assert.equal(b.node('consent-details').hidden, false);
});

await check('consent requires an explicit connection and never defaults to the first alphabetical agent', async () => {
  const choices = { ...consent, agents: [
    { id: 'chatgpt-fixture', name: 'ChatGPT', can_request: 1, can_work: 1 },
    { id: 'grok-fixture', name: 'Grok', can_request: 1, can_work: 1 },
  ] };
  const b = consentBrowser({ response: async (url, opts) => ({ ok: true, status: 200, json: async () => opts.method === 'GET' ? choices : { redirectUrl: 'https://client.example/callback?code=fixture' } }) });
  await settle();
  for (const value of ['', 'not-in-this-workspace']) {
    b.node('agent-id').value = value;
    b.node('agent-id').listeners.change();
    assert.equal(b.node('consent-allow').disabled, true);
    await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: 'allow' } });
    assert.equal(b.calls.filter((call) => call[0] === 'fetch').length, 1);
    assert.equal(b.node('agent-id').focused, true);
  }
  b.node('agent-id').value = 'grok-fixture';
  b.node('agent-id').listeners.change();
  assert.equal(b.node('consent-allow').disabled, false);
  assert.equal(b.node('consent-allow').textContent, 'Connect Grok');
  assert.match(b.node('connection-selection').textContent, /Grok \(grok-fixture\)/);
  await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: 'allow' } });
  assert.equal(b.calls.filter((call) => call[0] === 'fetch').at(-1)[2].body.get('agent_id'), 'grok-fixture');
  assert.ok(b.calls.some((call) => call[0] === 'assign'));
  assert.match(html.connect, /value="deny"[^>]*formnovalidate/);
});

await check('scoped consent confirms its server-selected identity without a picker and ignores substituted UI values', async () => {
  const fixed = { ...consent, targetAgentId: 'grok-fixture', agents: [{ id: 'grok-fixture', name: 'Grok', can_request: 1, can_work: 1 }] };
  const b = consentBrowser({ response: async (url, opts) => ({ ok: true, status: 200, json: async () => opts.method === 'GET' ? fixed : { redirectUrl: 'https://client.example/callback?code=fixture' } }) });
  await settle();
  assert.equal(b.node('agent-picker').hidden, true);
  assert.equal(b.node('fixed-connection').hidden, false);
  assert.equal(b.node('agent-id').disabled, true);
  assert.equal(b.node('agent-id').required, false);
  assert.equal(b.node('connect-title').textContent, 'Connect Grok');
  assert.equal(b.node('consent-allow').textContent, 'Connect Grok');
  assert.equal(b.node('consent-allow').disabled, false);
  b.node('agent-id').value = 'chatgpt-fixture';
  await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: 'allow' } });
  const request = b.calls.filter(call => call[0] === 'fetch').at(-1);
  assert.equal(request[2].body.get('agent_id'), 'grok-fixture');
  assert.ok(b.calls.some(call => call[0] === 'assign'));
});

await check('malformed fixed-target consent cannot fall back to a different agent', async () => {
  for (const targetAgentId of ['missing-fixture', '', 12]) {
    const b = consentBrowser({ response: async () => ({ ok: true, status: 200, json: async () => ({ ...consent, targetAgentId }) }) });
    await settle();
    assert.match(b.node('auth-error').textContent, /chosen connection could not be confirmed/);
    await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: 'allow' } });
    assert.equal(b.calls.filter(call => call[0] === 'fetch').length, 1);
  }
});

for (const decision of ['allow', 'deny']) await check(`consent ${decision} posts original CSRF and request identity before top-level callback`, async () => {
  const b = consentBrowser({ response: async (url, opts) => ({ ok: true, status: 200, json: async () => opts.method === 'GET' ? consent : { redirectUrl: 'https://client.example/callback?code=fixture' } }) });
  await settle();
  if (decision === 'allow') {
    b.node('agent-id').value = 'agent-fixture';
    b.node('agent-id').listeners.change();
  }
  await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: decision } });
  const request = b.calls.filter((call) => call[0] === 'fetch').at(-1);
  assert.equal(request[1], 'https://api.example.test/oauth/authorize');
  assert.equal(request[2].headers['X-CSRF-Token'], 'fixture-csrf');
  assert.equal(request[2].body.get('csrf_token'), 'fixture-csrf');
  assert.equal(request[2].body.get('request_id'), 'fixture-request');
  assert.equal(request[2].body.get('decision'), decision);
  assert.equal(request[2].body.get('agent_id'), decision === 'allow' ? 'agent-fixture' : null);
  assert.equal(request[2].credentials, 'omit'); assert.equal(request[2].redirect, 'error');
  assert.equal(b.calls.find((call) => call[0] === 'assign')[1], 'https://client.example/callback?code=fixture');
  assert.equal(b.calls.filter((call) => call[0] === 'token').length, 2);
});

await check('unauthenticated consent returns through sanitized sign-in without calling API', async () => {
  const b = consentBrowser({ session: false }); await settle();
  assert.equal(b.calls.some((call) => call[0] === 'fetch'), false);
  assert.equal(b.calls.find((call) => call[0] === 'replace')[1], '/sign-in?return_to=' + encodeURIComponent('/connect?client_id=fixture&state=kept'));
});

await check('no-agent consent keeps cancellation and guides user to workspace', async () => {
  const b = consentBrowser({ response: async () => ({ ok: true, status: 200, json: async () => ({ ...consent, agents: [] }) }) });
  await settle();
  assert.equal(b.node('consent-allow').hidden, true);
  assert.equal(b.node('agent-id').disabled, true);
  assert.equal(b.node('no-agents').hidden, false);
  assert.equal(b.buttons[1].disabled, false);
});

await check('unexpected callback origin is blocked and consent controls recover', async () => {
  const b = consentBrowser({ response: async (url, opts) => ({ ok: true, status: 200, json: async () => opts.method === 'GET' ? consent : { redirectUrl: 'https://other.example/?code=fixture' } }) });
  await settle();
  b.node('agent-id').value = 'agent-fixture';
  b.node('agent-id').listeners.change();
  await b.node('oauth-consent').listeners.submit({ preventDefault() {}, submitter: { value: 'allow' } });
  assert.equal(b.calls.some((call) => call[0] === 'assign'), false);
  assert.equal(b.node('auth-error').hidden, false);
  assert.match(b.node('auth-error').textContent, /unexpected redirect/);
  assert.ok(b.buttons.every((button) => !button.disabled));
});

await check('landing prompts preserve drafts and report clipboard outcomes', async () => {
  await import('./landing/prompt-test.mjs');
});

await check('landing examples play, pause, navigate, and restore accessibly', async () => {
  await import('./landing/demo-test.mjs');
});

console.log(`Frontend checks passed: ${count}`);
