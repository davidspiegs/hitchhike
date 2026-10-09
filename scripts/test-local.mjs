#!/usr/bin/env node
// Runs only local emulators, with fresh configuration, credentials and D1 state.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const suites = {
  legacy: ["e2e.mjs"],
  hosted: ["hosted-e2e.mjs", "security-regression.mjs"],
};
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--suite" || !suites[args[1]])) {
  console.error("Usage: node scripts/test-local.mjs [--suite legacy|hosted]");
  process.exit(1);
}
const selected = args.length ? [args[1]] : Object.keys(suites);
await access(wrangler).catch(() => {
  throw new Error("Wrangler is not installed. Run npm ci before npm run test:local.");
});
for (const suite of selected) {
  for (const file of suites[suite]) await access(join(root, "scripts", file));
}

const temporary = await mkdtemp(join(tmpdir(), "agent-connector-tests-"));
const children = new Set();
const testSecrets = new Set(["dev-admin-token"]);
function redact(output) {
  let safe = String(output);
  for (const secret of testSecrets) safe = safe.replaceAll(secret, "[redacted]");
  return safe
    .replace(/^.*(?:ADMIN_TOKEN|ENCRYPTION_KEY|GOOGLE_CLIENT_SECRET).*$/gm, "[credential binding redacted]")
    .replace(/\b(?:ar|ct|access|refresh|code|consent|csrf|session|ses|pair)_[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/(Bearer\s+)[^\s"'<>]+/gi, "$1[redacted]");
}
const env = {};
for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "COMSPEC", "PATHEXT", "USERPROFILE", "LANG", "LC_ALL"]) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
Object.assign(env, {
  CI: "1",
  NO_COLOR: "1",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_SEND_ERROR_REPORTS: "false",
  WRANGLER_HIDE_BANNER: "true",
  CLOUDFLARE_SEND_METRICS: "false",
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
  WRANGLER_NO_SKILLS_UPDATE_PROMPTS: "true",
  XDG_CONFIG_HOME: join(temporary, "config"),
});

function launch(argv, options = {}) {
  const child = spawn(process.execPath, argv, {
    cwd: temporary,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
    ...options,
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function finished(child) {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveExit();
      else reject(new Error(`Local command exited with ${signal || `status ${code}`}.`));
    });
  });
}

function signalChild(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(child) {
  if (!children.has(child)) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  signalChild(child, "SIGTERM");
  await Promise.race([exited, delay(1500)]);
  if (children.has(child)) {
    signalChild(child, "SIGKILL");
    await exited;
  }
}

async function availablePort() {
  const socket = createServer();
  await new Promise((ready, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", ready);
  });
  const port = socket.address().port;
  await new Promise((closed, reject) => socket.close((error) => error ? reject(error) : closed()));
  return port;
}

async function ready(base, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Local Worker exited before becoming ready.");
    try {
      const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ok === true) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Local Worker did not become ready at ${base}.`);
}

async function runSuite(suite) {
  const directory = join(temporary, suite);
  await mkdir(directory);
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const config = join(directory, "wrangler.json");
  const state = join(directory, "state");
  const encryptionKey = randomBytes(32).toString("hex");
  testSecrets.add(encryptionKey);
  await writeFile(config, JSON.stringify({
    name: `agent-connector-local-${suite}`,
    main: join(root, "src/index.ts"),
    compatibility_date: "2026-09-01",
    observability: { enabled: false },
    d1_databases: [{
      binding: "DB",
      database_name: `agent-connector-local-${suite}`,
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: join(root, "migrations"),
    }],
    vars: {
      RELAY_NAME: `Local ${suite} tests`,
      PUBLIC_URL: base,
      HOSTED: suite === "hosted" ? "true" : "false",
      SIGNUP_MODE: "invite",
      ALLOW_DEV_AUTH: suite === "hosted" ? "true" : "false",
      ADMIN_TOKEN: "dev-admin-token",
      ENCRYPTION_KEY: encryptionKey,
      BETA_EMAILS: "alice@example.test,bob@example.test",
      MIN_LEASE_SECONDS: "1",
      DEFAULT_DAILY_JOB_LIMIT: "1000",
      DEFAULT_MONTHLY_JOB_LIMIT: "10000",
    },
  }, null, 2));
  console.log(`\nRunning ${suite} tests on ${base} with isolated local D1 state.`);
  await finished(launch([wrangler, "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", state]));
  const logPath = join(directory, "worker.log");
  const log = createWriteStream(logPath);
  const worker = launch([wrangler, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--config", config, "--persist-to", state], { stdio: ["ignore", "pipe", "pipe"] });
  worker.stdout.pipe(log, { end: false });
  worker.stderr.pipe(log, { end: false });
  let launchError;
  worker.once("error", (error) => { launchError = error; });
  try {
    await ready(base, worker);
    if (launchError) throw launchError;
    for (const file of suites[suite]) {
      await finished(launch([join(root, "scripts", file)], {
        cwd: directory,
        env: { ...env, RELAY_URL: base, ADMIN_TOKEN: "dev-admin-token" },
        timeout: 180_000,
      }));
    }
  } catch (error) {
    const output = await readFile(logPath, "utf8").catch(() => "");
    console.error(redact(output).slice(-12_000));
    throw error;
  } finally {
    await stop(worker);
    await new Promise((done) => log.end(done));
  }
}

let cleaning;
async function cleanup() {
  if (!cleaning) cleaning = (async () => {
    await Promise.all([...children].map(stop));
    await rm(temporary, { recursive: true, force: true });
  })();
  return cleaning;
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
}
try {
  for (const suite of selected) await runSuite(suite);
  console.log("\nAll selected local suites passed.");
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
} finally {
  await cleanup();
}
