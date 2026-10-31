/** Directory listing files stay consistent with the hosted endpoint, the canonical skill and each directory's published rules; no network. */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(".");
const endpoint = "https://api.hitchhike.dev/mcp";
let count = 0;
const check = (name, fn) => { fn(); console.log("ok " + (++count) + " - " + name); };
const json = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const png = (path) => {
  const bytes = readFileSync(join(root, path));
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", path + " is not a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), size: bytes.length };
};

const marketplace = json(".claude-plugin/marketplace.json");
const codexMarketplace = json(".agents/plugins/marketplace.json");
const entry = marketplace.plugins.find((plugin) => plugin.name === "hitchhike");
const pluginRoot = entry?.source;
const plugin = json(join(pluginRoot, ".claude-plugin/plugin.json"));
const portable = json(join(pluginRoot, "plugin.json"));
const openai = portable.extensions["com.openai"];

check("the Claude Code marketplace lists the in-repo hitchhike plugin", () => {
  assert.equal(marketplace.name, "hitchhike");
  assert.ok(marketplace.owner?.name);
  assert.equal(typeof pluginRoot, "string");
  assert.ok(pluginRoot.startsWith("./"), "relative sources must start with ./");
  assert.ok(existsSync(join(root, pluginRoot, ".claude-plugin/plugin.json")));
});

check("marketplace entry and plugin manifest agree", () => {
  for (const key of ["name", "version", "description", "homepage", "repository", "license"]) assert.deepEqual(entry[key], plugin[key], key);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(plugin.privacyPolicyUrl, "https://hitchhike.dev/privacy");
  assert.equal(plugin.termsOfServiceUrl, "https://hitchhike.dev/terms");
});

