/** Browser-bound authentication behavior with an isolated Clerk/DOM double; no vendor calls. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Script, createContext } from "node:vm";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "agent-connect-ui-test-"));
let count = 0;
const check = async (name, action) => { await action(); console.log("ok " + (++count) + " - " + name); };
const scripts = (html) => Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), (match) => match[1]);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
function browser(auth) {
  const nodes = new Map(), appended = [], calls = [], window = { AgentConnectAuth: auth };
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, textContent: "", value: "", listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute(name,value) { this[name] = value; }, querySelector() { return this.rendered ? {} : null; }, render() { this.rendered = true; this.observer?.(); } });
    return nodes.get(id);
  };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe(target) { this.target = target; target.observer = this.callback; } disconnect() { this.target.observer = null; } }
  const context = createContext({ window, document: { getElementById: node, createElement: () => node("script-" + appended.length), head: { appendChild(value) { appended.push(value); queueMicrotask(() => value.onload()); } } }, location: { origin: "https://relay.example", replace(path) { calls.push(["replace",path]); }, reload() { calls.push(["reload"]); } }, fetch: async (...args) => { calls.push(["fetch",...args]); return { ok:true, json:async () => ({authenticated:true}) }; }, MutationObserver, setTimeout, clearTimeout, Promise, URL, console });
  return { context, window, nodes, node, calls, appended, run(source) { return new Script(source).runInContext(context); } };
}
try {
  const entry = join(temporary, "ui.mjs");
  await build({entryPoints:[resolve("src/clerk-ui.ts")],bundle:true,platform:"node",format:"esm",outfile:entry,logLevel:"silent"});
  const ui = await import(pathToFileURL(entry).href);
  const dashboardEntry = join(temporary, "dashboard.mjs"), consentEntry = join(temporary, "auth-ui.mjs");
  await build({entryPoints:[resolve("src/dashboard.ts")],bundle:true,platform:"node",format:"esm",outfile:dashboardEntry,logLevel:"silent"});
  await build({entryPoints:[resolve("src/auth-ui.ts")],bundle:true,platform:"node",format:"esm",outfile:consentEntry,logLevel:"silent"});
  const dashboard = await import(pathToFileURL(dashboardEntry).href), consent = await import(pathToFileURL(consentEntry).href);
  const config = {publishableKey:"pk_test_public",frontendApi:"sample.clerk.accounts.dev",nonce:"random-nonce",returnTo:"/oauth/authorize?state=kept"};
  await check("all emitted scripts parse, escape markup, and carry the supplied nonce", async () => {
    for (const html of [ui.clerkSignInPage({...config,publishableKey:'pk_test_</script><script>bad</script>'}),ui.clerkConsentScript(config)]) {
      for (const source of scripts(html)) new Script(source);
      assert.equal((html.match(/<script\b/g) || []).length,2);
      assert.equal((html.match(/<script nonce="random-nonce">/g) || []).length,2);
      assert.doesNotMatch(html,/<script>bad/);
    }
  });
  await check("dashboard loads Clerk only in Clerk mode while legacy and Google markup remain compatible", async () => {
    const clerkPage=dashboard.dashboardHtml("Agent Connect",{hosted:true,authProvider:"clerk",authConfigured:true,clerk:config,nonce:config.nonce});
    const googlePage=dashboard.dashboardHtml("Agent Connect",{hosted:true,authProvider:"google",authConfigured:true});
    const legacyPage=dashboard.dashboardHtml("My relay");
    assert.equal(scripts(clerkPage).length,2);
    for(const page of [clerkPage,googlePage,legacyPage]) for(const source of scripts(page)) new Script(source);
    assert.match(clerkPage,/Create account or sign in/); assert.match(googlePage,/Continue with Google/); assert.match(legacyPage,/Owner key/);
    assert.doesNotMatch(googlePage,/sample.clerk.accounts.dev|clerk.browser.js/); assert.doesNotMatch(legacyPage,/sample.clerk.accounts.dev|clerk.browser.js/);
    assert.equal((clerkPage.match(/<script nonce="random-nonce">/g)||[]).length,2);
  });
  await check("native consent is script-free without Clerk and safely disables Clerk submissions until ready", async () => {
    const input={clientName:'<img src=x onerror=alert(1)>',redirectOrigin:"https://client.example",email:"test@example.test",csrfToken:"csrf-kept",requestId:"request-kept",scopes:["relay:read"],agents:[{id:"agent",name:"My agent",can_request:1,can_work:1}]};
    const google=consent.consentPage(input), clerk=consent.consentPage({...input,clerk:config});
    assert.equal(scripts(google).length,0); assert.equal(scripts(clerk).length,2);
    assert.match(clerk,/name="clerk_session_token" value=""/); assert.match(clerk,/value="allow" disabled/); assert.match(clerk,/name="csrf_token" value="csrf-kept"/);
    assert.doesNotMatch(clerk,/<img src=x/);
    for (const page of [google, clerk]) {
      assert.match(page, /<option value="" disabled selected>Choose a connection…<\/option>/);
      assert.match(page, /<option value="agent">My agent — send and work \(agent\)<\/option>/);
      assert.match(page, /value="deny" formnovalidate/);
    }
  });
  await check("scoped native consent confirms one connection without a picker and escapes its identity", async () => {
    const input={targetAgentId:'grok',clientName:'Custom client',redirectOrigin:'https://client.example',email:'test@example.test',csrfToken:'csrf',requestId:'request',scopes:['relay:read','relay:work'],agents:[{id:'grok',name:'Grok <script>unsafe</script>',can_request:1,can_work:1}]};
    for (const page of [consent.consentPage(input),consent.consentPage({...input,clerk:config})]) {
      assert.doesNotMatch(page,/<select|<script>unsafe/);
      assert.match(page,/<h1>Connect Grok &lt;script&gt;unsafe&lt;\/script&gt;<\/h1>/);
      assert.match(page,/type="hidden" name="agent_id" value="grok"/);
      assert.match(page,/name="csrf_token" value="csrf"/);
      assert.match(page,/value="deny" formnovalidate/);
    }
    const missing=consent.consentPage({...input,targetAgentId:'other'});
    assert.match(missing,/Connection unavailable/); assert.doesNotMatch(missing,/<form|<select/);
  });
  await check("return paths cannot navigate to an external origin or unrelated route", async () => {
    for (const returnTo of ["//evil.example/", "https://evil.example/", "/auth/logout", "/\\evil.example/"]) {
      const b = browser(); b.window.Clerk = {load:async () => {}};
      b.run(scripts(ui.clerkBootstrap({...config,returnTo}))[0]);
      await b.window.AgentConnectAuth.ready;
      assert.equal(b.window.AgentConnectAuth.returnTo,"/");
    }
    assert.throws(() => ui.clerkBootstrap({...config,frontendApi:"bad.example/path"}));
    assert.throws(() => ui.clerkBootstrap({...config,frontendApi:"https://bad.example:444"}));
  });
  await check("raw Clerk transport URLs cannot appear in rendered retry links or bootstrap state", async () => {
    const dirty={...config,returnTo:config.returnTo+"&__clerk_handshake=transport-secret-placeholder&__clerk_db_jwt=transport-secret-placeholder&__CLERK_FUTURE=transport-secret-placeholder"};
    const input={clientName:"Client",redirectOrigin:"https://client.example",email:"test@example.test",csrfToken:"csrf",requestId:"request",scopes:["relay:read"],agents:[],clerk:dirty};
    for (const page of [ui.clerkSignInPage(dirty),ui.clerkBootstrap(dirty),consent.consentPage(input)]) {
      assert.doesNotMatch(page,/__clerk|transport-secret-placeholder/i);
      assert.match(page,/state(?:%3D|=)kept/);
    }
  });
  await check("bootstrap loads exact Clerk host with nonce and disables optional telemetry", async () => {
    const b = browser(); let options;
    b.window.__internal_ClerkUICtor = function() {};
    b.window.Clerk = {load:async (value) => {options=value;},session:{getToken:async (value) => { b.calls.push(["token",value]); return "short-lived"; }}};
    b.run(scripts(ui.clerkBootstrap(config,true))[0]);
    await b.window.AgentConnectAuth.ready;
    assert.equal(b.appended.length,2);
    assert.equal(b.appended[0].src,"https://sample.clerk.accounts.dev/npm/@clerk/ui@1/dist/ui.browser.js");
    assert.equal(b.appended[1].nonce,"random-nonce");
    assert.equal(b.appended[1]["data-clerk-publishable-key"],"pk_test_public");
    assert.equal(options.telemetry.disabled,true);
    assert.equal(await b.window.AgentConnectAuth.getToken(true),"short-lived");
    assert.equal(b.calls[0][1].skipCache,true);
  });
  await check("new users stay in the mounted sign-in flow and preserve signup/social continuation", async () => {
    const clerk = {session:null,mountSignIn:(node,options) => { b.calls.push(["mount",options]); node.render(); }};
    const b = browser({ready:Promise.resolve(clerk),returnTo:config.returnTo});
    b.run(scripts(ui.clerkSignInPage(config))[1]); await settle();
    const options = b.calls.find((call) => call[0]==="mount")[1];
    assert.equal(options.routing,"hash"); assert.equal(options.withSignUp,true); assert.equal(options.oauthFlow,"redirect");
    assert.equal(options.forceRedirectUrl,config.returnTo); assert.equal(options.signUpForceRedirectUrl,config.returnTo);
    assert.equal(b.calls.some((call) => call[0]==="fetch"),false);
    assert.equal(b.node("auth-panel")["aria-busy"],"false");
    assert.equal(b.node("auth-placeholder").hidden,true);
  });
  await check("both SDK requests start before either completes, then initialize only after both load", async () => {
    const b = browser(); let loaded = false;
    b.window.__internal_ClerkUICtor = function() {};
    b.window.Clerk = {load:async () => {loaded = true;}};
    b.context.document.head.appendChild = value => b.appended.push(value);
    b.run(scripts(ui.clerkBootstrap(config,true))[0]);
    assert.equal(b.appended.length,2);
    b.appended[1].onload(); await settle(); assert.equal(loaded,false);
    b.appended[0].onload(); await b.window.AgentConnectAuth.ready; assert.equal(loaded,true);
  });
  await check("the loading frame remains until Clerk renders controls, including delayed component chunks", async () => {
    const b = browser({ready:Promise.resolve({session:null,mountSignIn:() => {}}),returnTo:"/app"});
    b.run(scripts(ui.clerkSignInPage(config))[1]); await settle();
    assert.equal(b.node("auth-placeholder").hidden,false);
    assert.equal(b.node("auth-panel")["data-ready"],undefined);
    b.node("sign-in").render(); await settle();
    assert.equal(b.node("auth-placeholder").hidden,true);
    assert.equal(b.node("auth-panel")["data-ready"],"true");
    assert.equal(b.node("sign-in").observer,null);
  });
  await check("a stalled UI mount exits the loading frame with an accessible retry", async () => {
    let timeout;
    const b = browser({ready:Promise.resolve({session:null,mountSignIn:() => {}}),returnTo:"/app"});
    b.context.setTimeout = (callback) => {timeout=callback;return 1;}; b.context.clearTimeout = () => {};
    b.run(scripts(ui.clerkSignInPage(config))[1]); await settle(); timeout(); await settle();
    assert.equal(b.node("auth-placeholder").hidden,true);
    assert.equal(b.node("auth-panel")["data-failed"],"true");
    assert.equal(b.node("auth-panel")["aria-busy"],"false");
    assert.equal(b.node("auth-problem").hidden,false);
    assert.equal(b.node("auth-retry").hidden,false);
    assert.equal(b.node("sign-in").observer,null);
  });
  await check("existing sessions are verified before returning to MCP consent", async () => {
    const b = browser({ready:Promise.resolve({session:{}}),returnTo:config.returnTo,getToken:async () => "fresh-session-token"});
    b.run(scripts(ui.clerkSignInPage(config))[1]); await settle();
    const request = b.calls.find((call) => call[0]==="fetch");
    assert.equal(request[1],"/auth/clerk/session"); assert.equal(request[2].headers.Authorization,"Bearer fresh-session-token");
    assert.equal(b.calls.find((call) => call[0]==="replace")[1],config.returnTo);
  });
  await check("backend verification failure stays visible without a login fallback", async () => {
    const b = browser({ready:Promise.resolve({session:{}}),returnTo:config.returnTo,getToken:async () => "token"});
    b.window.Clerk = {session:{}};
    b.context.fetch = async () => ({ok:false,json:async () => ({error:{message:"Session revoked"}})});
    b.run(scripts(ui.clerkSignInPage(config))[1]); await settle();
    assert.equal(b.node("auth-error").textContent,"Session revoked"); assert.equal(b.node("auth-error").hidden,false);
    assert.equal(b.node("auth-reset").hidden,false); assert.equal(b.calls.length,0);
  });
  await check("SDK load failures provide a retry instead of opening the workspace", async () => {
    const failed = Promise.reject(new Error("Sign-in could not load")); failed.catch(() => {});
    const b = browser({ready:failed}); b.run(scripts(ui.clerkSignInPage(config))[1]); await settle();
    assert.equal(b.node("auth-retry").hidden,false); assert.match(b.node("auth-error").textContent,/could not load/); assert.equal(b.calls.length,0);
  });
  await check("native consent awaits a fresh token and keeps the clicked decision and original CSRF", async () => {
    let release;
    const b = browser({ready:Promise.resolve({session:{}}),getToken:async (force) => { assert.equal(force,true); return new Promise((resolve) => {release=resolve;}); }});
    const form=b.node("oauth-consent"), allow={disabled:true,name:"decision",value:"allow"}, deny={disabled:true,name:"decision",value:"deny"};
    const fields={clerk_session_token:{value:""},csrf_token:{value:"original-csrf"},request_id:{value:"original-request"}};
    form.querySelectorAll=() => [allow,deny]; form.elements={namedItem:(name) => fields[name]};
    form.requestSubmit=(submitter) => { let prevented=false; form.listeners.submit({submitter,preventDefault(){prevented=true;}}); assert.equal(prevented,false); b.calls.push(["submitted",submitter.value]); };
    b.run(scripts(ui.clerkConsentScript(config))[1]); await settle(); assert.equal(allow.disabled,false);
    const pending=form.listeners.submit({submitter:deny,preventDefault(){}}); await settle();
    assert.equal(allow.disabled,true); assert.equal(fields.clerk_session_token.value,""); assert.equal(b.calls.length,0);
    release("new-token"); await pending;
    assert.equal(fields.clerk_session_token.value,"new-token"); assert.equal(b.calls[0][1],"deny"); assert.equal(fields.csrf_token.value,"original-csrf"); assert.equal(fields.request_id.value,"original-request");
  });
  console.log("Clerk UI checks passed: " + count);
} finally { await rm(temporary,{recursive:true,force:true}); }
