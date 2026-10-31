/** Isolated authentication regression checks. Uses SQLite in memory, never a
 * deployed relay. Google HTTP responses are mocked at the fixed vendor URLs. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..",import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(),"relay-auth-test-"));
const sqlite = new DatabaseSync(":memory:");
const originalFetch = globalThis.fetch;
let count = 0;
async function check(name,fn) { await fn(); count++; console.log(`ok ${count} - ${name}`); }
class Statement {
  constructor(sql,values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.sql,values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return {results:sqlite.prepare(this.sql).all(...this.values),success:true}; }
  async run() { return {meta:sqlite.prepare(this.sql).run(...this.values),success:true}; }
}
const DB = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const output=[]; for (const s of statements) output.push(await s.run()); sqlite.exec("COMMIT"); return output; }
    catch (e) { sqlite.exec("ROLLBACK"); throw e; }
  },
};
const base = "http://127.0.0.1:8787";
const env = {DB,HOSTED:"true",SIGNUP_MODE:"invite",ALLOW_DEV_AUTH:"true",PUBLIC_URL:base,BETA_EMAILS:"alice@example.test, BOB@EXAMPLE.TEST"};
const req = (path,opts = {}) => new Request(base + path,opts);
const form = (body,extras={}) => ({method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...extras},body:new URLSearchParams(body)});
const cookieOf = (response) => response.headers.get("Set-Cookie")?.split(";")[0];
const challengeOf = async (verifier) => Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier))).toString("base64url");
try {
  for (const file of (await readdir(join(root,"migrations"))).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(await readFile(join(root,"migrations",file),"utf8"));
  const modulePath = join(temporary,"auth.mjs");
  await build({entryPoints:[join(root,"src/auth.ts")],bundle:true,platform:"node",format:"esm",outfile:modulePath,logLevel:"silent"});
  const auth = await import(pathToFileURL(modulePath).href);
  const handle = (request,e=env) => auth.handleAuth(request,e);
  async function signIn(email) {
    const response = await handle(req("/auth/dev",{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({email})}));
    assert.equal(response.status,200);
    const cookie = cookieOf(response);
    const session = await (await handle(req("/auth/session",{headers:{Cookie:cookie}}))).json();
    assert.equal(session.authenticated,true);
    return {cookie,...session};
  }
  await check("unconfigured Google login is a clear setup-required response",async () => {
    const response = await handle(req("/auth/google/start")); assert.equal(response.status,503); assert.match(await response.text(),/not configured/);
  });
  await check("dev login requires loopback, explicit toggle, matching Origin, and invite",async () => {
    const options = {method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({email:"alice@example.test"})};
    assert.equal((await handle(req("/auth/dev",options),{...env,ALLOW_DEV_AUTH:undefined})).status,404);
    assert.equal((await handle(new Request("https://relay.example/auth/dev",{...options,headers:{"Content-Type":"application/json",Origin:"https://relay.example"}}),{...env,PUBLIC_URL:"https://relay.example"})).status,404);
    assert.equal((await handle(req("/auth/dev",{...options,headers:{"Content-Type":"application/json"}}))).status,404);
    assert.equal((await handle(req("/auth/dev",{...options,body:JSON.stringify({email:"stranger@example.test"})}))).status,403);
    assert.equal((await handle(req("/auth/dev",options),{...env,BETA_EMAILS:""})).status,403);
  });
  await check("public signup is the default and optional invitation mode stays fail closed",async () => {
    const options = {method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify({email:"public@example.test"})};
    const response = await handle(req("/auth/dev",options),{...env,SIGNUP_MODE:undefined,BETA_EMAILS:undefined});
    assert.equal(response.status,200);
    const sessionResponse = await handle(req("/auth/session",{headers:{Cookie:cookieOf(response)}}),{...env,SIGNUP_MODE:"public",BETA_EMAILS:undefined});
    assert.equal((await sessionResponse.json()).authenticated,true);
    assert.equal((await handle(req("/auth/dev",options),{...env,SIGNUP_MODE:"typo"})).status,503);
    const configured = {...env,SIGNUP_MODE:"public",BETA_EMAILS:undefined,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret"};
    assert.equal((await (await handle(req("/auth/session"),configured)).json()).loginConfigured,true);
  });
  await check("browser dev form is local-only, script-free, and creates a session then redirects",async () => {
    const formPage = await handle(req("/auth/dev")); assert.equal(formPage.status,200); const content = await formPage.text();
    assert.equal(formPage.headers.get("Referrer-Policy"),"same-origin");
    assert.match(formPage.headers.get("Content-Security-Policy"),/form-action 'self';/);
    assert.match(content,/Local development sign-in/); assert.match(content,/name="email"/); assert.doesNotMatch(content,/<script/i);
    assert.equal((await handle(req("/auth/dev"),{...env,ALLOW_DEV_AUTH:undefined})).status,404);
    assert.equal((await handle(new Request("https://relay.example/auth/dev"),{...env,PUBLIC_URL:"https://relay.example"})).status,404);
    const result = await handle(req("/auth/dev",form({email:"alice@example.test"},{Origin:base})));
    assert.equal(result.status,303); assert.equal(result.headers.get("Location"),"/"); assert.ok(cookieOf(result));
    assert.equal(result.headers.get("Referrer-Policy"),"no-referrer");
    assert.equal((await handle(req("/auth/dev",form({email:"alice@example.test"},{Origin:"null"})))).status,404);
  });
  const alice = await signIn("ALICE@EXAMPLE.TEST"), bob = await signIn("bob@example.test");
  await check("case-insensitive invited identity creates isolated human sessions",async () => {
    assert.equal(alice.user.email,"alice@example.test"); assert.notEqual(alice.workspace.id,bob.workspace.id);
    assert.ok(alice.csrfToken); assert.ok(alice.cookie.startsWith("relay_dev_session="));
    const row = sqlite.prepare("SELECT * FROM auth_sessions LIMIT 1").get(); assert.equal(row.token_hash.length,64); assert.ok(!row.token_hash.startsWith("ses_"));
    assert.equal((await (await handle(req("/auth/session"))).json()).authenticated,false);
  });
  const addAgent = (workspace,id) => sqlite.prepare("INSERT INTO agents(id,name,token_hash,created_at,workspace_id,handle,can_request,can_work) VALUES (?,?,?,?,?,?,1,1)").run(id,"Test Agent",id + "-hash",Date.now(),workspace,id);
  addAgent(alice.workspace.id,"alice-agent"); addAgent(alice.workspace.id,"alice-grok"); addAgent(bob.workspace.id,"bob-agent");
  const registration = (overrides={}) => handle(req("/oauth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_name:"Test client",redirect_uris:["http://127.0.0.1:8123/callback"],token_endpoint_auth_method:"none",...overrides})}));
  await check("client registration rejects unsafe redirects and unsupported client auth",async () => {
    assert.equal((await registration({redirect_uris:["javascript:alert(1)"]})).status,400);
    assert.equal((await registration({redirect_uris:["http://evil.example/callback"]})).status,400);
    assert.equal((await registration({redirect_uris:["https://example.com/callback#fragment"]})).status,400);
    assert.equal((await registration({redirect_uris:["https://*.example.com/callback"]})).status,400);
    assert.equal((await registration({redirect_uris:["https://example.com;form-action/callback"]})).status,400);
    assert.equal((await registration({token_endpoint_auth_method:"client_secret_post"})).status,400);
  });
  const client = await (await registration()).json();
  const verifier = "a".repeat(64), pkce = await challengeOf(verifier), redirectUri = "http://127.0.0.1:8123/callback";
  function authorizeUrl(overrides={}) {
    return "/oauth/authorize?" + new URLSearchParams({client_id:client.client_id,redirect_uri:redirectUri,response_type:"code",code_challenge:pkce,code_challenge_method:"S256",scope:"relay:read relay:send relay:work offline_access",resource:base + "/mcp",state:"test-state",...overrides});
  }
  async function consent() {
    const response = await handle(req(authorizeUrl(),{headers:{Cookie:alice.cookie}})); assert.equal(response.status,200);
    assert.equal(response.headers.get("Referrer-Policy"),"same-origin");
    assert.match(response.headers.get("Content-Security-Policy"),/form-action 'self' http:\/\/127\.0\.0\.1:8123;/);
    const html = await response.text(); const id = html.match(/name="request_id" value="([^"]+)"/)?.[1]; assert.ok(id); return id;
  }
  async function grant() {
    const id = await consent();
    const response = await handle(req("/oauth/authorize",form({request_id:id,csrf_token:alice.csrfToken,agent_id:"alice-agent",decision:"allow"},{Cookie:alice.cookie,Origin:base})));
    assert.equal(response.status,303); return new URL(response.headers.get("Location")).searchParams.get("code");
  }
  const exchange = (code,overrides={}) => handle(req("/oauth/token",form({grant_type:"authorization_code",client_id:client.client_id,redirect_uri:redirectUri,code,code_verifier:verifier,resource:base + "/mcp",...overrides})));
  await check("discovery advertises PKCE, opaque resource authorization, and revocation",async () => {
    const metadata = await (await handle(req("/.well-known/oauth-authorization-server"))).json();
    assert.deepEqual(metadata.code_challenge_methods_supported,["S256"]); assert.ok(metadata.revocation_endpoint); assert.ok(metadata.authorization_response_iss_parameter_supported);
    // Claude uses metadata documents only when both fields are advertised.
    assert.equal(metadata.client_id_metadata_document_supported,true); assert.deepEqual(metadata.token_endpoint_auth_methods_supported,["none"]);
    const resource = await (await handle(req("/.well-known/oauth-protected-resource/mcp"))).json(); assert.equal(resource.resource,base + "/mcp");
  });
  await check("authorization validates exact redirect, PKCE method, scopes, and resource",async () => {
    for (const invalid of [{redirect_uri:"http://127.0.0.1:8124/callback"},{code_challenge_method:"plain"},{code_challenge:"short"},{scope:"admin"},{resource:"https://evil.example/mcp"}]) {
      assert.equal((await handle(req(authorizeUrl(invalid),{headers:{Cookie:alice.cookie}}))).status,400);
    }
  });
  const scopedResource = base + '/mcp/connections/alice-grok';
  async function scopedConsent(resource = scopedResource) {
    const response = await handle(req(authorizeUrl({resource}),{headers:{Cookie:alice.cookie}}));
    assert.equal(response.status,200);
    const content = await response.text(), requestId = content.match(/name="request_id" value="([^"]+)"/)?.[1];
    assert.ok(requestId); return {requestId,content};
  }
  const scopedDecision = (requestId, extra = {}) => handle(req('/oauth/authorize',form({request_id:requestId,csrf_token:alice.csrfToken,decision:'allow',...extra},{Cookie:alice.cookie,Origin:base})));
  await check('connection resource consent is fixed to its owned target and never inferred from client name',async()=>{
    sqlite.prepare('UPDATE oauth_clients SET name=? WHERE id=?').run('ChatGPT',client.client_id);
    const {requestId,content} = await scopedConsent();
    assert.match(content,/alice-grok/);assert.doesNotMatch(content,/alice-agent|bob-agent/);
    assert.equal((await scopedDecision(requestId,{agent_id:'alice-agent'})).status,403);
    assert.equal((await scopedDecision(requestId,{agent_id:'bob-agent'})).status,403);
    assert.equal((await scopedDecision(requestId,{agent_id:''})).status,403);
    const granted=await scopedDecision(requestId);
    assert.equal(granted.status,303);
    const code=new URL(granted.headers.get('location')).searchParams.get('code');
    const row=sqlite.prepare('SELECT g.agent_id,g.resource FROM oauth_codes c JOIN oauth_grants g ON g.id=c.grant_id WHERE c.code_hash=?')
      .get(Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))).toString('hex'));
    assert.equal(row.agent_id,'alice-grok');assert.equal(row.resource,scopedResource);
    const before=sqlite.prepare('SELECT count(*) n FROM oauth_requests').get().n;
    for(const id of ['bob-agent','missing-agent']) {
      const unavailable=await handle(req(authorizeUrl({resource:base+'/mcp/connections/'+id}),{headers:{Cookie:alice.cookie}}));
      assert.equal(unavailable.status,403);assert.doesNotMatch(await unavailable.text(),/Test Agent/);
    }
    assert.equal(sqlite.prepare('SELECT count(*) n FROM oauth_requests').get().n,before);
    const url=new URL(base+authorizeUrl());url.searchParams.delete('resource');
    const generic=await handle(req(url.pathname+url.search,{headers:{Cookie:alice.cookie}}));
    assert.equal(generic.status,200);const picker=await generic.text();
    assert.match(picker,/Choose a connection/);assert.match(picker,/alice-agent/);assert.match(picker,/alice-grok/);
  });
  await check('scoped code exchange and refresh keep the exact resource and reject audience substitution',async()=>{
    const {requestId}=await scopedConsent(), granted=await scopedDecision(requestId,{agent_id:'alice-grok'});
    const code=new URL(granted.headers.get('location')).searchParams.get('code');
    assert.equal((await exchange(code)).status,400);
    assert.equal((await exchange(code,{resource:base+'/mcp/connections/alice-agent'})).status,400);
    const issuedResponse=await exchange(code,{resource:scopedResource});assert.equal(issuedResponse.status,200);
    const issued=await issuedResponse.json();
    const identity=path=>auth.authenticateOAuth(req(path,{headers:{Authorization:'Bearer '+issued.access_token}}),env);
    assert.equal((await identity('/mcp/connections/alice-grok')).agent.id,'alice-grok');
    assert.equal((await identity('/v1/me')).agent.id,'alice-grok');
    for(const path of ['/mcp','/mcp/connections/alice-agent','/mcp/connections/bob-agent']) assert.equal(await identity(path),null);
    const refresh=(resource)=>handle(req('/oauth/token',form({grant_type:'refresh_token',client_id:client.client_id,refresh_token:issued.refresh_token,resource})));
    assert.equal((await refresh(base+'/mcp')).status,400);
    assert.equal((await refresh(base+'/mcp/connections/alice-agent')).status,400);
    const response=await refresh(scopedResource);assert.equal(response.status,200);const renewed=await response.json();
    assert.equal((await auth.authenticateOAuth(req('/mcp/connections/alice-grok',{headers:{Authorization:'Bearer '+renewed.access_token}}),env)).agent.id,'alice-grok');
    assert.equal((await refresh(scopedResource)).status,400);
    assert.equal(await auth.authenticateOAuth(req('/mcp/connections/alice-grok',{headers:{Authorization:'Bearer '+renewed.access_token}}),env),null);
  });
  await check('scoped resources reject ambiguous spellings while discovery contains only public routing metadata',async()=>{
    for(const suffix of ['/mcp/connections/alice-grok/','/mcp/connections/alice-grok?x=1','/mcp/connections/alice-grok#x','/mcp/connections/alice%2dgrok','/mcp/connections/ALICE','/mcp/connections/access_secret/extra']) {
      const response=await handle(req(authorizeUrl({resource:base+suffix}),{headers:{Cookie:alice.cookie}}));assert.equal(response.status,400,suffix);
    }
    for(const id of ['alice-grok','bob-agent','missing-agent']) {
      const response=await handle(req('/.well-known/oauth-protected-resource/mcp/connections/'+id));
      assert.equal(response.status,200);const metadata=await response.json();
      assert.deepEqual(Object.keys(metadata).sort(),['authorization_servers','bearer_methods_supported','resource','scopes_supported']);
      assert.equal(metadata.resource,base+'/mcp/connections/'+id);assert.deepEqual(metadata.authorization_servers,[base]);
      assert.doesNotMatch(JSON.stringify(metadata),/Test Agent|workspace|@example/);
      assert.equal(auth.oauthChallenge(req('/mcp/connections/'+id),env),`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/connections/${id}"`);
    }
  });
  await check("unsplit consent retains HTML and redirect responses even with a JSON Accept header",async () => {
    const response = await handle(req(authorizeUrl(),{headers:{Cookie:alice.cookie,Accept:"application/json"}}));
    assert.equal(response.status,200); assert.match(response.headers.get("Content-Type"),/^text\/html/);
    const id = (await response.text()).match(/name="request_id" value="([^"]+)"/)?.[1]; assert.ok(id);
    const denied = await handle(req("/oauth/authorize",form({request_id:id,csrf_token:alice.csrfToken,decision:"deny"},{Cookie:alice.cookie,Origin:base,Accept:"application/json"})));
    assert.equal(denied.status,303); assert.equal(new URL(denied.headers.get("Location")).searchParams.get("error"),"access_denied");
    const invalid = await handle(req(authorizeUrl({resource:"https://evil.example/mcp"}),{headers:{Cookie:alice.cookie,Accept:"application/json"}}));
    assert.equal(invalid.status,400); assert.match(invalid.headers.get("Content-Type"),/^text\/html/);
    const approved = await handle(req("/oauth/authorize",form({request_id:await consent(),csrf_token:alice.csrfToken,agent_id:"alice-agent",decision:"allow"},{Cookie:alice.cookie,Origin:base,Accept:"application/json"})));
    assert.equal(approved.status,303); assert.ok(new URL(approved.headers.get("Location")).searchParams.get("code"));
  });
  await check("consent blocks forged CSRF, cross-origin submission, and other tenant agents",async () => {
    const id = await consent(), body = {request_id:id,csrf_token:alice.csrfToken,agent_id:"alice-agent",decision:"allow"};
    assert.equal((await handle(req("/oauth/authorize",form({...body,csrf_token:"forged"},{Cookie:alice.cookie,Origin:base})))).status,403);
    assert.equal((await handle(req("/oauth/authorize",form(body,{Cookie:alice.cookie,Origin:"https://evil.example"})))).status,403);
    assert.equal((await handle(req("/oauth/authorize",form(body,{Cookie:alice.cookie,Origin:"null"})))).status,403);
    assert.equal((await handle(req("/oauth/authorize",form({...body,agent_id:"bob-agent"},{Cookie:alice.cookie,Origin:base})))).status,403);
    assert.equal((await handle(req("/oauth/authorize",form({...body,agent_id:""},{Cookie:alice.cookie,Origin:base})))).status,403);
    const approved = await handle(req("/oauth/authorize",form(body,{Cookie:alice.cookie,Origin:base}))); assert.equal(approved.status,303);
    const url = new URL(approved.headers.get("Location")); assert.equal(url.searchParams.get("state"),"test-state"); assert.equal(url.searchParams.get("iss"),base);
    assert.equal((await handle(req("/oauth/authorize",form(body,{Cookie:alice.cookie,Origin:base})))).status,400);
  });
  let tokens;
  await check("code exchange requires correct verifier and redirect without burning a valid code",async () => {
    const code = await grant();
    assert.equal((await exchange(code,{code_verifier:"b".repeat(64)})).status,400);
    assert.equal((await exchange(code,{redirect_uri:"https://evil.example/callback"})).status,400);
    const response = await exchange(code); assert.equal(response.status,200); tokens = await response.json(); assert.ok(tokens.refresh_token);
    const actor = await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${tokens.access_token}`}}),env);
    assert.equal(actor.workspaceId,alice.workspace.id); assert.equal(actor.agent.id,"alice-agent");
    const persisted = sqlite.prepare("SELECT token_hash FROM oauth_tokens").all(); assert.ok(persisted.every((r) => r.token_hash.length === 64));
  });
  await check("refresh rotation detects reuse and revokes all access in the grant",async () => {
    const request = () => req("/oauth/token",form({grant_type:"refresh_token",client_id:client.client_id,refresh_token:tokens.refresh_token}));
    const response = await handle(request()); assert.equal(response.status,200); const newer = await response.json(); assert.notEqual(newer.refresh_token,tokens.refresh_token);
    assert.equal((await handle(request())).status,400);
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${newer.access_token}`}}),env),null);
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${tokens.access_token}`}}),env),null);
  });
  await check("authorization code replay revokes previously issued tokens",async () => {
    const code = await grant(); const issued = await (await exchange(code)).json();
    assert.equal((await exchange(code)).status,400);
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${issued.access_token}`}}),env),null);
  });
  await check("revoke and agent generation changes invalidate access",async () => {
    const issued = await (await exchange(await grant())).json();
    assert.equal((await handle(req("/oauth/revoke",form({client_id:client.client_id,token:issued.access_token})))).status,200);
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${issued.access_token}`}}),env),null);
    const generation = await (await exchange(await grant())).json();
    sqlite.prepare("UPDATE agents SET auth_generation=auth_generation+1 WHERE id='alice-agent'").run();
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${generation.access_token}`}}),env),null);
  });
  await check("expired credentials fail closed while paused workspaces retain authenticated access",async () => {
    const expiredCode = await grant();
    sqlite.prepare("UPDATE oauth_codes SET expires_at=0 WHERE used_at IS NULL").run();
    assert.equal((await exchange(expiredCode)).status,400);
    const expiredAccess = await (await exchange(await grant())).json();
    sqlite.prepare("UPDATE oauth_tokens SET expires_at=0 WHERE kind='access'").run();
    assert.equal(await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${expiredAccess.access_token}`}}),env),null);
    const paused = await (await exchange(await grant())).json();
    sqlite.prepare("UPDATE workspaces SET paused=1 WHERE id=?").run(alice.workspace.id);
    assert.equal((await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:`Bearer ${paused.access_token}`}}),env)).workspaceId,alice.workspace.id);
    sqlite.prepare("UPDATE workspaces SET paused=0 WHERE id=?").run(alice.workspace.id);
  });
  await check("logout requires CSRF, invalidates session, and expiry fails closed",async () => {
    assert.equal((await handle(req("/auth/logout",{method:"POST",headers:{Cookie:bob.cookie,Origin:base}}))).status,403);
    assert.equal((await handle(req("/auth/logout",{method:"POST",headers:{Cookie:bob.cookie,Origin:base,"X-CSRF-Token":bob.csrfToken}}))).status,200);
    assert.equal(await auth.getHumanSession(req("/auth/session",{headers:{Cookie:bob.cookie}}),env),null);
    const newBob = await signIn("bob@example.test"); sqlite.prepare("UPDATE auth_sessions SET expires_at=0 WHERE user_id=?").run(newBob.user.id);
    assert.equal(await auth.getHumanSession(req("/auth/session",{headers:{Cookie:newBob.cookie}}),env),null);
  });
  await check("public Google signup binds state/PKCE and accepts any verified email without an invite list",async () => {
    const publicBase = "https://relay.example", googleEnv = {...env,SIGNUP_MODE:"public",BETA_EMAILS:undefined,PUBLIC_URL:publicBase,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret"};
    const start = await handle(new Request(publicBase + "/auth/google/start?return_to=https://evil.example/"),googleEnv);
    assert.equal(start.status,303); const google = new URL(start.headers.get("Location")); assert.equal(google.origin,"https://accounts.google.com"); assert.equal(google.searchParams.get("code_challenge_method"),"S256");
    const callback = publicBase + "/auth/google/callback?" + new URLSearchParams({code:"mock-google-code",state:google.searchParams.get("state")});
    assert.equal((await handle(new Request(callback,{headers:{Cookie:"__Host-relay_login=wrong"}}),googleEnv)).status,400);
    let exchanges=0;
    globalThis.fetch = async (url,opts) => {
      if (url === "https://oauth2.googleapis.com/token") {
        assert.equal(opts.body.get("code"),"mock-google-code"); assert.equal(opts.body.get("client_id"),"test-client"); assert.equal(opts.body.get("redirect_uri"),publicBase + "/auth/google/callback");
        assert.equal(await challengeOf(opts.body.get("code_verifier")),google.searchParams.get("code_challenge")); exchanges++;
        return Response.json({access_token:"mock-provider-token"});
      }
      assert.equal(url,"https://openidconnect.googleapis.com/v1/userinfo"); assert.equal(opts.headers.Authorization,"Bearer mock-provider-token");
      return Response.json({sub:"google-public",email:"public-google@example.test",email_verified:true});
    };
    const result = await handle(new Request(callback,{headers:{Cookie:cookieOf(start)}}),googleEnv);
    assert.equal(result.status,303); assert.equal(result.headers.get("Location"),"/"); assert.equal(exchanges,1);
    const cookies = result.headers.getSetCookie(); assert.ok(cookies.some((s) => s.startsWith("__Host-relay_session=") && s.includes("; Secure") && s.includes("; HttpOnly") && s.includes("SameSite=Lax")));
    const sessionCookie = cookies.find((s) => s.startsWith("__Host-relay_session=")).split(";")[0];
    assert.equal((await auth.getHumanSession(new Request(publicBase + "/auth/session",{headers:{Cookie:sessionCookie}}),googleEnv)).email,"public-google@example.test");
    assert.equal((await handle(new Request(callback,{headers:{Cookie:cookieOf(start)}}),googleEnv)).status,400);
    globalThis.fetch = originalFetch;
  });
  await check("Google identity without a verified invited email cannot create a session",async () => {
    const publicBase = "https://relay.example", googleEnv = {...env,PUBLIC_URL:publicBase,GOOGLE_CLIENT_ID:"test-client",GOOGLE_CLIENT_SECRET:"test-secret"};
    const before = sqlite.prepare("SELECT count(*) AS n FROM auth_sessions").get().n;
    for (const profile of [{sub:"unverified",email:"alice@example.test",email_verified:false},{sub:"not-invited",email:"other@example.test",email_verified:true}]) {
      const start = await handle(new Request(publicBase + "/auth/google/start"),googleEnv);
      const google = new URL(start.headers.get("Location"));
      globalThis.fetch = async (url) => url === "https://oauth2.googleapis.com/token" ? Response.json({access_token:"mock-provider-token"}) : Response.json(profile);
      const callback = publicBase + "/auth/google/callback?" + new URLSearchParams({code:"mock-code",state:google.searchParams.get("state")});
      assert.equal((await handle(new Request(callback,{headers:{Cookie:cookieOf(start)}}),googleEnv)).status,403);
    }
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM auth_sessions").get().n,before);
    globalThis.fetch = originalFetch;
  });
  const day = 86_400_000;
  const clientCount = (where, ...values) => sqlite.prepare(`SELECT count(*) AS n FROM oauth_clients WHERE ${where}`).get(...values).n;
  await check("only unclaimed registrations share a rolling allowance, so authorized clients never lock out new users",async () => {
    sqlite.exec("DELETE FROM auth_rate_limits");
    const now = Date.now(), seed = sqlite.prepare("INSERT INTO oauth_clients(id,name,redirect_uris,created_at,claimed_at) VALUES (?,?,?,?,?)");
    assert.ok(sqlite.prepare("SELECT claimed_at FROM oauth_clients WHERE id=?").get(client.client_id).claimed_at,"Authorizing a client claims it");
    // Far above the previous 1,000-row global ceiling.
    sqlite.exec("BEGIN"); for (let i = 0; i < 2500; i++) seed.run("client_claimed_" + i,"Claimed","[]",now,now); sqlite.exec("COMMIT");
    assert.equal((await registration()).status,201);
    const pending = clientCount("claimed_at IS NULL AND metadata_expires_at IS NULL AND created_at>?",now - day);
    sqlite.exec("BEGIN"); for (let i = pending; i < 2000; i++) seed.run("client_pending_" + i,"Pending","[]",now,null); sqlite.exec("COMMIT");
    const full = await registration();
    assert.equal(full.status,429); assert.equal((await full.json()).error,"client_capacity");
    // Abandoned registrations stop counting after a day, then expire after a week.
    sqlite.prepare("UPDATE oauth_clients SET created_at=? WHERE id LIKE 'client_pending_%'").run(now - 2 * day);
    assert.equal((await registration()).status,201);
    sqlite.prepare("UPDATE oauth_clients SET created_at=? WHERE id LIKE 'client_claimed_%' OR id LIKE 'client_pending_%'").run(now - 8 * day);
    await auth.cleanupAuth(env,now);
    assert.equal(clientCount("id LIKE 'client_pending_%'"),0);
    assert.equal(clientCount("id LIKE 'client_claimed_%'"),2500,"Previously authorized clients keep the 30-day retention");
    sqlite.prepare("UPDATE oauth_clients SET created_at=? WHERE id LIKE 'client_claimed_%'").run(now - 31 * day);
    await auth.cleanupAuth(env,now);
    assert.equal(clientCount("id LIKE 'client_claimed_%'"),0);
    assert.equal(clientCount("id=?",client.client_id),1,"A client with grants is never pruned");
  });
  await check("client names only pre-fill a platform suggestion",async () => {
    for (const [name,platform] of [["Claude Code",'claude-code'],["claude-code (relay)","claude-code"],["Claude","claude"],["claudeai","claude"],["OpenAI Codex","codex"],["ChatGPT","chatgpt"],["OpenAI","chatgpt"],["Grok","grok"],["Cursor",null],["Test client",null]]) {
      assert.equal(auth.suggestedPlatform(name),platform,name);
    }
  });
  const metadataUrl = "https://apps.example.com/oauth/hitchhike-client.json";
  const metadataDocument = (overrides = {}) => ({client_id:metadataUrl,client_name:"Example Code",redirect_uris:["http://127.0.0.1/callback","http://localhost/callback","https://apps.example.com/oauth/callback"],token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"],...overrides});
  const fetches = [];
  let serve = () => Response.json(metadataDocument());
  const metadataFetch = async (url,opts) => { fetches.push({url:String(url),opts}); return serve(); };
  const metadataAuthorize = (redirect,clientId = metadataUrl) => handle(req(authorizeUrl({client_id:clientId,redirect_uri:redirect}),{headers:{Cookie:alice.cookie}}));
  await check("client ID metadata documents authorize without registration and match loopback ports at run time",async () => {
    sqlite.exec("DELETE FROM auth_rate_limits");
    globalThis.fetch = metadataFetch;
    try {
      const page = await metadataAuthorize("http://127.0.0.1:3118/callback");
      assert.equal(page.status,200);
      const content = await page.text();
      assert.match(content,/Connect Example Code/); assert.match(content,/Published by<\/dt><dd>apps\.example\.com/);
      assert.equal(fetches.length,1); assert.equal(fetches[0].url,metadataUrl); assert.equal(fetches[0].opts.redirect,"manual");
      for (const redirect of ["http://127.0.0.1:4119/callback","http://localhost:5000/callback","https://apps.example.com/oauth/callback"]) assert.equal((await metadataAuthorize(redirect)).status,200,redirect);
      assert.equal(fetches.length,1,"A valid document is cached");
      for (const redirect of ["http://127.0.0.1:3118/other","http://[::1]:3118/callback","https://apps.example.com:8443/oauth/callback","https://apps.example.com/oauth/callback/","http://127.0.0.1:3118/./callback"]) assert.equal((await metadataAuthorize(redirect)).status,400,redirect);
      const requestId = content.match(/name="request_id" value="([^"]+)"/)?.[1];
      const approved = await handle(req("/oauth/authorize",form({request_id:requestId,csrf_token:alice.csrfToken,agent_id:"alice-agent",decision:"allow"},{Cookie:alice.cookie,Origin:base})));
      assert.equal(approved.status,303);
      const callback = new URL(approved.headers.get("Location"));
      assert.equal(callback.origin + callback.pathname,"http://127.0.0.1:3118/callback");
      const issued = await handle(req("/oauth/token",form({grant_type:"authorization_code",client_id:metadataUrl,redirect_uri:"http://127.0.0.1:3118/callback",code:callback.searchParams.get("code"),code_verifier:verifier,resource:base + "/mcp"})));
      assert.equal(issued.status,200);
      const tokens = await issued.json();
      assert.equal((await auth.authenticateOAuth(req("/mcp",{headers:{Authorization:"Bearer " + tokens.access_token}}),env)).agent.id,"alice-agent");
      assert.equal((await handle(req("/oauth/token",form({grant_type:"refresh_token",client_id:"client_" + "x".repeat(24),refresh_token:tokens.refresh_token})))).status,400,"Refresh stays bound to the metadata client ID");
      assert.equal((await handle(req("/oauth/token",form({grant_type:"refresh_token",client_id:metadataUrl,refresh_token:tokens.refresh_token})))).status,200);
      const listed = await (await handle(req("/auth/grants",{headers:{Cookie:alice.cookie}}))).json();
      assert.ok(listed.grants.some((g) => g.client_name === "Example Code"),"Granted metadata clients appear in the owner's list");
      assert.ok(sqlite.prepare("SELECT claimed_at FROM oauth_clients WHERE id=?").get(metadataUrl).claimed_at);
      // ChatGPT publishes both fields; only the supported intersection counts.
      sqlite.prepare("DELETE FROM oauth_clients WHERE id=?").run("https://chat.example.com/oauth/client.json");
      serve = () => Response.json({client_id:"https://chat.example.com/oauth/client.json",client_name:"Example Chat",redirect_uris:["https://chat.example.com/connector_platform_oauth_redirect"],token_endpoint_auth_methods_supported:["none","private_key_jwt"],token_endpoint_auth_method:"private_key_jwt"});
      assert.equal((await metadataAuthorize("https://chat.example.com/connector_platform_oauth_redirect","https://chat.example.com/oauth/client.json")).status,200);
    } finally { globalThis.fetch = originalFetch; serve = () => Response.json(metadataDocument()); }
  });
  await check("client metadata documents are validated strictly and failures are never cached",async () => {
    sqlite.exec("DELETE FROM auth_rate_limits");
    globalThis.fetch = metadataFetch;
    const fresh = "https://apps.example.com/oauth/fresh.json", attempt = () => { sqlite.prepare("DELETE FROM oauth_clients WHERE id=?").run(fresh); return metadataAuthorize("https://apps.example.com/oauth/callback",fresh); };
    const documentFor = (overrides) => ({...metadataDocument(),client_id:fresh,...overrides});
    try {
      const without = (key) => { const value = documentFor({}); delete value[key]; return value; };
      const invalid = {
        "mismatched client_id": () => Response.json(documentFor({client_id:metadataUrl})),
        "client secret": () => Response.json(documentFor({client_secret:"shared"})),
        "secret client authentication": () => Response.json(documentFor({token_endpoint_auth_method:"client_secret_basic"})),
        "no public client authentication": () => Response.json(without("token_endpoint_auth_method")),
        "key-only authentication list": () => Response.json(documentFor({token_endpoint_auth_methods_supported:["private_key_jwt"]})),
        "missing redirects": () => Response.json(without("redirect_uris")),
        "cross-origin redirect": () => Response.json(documentFor({redirect_uris:["https://apps.example.com/oauth/callback","https://evil.example.com/oauth/callback"]})),
        "unsupported grant": () => Response.json(documentFor({grant_types:["client_credentials"]})),
        "HTTP redirect": () => new Response(null,{status:302,headers:{Location:"https://apps.example.com/other.json"}}),
        "missing document": () => new Response("missing",{status:404}),
        "HTML": () => new Response(JSON.stringify(documentFor({})),{headers:{"Content-Type":"text/html"}}),
        "invalid JSON": () => new Response("{",{headers:{"Content-Type":"application/json"}}),
        "oversized document": () => Response.json(documentFor({client_name:"x".repeat(6000)})),
        "network failure": () => { throw new TypeError("offline"); },
      };
      for (const [label,responder] of Object.entries(invalid)) {
        serve = responder;
        const response = await attempt();
        assert.equal(response.status,400,label); assert.equal(clientCount("id=?",fresh),0,label + " is not cached");
      }
      serve = () => Response.json(documentFor({}));
      assert.equal((await attempt()).status,200,"A corrected document works immediately");
      // no-store is respected: every use fetches again.
      serve = () => Response.json(documentFor({}),{headers:{"Cache-Control":"no-store"}});
      sqlite.prepare("DELETE FROM oauth_clients WHERE id=?").run(fresh);
      const before = fetches.length;
      for (let i = 0; i < 2; i++) assert.equal((await metadataAuthorize("https://apps.example.com/oauth/callback",fresh)).status,200);
      assert.equal(fetches.length,before + 2);
      serve = () => Response.json(documentFor({}),{headers:{"Cache-Control":"public, max-age=60"}});
      sqlite.prepare("DELETE FROM oauth_clients WHERE id=?").run(fresh);
      const fetchedAt = Date.now();
      assert.equal((await metadataAuthorize("https://apps.example.com/oauth/callback",fresh)).status,200);
      const expires = sqlite.prepare("SELECT metadata_expires_at FROM oauth_clients WHERE id=?").get(fresh).metadata_expires_at;
      assert.ok(expires >= fetchedAt + 59_000 && expires <= Date.now() + 60_000);
      // Unsafe or ambiguous client IDs are refused before any request.
      const fetched = fetches.length;
      for (const unsafe of ["http://apps.example.com/client.json","https://127.0.0.1/client.json","https://[::1]/client.json","https://localhost/client.json","https://metadata.internal/client.json","https://apps.example.com:8443/client.json","https://apps.example.com/","https://APPS.example.com/client.json","https://apps.example.com/a/../client.json","https://apps.example.com/client.json?x=1","https://apps.example.com/client.json#x","https://user@apps.example.com/client.json","https://" + "a".repeat(510) + ".com/x"]) {
        assert.equal((await metadataAuthorize("https://apps.example.com/oauth/callback",unsafe)).status,400,unsafe);
      }
      const selfHosted = "https://relay.example.com", selfEnv = {...env,PUBLIC_URL:selfHosted};
      const selfUrl = authorizeUrl({client_id:selfHosted + "/client.json",redirect_uri:selfHosted + "/callback"});
      assert.equal((await handle(new Request(selfHosted + selfUrl,{headers:{Cookie:alice.cookie}}),selfEnv)).status,400,"The relay never fetches a document from itself");
      assert.equal(fetches.length,fetched);
      // Oversized client IDs are refused at the token endpoint too.
      assert.equal((await handle(req("/oauth/token",form({grant_type:"authorization_code",client_id:"https://apps.example.com/" + "x".repeat(600),code:"code_x",code_verifier:verifier,redirect_uri:"https://apps.example.com/oauth/callback"})))).status,400);
    } finally { globalThis.fetch = originalFetch; serve = () => Response.json(metadataDocument()); }
  });
  await check("cached metadata documents expire unless an active grant still uses them",async () => {
    const later = Date.now() + 3 * day;
    assert.ok(clientCount("id=?","https://apps.example.com/oauth/fresh.json"));
    await auth.cleanupAuth(env,later);
    assert.equal(clientCount("id=?","https://apps.example.com/oauth/fresh.json"),0);
    assert.equal(clientCount("id=?",metadataUrl),1,"A document client with grants stays listed");
  });
  await check("account deletion removes sessions and all grant material for the owner only",async () => {
    const before = sqlite.prepare("SELECT count(*) AS n FROM users").get().n;
    await assert.rejects(auth.deleteHumanAccount(env,alice.user.id,bob.workspace.id));
    await auth.deleteHumanAccount(env,alice.user.id,alice.workspace.id);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM users").get().n,before-1);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM oauth_grants WHERE user_id=?").get(alice.user.id).n,0);
    assert.equal(await auth.getHumanSession(req("/auth/session",{headers:{Cookie:alice.cookie}}),env),null);
  });
  await check("rollback-created Google and dev accounts can be deleted after re-upgrade without linking email",async () => {
    const existingUser = sqlite.prepare("SELECT id,email FROM users WHERE email='bob@example.test'").get();
    assert.ok(existingUser);
    for (const [label,subject] of [["google","rollback-google-subject"],["dev","dev:rollback@example.test"]]) {
      const id="rollback-"+label, workspace="ws_"+id, now=Date.now(), token="ses_"+id;
      // These are the pre-Clerk INSERTs: the migrated database supplies NULL
      // identity_key and provider='google', including for local dev sessions.
      sqlite.prepare("INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)").run(workspace,"Rollback account",now);
      sqlite.prepare("INSERT INTO users(id,google_sub,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?)").run(id,subject,existingUser.email,"Rollback account",workspace,now);
      const hash=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))).toString("hex");
      sqlite.prepare("INSERT INTO auth_sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES (?,?,?,?,?)").run(hash,id,"rollback-csrf",now,now+60_000);
      addAgent(workspace,id+"-agent");
      assert.equal(sqlite.prepare("SELECT identity_key FROM users WHERE id=?").get(id).identity_key,null);
      const request=req("/auth/session",{headers:{Cookie:"relay_dev_session="+token}});
      const session=await auth.getHumanSession(request,env);
      assert.equal(session.userId,id);
      assert.equal(session.workspaceId,workspace);
      await auth.deleteHumanAccount(env,session.userId,session.workspaceId);
      assert.equal(await auth.getHumanSession(request,env),null);
      assert.equal(sqlite.prepare("SELECT id FROM users WHERE id=?").get(id),undefined);
      assert.equal(sqlite.prepare("SELECT id FROM workspaces WHERE id=?").get(workspace),undefined);
      assert.equal(sqlite.prepare("SELECT id FROM agents WHERE workspace_id=?").get(workspace),undefined);
      assert.equal(sqlite.prepare("SELECT user_id FROM account_deletions WHERE user_id=?").get(id),undefined);
      assert.equal(sqlite.prepare("SELECT id FROM users WHERE id=?").get(existingUser.id).id,existingUser.id);
    }
  });
  await check("missing Clerk identity cannot be guessed from a legacy sentinel during deletion",async () => {
    const id="missing-clerk-identity", workspace="ws_"+id, now=Date.now();
    sqlite.prepare("INSERT INTO workspaces(id,name,created_at) VALUES (?,?,?)").run(workspace,"Incomplete identity",now);
    sqlite.prepare("INSERT INTO users(id,google_sub,email,name,workspace_id,created_at) VALUES (?,?,?,?,?,?)").run(id,"clerk:"+"a".repeat(64),"bob@example.test","Incomplete identity",workspace,now);
    await assert.rejects(auth.deleteHumanAccount(env,id,workspace),error => error instanceof auth.AuthError && error.code==="identity_unavailable" && error.status===503);
    assert.equal(sqlite.prepare("SELECT user_id FROM account_deletions WHERE user_id=?").get(id),undefined);
    assert.equal(sqlite.prepare("SELECT paused FROM workspaces WHERE id=?").get(workspace).paused,0);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM clerk_actions").get().n,0);
  });
  console.log(`\n${count} isolated auth checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await rm(temporary,{recursive:true,force:true});
}
