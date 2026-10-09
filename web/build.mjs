import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLanding } from './landing/scripts/build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-root' || !args[1])) {
  throw new Error('Usage: node web/build.mjs [--output-root <directory>]');
}
const outputRoot = args.length ? resolve(args[1]) : root;
const destination = join(outputRoot, 'web/dist');
const vercelOutput = join(outputRoot, '.vercel/output');
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-web-build-'));
const clerkBundlePaths = ['/npm/@clerk/ui@1/dist/ui.browser.js', '/npm/@clerk/clerk-js@6/dist/clerk.browser.js'];
const repository = 'https://github.com/davidspiegs/hitchhike';
const releasePlaceholder = '<a class="release" data-release hidden></a>';
const escapeHtml = (value) => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function origin(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an HTTPS origin`);
  return url.origin;
}

export function contentSecurityPolicy(html, config, { clerk = false, warmSignIn = false } = {}) {
  const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  const scripts = ["'self'", ...hashes, ...(clerk ? [config.frontendApi, 'https://*.protect.clerk.com', 'https://challenges.cloudflare.com'] : warmSignIn ? clerkBundlePaths.map((path) => config.frontendApi + path) : [])];
  return [
    "default-src 'none'",
    'script-src ' + scripts.join(' '),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: " + (clerk ? config.frontendApi + ' https://img.clerk.com' : ''),
    "connect-src 'self' " + (clerk ? config.apiUrl + ' ' + config.frontendApi + ' https://*.protect.clerk.com:* https://challenges.cloudflare.com' : ''),
    'frame-src ' + (clerk ? config.frontendApi + ' https://*.protect.clerk.com https://challenges.cloudflare.com' : "'none'"),
    "worker-src 'self' blob:",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

try {
  const publishedConfig = JSON.parse(await readFile(join(root, 'web/config.public.json'), 'utf8'));
  const publicSettings = ['HITCHHIKE_API_URL', 'HITCHHIKE_CLERK_FRONTEND_API', 'HITCHHIKE_CLERK_PUBLISHABLE_KEY', 'HITCHHIKE_SITE_URL'];
  const production = process.env.VERCEL_ENV === 'production';
  const missing = publicSettings.filter((name) => !process.env[name]?.trim());
  if (production && missing.length) throw new Error('Production builds require explicit public configuration: ' + missing.join(', '));
  if (missing.length && !['development', 'preview'].includes(process.env.VERCEL_ENV) && process.env.HITCHHIKE_ALLOW_EXAMPLE_CONFIG !== '1') {
    throw new Error('Set HITCHHIKE_API_URL, HITCHHIKE_CLERK_FRONTEND_API, HITCHHIKE_CLERK_PUBLISHABLE_KEY and HITCHHIKE_SITE_URL, or set HITCHHIKE_ALLOW_EXAMPLE_CONFIG=1 to build with the example.test placeholders');
  }
  const config = {
    apiUrl: origin(process.env.HITCHHIKE_API_URL || publishedConfig.apiUrl, 'HITCHHIKE_API_URL'),
    frontendApi: origin(process.env.HITCHHIKE_CLERK_FRONTEND_API || publishedConfig.frontendApi, 'HITCHHIKE_CLERK_FRONTEND_API'),
    publishableKey: process.env.HITCHHIKE_CLERK_PUBLISHABLE_KEY || publishedConfig.publishableKey,
    siteUrl: origin(process.env.HITCHHIKE_SITE_URL || publishedConfig.siteUrl, 'HITCHHIKE_SITE_URL'),
  };
  if (!/^pk_(live|test)_[A-Za-z0-9+/=_-]+$/.test(config.publishableKey)) throw new Error('Use a public Clerk publishable key');
  if (production) {
    const exampleHost = (hostname) => hostname === 'example.test' || hostname.endsWith('.example.test');
    const keyHostname = Buffer.from(config.publishableKey.slice(8), 'base64').toString('utf8').replace(/\$$/, '').toLowerCase();
    if ([config.apiUrl, config.frontendApi, config.siteUrl].some((url) => exampleHost(new URL(url).hostname)) || exampleHost(keyHostname)) {
      throw new Error('Production builds cannot use example.test API, Clerk, or site configuration');
    }
  }
  // Operators pass the public release tag (for example v0.1.0) through HITCHHIKE_RELEASE. There is no
  // commit fallback: private commit SHAs do not exist in the public snapshot repository.
  const releaseSetting = process.env.HITCHHIKE_RELEASE?.trim() ?? '';
  const release = /^[A-Za-z0-9._-]{1,64}$/.test(releaseSetting) ? escapeHtml(releaseSetting) : null;
  const bundled = join(temporary, 'pages.mjs');
  await build({ entryPoints: [join(root, 'web/pages.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundled, logLevel: 'silent' });
  const { frontendPages, publicDocsText } = await import(pathToFileURL(bundled).href);
  const assets = await buildLanding({ output: destination });
  const signInHints = `<meta name="hitchhike-sign-in-assets" content="${clerkBundlePaths.map((path) => config.frontendApi + path).join(' ')}">\n  <link rel="dns-prefetch" href="${config.frontendApi}">\n  <link rel="preconnect" href="${config.frontendApi}" crossorigin="anonymous">`;
  const releaseHints = release ? `\n  <meta name="hitchhike-release" content="${release}">` : '';
  const releaseHref = release ? `${repository}/${/^v\d/.test(release) ? 'releases/tag' : 'commit'}/${release}` : '';
  const releaseLink = release ? `<a class="release" data-release href="${releaseHref}" rel="noopener noreferrer">Release ${release}</a>` : '';
  const landing = await readFile(join(destination, 'index.html'), 'utf8');
  if (!landing.includes(releasePlaceholder)) throw new Error('Landing page is missing the release placeholder');
  const home = landing
    .replaceAll('https://hitchhike.dev/auth/start', '/sign-in')
    .replaceAll('https://hitchhike.dev', config.siteUrl)
    .replace('<head>', '<head>\n  ' + signInHints + releaseHints)
    .replace(releasePlaceholder, releaseLink);
  const pages = { '/': home, ...frontendPages({ ...config, assets }) };
  const consentScript = await readFile(join(root, 'web/connect.js'));
  const consentPath = '/_hitchhike-assets/connect.' + createHash('sha256').update(consentScript).digest('hex').slice(0, 16) + '.js';
  await writeFile(join(destination, consentPath.slice(1)), consentScript);
  pages['/connect'] = pages['/connect'].replace('/web/connect.js', consentPath);
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  const routes = [];
  const noStore = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store' };
  for (const [route, html] of Object.entries(pages)) {
    if (/\bnonce=/.test(html)) throw new Error(`Static page ${route} contains a reusable nonce`);
    const path = route === '/' ? 'index.html' : route.slice(1) + '/index.html';
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await writeFile(join(destination, path), html);
    routes.push({
      src: route === '/' ? '^/(?:index\\.html)?$' : '^' + route + '(?:/|/index\\.html)?$',
      dest: '/' + path,
      headers: {
        ...securityHeaders,
        // Warming public files must not grant the landing page auth API/frame permissions.
        'Content-Security-Policy': contentSecurityPolicy(html, config, { clerk: ['/app', '/app-next', '/sign-in', '/connect'].includes(route), warmSignIn: route === '/' }),
        ...noStore,
        ...(['/', '/privacy', '/docs', '/docs/use-cases', '/docs/connect', '/docs/using-hitchhike', '/docs/background', '/docs/troubleshooting'].includes(route) ? {} : { 'X-Robots-Tag': 'noindex' }),
      },
    });
  }
  const publicText = publicDocsText(config);
  const indexable = ['/', '/privacy', '/docs', '/docs/use-cases', '/docs/connect', '/docs/using-hitchhike', '/docs/background', '/docs/troubleshooting'];
  publicText['/robots.txt'] = { content: 'User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /app-next\nDisallow: /sign-in\nDisallow: /connect\nSitemap: ' + config.siteUrl + '/sitemap.xml\n', contentType: 'text/plain; charset=utf-8' };
  publicText['/sitemap.xml'] = { content: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + indexable.map((route) => '  <url><loc>' + config.siteUrl + (route === '/' ? '/' : route) + '</loc></url>').join('\n') + '\n</urlset>\n', contentType: 'application/xml; charset=utf-8' };
  for (const [route, { content, contentType }] of Object.entries(publicText)) {
    await writeFile(join(destination, route.slice(1)), content);
    routes.push({ src: '^' + route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', dest: route,
      headers: { ...securityHeaders, ...noStore, 'Content-Type': contentType, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox" } });
  }
  await mkdir(join(destination, 'web'), { recursive: true });
  await cp(join(root, 'web/connect.js'), join(destination, 'web/connect.js'));
  await writeFile(join(destination, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Hitchhike</title><main><h1>Page not found</h1><p><a href="/">Back to Hitchhike</a></p></main></html>');
  routes.push(
    { src: '/(.*)', headers: { ...securityHeaders, ...noStore }, continue: true },
    { src: '^/_hitchhike-assets/(.*)$', headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      'Vercel-CDN-Cache-Control': 'public, max-age=31536000, immutable',
    }, continue: true },
    { handle: 'filesystem' },
    { src: '/.*', dest: '/404.html', status: 404 },
  );
  await rm(vercelOutput, { recursive: true, force: true });
  await mkdir(vercelOutput, { recursive: true });
  await cp(destination, join(vercelOutput, 'static'), { recursive: true });
  await writeFile(join(vercelOutput, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2) + '\n');
  console.log('Built ' + Object.keys(pages).join(', ') + ' with hashed inline-script CSP');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
