/** Indexing boundary checks against the actual Worker; no network, secrets, or stored user data. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const temporary = await mkdtemp(join(tmpdir(), "hitchhike-public-pages-"));
const canonical = "https://hitchhike.dev";
let count=0, databaseCalls=0;
const check = async (name,fn) => { await fn(); console.log("ok " + (++count) + " - " + name); };
const DB = { prepare() { databaseCalls++; throw new Error("Public documents must not read workspace data"); } };
const env = {DB,HOSTED:"true",AUTH_PROVIDER:"google",PUBLIC_URL:canonical,GOOGLE_CLIENT_ID:"synthetic-client",GOOGLE_CLIENT_SECRET:"synthetic-secret",
  RATE_LIMITER:{limit:async()=>({success:true})},AUTH_RATE_LIMITER:{limit:async()=>({success:true})},GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
  ENCRYPTION_KEY:"synthetic-public-page-encryption-fixture-only",ADMIN_TOKEN:"synthetic-public-page-owner-fixture-only"};
const ctx = {waitUntil() {},passThroughOnException() {}};
try {
  const entry=join(temporary,"worker.mjs");
  await build({entryPoints:[resolve("src/index.ts")],bundle:true,platform:"node",format:"esm",outfile:entry,logLevel:"silent"});
  const worker=(await import(pathToFileURL(entry).href)).default;
  const fetchPage=(path,options={},bindings=env,origin=canonical) => worker.fetch(new Request(origin+path,options),bindings,ctx);
  await check("only anonymous canonical home and privacy responses are indexable and never cached",async () => {
    for(const path of ["/","/privacy"]) {
      const response=await fetchPage(path), html=await response.text();
      assert.equal(response.status,200); assert.equal(response.headers.get("X-Robots-Tag"),"index, follow");
      assert.equal(response.headers.get("Cache-Control"),"no-store");
      assert.match(html,/<meta name="robots" content="index, follow">/);
      assert.ok(html.includes('<link rel="canonical" href="'+canonical+path+'">'));
      assert.match(html,/<meta name="description"/); assert.match(html,/<meta property="og:site_name" content="Hitchhike">/);
    }
  });
  await check("anonymous home has useful visible static copy without exposing workspace content",async () => {
    const html=await (await fetchPage("/")).text();
    assert.doesNotMatch(html.match(/<div id="gate"[^>]*>/)?.[0] || "",/hidden/);
    assert.match(html,/<div id="app" class="app" hidden>/);
    assert.match(html,/Connect your AI apps\. Hand off work with context and bring the results back\./);
    assert.match(html,/href="\/auth\/start"/); assert.match(html,/Enable JavaScript to use Hitchhike/);
    assert.equal(databaseCalls,0);
  });
  await check("any cookie or authorization header keeps both documents private even when malformed or expired",async () => {
    for(const path of ["/","/privacy"]) for(const headers of [{Cookie:"__session=expired"},{Cookie:"relay_dev_session=known-session"},{Cookie:"future_provider_session=opaque"},{Cookie:""},{Authorization:"Bearer invalid-token"}]) {
      const response=await fetchPage(path,{headers}), html=await response.text();
      assert.equal(response.status,200); assert.equal(response.headers.get("X-Robots-Tag"),"noindex");
      assert.equal(response.headers.get("Cache-Control"),"no-store");
      assert.match(html,/<meta name="robots" content="noindex">/); assert.doesNotMatch(html,/<link rel="canonical"/);
      assert.doesNotMatch(html,/known-session|invalid-token|future_provider_session/);
    }
    assert.equal(databaseCalls,0);
  });
  await check("query parameters and preview or self-hosted origins cannot become indexable",async () => {
    const cases=[
      ["/?__clerk_db_jwt=NEVER_RENDER_TRANSPORT",{},env,canonical],
      ["/privacy?tracking=anything",{},env,canonical],
      ["/",{headers:{"X-Forwarded-Host":"hitchhike.dev"}},env,"https://preview.workers.dev"],
      ["/",{}, {...env,PUBLIC_URL:"https://preview.workers.dev"},"https://preview.workers.dev"],
      ["/",{}, {...env,HOSTED:"false"},canonical],
      ["/",{}, {...env,PUBLIC_URL:undefined},canonical],
      ["/",{}, {...env,PUBLIC_URL:"http://hitchhike.dev"},"http://hitchhike.dev"],
    ];
    for(const [path,options,bindings,origin] of cases) {
      const response=await fetchPage(path,options,bindings,origin),html=await response.text();
      assert.equal(response.headers.get("X-Robots-Tag"),"noindex"); assert.equal(response.headers.get("Cache-Control"),"no-store");
      assert.doesNotMatch(html,/<link rel="canonical"|NEVER_RENDER_TRANSPORT/);
    }
  });
  await check("auth, OAuth, API, work links, MCP and unknown routes remain noindex",async () => {
    for(const [path,method] of [["/auth/session","GET"],["/auth/start","GET"],["/oauth/authorize","GET"],["/v1/admin/overview","GET"],["/w/not-a-claim","GET"],["/mcp","POST"],["/not-found","GET"]]) {
      const response=await fetchPage(path,{method});
      assert.equal(response.headers.get("X-Robots-Tag"),"noindex",path);
      if(path.startsWith("/v1/") || path.startsWith("/w/") || path.startsWith("/mcp")) assert.equal(response.headers.get("Cache-Control"),"no-store",path);
    }
  });
  await check("terms are accessible without authentication, script-free, uncached, and unindexed",async () => {
    for(const headers of [{},{Cookie:"__session=expired"}]) {
      const response=await fetchPage("/terms",{headers}),html=await response.text();
      assert.equal(response.status,200); assert.equal(response.headers.get("X-Robots-Tag"),"noindex");
      assert.equal(response.headers.get("Cache-Control"),"no-store"); assert.match(html,/<meta name="robots" content="noindex">/);
      assert.match(html,/Effective September 26, 2026/); assert.doesNotMatch(html,/Draft for review/); assert.match(html,/href="\/privacy"/); assert.match(html,/github.com\/davidspiegs\/hitchhike\/issues/);
      assert.match(html,/Issues are public/); assert.doesNotMatch(html,/<script|expired/);
    }
    const home=await (await fetchPage("/")).text(),privacy=await (await fetchPage("/privacy")).text();
    assert.match(home,/href="\/terms"/); assert.match(privacy,/href="\/terms"/);
    const head=await fetchPage("/terms",{method:"HEAD"}); assert.equal(head.status,200); assert.equal(head.headers.get("X-Robots-Tag"),"noindex");
  });
  await check("terms and privacy describe the hosted service only; self-hosted relays neither serve nor link them",async () => {
    const selfHosted={...env,HOSTED:"false"}, callsBefore=databaseCalls;
    for(const path of ["/terms","/privacy"]) for(const method of ["GET","HEAD"]) {
      const response=await fetchPage(path,{method},selfHosted);
      assert.equal(response.status,404,method+" "+path); assert.equal(response.headers.get("X-Robots-Tag"),"noindex");
      assert.equal(response.headers.get("Cache-Control"),"no-store");
      if(method==="GET") assert.doesNotMatch(await response.text(),/Effective September 26, 2026|Privacy and data/);
    }
    assert.equal(databaseCalls,callsBefore,"hosted-only policy pages must 404 without reading workspace data");
    const home=await fetchPage("/",{},selfHosted); assert.equal(home.status,200);
    assert.doesNotMatch(await home.text(),/href="\/(?:privacy|terms)"/);
  });
  await check("HEAD matches public policy while unsupported methods never receive index permission",async () => {
    const head=await fetchPage("/",{method:"HEAD"}); assert.equal(head.status,200); assert.equal(head.headers.get("X-Robots-Tag"),"index, follow");
    const post=await fetchPage("/",{method:"POST"}); assert.equal(post.status,404); assert.equal(post.headers.get("X-Robots-Tag"),"noindex");
  });
  console.log("Public-page boundary checks passed: "+count);
} finally { await rm(temporary,{recursive:true,force:true}); }
