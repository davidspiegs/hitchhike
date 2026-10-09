#!/usr/bin/env node
/** Exercise the MCP conversation tools against migrated SQLite and real schemas. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'hitchhike-mcp-conversations-'));
const sqlite = new DatabaseSync(':memory:');
const originalFetch = globalThis.fetch;
let checks = 0;
class Statement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  execute() {
    const statement = sqlite.prepare(this.sql);
    if (statement.columns().length) return { results: statement.all(...this.values), meta: sqlite.prepare('SELECT changes() AS changes').get(), success: true };
    return { results: [], meta: statement.run(...this.values), success: true };
  }
  async run() { return this.execute(); }
}
const DB = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const env = { DB, HOSTED: 'true', WORKSPACE_ID: 'default' };
const allScopes = ['relay:read', 'relay:send', 'relay:work'];
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const agentRow = id => sqlite.prepare('SELECT * FROM agents WHERE id=?').get(id);
function agent(id) {
  sqlite.prepare(`INSERT INTO agents(id,workspace_id,handle,name,token_hash,can_request,can_work,work_types,platform,created_at)
    VALUES (?,'default',?,?,?,1,1,'["task","review"]','other',?)`).run(id,id,id,`synthetic-${id}`,Date.now());
}
function data(response) {
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  assert.equal(response.result.isError, false, JSON.stringify(response.result));
  return JSON.parse(response.result.content[0].text);
}
globalThis.fetch = async () => { throw new Error('Live provider requests forbidden'); };
try {
  for (const name of (await readdir(join(root, 'migrations'))).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(await readFile(join(root, 'migrations', name), 'utf8'));
  const modulePath = join(temporary, 'mcp.mjs');
  await build({ stdin: { contents: 'export { handleMcp } from "./src/mcp.ts"; export { exportWorkspace, deleteWorkspaceContents } from "./src/store.ts"; export { stopConversation } from "./src/conversations.ts";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
  const { handleMcp, exportWorkspace, deleteWorkspaceContents, stopConversation } = await import(pathToFileURL(modulePath).href);
  for (const id of ['cleo','claude','other-worker']) agent(id);
  async function rpc(id, method, params = {}, scopes = allScopes) {
    const background = [];
    const response = await handleMcp(new Request('http://localhost:8787/mcp', { method: 'POST', headers: { 'content-type':'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0',id:1,method,params }) }), env, 'http://localhost:8787', promise => background.push(promise), undefined, { agent: agentRow(id), scopes });
    assert.equal(response.status, 200);
    for (const settled of await Promise.allSettled(background)) assert.equal(settled.status, 'fulfilled', String(settled.reason));
    return response.json();
  }
  const call = (id,name,args = {},scopes) => rpc(id,'tools/call',{ name,arguments:args },scopes);
  const catalog = async (id='cleo',scopes=allScopes) => (await rpc(id,'tools/list',{},scopes)).result.tools;
  const newNames = ['get_collaboration_config','send_message','get_conversation','list_conversations','preview_requests','claim_request','reply_to_request','check_conversation_inbox','acknowledge_conversation'];

  await check('new tools and capability are gated while legacy tools remain available', async () => {
    const names = (await catalog()).map(tool => tool.name);
    assert.ok(names.includes('send_job')); assert.ok(names.includes('get_next_job'));
    for (const name of newNames) assert.ok(!names.includes(name));
    assert.equal(data(await call('cleo','connection_status')).capabilities.conversation_tools,false);
    assert.equal((await call('cleo','send_message',{to:'claude',message:'No beta'})).error.code,-32602);
    sqlite.prepare("UPDATE workspaces SET next_release_beta=1 WHERE id='default'").run();
    for (const name of newNames) assert.ok((await catalog()).some(tool => tool.name===name));
    assert.equal(data(await call('cleo','connection_status')).capabilities.conversation_tools,true);
    assert.match((await rpc('cleo','initialize')).result.instructions,/get_collaboration_config/);
  });
  await check('each new tool has a strict schema and correct read, send or work scope', async () => {
    const tools = await catalog();
    for (const name of newNames) assert.equal(tools.find(tool=>tool.name===name).inputSchema.additionalProperties,false);
    const readonly = (await catalog('claude',['relay:read'])).map(tool=>tool.name);
    assert.ok(readonly.includes('preview_requests')); assert.ok(readonly.includes('get_collaboration_config'));
    for (const name of ['send_message','claim_request','reply_to_request']) assert.ok(!readonly.includes(name));
    assert.equal(tools.find(tool=>tool.name==='acknowledge_conversation').annotations.readOnlyHint,false);
    assert.equal((await call('claude','claim_request',{request_id:'x',consumer_id:'read-only'},['relay:read'])).error.code,-32602);
    assert.equal((await call('cleo','send_message',{to:'claude',message:'x',from:'other-worker'})).error.code,-32602);
    assert.equal((await call('claude','claim_request',{request_id:'x',consumer_id:'bad consumer'})).error.code,-32602);
    assert.equal((await call('cleo','get_collaboration_config',{agent_id:'claude'})).error.code,-32602);
  });
  let sent, claimed;
  await check('a message creates one directed request and retries retain its conversation', async () => {
    sent = data(await call('cleo','send_message',{to:'claude',message:'Review this synthetic plan.',type:'review',idempotency_key:'roundtrip'}));
    const retry = data(await call('cleo','send_message',{to:'claude',message:'Review this synthetic plan.',type:'review',idempotency_key:'roundtrip'}));
    assert.equal(retry.replay,true); assert.equal(retry.request.id,sent.request.id); assert.equal(retry.conversation.id,sent.conversation.id);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,1);
    assert.equal(sent.request.requires_consumer,true);
  });
  await check('preview is read-only and targeted pickup refreshes configuration and history', async () => {
    const claims = sqlite.prepare('SELECT COUNT(*) n FROM claims').get().n;
    const preview = data(await call('claude','preview_requests',{},['relay:read']));
    assert.equal(preview.requests[0].id,sent.request.id);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM claims').get().n,claims);
    claimed = data(await call('claude','claim_request',{request_id:sent.request.id,consumer_id:'interactive'}));
    assert.equal(claimed.request.id,sent.request.id); assert.ok(claimed.claim_id); assert.equal(claimed.resent,false); assert.equal(claimed.resumed,undefined);
    assert.equal(claimed.configuration.version,0); assert.match(claimed.configuration.settings.sharing.instructions,/complete chats/);
    assert.equal(claimed.request.conversation_context.conversation_id,sent.conversation.id);
    assert.equal(data(await call('claude','claim_request',{request_id:sent.request.id,consumer_id:'scheduled'})).request,null);
    assert.equal(sqlite.prepare('SELECT attempts FROM jobs WHERE id=?').get(sent.request.id).attempts,1);
  });
  await check('reply binds claim to this request and authenticated agent before changing a result', async () => {
    let response = await call('claude','reply_to_request',{request_id:'another-request',claim_id:claimed.claim_id,message:'wrong'});
    assert.equal(response.result.isError,true);
    response = await call('other-worker','reply_to_request',{request_id:sent.request.id,claim_id:claimed.claim_id,message:'wrong'});
    assert.equal(response.result.isError,true);
    assert.equal(sqlite.prepare('SELECT result FROM jobs WHERE id=?').get(sent.request.id).result,null);
    const replied = data(await call('claude','reply_to_request',{request_id:sent.request.id,claim_id:claimed.claim_id,message:'## Summary\nA useful first answer.'}));
    assert.equal(replied.code,'ACCEPTED');
    assert.equal(data(await call('claude','reply_to_request',{request_id:sent.request.id,claim_id:claimed.claim_id,message:'Lost response retry.'})).code,'ALREADY_DONE');
    const history = data(await call('cleo','get_conversation',{conversation_id:sent.conversation.id}));
    assert.ok(history.messages.some(message=>message.kind==='answer' && message.text.includes('useful first answer')));
    assert.equal((await call('other-worker','get_conversation',{conversation_id:sent.conversation.id})).result.isError,true);
  });
  await check('independent inbox acknowledgments never hide a reply from another consumer', async () => {
    const interactive = data(await call('cleo','check_conversation_inbox',{consumer_id:'interactive'}));
    const item = interactive.conversations[0]; assert.equal(item.conversation.id,sent.conversation.id);
    data(await call('cleo','acknowledge_conversation',{conversation_id:sent.conversation.id,consumer_id:'interactive',cursor:item.next_cursor}));
    assert.equal(data(await call('cleo','check_conversation_inbox',{consumer_id:'interactive'})).conversations.length,0);
    assert.equal(data(await call('cleo','check_conversation_inbox',{consumer_id:'scheduled'})).conversations.length,1);
    assert.equal(data(await call('cleo','get_collaboration_config')).readiness.collaboration.verified,true);
    assert.equal(data(await call('cleo','get_collaboration_config')).readiness.background.verified,false);
  });
  await check('legacy revision preserves earlier answer and rejects the previous attempt claim', async () => {
    const revision = await call('cleo','send_back',{job_id:sent.request.id,feedback:'Revise point two.'});
    assert.equal(revision.result.isError,false);
    const again = data(await call('claude','claim_request',{request_id:sent.request.id,consumer_id:'scheduled'}));
    assert.ok(again.claim_id); assert.ok(again.request.conversation_context.messages.some(message=>message.kind==='answer'));
    const stale = await call('claude','reply_to_request',{request_id:sent.request.id,claim_id:claimed.claim_id,message:'Stale answer'});
    assert.equal(stale.result.isError,true);
    assert.equal(JSON.parse(stale.result.content[0].text).code,'SENT_BACK');
    const question = data(await call('claude','reply_to_request',{request_id:sent.request.id,claim_id:again.claim_id,status:'needs_input',message:'Which point?'}));
    assert.equal(question.code,'QUESTION_SENT');
    const answer = await call('cleo','answer_question',{job_id:sent.request.id,answer:'The second bullet.'});
    assert.equal(answer.result.isError,false);
    const clarified = data(await call('claude','claim_request',{request_id:sent.request.id,consumer_id:'scheduled'}));
    const complete = data(await call('claude','reply_to_request',{request_id:sent.request.id,claim_id:clarified.claim_id,message:'## Summary\nRevised second bullet.'}));
    assert.equal(complete.code,'ACCEPTED');
    const history = data(await call('cleo','get_conversation',{conversation_id:sent.conversation.id}));
    assert.equal(history.messages.filter(message=>message.kind==='answer').length,2);
    assert.ok(history.messages.some(message=>message.kind==='question')); assert.ok(history.messages.some(message=>message.kind==='revision'));
  });
  await check('informational reply adds no work and config restrictions affect MCP sending', async () => {
    const before = sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n;
    const note = data(await call('cleo','send_message',{to:'claude',message:'Received, no reply needed.',conversation_id:sent.conversation.id,response_requested:false,idempotency_key:'note'}));
    assert.equal(note.request,null); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,before);
    const config = data(await call('cleo','get_collaboration_config')).settings;
    config.allowed_request_categories=[];
    sqlite.prepare('INSERT INTO agent_collaboration(workspace_id,agent_id,version,settings,updated_at) VALUES(?,?,?,?,?)').run('default','cleo',1,JSON.stringify(config),Date.now());
    const denied = await call('cleo','send_message',{to:'claude',message:'Should not dispatch.'});
    assert.equal(denied.result.isError,true); assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM jobs').get().n,before);
    assert.match((await call('cleo','list_agents')).result.content[0].text,/No eligible collaborators/);
  });
  await check('owner stop revokes live claims and blocks follow-ups without removing history', async () => {
    sqlite.prepare("DELETE FROM agent_collaboration WHERE agent_id='cleo'").run();
    const fresh = data(await call('cleo','send_message',{to:'claude',message:'A stoppable task',idempotency_key:'stop-task'}));
    const active = data(await call('claude','claim_request',{request_id:fresh.request.id,consumer_id:'stop-test'}));
    await assert.rejects(() => stopConversation(env,{owner:false,agent:agentRow('cleo')},fresh.conversation.id), error => error.code==='owner_only');
    await stopConversation(env,{owner:true,agent:null},fresh.conversation.id);
    const stopped = await call('claude','reply_to_request',{request_id:fresh.request.id,claim_id:active.claim_id,message:'Late answer'});
    assert.equal(stopped.result.isError,true);
    assert.equal(sqlite.prepare('SELECT status FROM jobs WHERE id=?').get(fresh.request.id).status,'canceled');
    const continued = await call('cleo','send_message',{to:'claude',message:'Blocked continuation',conversation_id:fresh.conversation.id});
    assert.equal(continued.result.isError,true);
    assert.ok(data(await call('cleo','get_conversation',{conversation_id:fresh.conversation.id})).messages.length);
    assert.equal(data(await call('claude','claim_request',{request_id:fresh.request.id,consumer_id:'another-run'})).request,null);
    assert.ok(data(await call('cleo','get_conversation',{conversation_id:sent.conversation.id})).conversation.stopped_at===null, 'other chains remain available');
  });
  await check('workspace export excludes credentials and deletion removes new data with tenant isolation', async () => {
    const timestamp=Date.now();
    sqlite.prepare('INSERT INTO agent_collaboration(workspace_id,agent_id,version,settings,updated_at) VALUES(?,?,?,?,?)').run('default','cleo',1,JSON.stringify({purpose:'Exported purpose'}),timestamp);
    sqlite.prepare('INSERT INTO agent_onboarding(workspace_id,agent_id,provider,surface,step,updated_at) VALUES(?,?,?,?,?,?)').run('default','cleo','other','terminal','exchange',timestamp);
    sqlite.prepare('INSERT INTO activation_configs(workspace_id,agent_id,endpoint,token_ciphertext,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('default','claude','https://api.anthropic.com/v1/claude_code/routines/trig_test/fire','DO_NOT_EXPORT_ACTIVATION_CIPHERTEXT',0,timestamp,timestamp);
    sqlite.prepare('INSERT INTO collaboration_background_runs(workspace_id,agent_id,run_id,method,request_id,observed_at) VALUES(?,?,?,?,?,?)').run('default','claude','provider-test-run','scheduled',sent.request.id,timestamp);
    const exported=await exportWorkspace(env);
    assert.equal(exported.version,2); assert.ok(exported.messages.length); assert.equal(exported.collaboration.length,1); assert.equal(exported.onboarding.length,1);
    assert.doesNotMatch(JSON.stringify(exported),/synthetic-cleo|synthetic-claude|DO_NOT_EXPORT_ACTIVATION_CIPHERTEXT/);
    sqlite.prepare("INSERT INTO workspaces(id,name,created_at) VALUES('other-workspace','Other',?)").run(timestamp);
    sqlite.prepare("INSERT INTO agents(id,workspace_id,handle,name,token_hash,created_at) VALUES('other-tenant-agent','other-workspace','other','Other','OTHER_TENANT_SECRET',?)").run(timestamp);
    sqlite.prepare('INSERT INTO agent_collaboration(workspace_id,agent_id,version,settings,updated_at) VALUES(?,?,?,?,?)').run('other-workspace','other-tenant-agent',1,'{}',timestamp);
    await deleteWorkspaceContents(env);
    for (const table of ['jobs','agents','claims','events','conversation_chains','conversations','conversation_messages','conversation_receipts','agent_collaboration','agent_onboarding','collaboration_background_runs','activation_configs','activation_dispatches']) {
      assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE workspace_id='default'`).get().n,0,table);
    }
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agents WHERE workspace_id='other-workspace'").get().n,1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM agent_collaboration WHERE workspace_id='other-workspace'").get().n,1);
  });
  console.log(`\n${checks} MCP conversation checks passed.`);
} finally { globalThis.fetch=originalFetch; sqlite.close(); await rm(temporary,{recursive:true,force:true}); }
