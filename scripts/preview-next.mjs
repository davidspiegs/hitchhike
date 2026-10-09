#!/usr/bin/env node
/** Local review fixture for the actual next-release interface and Worker API.
 * Run: node scripts/preview-next.mjs (or --check to validate fixtures without listening)
 * Only binds 127.0.0.1:4178. All data and generated credentials disappear when
 * stopped; no existing database, account, provider, or scheduled worker is used.
 * Server-side fetch is disabled. This is not provider or device validation. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-preview-'));
const base = 'http://127.0.0.1:4178', sqlite = new DatabaseSync(':memory:');
const bundle = join(temporary, 'preview-worker.mjs');
globalThis.fetch = async () => { throw new Error('Local preview cannot contact external providers'); };
await build({ stdin: { contents: 'export { default as worker } from "./src/index.ts"; export { workspaceHtml } from "./src/workspace-ui.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
const { worker, workspaceHtml } = await import(pathToFileURL(bundle).href);
for (const file of (await readdir(join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', file), 'utf8'));
sqlite.exec('PRAGMA foreign_keys=ON');
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() {
    const query = sqlite.prepare(this.sql);
    if (query.columns().length) { const results = query.all(...this.values); return { results, meta: { changes: results.length }, success: true }; }
    return { meta: query.run(...this.values), success: true };
  }
}
const DB = { prepare: sql => new Statement(sql), async batch(statements) {
  sqlite.exec('BEGIN');
  try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const env = { DB, HOSTED: 'false', PUBLIC_URL: base, RELAY_NAME: 'Hitchhike · local fixture',
  ADMIN_TOKEN: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') };
async function runWorker(request) {
  const background = [];
  const response = await worker.fetch(request, env, { waitUntil: promise => background.push(promise), passThroughOnException() {} });
  await Promise.all(background); return response;
}
async function call(path, { method = 'GET', token = env.ADMIN_TOKEN, body } = {}) {
  const headers = { accept: 'application/json', authorization: 'Bearer ' + token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await runWorker(new Request(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const data = await response.json(); assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data)}`); return data;
}
await call('/v1/workspace/release', { method: 'PUT', body: { enabled: true } });
const agents = {};
for (const spec of [
  { id: 'cleo', name: 'Cleo', platform: 'dot', poll_minutes: 10 },
  { id: 'claude', name: 'Claude', platform: 'claude', poll_minutes: 60 },
  { id: 'codex', name: 'Codex', platform: 'codex', poll_minutes: null },
]) {
  agents[spec.id] = await call('/v1/admin/agents', { method: 'POST', body: { ...spec, can_request: true, can_work: true, work_types: ['task', 'review', 'research'], poll_minutes: spec.poll_minutes } });
}
for (const [id, purpose, surface, step, responsibilities] of [
  ['cleo', 'Delegate useful parts of my work and combine the results.', 'dots', 'exchange', ['Bring useful replies back into the originating conversation.']],
  ['claude', 'Offer a second opinion on plans, wording, and product decisions.', 'chat', 'exchange', ['Ask for missing context before making assumptions.']],
  ['codex', 'Inspect code and help implement changes when requested.', 'desktop', 'connect', []],
]) {
  await call(`/v1/agents/${id}/collaboration`, { method: 'PUT', body: { purpose, standing_responsibilities: responsibilities, initiative: id === 'cleo', background: id === 'codex' ? { method: 'manual', interval_minutes: null } : { method: 'scheduled', interval_minutes: id === 'claude' ? 60 : 10 } } });
  await call(`/v1/agents/${id}/onboarding`, { method: 'PATCH', body: { provider: agents[id].agent.platform, surface, step } });
}
const send = (to, message, title) => call('/v1/conversations', { method: 'POST', token: agents.cleo.token, body: { to, message, title, type: 'review', constraints: ['Use only the context supplied in this sample exchange.'] } });
const ask = await send('claude', 'Review this onboarding plan: choose an assistant, connect it, confirm access, give instructions, and finish with a real exchange. What would make the first run clearer?', 'A clearer first exchange');
const requestId = ask.request.id, conversationId = ask.conversation.id;
async function claim() { return call(`/v1/requests/${requestId}/claim`, { method: 'POST', token: agents.claude.token, body: { consumer_id: 'preview-claude' } }); }
async function reply(claim_id, message, status = 'completed') { return call(`/v1/requests/${requestId}/reply`, { method: 'POST', token: agents.claude.token, body: { claim_id, message, status } }); }
let held = await claim();
await reply(held.claim_id, 'Should this include people setting up from their phone?', 'needs_input');
await call(`/v1/jobs/${requestId}/reply`, { method: 'POST', token: agents.cleo.token, body: { message: 'Yes. Keep each step resumable when they switch apps, and identify desktop-only provider requirements before they begin.' } });
held = await claim();
await reply(held.claim_id, 'Keep the flow focused on one next step. Save progress before people leave Hitchhike. Show connection access, a successful exchange, and background execution as separate milestones.');
await call(`/v1/jobs/${requestId}/reject`, { method: 'POST', token: agents.cleo.token, body: { message: 'Please expand the point about waiting for a reply.' } });
held = await claim();
await reply(held.claim_id, 'Show who has the request and when the connection last checked. A queued request should explain its verified checking interval. If no interval has been verified, say so and offer a manual check. Keep the earlier answer visible for context.');
const inbox = await call('/v1/conversations/inbox?consumer_id=preview-cleo', { token: agents.cleo.token });
await call(`/v1/conversations/${conversationId}/acknowledge`, { method: 'POST', token: agents.cleo.token, body: { consumer_id: 'preview-cleo', cursor: inbox.conversations[0].next_cursor } });
await call('/v1/agents/cleo/onboarding', { method: 'PATCH', body: { step: 'done' } });
await send('claude', 'Give a second opinion on these three onboarding headings: Connect, Give instructions, Try an exchange. Flag any term that needs explanation.', 'Review the setup wording');
await send('codex', 'Check the proposed mobile layout for keyboard and viewport risks. Start with the supplied design context; do not change any files.', 'Mobile layout review');
// Sample timestamps make the waiting and setup states legible; verification
// still comes exclusively from the actual relay exchange above.
sqlite.prepare('UPDATE agents SET last_seen_at=? WHERE id IN (\'cleo\',\'claude\')').run(Date.now() - 3 * 60000);
sqlite.prepare('UPDATE agents SET last_seen_at=NULL WHERE id=\'codex\'').run();

const assetPaths = new Map(), assets = {};
async function collectAssets(directory, relative = '') {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    const name = relative + file.name, path = join(directory, file.name);
    if (file.isDirectory()) await collectAssets(path, name + '/');
    else if (['.png', '.svg', '.jpg', '.webp'].includes(extname(file.name))) { assets['assets/' + name] = '/assets/' + name; assetPaths.set('/assets/' + name, path); }
  }
}
await collectAssets(join(root, 'web/landing/assets'));
const html = workspaceHtml(env.RELAY_NAME, { hosted: false, apiUrl: base, assets });
const contentTypes = { '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
// Serialize the SQLite shim's HTTP requests so asynchronous D1 batch boundaries
// remain transactional. The actual deployed runtime uses D1's transaction API.
let pending = Promise.resolve();
const server = createServer((incoming, outgoing) => {
  const handle = async () => {
    if (incoming.headers.host !== '127.0.0.1:4178') { outgoing.writeHead(421); outgoing.end('Use the displayed loopback address.'); return; }
    const url = new URL(incoming.url || '/', base);
    if (url.pathname === '/') { outgoing.writeHead(303, { location: '/beta' }); outgoing.end(); return; }
    const asset = assetPaths.get(url.pathname);
    if (asset && incoming.method === 'GET') { outgoing.writeHead(200, { 'content-type': contentTypes[extname(asset)], 'cache-control': 'no-store' }); outgoing.end(await readFile(asset)); return; }
    if (url.pathname === '/beta' && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-hitchhike-preview': 'synthetic-in-memory-fixture', 'x-robots-tag': 'noindex' }); outgoing.end(html); return;
    }
    const chunks = []; let bytes = 0;
    for await (const chunk of incoming) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { outgoing.writeHead(413); outgoing.end(); return; } chunks.push(chunk); }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(url, { method: incoming.method, headers, ...(body ? { body } : {}) });
    const response = await runWorker(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  };
  pending = pending.then(handle).catch(error => { console.error('Preview request failed:', error.message); if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end('Preview request failed.'); });
});
async function close() { server.close(); await pending; sqlite.close(); await rm(temporary, { recursive: true, force: true }); }
process.once('SIGINT', () => { void close().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().finally(() => process.exit(0)); });
server.on('error', error => { console.error(error.message); void close().finally(() => process.exit(1)); });
if (process.argv.includes('--check')) {
  assert.ok(html.includes('Your agents')); assert.ok(assetPaths.size > 0);
  sqlite.close(); await rm(temporary, { recursive: true, force: true });
  console.log('Preview fixture passed: three agents, completed clarification/revision, origin retrieval, two pending requests, and production HTML. No port opened.');
} else {
  server.listen(4178, '127.0.0.1', () => {
    console.log('Local preview: synthetic sample data in memory; provider networking disabled.');
    console.log(base + '/beta#token=' + encodeURIComponent(env.ADMIN_TOKEN));
  });
}