check("both MCP configurations connect only to the hosted OAuth endpoint", () => {
  const claude = json(join(pluginRoot, ".mcp.json")), agentPlugins = json(join(pluginRoot, "mcp.json"));
  assert.deepEqual(claude, { mcpServers: { hitchhike: { type: "http", url: endpoint } } });
  assert.deepEqual(agentPlugins, { $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", mcpServers: { hitchhike: { type: "streamable-http", url: endpoint } } });
});

check("the portable manifest matches the Claude manifest and the Codex marketplace", () => {
  assert.equal(portable.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  for (const key of ["name", "version", "author", "homepage", "repository", "license"]) assert.deepEqual(portable[key], plugin[key], key);
  assert.equal(codexMarketplace.name, "hitchhike");
  assert.deepEqual(codexMarketplace.plugins, [{ name: "hitchhike", source: { source: "local", path: pluginRoot }, policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Productivity" }]);
});

check("the OpenAI listing stays within the directory's submission limits", () => {
  const ui = openai.interface;
  assert.ok(ui.displayName.length <= 30 && ui.shortDescription.length <= 30 && !ui.shortDescription.includes("\n"));
  assert.ok(ui.longDescription.length <= 4000 && ui.developerName.length <= 80);
  assert.ok(!/\b(MCP|plugin)\b/i.test(ui.displayName), "names must not append MCP or Plugin");
  assert.ok(ui.capabilities.length <= 20 && ui.capabilities.every((item) => item.length <= 120));
  assert.ok(ui.defaultPrompt.length <= 3 && new Set(ui.defaultPrompt).size === ui.defaultPrompt.length);
  assert.ok(ui.defaultPrompt.every((prompt) => prompt.length <= 128 && !prompt.includes("@")));
  for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) assert.match(ui[key], /^https:\/\/[^@\s]+$/, key);
  assert.equal(ui.privacyPolicyURL, plugin.privacyPolicyUrl); assert.equal(ui.termsOfServiceURL, plugin.termsOfServiceUrl);
  for (const color of [ui.brandColor, ui.brandColorDark]) assert.match(color, /^#[0-9A-F]{6}$/);
  for (const path of [ui.logo, ui.composerIcon]) {
    assert.ok(path.startsWith("./assets/"));
    const { width, height, size } = png(join(pluginRoot, path));
    assert.equal(width, height); assert.ok(width >= 48 && width <= 4096 && size <= 5 * 1024 * 1024);
  }
});

check("the OpenAI review cases name only tools the server offers", () => {
  const source = readFileSync(join(root, "src/mcp.ts"), "utf8");
  const tools = new Set([...source.matchAll(/name: "([a-z_]+)",\s*requiredScope:/g)].map((match) => match[1]));
  const { positive, negative } = openai.review.test_cases;
  assert.equal(positive.length, 5); assert.equal(negative.length, 3);
  for (const test of positive) {
    assert.ok(test.description && test.prompt && test.expected_behavior);
    for (const name of test.tools_triggered.split(/,\s*/)) assert.ok(tools.has(name), name);
  }
  for (const test of negative) assert.ok(test.description && test.prompt);
  assert.ok(!("test_credentials" in openai.review) && !("reviewer_instructions" in openai.review), "reviewer credentials go in the dashboard, never the package");
});

check("the bundled skill is an exact copy of the canonical adapter skill", () => {
  const canonical = readFileSync(join(root, "adapters/skills/delegate-to-agents/SKILL.md"));
  assert.ok(canonical.equals(readFileSync(join(root, pluginRoot, "skills/delegate-to-agents/SKILL.md"))), "copy adapters/skills/delegate-to-agents/SKILL.md into the plugin again");
  assert.deepEqual(readdirSync(join(root, pluginRoot, "skills")), ["delegate-to-agents"]);
});

check("the plugin icon meets the plugin directory's rules", () => {
  assert.equal(plugin.icon, "./assets/icon.png");
  const icon = png(join(pluginRoot, plugin.icon));
  assert.equal(icon.width, icon.height);
  assert.ok(icon.width >= 512 && icon.width <= 2048);
  assert.ok(icon.size < 2 * 1024 * 1024);
});

check("every exported listing icon has the size its name states", () => {
  const icons = readdirSync(join(root, "marketplace/icons")).filter((name) => name.endsWith(".png"));
  assert.ok(icons.length >= 8);
  for (const name of icons) {
    const size = Number(/-(\d+)\.png$/.exec(name)?.[1]);
    const { width, height } = png(join("marketplace/icons", name));
    assert.equal(width, size, name); assert.equal(height, size, name);
  }
  for (const name of ["hitchhike-icon.svg", "hitchhike-icon-small.svg", "hitchhike-icon-transparent.svg"]) {
    assert.ok(statSync(join(root, "marketplace/icons", name)).isFile(), name);
  }
});

const temporary = await mkdtemp(join(tmpdir(), "hitchhike-marketplace-"));
try {
  const entry = join(temporary, "worker.mjs");
  await build({ entryPoints: [resolve("src/index.ts")], bundle: true, platform: "node", format: "esm", outfile: entry, logLevel: "silent" });
  const worker = (await import(pathToFileURL(entry).href)).default;
  const env = { DB: { prepare() { throw new Error("Domain verification must not read workspace data"); } }, HOSTED: "true", PUBLIC_URL: "https://api.hitchhike.dev" };
  const challenge = (bindings) => worker.fetch(new Request("https://api.hitchhike.dev/.well-known/openai-apps-challenge"), bindings, { waitUntil() {}, passThroughOnException() {} });
  const served = await challenge({ ...env, OPENAI_APPS_CHALLENGE: " synthetic-portal-token \n" });
  assert.equal(served.status, 200);
  assert.match(served.headers.get("Content-Type"), /^text\/plain/);
  assert.equal(await served.text(), "synthetic-portal-token");
  console.log("ok " + (++count) + " - the configured domain-verification token is served as exact plain text");
  for (const value of [undefined, "", "two words", "x".repeat(513)]) assert.equal((await challenge({ ...env, OPENAI_APPS_CHALLENGE: value })).status, 404, String(value));
  console.log("ok " + (++count) + " - without a valid token the challenge path is not found");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
