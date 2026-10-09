/** Render the shipped dashboard functions against synthetic fixtures, without a browser or network. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, Script } from 'node:vm';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-dashboard-ux-'));
let passed = 0;
const check = async (name, action) => { await action(); console.log(`ok ${++passed} - ${name}`); };
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// A deliberately small DOM double. Application element creation, rendering,
// event handlers and state decisions come from dashboardHtml's emitted script.
// This does not claim layout, native focus trapping, or screen-reader coverage.
function createDocument(html) {
  const document = { activeElement: null };
  class Node {
    constructor(tag = '', text = '') {
      this.nodeType = tag ? 1 : 3; this.tagName = tag.toUpperCase(); this._text = text;
      this.childNodes = []; this.parentNode = null; this.attrs = new Map(); this.dataset = {};
      this.listeners = new Map(); this.hidden = false; this.disabled = false; this.checked = false;
      this.value = ''; this.selectionStart = 0; this.selectionEnd = 0;
      this.style = { setProperty() {} };
      this.classList = { contains: value => this.className.split(/\s+/).includes(value) };
    }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get textContent() { return this.nodeType === 3 ? this._text : this.childNodes.map(node => node.textContent).join(''); }
    set textContent(text) { if (this.nodeType === 3) this._text = String(text); else this.replaceChildren(new Node('', String(text))); }
    get className() { return this.attrs.get('class') || ''; }
    set className(value) { this.attrs.set('class', value); }
    get id() { return this.attrs.get('id') || ''; }
    get open() { return this.attrs.has('open'); }
    set open(value) { if (value) this.attrs.set('open', ''); else this.attrs.delete('open'); }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    append(...nodes) {
      for (const item of nodes) { const node = item && item.nodeType ? item : new Node('', String(item)); node.parentNode = this; this.childNodes.push(node); }
      if (this.tagName === 'SELECT') this.value = (this.children.find(node => node.attrs.has('selected')) || this.children[0])?.value || '';
    }
    replaceChildren(...nodes) {
      if (this.childNodes.some(node => node.contains(document.activeElement))) document.activeElement = document.body;
      for (const node of this.childNodes) node.parentNode = null;
      this.childNodes = []; this.append(...nodes);
    }
    contains(node) { return this === node || this.childNodes.some(child => child.contains(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const tag = part.trim().match(/^[a-z][a-z0-9]*/i)?.[0];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        const id = part.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
        const cls = part.match(/\.([\w-]+)/)?.[1]; if (cls && !this.classList.contains(cls)) return false;
        for (const [, name, , value] of part.matchAll(/\[([\w-]+)(?:=(['"]?)(.*?)\2)?\]/g)) {
          if (!this.attrs.has(name) || value !== undefined && this.getAttribute(name) !== value) return false;
        }
        return this.nodeType === 1;
      });
    }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(event, handler) { const handlers = this.listeners.get(event) || []; handlers.push(handler); this.listeners.set(event, handlers); }
    async dispatch(event, properties = {}) { for (const handler of this.listeners.get(event) || []) await handler({ target: this, preventDefault() {}, ...properties }); }
    async click() { if (!this.disabled) await this.dispatch('click'); }
    focus() { if (this.isConnected && !this.hidden) document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    select() { this.setSelectionRange(0, this.value.length); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  document.body = new Node('body'); document.activeElement = document.body;
  document.createElement = tag => new Node(tag);
  document.createTextNode = text => new Node('', text);
  document.querySelector = selector => document.body.querySelector(selector);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  // Mount only named application roots and the real filter controls. Dynamic
  // children are always constructed by the application, never by a fixture.
  for (const [, tag, attrs] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="[^"]+"[^>]*)>/gi)) {
    const node = new Node(tag);
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(key, value);
    document.body.append(node);
  }
  for (const [, attrs, label] of html.matchAll(/<button\b([^>]*\bdata-filter="[^"]+"[^>]*)>([^<]*)<\/button>/g)) {
    const node = new Node('button');
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(key, value);
    node.textContent = label; document.body.append(node);
  }
  return document;
}

try {
  const bundle = join(temporary, 'dashboard.mjs');
  await build({ stdin: { contents: 'export { dashboardHtml } from "./src/dashboard.ts"; export { PLATFORMS, setupGuide } from "./src/platforms.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { dashboardHtml, PLATFORMS, setupGuide } = await import(pathToFileURL(bundle).href);
  const html = dashboardHtml('Local QA', { hosted: true });
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  new Script(source); // Validate the entire emitted script, including bootstrap.
  const escaped = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function functionSource(name) {
    const match = source.match(new RegExp('^  (?:async )?function ' + escaped(name) + '\\([^]*?^  }', 'm'));
    assert.ok(match, `Missing render function ${name}`); return match[0];
  }
  function variableSource(name) {
    const start = source.match(new RegExp('^  const ' + escaped(name) + ' = [^\\n]*', 'm'));
    assert.ok(start, `Missing render helper ${name}`);
    if (start[0].endsWith(';')) return start[0];
    const rest = source.slice(start.index), end = rest.match(/^  };$/m);
    assert.ok(end, `Missing multiline helper terminator ${name}`); return rest.slice(0, end.index + end[0].length);
  }
  const functionNames = ['el', 'ago', 'isLit', 'cadence', 'pickupText', 'status', 'jobStatus', 'platformIcon', 'startKey', 'renderStart', 'renderJobs', 'testJob', 'verifiedTest', 'readiness', 'renderSetup', 'setupPrompts', 'updateSetupStatus', 'runTest', 'settingsForm', 'copyBox', 'renderJobDrawer', 'replyBox', 'openHelp', 'uniqueHandle', 'renderPlatformGrid', 'renderSharedConnections', 'renderConnectForm', 'connectBlurb', 'openEdit', 'renderAgentDrawer', 'rememberPairing', 'currentPairing', 'newPairingCode', 'openSetup', 'renderSchedules', 'openWorkspace'];
  const variableNames = ['$', '$$', 'TYPE_LABEL', 'STATUS', 'OPEN', 'POLL', 'GLYPH', 'agentById', 'who', 'pollLabel', 'platformOf', 'route', 'lamp', 'clock', 'body', 'resultRevision', 'workAttempts', 'dialog', 'cbody', 'typeWords'];
  const dismiss = source.match(/^  \$\("#start-hide"\).*$/m);
  const filters = source.match(/^  \$\$\("\[data-filter\]"\)[^]*?^  }\)\);/m);
  assert.ok(dismiss); assert.ok(filters);
  const program = [...functionNames.map(functionSource), ...variableNames.map(variableSource), dismiss[0], filters[0]].join('\n');

  const now = new Date().toISOString();
  const agent = (id = 'muse', extra = {}) => ({ id, handle: id, name: id === 'muse' ? 'Muse' : id, platform: id === 'sender' ? 'chatgpt' : id, can_work: true, can_request: true, last_seen_at: now, poll_minutes: null, work_types: ['task'], accept_from: ['*'], request_targets: ['*'], daily_work_limit: 50, daily_job_limit: 50, max_leases: 1, stats: {}, ...extra });
  const job = (id, status, extra = {}) => ({ id, status, to: 'muse', from: 'owner', title: id, type: 'task', goal: 'Synthetic task', created_at: now, attempts: 1, max_attempts: 3, thread: [], inputs: {}, ...extra });
  const testJob = (status = 'queued', extra = {}) => job('test-muse', status, { inputs: { connection_test: true, expected_response: 'Connected: fixture' }, ...extra });
  const verified = () => testJob('completed', { result: { summary: 'Connected: fixture', validation: { ok: true } } });
  const pair = () => [agent('sender', { can_work: false }), agent()];

  function fixture({ agents = [], jobs = [], hosted = true, realSetup = false, schedules = [] } = {}) {
    const document = createDocument(html), calls = [], saved = new Map();
    const context = createContext({ document, console, crypto: { randomUUID }, setTimeout() {},
      HOSTED: hosted, ASSETS: {}, taskFilter: 'all', showSetup: false, session: { workspace: { id: 'workspace-a' } },
      data: { agents, jobs, platforms: plain(PLATFORMS), events: [], schedules }, drawer: null,
      testsInFlight: new Set(), testAttempts: new Map(), formSeq: 0, drafts: {},
      pairingCodes: new Map(), pairingInFlight: new Set(), sessionEpoch: 0,
      store: { get: key => saved.get(key), set: (key, value) => saved.set(key, value), del: key => saved.delete(key) },
      workers: () => context.data.agents.filter(a => a.can_work),
      api: async (...args) => { calls.push(['api', ...args]); return { job: job('new-test', 'queued') }; },
      load: async () => { calls.push(['load']); }, toast: message => calls.push(['toast', message]),
      openConnect: () => calls.push(['connect']), openAgent: id => calls.push(['agent', id]),
      openJob: id => calls.push(['job', id]), openCompose: () => calls.push(['compose']),
      openDrawer: () => {}, closeDrawer: () => { context.drawer = null; }, copy: async () => true,
      renderPlatformGrid: () => calls.push(['platforms']), rotate: () => calls.push(['rotate']),
      confirm: () => true, prompt: () => 'DELETE', finishSignOut: async message => calls.push(['signout', message]),
      act: async (...args) => { calls.push(['act', ...args]); },
    });
    new Script(program, { filename: 'dashboard-render-functions.js' }).runInContext(context);
    if (!realSetup) context.openSetup = id => calls.push(['setup', id]);
    return { context, document, calls, saved,
      $: selector => document.querySelector(selector), $$: selector => document.querySelectorAll(selector),
      renderStart: () => context.renderStart(), startAction: () => document.querySelector('#start-continue'),
      setup(overrides = {}) { context.drawer = { kind: 'setup', id: agents[0].id, guide: setupGuide({ agentId: agents[0].id, name: agents[0].name, token: 'synthetic-private-key', relayUrl: 'http://127.0.0.1:8787', canWork: !!agents[0].can_work, canRequest: !!agents[0].can_request, workTypes: agents[0].work_types, pollMinutes: agents[0].poll_minutes, platform: agents[0].platform, hosted, pairingCode: 'synthetic-one-use-code', ...overrides }) }; context.rememberPairing(agents[0].id, context.drawer.guide, { expires_at: new Date(Date.now() + 600000).toISOString() }); context.renderSetup(); },
    };
  }

  await check('empty workspace prompts the first connection and opens the picker', async () => {
    const f = fixture(); f.renderStart(); assert.equal(f.$('#start').hidden, false);
    assert.match(f.startAction().textContent, /first agent/); await f.startAction().click(); assert.deepEqual(f.calls, [['connect']]);
  });
  await check('an unpaired connection resumes its own setup without creating another', async () => {
    const f = fixture({ agents: [agent('muse', { last_seen_at: null })] }); f.renderStart();
    assert.match(f.$('#h-start').textContent, /Finish connecting Muse/); await f.startAction().click(); assert.deepEqual(f.calls, [['setup', 'muse']]);
  });
  await check('one checked-in connection prompts a second app', async () => {
    const f = fixture({ agents: [agent()] }); f.renderStart();
    assert.match(f.startAction().textContent, /another agent/); await f.startAction().click(); assert.deepEqual(f.calls, [['connect']]);
  });
  await check('two send-only connections prompt a receiver rather than an impossible test', async () => {
    const f = fixture({ agents: pair().map(a => ({ ...a, can_work: false })) }); f.renderStart();
    assert.match(f.startAction().textContent, /receiver/); await f.startAction().click(); assert.deepEqual(f.calls, [['connect']]);
  });
  await check('two connections without a test send the test to the receiver', async () => {
    const f = fixture({ agents: pair() }); f.renderStart(); await f.startAction().click();
    assert.equal(f.calls.filter(call => call[0] === 'api').length, 1); assert.equal(f.calls[0][1], '/v1/admin/agents/muse/test');
    assert.equal(f.calls[0][2].method, 'POST'); assert.ok(f.calls.some(call => call[0] === 'job' && call[1] === 'new-test'));
  });
  await check('onboarding prioritizes a receiver with a pending test over another receiver', async () => {
    const f = fixture({ agents: [agent('claude'), agent()], jobs: [testJob()] }); f.renderStart(); await f.startAction().click();
    assert.deepEqual(f.calls, [['job', 'test-muse']]);
  });
  await check('a verified test advances to a useful task without completing onboarding', async () => {
    const f = fixture({ agents: pair(), jobs: [verified()] }); f.renderStart();
    assert.equal(f.$('#start').hidden, false); assert.match(f.startAction().textContent, /Send a task/);
    await f.startAction().click(); assert.deepEqual(f.calls, [['compose']]);
  });
  await check('a completed dashboard-origin task completes onboarding', () => {
    const f = fixture({ agents: pair(), jobs: [job('owner-handoff', 'completed')] }); f.renderStart();
    assert.equal(f.$('#start').hidden, true);
    assert.match(f.$('#start-steps').children[2].textContent, /complete/);
  });
  await check('test completion and failed tasks cannot count as a useful handoff', () => {
    const f = fixture({ agents: pair(), jobs: [verified(), job('failed-handoff', 'failed')] }); f.renderStart();
    assert.equal(f.$('#start').hidden, false); assert.doesNotMatch(f.$('#start-steps').children[2].textContent, /complete/);
  });
  await check('dismissal is workspace-scoped and survives subsequent renders', async () => {
    const f = fixture(); f.renderStart(); await f.$('#start-hide').click(); f.renderStart(); assert.equal(f.$('#start').hidden, true);
    f.context.session.workspace.id = 'workspace-b'; f.renderStart(); assert.equal(f.$('#start').hidden, false);
  });
  await check('explicitly reopened completed onboarding stays open across polling until dismissed', async () => {
    const f = fixture({ agents: pair(), jobs: [job('done', 'completed')] }); f.context.openHelp();
    await f.$('#drawer-body').querySelector('button').click(); f.renderStart(); f.renderStart();
    assert.equal(f.$('#start').hidden, false); await f.$('#start-hide').click(); f.renderStart(); assert.equal(f.$('#start').hidden, true);
  });
  await check('onboarding refresh preserves focus on the replacement action button', () => {
    const f = fixture(); f.renderStart(); const before = f.startAction(); before.focus(); f.renderStart();
    assert.notEqual(f.startAction(), before); assert.equal(f.document.activeElement, f.startAction());
  });

  await check('task filters render the intended status sets and update pressed state', async () => {
    const statuses = ['queued', 'claimed', 'needs_approval', 'input_required', 'completed', 'failed', 'canceled', 'expired'];
    const f = fixture({ jobs: statuses.map(status => job(status, status)) }); f.context.renderJobs();
    const visible = () => f.$('#jobs').children.map(node => node.dataset.jobId);
    assert.deepEqual(visible(), statuses);
    await f.$('[data-filter="open"]').click(); assert.deepEqual(visible(), statuses.slice(0, 4));
    assert.equal(f.$('[data-filter="open"]').getAttribute('aria-pressed'), 'true'); assert.equal(f.$('[data-filter="all"]').getAttribute('aria-pressed'), 'false');
    await f.$('[data-filter="results"]').click(); assert.deepEqual(visible(), ['completed']); assert.equal(f.$('#job-count').textContent, '1 task');
    await f.$('[data-filter="all"]').click(); assert.deepEqual(visible(), statuses);
  });
  await check('filter selection survives refresh and shows newly completed work under results', async () => {
    const f = fixture({ jobs: [job('task', 'queued')] }); await f.$('[data-filter="results"]').click();
    assert.match(f.$('#jobs').textContent, /No results yet/); f.context.data.jobs[0].status = 'completed'; f.context.renderJobs();
    assert.equal(f.$('#jobs').children[0].dataset.jobId, 'task'); assert.equal(f.$('[data-filter="results"]').getAttribute('aria-pressed'), 'true');
  });
  await check('empty task states offer an appropriate action without fabricating an empty workspace', async () => {
    const f = fixture(); f.context.renderJobs(); await f.$('#jobs').querySelector('button').click(); assert.deepEqual(f.calls, [['connect']]);
    const ready = fixture({ agents: [agent()] }); ready.context.renderJobs(); await ready.$('#jobs').querySelector('button').click(); assert.deepEqual(ready.calls, [['compose']]);
    const done = fixture({ jobs: [job('done', 'completed')] }); await done.$('[data-filter="open"]').click();
    assert.match(done.$('#jobs').textContent, /Nothing in progress/); assert.equal(done.$('#jobs').querySelector('button'), null);
  });
  await check('task titles remain literal text and keyboard activation opens the correct task', async () => {
    const f = fixture({ jobs: [job('safe-id', 'queued', { title: '<img src=x onerror=alert(1)>' })] }); f.context.renderJobs();
    assert.match(f.$('#jobs').textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(f.$('#jobs').querySelector('img'), null);
    await f.$('[data-job-id]').dispatch('keydown', { key: 'Enter' }); assert.deepEqual(f.calls, [['job', 'safe-id']]);
  });

  await check('setup distinguishes first contact from a verified response', () => {
    const f = fixture({ agents: [agent('muse', { last_seen_at: null })] }); f.setup();
    assert.equal(f.$('#setup-status').dataset.state, 'waiting'); assert.match(f.$('#setup-status').textContent, /Waiting for first check-in/);
    f.context.data.agents[0].last_seen_at = now; f.context.updateSetupStatus();
    assert.equal(f.$('#setup-status').dataset.state, 'contact'); assert.doesNotMatch(f.$('#setup-status').textContent, /Test response verified/);
  });
  for (const [status, title] of [['queued', 'waiting for pickup'], ['claimed', 'running the test'], ['needs_approval', 'needs approval'], ['input_required', 'needs your input']]) {
    await check(`${status} setup test opens the existing task without another POST`, async () => {
      const f = fixture({ agents: [agent()], jobs: [testJob(status)] }); f.setup();
      assert.equal(f.$('#setup-status').dataset.state, 'testing'); assert.match(f.$('#setup-status').textContent, new RegExp(title));
      await f.$('#setup-test-button').click(); await f.context.runTest('muse');
      assert.deepEqual(f.calls, [['job', 'test-muse'], ['job', 'test-muse']]);
    });
  }
  await check('format-valid but incorrect connection markers are not reported as verified', () => {
    const f = fixture({ agents: [agent()], jobs: [testJob('completed', { result: { summary: 'Different marker', validation: { ok: true } } })] }); f.setup();
    assert.equal(f.$('#setup-status').dataset.state, 'review'); assert.match(f.$('#setup-test-button').textContent, /Review test result/);
    f.context.data.jobs[0] = verified(); f.context.updateSetupStatus();
    assert.equal(f.$('#setup-status').dataset.state, 'verified'); assert.doesNotMatch(f.$('#setup-status').textContent, /acknowledged|delivered to sender/i);
    f.context.data.jobs[0].result.validation.ok = false; f.context.updateSetupStatus(); assert.equal(f.$('#setup-status').dataset.state, 'review');
  });
  await check('failed, expired and canceled setup tests offer an actual retry', async () => {
    for (const status of ['failed', 'expired', 'canceled']) {
      const f = fixture({ agents: [agent()], jobs: [testJob(status)] }); f.setup();
      assert.equal(f.$('#setup-test-button').textContent, 'Try test again'); await f.$('#setup-test-button').click();
      assert.equal(f.calls.filter(call => call[0] === 'api').length, 1);
    }
  });
  await check('concurrent test clicks send only one request and network retry reuses its identifier', async () => {
    const f = fixture({ agents: [agent()] }), pending = deferred(), requests = [];
    f.context.api = async (path, options) => { requests.push({ path, options }); await pending.promise; throw new Error('Connection interrupted'); };
    const first = f.context.runTest('muse'); await f.context.runTest('muse'); assert.equal(requests.length, 1);
    pending.resolve(); await first; await f.context.runTest('muse'); assert.equal(requests.length, 2);
    assert.equal(requests[0].options.idempotencyKey, requests[1].options.idempotencyKey);
  });
  await check('unchanged setup status retains the live-region children and disables an in-flight test', () => {
    const f = fixture({ agents: [agent()] }); f.setup(); const before = f.$('#setup-status').children[0];
    f.context.testsInFlight.add('muse'); f.context.updateSetupStatus(); assert.equal(f.$('#setup-test-button').disabled, true);
    assert.equal(f.$('#setup-status').children[0], before); f.context.testsInFlight.delete('muse'); f.context.updateSetupStatus(); assert.equal(f.$('#setup-test-button').disabled, false);
  });
  await check('setup uses real platform guidance and keeps private instructions in an explicit disclosure', () => {
    const f = fixture({ agents: [agent()] }); f.setup();
    assert.match(f.$('#drawer-body').textContent, /synthetic-one-use-code/);
    const disclosure = f.$('#drawer-body').querySelector('details.setup-copy'); assert.ok(disclosure); assert.equal(disclosure.open, false);
    const privateRelay = fixture({ agents: [agent('chatgpt')], hosted: false }); privateRelay.setup();
    assert.match(privateRelay.$('#drawer-body').querySelector('details.setup-copy').textContent, /synthetic-private-key/);
  });
  await check('connection settings preserve coding send-only defaults and explicit existing permissions', () => {
    const f = fixture(); const coding = f.context.settingsForm(PLATFORMS.find(p => p.id === 'codex'), null).read();
    assert.equal(coding.can_request, true); assert.equal(coding.can_work, false); assert.deepEqual(plain(coding.work_types), []); assert.equal(coding.poll_minutes, null);
    const existing = agent('muse', { can_request: false, work_types: ['research'], poll_minutes: 15, max_leases: 2, daily_work_limit: 80, accept_from: ['*'] });
    const form = f.context.settingsForm(PLATFORMS.find(p => p.id === 'muse'), existing);
    assert.deepEqual(plain(form.read()), { name: 'Muse', can_request: false, can_work: true, work_types: ['research'], poll_minutes: 15, max_leases: 2, daily_work_limit: 80, accept_from: ['*'] });
  });

  const buttonNamed = (f, text, root = f.$('#drawer-body')) => root.querySelectorAll('button').find(node => node.textContent === text);
  await check('renaming an existing send-only connection saves only its name and retains the pairing state', async () => {
    const f = fixture({ agents: [agent('ag_codex', { handle: 'codex', platform: 'codex', can_work: false, work_types: [] })] });
    const pairing = { instructions: 'Existing synthetic code', expires_at: new Date(Date.now() + 600000).toISOString() };
    f.context.pairingCodes.set('ag_codex', pairing); f.context.openEdit('ag_codex');
    assert.match(f.$('#drawer-body').textContent, /Names and ordinary settings preserve authorization/);
    assert.match(f.$('#drawer-body').textContent, /previous consent requires fresh authorization/);
    f.$('#drawer-body').querySelector('input[type="text"]').value = 'Build helper';
    await buttonNamed(f, 'Save').click();
    const saves = f.calls.filter(call => call[0] === 'api'); assert.equal(saves.length, 1);
    assert.deepEqual(plain(saves[0][2].body), { id: 'ag_codex', name: 'Build helper' });
    assert.equal(f.context.pairingCodes.get('ag_codex'), pairing); assert.ok(f.calls.some(call => call[0] === 'agent'));
  });
  await check('an unchanged settings save sends no mutation or setup request', async () => {
    const f = fixture({ agents: [agent()] }); f.context.openEdit('muse'); await buttonNamed(f, 'Save').click();
    assert.equal(f.calls.filter(call => call[0] === 'api').length, 0); assert.ok(f.calls.some(call => call[0] === 'toast' && /No changes/.test(call[1])));
  });
  await check('enabling receive saves its changed fields and explains potential fresh app consent', async () => {
    const f = fixture({ agents: [agent('codex', { can_work: false, work_types: [] })] }); f.context.openEdit('codex');
    f.$('#drawer-body').querySelectorAll('input[type="checkbox"]')[1].checked = true;
    await buttonNamed(f, 'Save').click();
    assert.deepEqual(plain(f.calls.find(call => call[0] === 'api')[2].body), { id: 'codex', can_work: true, work_types: ['task'] });
    assert.ok(f.calls.some(call => call[0] === 'toast' && /fresh authorization in your app/.test(call[1])));
  });
  await check('handles remain unique after connection renames and the suggested ID cannot bypass that check', async () => {
    const f = fixture({ agents: [agent('ag_existing', { handle: 'muse', name: 'Research helper', platform: 'muse' })] });
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { agent: { id: 'ag_new' } }; };
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'muse'));
    await buttonNamed(f, 'Get setup instructions', f.$('#connect-body')).click();
    assert.equal(f.calls.find(call => call[0] === 'api')[2].body.id, 'muse-2');
    assert.equal(f.context.uniqueHandle('owner'), 'agent-owner'); assert.equal(f.context.uniqueHandle('a'), 'agent-a');
  });
  await check('a handle collision offers existing setup instead of creating a second connection', async () => {
    const f = fixture(); let tries = 0;
    f.context.api = async (...args) => {
      f.calls.push(['api', ...args]);
      if (++tries === 1) throw Object.assign(new Error('Handle occupied'), { code: 'handle_taken' });
      return { agent: { id: 'ag_new' } };
    };
    f.context.load = async () => { f.calls.push(['load']); f.context.data.agents = [agent('ag_other', { handle: 'muse' })]; };
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'muse'));
    f.$('#connect-dialog').showModal();
    const connect = buttonNamed(f, 'Get setup instructions', f.$('#connect-body')); await connect.click();
    assert.match(f.$('#connect-body').textContent, /Review its setup before adding another/); assert.equal(connect.disabled, false);
    await connect.click(); assert.deepEqual(f.calls.filter(call => call[0] === 'api').map(call => call[2].body.id), ['muse']);
    assert.ok(f.calls.some(call => call[0] === 'setup' && call[1] === 'ag_other'));
  });

  await check('Dot is a distinct picker option with manual defaults and optional provider scheduling', async () => {
    const f = fixture(); f.context.renderPlatformGrid();
    const tiles = f.$('#connect-body').querySelectorAll('button.tile');
    assert.ok(tiles.some(tile => tile.textContent.startsWith('●Dot')));
    assert.ok(tiles.some(tile => tile.textContent.includes('ChatGPT')));
    await tiles.find(tile => tile.textContent.startsWith('●Dot')).click();
    assert.match(f.$('#connect-body').textContent, /One Hitchhike plugin connection/);
    const form = f.context.settingsForm(PLATFORMS.find(p => p.id === 'dot'), null);
    assert.deepEqual(plain(form.read()).poll_minutes, null);
    assert.equal(form.read().can_request, true); assert.equal(form.read().can_work, true);
    const select = form.nodes.flatMap(node => node.querySelectorAll('select')).find(node => node.getAttribute('aria-label') === 'Check for tasks');
    assert.deepEqual(select.children.map(option => option.value), ['', '60', '240', '1440']);
  });
  await check('Dots setup has one introduction, shared identity guidance, and optional diagnostics', () => {
    const f = fixture({ agents: [agent('dot', { name: 'Dot' })] }); f.setup();
    const text = f.$('#drawer-body').textContent;
    assert.match(text, /ChatGPT and Dots share plugin settings/);
    assert.match(f.$('#setup-prompt-content').textContent, /connection_status/);
    assert.match(f.$('#setup-prompt-content').textContent, /If helpful, you may/);
    assert.doesNotMatch(f.$('#setup-prompt-content').textContent, /Create an hourly|consumer_id|get_next_job|check_inbox/);
    assert.equal(f.$('#setup-diagnostics').open, false);
    assert.ok(f.$('#setup-diagnostics').contains(f.$('#setup-test-button')));
    assert.equal(f.$('#new-pairing-code'), null); assert.equal(f.context.pairingCodes.size, 0);
    assert.doesNotMatch(text, /synthetic-private-key|synthetic-one-use-code|After the read-only setup check succeeds/);
    assert.equal(f.$('#drawer-body').querySelectorAll('button').filter(node => node.textContent === 'Copy introduction').length, 1);
  });
  await check('single introductions request selected scheduling without adding setup prerequisites', () => {
    for (const platform of ['claude','grok','chatgpt']) {
      const f=fixture({agents:[agent(platform)]}); f.setup({conversationTools:true});
      assert.match(f.$('#setup-prompt-content').textContent,/Create an hourly scheduled task/);
      assert.equal((f.$('#drawer-body').textContent.match(/Create an hourly scheduled task/g)||[]).length,1);
      assert.match(f.$('#setup-prompt-content').textContent,/Report whether it was saved, its next run, or any limitation/);
      assert.doesNotMatch(f.$('#drawer-body').textContent,/does not.*create a schedule|After the read-only setup check succeeds|two actual scheduled/);
      assert.equal(f.$('#setup-diagnostics').open,false);
      const steps=f.$('#drawer-body').querySelector('.guide-steps').textContent;
      assert.doesNotMatch(steps,/Confirm access|Test task pickup|Receive a task/);
    }
  });
  await check('paired setup includes the chosen schedule once and requires no second introduction', () => {
    for(const platform of ['muse','grok-bot']) {
      const f=fixture({agents:[agent(platform)]}); f.setup({conversationTools:true,background:{enabled:true,intervalMinutes:10}});
      const text=f.$('#drawer-body').textContent;
      assert.equal((text.match(/every 10 minutes/g)||[]).length,1);
      assert.match(text,/synthetic-one-use-code/);
      assert.equal(f.$('#setup-prompt-content'),null);
      assert.equal(f.$('#setup-diagnostics').open,false);
      assert.doesNotMatch(f.$('#drawer-body').querySelector('.guide-steps').textContent,/Prove the exchange|Add background checks/);
    }
  });
  await check('sender-only and receiver-only introductions respect current permissions', () => {
    for (const platform of ['dot', 'chatgpt', 'claude', 'grok', 'muse', 'grok-bot']) {
      for (const canWork of [true, false]) {
        const f = fixture({ agents: [agent(platform, { can_work: canWork, can_request: !canWork })] }); f.setup({background:{enabled:true,intervalMinutes:60}});
        const prompt = f.$('#setup-prompt-content')?.textContent || f.$('#drawer-body').querySelector('details.setup-copy').textContent;
        assert.equal(prompt.includes('handle eligible work'), canWork, platform);
        assert.equal(prompt.includes('retrieve replies'), !canWork, platform);
        assert.equal(!!f.$('#setup-test-button'), canWork, platform);
        assert.doesNotMatch(prompt,/get_next_job|claim_request|send_job|list_agents/);
      }
    }
  });
  await check('saved intervals never claim a running schedule and explicit off requests none', () => {
    const f = fixture({ agents: [agent('dot', { poll_minutes: 60 })] }); f.setup();
    assert.match(f.context.cadence(f.context.data.agents[0]), /Check interval/);
    assert.match(f.context.pickupText(f.context.data.agents[0]), /has not verified/);
    assert.doesNotMatch(f.$('#setup-prompt-content').textContent, /Create an hourly/);
    const off=fixture({agents:[agent('claude')]}); off.setup({background:{enabled:false}});
    assert.doesNotMatch(off.$('#setup-prompt-content').textContent,/Create an hourly/);
    assert.match(off.$('#drawer-body').textContent,/Background checking is off/);
    assert.equal(PLATFORMS.find(p => p.id === 'muse').defaults.poll_minutes, null);
    assert.equal(PLATFORMS.find(p => p.id === 'grok-bot').defaults.poll_minutes, null);
  });
  await check('Dots reuses an existing ChatGPT connection and targets its actual identity without a write', async () => {
    const shared = agent('shared-openai', { platform: 'chatgpt', name: 'ChatGPT', poll_minutes: 240 });
    const unused = agent('unused-dot', { platform: 'dot', name: 'Unused dot', last_seen_at: null });
    const f = fixture({ agents: [unused, shared], realSetup: true }), before = plain(f.context.data);
    const guide = setupGuide({ agentId: shared.id, name: shared.name, token: '', relayUrl: 'https://relay.example.test', canWork: true, canRequest: true, workTypes: ['task'], pollMinutes: 240, platform: 'chatgpt', hosted: true });
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { guide }; };
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot')); f.$('#connect-dialog').showModal();
    assert.match(f.$('#connect-body').textContent, /Use your existing connection/);
    assert.equal(f.$('#connect-body').querySelectorAll('.shared-connection')[0].querySelector('strong').textContent, 'ChatGPT');
    await buttonNamed(f, 'Use ChatGPT', f.$('#connect-body')).click();
    assert.equal(f.$('#connect-dialog').open, false); assert.equal(f.$('#setup-prompt-target').value, 'dot');
    assert.match(f.$('#setup-prompt-content').textContent, /shared-openai/); assert.doesNotMatch(f.$('#setup-prompt-content').textContent, /unused-dot/);
    assert.deepEqual(f.calls, [['api', '/v1/admin/agents/shared-openai/setup']]);
    assert.deepEqual(plain(f.context.data), before);
  });
  await check('ChatGPT, Dots and Both copy the selected prompt without changing identity or creating work', async () => {
    const f = fixture({ agents: [agent('shared-openai', { platform: 'chatgpt', name: 'Shared assistant' })] }); f.setup();
    const before = plain(f.context.data), copied = [];
    f.context.copy = async text => copied.push(text);
    for (const target of ['chatgpt', 'dot', 'both']) {
      const select = f.$('#setup-prompt-target'); select.value = target; await select.dispatch('change');
      const expected = f.context.drawer.guide.prompts.find(p => p.target === target).copy;
      await buttonNamed(f, 'Copy introduction').click(); assert.equal(copied.at(-1), expected);
      assert.match(expected, /shared-openai/); assert.match(expected, /Stop on an identity mismatch/);
      assert.match(expected, /Create an hourly scheduled task/); assert.match(expected, /saved permissions and sharing preferences/);
      f.context.updateSetupStatus(); assert.equal(f.$('#setup-prompt-target'), select);
      assert.equal(select.value, target);
    }
    assert.match(f.$('#setup-prompt-content').textContent, /These apps share one connection/);
    f.context.renderSetup(); assert.equal(f.$('#setup-prompt-target').value, 'both');
    assert.deepEqual(plain(f.context.data), before); assert.deepEqual(f.calls, []);
  });
  await check('interrupted shared setup retries the read and preserves the requested Dots prompt', async () => {
    const f = fixture({ agents: [agent('shared-openai', { platform: 'chatgpt' })], realSetup: true }); let attempts = 0;
    const guide = setupGuide({ agentId: 'shared-openai', name: 'Shared assistant', token: '', relayUrl: 'https://relay.example.test', canWork: true, canRequest: true, workTypes: ['task'], pollMinutes: null, platform: 'chatgpt', hosted: true });
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); if (++attempts === 1) throw new Error('Interrupted read'); return { guide }; };
    await f.context.openSetup('shared-openai', null, null, 'dot');
    assert.match(f.$('#drawer-body').textContent, /Interrupted read/); await buttonNamed(f, 'Try again').click();
    assert.equal(f.$('#setup-prompt-target').value, 'dot');
    f.context.drawer = null; await f.context.openSetup('shared-openai', null, null, 'both');
    assert.equal(f.$('#setup-prompt-target').value, 'both');
    assert.deepEqual(f.calls, Array.from({ length: 3 }, () => ['api', '/v1/admin/agents/shared-openai/setup']));
  });
  await check('clipboard failure leaves the prompt readable and never claims it was copied', async () => {
    for (const throws of [false, true]) {
      const f = fixture({ agents: [agent('chatgpt')] }); f.setup();
      f.context.copy = async () => { if (throws) throw new Error('Clipboard denied'); return false; };
      await buttonNamed(f, 'Copy introduction').click();
      assert.ok(buttonNamed(f, 'Copy introduction')); assert.equal(buttonNamed(f, 'Copied'), undefined);
      assert.match(f.$('#setup-prompt-content').textContent, /Use Hitchhike as/);
      assert.ok(f.calls.some(call => call[0] === 'toast' && /copy it manually/.test(call[1])));
    }
  });
  await check('a stale shared setup response cannot overwrite another connection or its prompt', async () => {
    const f = fixture({ agents: [agent('shared-openai', { platform: 'chatgpt' })], realSetup: true }), pending = deferred();
    f.context.api = () => pending.promise;
    const opening = f.context.openSetup('shared-openai', null, null, 'dot');
    f.context.drawer = { kind: 'agent', id: 'another-connection' };
    pending.resolve({ guide: { platform: 'chatgpt', prompts: [] } }); await opening;
    assert.equal(f.context.drawer.kind, 'agent'); assert.equal(f.context.drawer.id, 'another-connection');
  });
  await check('separate OpenAI records require an explicit choice after shared-authorization limits', async () => {
    const f = fixture({ agents: [agent('shared-openai', { platform: 'chatgpt', name: 'ChatGPT' })] });
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot'));
    const details = f.$('#connect-body').querySelector('details');
    assert.equal(details.open, false); assert.match(details.textContent, /Independently scoped simultaneous ChatGPT and Dots connections are unverified/);
    assert.equal(buttonNamed(f, 'Get setup instructions', f.$('#connect-body')), undefined);
    await buttonNamed(f, 'Create a separate connection', f.$('#connect-body')).click();
    assert.ok(buttonNamed(f, 'Get setup instructions', f.$('#connect-body')));
    assert.match(f.$('#connect-body').textContent, /reconnecting the shared plugin can affect both apps/);
    assert.deepEqual(f.calls, []);
  });
  await check('a saved Dot connection survives a failed refresh without a second POST or rotation', async () => {
    const f = fixture(), pending = deferred(); let loads = 0;
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); await pending.promise; return { agent: { id: 'ag_dot' } }; };
    f.context.load = async () => { if (++loads === 1) throw new Error('Refresh interrupted'); };
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot')); f.$('#connect-dialog').showModal();
    const button = buttonNamed(f, 'Get setup instructions', f.$('#connect-body'));
    const first = button.click(); await button.click(); assert.equal(f.calls.length, 1);
    pending.resolve(); await first;
    assert.match(f.$('#connect-body').textContent, /Connection saved/);
    await button.click();
    assert.equal(f.calls.filter(call => call[0] === 'api').length, 1);
    assert.equal(f.calls[0][2].body.rotate_token, undefined);
    assert.ok(f.calls.some(call => call[0] === 'setup' && call[1] === 'ag_dot'));
  });
  await check('a lost create response retries the same handle even after dashboard polling finds it', async () => {
    const f = fixture(); let tries = 0;
    f.context.api = async (...args) => {
      f.calls.push(['api', ...args]);
      if (++tries === 1) throw new Error('Response lost');
      throw Object.assign(new Error('Handle occupied'), { code: 'handle_taken' });
    };
    f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot')); f.$('#connect-dialog').showModal();
    const button = buttonNamed(f, 'Get setup instructions', f.$('#connect-body')); await button.click();
    f.context.data.agents = [agent('ag_dot', { handle: 'dots-openai', platform: 'dot' })];
    await button.click(); await button.click();
    assert.deepEqual(f.calls.filter(call => call[0] === 'api').map(call => call[2].body.id), ['dots-openai', 'dots-openai']);
    assert.ok(f.calls.some(call => call[0] === 'setup' && call[1] === 'ag_dot'));
  });
  await check('a rejected connection can correct its settings before retrying', async () => {
    for (const code of ['invalid_request', 'connection_limit']) {
      const f = fixture(); let tries = 0;
      f.context.api = async (...args) => {
        f.calls.push(['api', ...args]);
        if (++tries === 1) throw Object.assign(new Error('Correct these settings'), { code });
        return { agent: { id: 'ag_dot' } };
      };
      f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot')); f.$('#connect-dialog').showModal();
      const select = f.$('[aria-label="Check for tasks"]'); select.value = '60';
      const button = buttonNamed(f, 'Get setup instructions', f.$('#connect-body')); await button.click();
      assert.equal(select.disabled, false); select.value = ''; await button.click();
      assert.deepEqual(f.calls.filter(call => call[0] === 'api').map(call => call[2].body.poll_minutes), [60, null]);
      assert.ok(f.calls.some(call => call[0] === 'setup' && call[1] === 'ag_dot'));
    }
  });
  await check('late Dot create responses cannot reopen setup after sign-out or after another form opens', async () => {
    for (const interrupt of ['signout', 'another-form']) {
      const f = fixture(), pending = deferred();
      f.context.api = () => pending.promise;
      f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'dot')); f.$('#connect-dialog').showModal();
      const first = buttonNamed(f, 'Get setup instructions', f.$('#connect-body')).click();
      if (interrupt === 'signout') f.context.sessionEpoch++;
      else f.context.renderConnectForm(PLATFORMS.find(p => p.id === 'chatgpt'));
      pending.resolve({ agent: { id: 'ag_dot' } }); await first;
      assert.ok(!f.calls.some(call => call[0] === 'setup')); assert.equal(f.context.pairingCodes.size, 0);
    }
  });
  await check('repeated Dot setup and reload only read the existing connection', async () => {
    const f = fixture({ agents: [agent('dot', { last_seen_at: null })], realSetup: true });
    const guide = setupGuide({ agentId: 'dot', name: 'Dot', token: '', relayUrl: 'https://relay.example.test', canWork: true, canRequest: true, workTypes: ['task'], pollMinutes: null, platform: 'dot', hosted: true });
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { guide }; };
    await f.context.openSetup('dot'); f.context.drawer = null; await f.context.openSetup('dot');
    assert.deepEqual(f.calls, [['api', '/v1/admin/agents/dot/setup'], ['api', '/v1/admin/agents/dot/setup']]);
    assert.equal(f.context.pairingCodes.size, 0); assert.equal(f.saved.size, 0);
  });
  await check('hosted routine connections hide the webhook form while self-hosted ones retain it', () => {
    for (const hosted of [true, false]) {
      const f = fixture({ agents: [agent('muse', { connects: 'routine' })], hosted }); f.context.drawer = { kind: 'agent', id: 'muse' }; f.context.renderAgentDrawer();
      assert.equal(!!f.$('[aria-label="Wake-up URL"]'), !hosted); assert.match(f.$('#drawer-body').textContent, /Last seen/);
      if (hosted) assert.ok(buttonNamed(f, 'Replace credentials'));
    }
  });

  const syntheticGuide = (pairingCode = null) => setupGuide({ agentId: 'muse', name: 'Muse', token: '', relayUrl: 'http://127.0.0.1:8787', canWork: true, canRequest: true, workTypes: ['task'], pollMinutes: 15, platform: 'muse', hosted: true, ...(pairingCode ? { pairingCode } : {}) });
  await check('opening setup uses GET and preserves a generated initial code until its expiry', async () => {
    const f = fixture({ agents: [agent()], realSetup: true }), expires_at = new Date(Date.now() + 600000).toISOString();
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { guide: syntheticGuide() }; };
    await f.context.openSetup('muse', syntheticGuide('initial-code'), { expires_at });
    assert.match(f.$('#drawer-body').textContent, /initial-code/); assert.match(f.$('#pairing-expiry').textContent, /Expires.*One use/);
    assert.doesNotMatch(JSON.stringify(f.context.drawer.guide), /initial-code/);
    f.context.drawer = null; await f.context.openSetup('muse');
    assert.match(f.$('#drawer-body').textContent, /initial-code/); assert.deepEqual(f.calls, [['api', '/v1/admin/agents/muse/setup']]);
    assert.equal(f.saved.size, 0);
  });
  await check('setup without a recoverable code waits for explicit creation and displays replacement instructions', async () => {
    const f = fixture({ agents: [agent()], realSetup: true });
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { guide: syntheticGuide() }; };
    await f.context.openSetup('muse'); assert.equal(f.context.pairingCodes.size, 0);
    assert.match(f.$('#drawer-body').textContent, /earlier code cannot be recovered/); assert.match(f.$('#drawer-body').textContent, /new code replaces any unused pairing code/);
    assert.equal(f.$('#pairing-expiry'), null); assert.equal(f.calls.length, 1);
  });
  await check('explicit code creation sends one POST and replaces the in-memory instruction without persistence', async () => {
    const f = fixture({ agents: [agent()], realSetup: true }), pending = deferred(); f.setup();
    f.context.api = async (...args) => { f.calls.push(['api', ...args]); return pending.promise; };
    const first = f.$('#new-pairing-code').click(); await f.context.newPairingCode('muse'); assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][1], '/v1/admin/agents/muse/pairing'); assert.equal(f.calls[0][2].method, 'POST');
    pending.resolve({ code: 'replacement-code', instructions: 'Use replacement-code', expires_at: new Date(Date.now() + 600000).toISOString() }); await first;
    assert.match(f.$('#drawer-body').textContent, /replacement-code/); assert.doesNotMatch(f.$('#drawer-body').textContent, /synthetic-one-use-code/);
    assert.equal(f.$('#new-pairing-code').disabled, false); assert.equal(f.saved.size, 0);
  });
  await check('expired pairing instructions disappear from the rendered setup and memory on refresh', () => {
    const f = fixture({ agents: [agent()] }); f.setup(); f.context.pairingCodes.get('muse').expires_at = new Date(Date.now() - 1000).toISOString();
    f.context.updateSetupStatus(); assert.equal(f.context.pairingCodes.size, 0); assert.equal(f.$('#pairing-expiry'), null);
    assert.doesNotMatch(f.$('#drawer-body').textContent, /synthetic-one-use-code/); assert.ok(f.$('#new-pairing-code'));
  });
  await check('a pairing response arriving after sign-out cannot enter another session memory', async () => {
    const f = fixture({ agents: [agent()] }), pending = deferred(); f.setup(); f.context.api = () => pending.promise;
    const issuing = f.context.newPairingCode('muse'); f.context.sessionEpoch++; f.context.pairingCodes.clear(); f.context.drawer = null;
    pending.resolve({ instructions: 'Late private code', expires_at: new Date(Date.now() + 600000).toISOString() }); await issuing;
    assert.equal(f.context.pairingCodes.size, 0);
  });

  await check('schedule retry failures expose retry timing and disabled reasons without replacing the occurrence time', () => {
    const f = fixture({ agents: [agent()], schedules: [
      { to: 'muse', type: 'monitor', title: 'Watch launches', every_minutes: 60, enabled: true, next_run_at: now, next_attempt_at: '2026-10-01T12:00:00Z', consecutive_failures: 2, last_error: 'Daily limit reached' },
      { to: 'muse', type: 'task', title: 'Paused task', every_minutes: 1440, enabled: false, disabled_reason: 'Receiver disconnected', last_error: 'No receiver' },
    ] }); f.context.renderSchedules();
    assert.match(f.$('#schedules').textContent, /Retry .* after 2 failed runs/); assert.match(f.$('#schedules').textContent, /Last error: Daily limit reached/);
    assert.match(f.$('#schedules').textContent, /paused.*Receiver disconnected/); assert.equal(f.context.data.schedules[0].next_run_at, now);
  });
  await check('self-host workspace reset keeps the owner signed in and returns to an empty usable workspace', async () => {
    const f = fixture({ hosted: false }); f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { workspace: { name: 'Local relay', paused: false, retention_days: 30 } }; };
    await f.context.openWorkspace(); assert.match(f.$('#drawer-body').textContent, /relay will be ready for new connections after cleanup/);
    await buttonNamed(f, 'Delete workspace').click(); assert.equal(f.context.drawer, null);
    assert.equal(f.calls.filter(call => call[0] === 'signout').length, 0); assert.ok(f.calls.some(call => call[0] === 'load'));
    assert.ok(f.calls.some(call => call[0] === 'toast' && /Workspace reset/.test(call[1])));
  });
  await check('hosted workspace deletion still ends the session after successful deletion', async () => {
    const f = fixture(); f.context.api = async (...args) => { f.calls.push(['api', ...args]); return { workspace: { name: 'Hosted workspace', paused: false, retention_days: 30 } }; };
    await f.context.openWorkspace(); await buttonNamed(f, 'Delete workspace').click(); assert.ok(f.calls.some(call => call[0] === 'signout'));
  });

  const completedJob = (attempt = 1) => job('result-task', 'completed', {
    attempts: attempt, completed_at: `2026-09-27T12:0${attempt}:00Z`,
    result: { worker: 'muse', submitted_at: `2026-09-27T12:0${attempt}:00Z`, summary: `Attempt ${attempt}`, body_chars: 200, validation: { ok: true }, data: { synthetic: true } },
  });
  const readButton = f => f.$('#drawer-body').querySelectorAll('button').find(node => node.textContent === 'Read full result');
  async function resultFixture() {
    const f = fixture({ agents: [agent()], jobs: [completedJob()] });
    f.context.drawer = { kind: 'job', id: 'result-task' };
    f.context.api = async path => ({ job: { ...f.context.data.jobs[0], result: { ...f.context.data.jobs[0].result, ...(path.includes('?full=1') ? { body: 'Synthetic full body for attempt 1' } : {}) } } });
    await f.context.renderJobDrawer(false); return f;
  }
  await check('answered clarifications do not exhaust the rendered request-changes budget', async () => {
    const f = fixture({ agents: [agent()], jobs: [completedJob(5)] });
    f.context.data.jobs[0].clarification_rounds = 3; f.context.data.jobs[0].max_clarification_rounds = 5;
    f.context.drawer = { kind: 'job', id: 'result-task' }; f.context.api = async () => ({ job: f.context.data.jobs[0] });
    await f.context.renderJobDrawer(false); assert.ok(f.$('[data-disclosure="feedback"]'));
    assert.match(f.$('[data-disclosure="details"]').textContent, /Work attempt 2 of 3/); assert.match(f.$('[data-disclosure="details"]').textContent, /Clarifications answered 3 of 5/);
    f.context.data.jobs[0].attempts = 6; await f.context.renderJobDrawer(false); assert.equal(f.$('[data-disclosure="feedback"]'), null);
  });
  await check('a final work-attempt question remains answerable and a reached clarification cap offers follow-up recovery', async () => {
    const f = fixture({ agents: [agent()], jobs: [job('question-task', 'input_required', { attempts: 7, clarification_rounds: 4, max_clarification_rounds: 5, thread: [{ kind: 'question', from: 'muse', text: 'Which option?' }] })] });
    f.context.drawer = { kind: 'job', id: 'question-task' }; f.context.api = async () => ({ job: f.context.data.jobs[0] });
    await f.context.renderJobDrawer(false); assert.ok(buttonNamed(f, 'Send answer')); assert.match(f.$('#drawer-body').textContent, /Work attempt 3 of 3/);
    f.context.data.jobs[0].status = 'claimed'; f.context.data.jobs[0].clarification_rounds = 5; await f.context.renderJobDrawer(false);
    assert.match(f.$('#drawer-body').textContent, /used its clarification limit/); await buttonNamed(f, 'Start a follow-up task').click(); assert.deepEqual(f.calls, [['compose']]);
  });
  await check('unchanged task polling retains the rendered result and user-opened disclosures', async () => {
    const f = await resultFixture(), details = f.$('[data-disclosure="details"]'); details.open = true;
    await f.context.renderJobDrawer(false); assert.equal(f.$('[data-disclosure="details"]'), details); assert.equal(details.open, true);
    f.context.data.jobs[0].retrieved_at = now; await f.context.renderJobDrawer(false);
    assert.notEqual(f.$('[data-disclosure="details"]'), details); assert.equal(f.$('[data-disclosure="details"]').open, true);
  });
  await check('task updates preserve feedback text, selection and the expanded disclosure', async () => {
    const f = await resultFixture(); f.$('[data-disclosure="feedback"]').open = true;
    const area = f.$('[data-draft]'); area.value = 'Keep this draft while polling'; await area.dispatch('input'); area.focus(); area.setSelectionRange(5, 9);
    f.context.data.jobs[0].retrieved_at = now; await f.context.renderJobDrawer(false);
    const replacement = f.$('[data-draft]'); assert.equal(replacement.value, area.value); assert.equal(f.document.activeElement, replacement);
    assert.equal(replacement.selectionStart, 5); assert.equal(replacement.selectionEnd, 9); assert.equal(f.$('[data-disclosure="feedback"]').open, true);
  });
  await check('a reworked task never displays the previous attempt full body with its new result', async () => {
    const f = await resultFixture(); await readButton(f).click(); assert.match(f.$('#drawer-body').textContent, /Synthetic full body for attempt 1/);
    f.context.data.jobs[0] = job('result-task', 'queued', { attempts: 2 }); await f.context.renderJobDrawer(false);
    assert.doesNotMatch(f.$('#drawer-body').textContent, /Synthetic full body for attempt 1/);
    f.context.data.jobs[0] = completedJob(2); await f.context.renderJobDrawer(false);
    assert.match(f.$('#drawer-body').textContent, /Attempt 2/); assert.doesNotMatch(f.$('#drawer-body').textContent, /Synthetic full body for attempt 1/); assert.ok(readButton(f));
  });
  await check('a delayed full-result response updates the current DOM after an intervening rerender', async () => {
    const f = await resultFixture(), pending = deferred();
    f.context.api = async path => path.includes('?full=1') ? pending.promise : { job: f.context.data.jobs[0] };
    const original = readButton(f), reading = original.click();
    await f.context.renderJobDrawer(true); assert.equal(original.isConnected, false);
    pending.resolve({ job: { ...completedJob(), result: { ...completedJob().result, body: 'Arrived after rerender' } } }); await reading;
    assert.match(f.$('#drawer-body').textContent, /Arrived after rerender/); assert.equal(readButton(f), undefined);
  });
  await check('an old in-flight full-result response cannot overwrite a newer task attempt', async () => {
    const f = await resultFixture(), pending = deferred(); f.context.api = () => pending.promise;
    const reading = readButton(f).click(); f.context.data.jobs[0] = completedJob(2); await f.context.renderJobDrawer(false);
    pending.resolve({ job: { ...completedJob(), result: { ...completedJob().result, body: 'Stale attempt body' } } }); await reading;
    assert.match(f.$('#drawer-body').textContent, /Attempt 2/); assert.doesNotMatch(f.$('#drawer-body').textContent, /Stale attempt body/); assert.ok(readButton(f));
  });
  await check('a response for another result revision refreshes the overview without caching that body', async () => {
    const f = await resultFixture(); f.context.api = async () => ({ job: { ...completedJob(2), result: { ...completedJob(2).result, body: 'Newer response body' } } });
    await readButton(f).click(); assert.deepEqual(f.calls, [['load']]); assert.doesNotMatch(f.$('#drawer-body').textContent, /Newer response body/); assert.ok(readButton(f));
  });
  await check('queued and closed status text passes AA on the shipped plain, hover and selected backgrounds', () => {
    const token = name => {
      const match = html.match(new RegExp('--' + name + ':#([A-Fa-f0-9]{6})')); assert.ok(match);
      return match[1].match(/../g).map(channel => parseInt(channel, 16));
    };
    const mix = (front, back, amount) => front.map((channel, index) => channel * amount + back[index] * (1 - amount));
    const luminance = rgb => rgb.map(channel => { const s = channel / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    const hover = Number(html.match(/\.job:hover\{background:color-mix\(in srgb,var\(--ink\) ([\d.]+)%/)[1]) / 100;
    const selected = Number(html.match(/\.job\[aria-current="true"\]\{background:color-mix\(in srgb,var\(--working\) ([\d.]+)%/)[1]) / 100;
    const backgrounds = [token('panel'), token('paper'), mix(token('ink'), token('panel'), hover), mix(token('working'), token('panel'), selected)];
    const f = fixture({ jobs: ['queued', 'canceled', 'expired'].map(status => job(status, status)) }); f.context.renderJobs();
    for (const node of f.$('#jobs').querySelectorAll('.status')) {
      const name = node.getAttribute('style').match(/var\(--(\w+)\)/)[1];
      for (const background of backgrounds) assert.ok(contrast(token(name), background) >= 4.5, `${name} contrast ${contrast(token(name), background).toFixed(2)} is below 4.5`);
    }
    assert.match(html, /color-scheme: light/);
  });
  console.log(`\n${passed} dashboard UX checks passed (synthetic DOM/API fixtures; no browser or network).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
