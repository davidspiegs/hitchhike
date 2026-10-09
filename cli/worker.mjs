import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export class CliError extends Error {
  constructor(message, exitCode = 1, status) {
    super(message);
    this.exitCode = exitCode;
    this.status = status;
  }
}

function httpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new CliError("use an absolute HTTP(S) relay URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CliError("relay URLs must use HTTP(S), without credentials, a query or a fragment.");
  }
  if (url.protocol === "http:" && !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) {
    throw new CliError("use HTTPS for remote relays; HTTP is allowed only for local loopback development.");
  }
  return url;
}

export function relayOrigin(base) {
  if (!base) throw new CliError("set RELAY_URL to your relay's API address.");
  const url = httpUrl(base);
  if (url.pathname !== "/") throw new CliError("RELAY_URL must be the relay's API origin, without a path.");
  return url.origin;
}

export async function requestJson(url, { method, headers, body, timeout = 10000, signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, timeout));
  try {
    const response = await fetch(url, { method, headers, body, redirect: "error", signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new CliError("the relay returned invalid JSON; the request's outcome is uncertain.", 1, response.status); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new CliError("the relay returned an invalid response.", 1, response.status);
    return { status: response.status, data };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(`relay request failed (${error.cause?.code || error.name}); its outcome may be uncertain.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** A hosted claim's credential goes only to the configured API's exact routes. */
export function workerEndpoints(base, submitUrl, claimId, token = process.env.RELAY_TOKEN) {
  const url = httpUrl(submitUrl);
  const origin = base ? relayOrigin(base) : undefined;
  if (origin && url.origin !== origin) throw new CliError("the submission URL does not belong to RELAY_URL.");
  if (claimId !== undefined) {
    if (!origin || !token) throw new CliError("hosted submission needs RELAY_URL, RELAY_TOKEN and --claim-id.");
    if (typeof claimId !== "string" || !/^ct_[A-Za-z0-9_-]+$/.test(claimId) || url.pathname !== "/v1/submit") {
      throw new CliError("use the claim identifier and exact /v1/submit URL returned by this relay.");
    }
    return { submit: `${origin}/v1/submit`, heartbeat: `${origin}/v1/heartbeat`, headers: { authorization: `Bearer ${token}`, "x-claim-token": claimId } };
  }
  if (!/^\/v1\/submit\/ct_[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new CliError("hosted submission needs --claim-id; legacy submission needs the relay's claim URL.");
  }
  // Legacy standalone submit still works without a configured relay. Never add
  // the ambient bearer to a user-supplied capability URL, even on the same host.
  return { submit: url.href, heartbeat: `${url.href}/heartbeat`, headers: {} };
}

export const submitWorker = (endpoints, body) => requestJson(endpoints.submit, {
  method: "POST", headers: { ...endpoints.headers, accept: "application/json", "content-type": "text/markdown" }, body,
});

export function confirmSubmission({ status, data }) {
  const outcomes = new Set(["ACCEPTED", "QUESTION_SENT", "RECORDED", "ALREADY_DONE", "CLOSED"]);
  if (status < 200 || status >= 300 || data.ok !== true || !outcomes.has(data.outcome)) {
    throw new CliError(data.error?.message || data.message || `submission was not confirmed (${status}).`, status === 429 ? 3 : 1, status);
  }
  return data.outcome;
}

async function heartbeatWorker(endpoints, timeout, signal) {
  const { status, data } = await requestJson(endpoints.heartbeat, {
    method: "POST", headers: { ...endpoints.headers, accept: "application/json" }, timeout, signal,
  });
  const until = Date.parse(data.lease_expires_at);
  if (status !== 200 || data.ok !== true || !Number.isFinite(until) || until <= Date.now()) {
    throw new CliError(data.error?.message || "the relay did not confirm this job's lease.", 1, status);
  }
  return until;
}

export function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

/** Prepare before acquiring: a crash cannot leave an empty, unidentifiable lock. */
function lockRunner(directory) {
  const owner = { pid: process.pid, nonce: randomUUID() };
  const ownerPath = join(directory, `owner-${owner.nonce}.json`);
  const lockPath = join(directory, "runner.lock");
  writePrivate(ownerPath, JSON.stringify(owner));
  let recoveryPath;
  try {
    try { linkSync(ownerPath, lockPath); } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = JSON.parse(readFileSync(lockPath, "utf8"));
      if (typeof previous.nonce !== "string" || !/^[a-f0-9-]{36}$/.test(previous.nonce) || pidIsAlive(previous.pid)) {
        throw new CliError("another runner holds this connection's lock; do not start a second one.");
      }
      // Only one contender may reclaim this particular dead owner's lock.
      // Recheck the nonce after reserving recovery, so an observed stale lock
      // can never authorize removing a newly acquired runner's lock.
      recoveryPath = join(directory, `recover-${previous.nonce}.lock`);
      try { linkSync(ownerPath, recoveryPath); } catch (error) {
        if (error.code === "EEXIST") throw new CliError(`lock recovery is already reserved; inspect ${recoveryPath} before removing an abandoned recovery marker.`);
        throw error;
      }
      const current = JSON.parse(readFileSync(lockPath, "utf8"));
      if (current.nonce !== previous.nonce || pidIsAlive(current.pid)) throw new CliError("the runner lock changed; try again after the other runner stops.");
      unlinkSync(lockPath);
      try { linkSync(ownerPath, lockPath); } catch (error) {
        if (error.code === "EEXIST") throw new CliError("another runner acquired this connection's lock.");
        throw error;
      }
    }
  } catch (error) {
    try { unlinkSync(ownerPath); } catch {}
    throw error;
  } finally {
    if (recoveryPath) {
      try {
        if (JSON.parse(readFileSync(recoveryPath, "utf8")).nonce === owner.nonce) unlinkSync(recoveryPath);
      } catch {}
    }
  }
  return () => {
    try { if (JSON.parse(readFileSync(lockPath, "utf8")).nonce === owner.nonce) unlinkSync(lockPath); } catch {}
    try { unlinkSync(ownerPath); } catch {}
  };
}

function writePrivate(path, text) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicWrite(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writePrivate(temporary, text);
    renameSync(temporary, path);
    // Windows cannot open directories this way. The receipt file itself is
    // fsynced before rename on every platform; POSIX also persists the rename.
    if (process.platform !== "win32") {
      const fd = openSync(dirname(path), "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
    }
  } finally {
    try { unlinkSync(temporary); } catch {}
  }
}

export function runnerState(base, agentId) {
  if (typeof agentId !== "string" || !agentId || agentId === "owner") throw new CliError("run needs an agent connection.");
  const origin = relayOrigin(base);
  const hash = createHash("sha256").update(`${origin}|${agentId}`).digest("hex").slice(0, 24);
  const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "agent-connector", `runner-${hash}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const release = lockRunner(directory);
  return {
    release,
    begin(job, { endpoints, claimId, command, brief, resent, resume }) {
      if (typeof job.id !== "string" || !job.id) throw new CliError("the relay returned a job without an ID.");
      if (resume && resume !== job.id) throw new CliError(`requested resume ${resume}, but the relay returned ${job.id}. Nothing was executed.`);
      const jobHash = createHash("sha256").update(job.id).digest("hex");
      const jobDirectory = join(directory, jobHash);
      const receiptPath = join(jobDirectory, "receipt.json");
      let previous;
      try { previous = JSON.parse(readFileSync(receiptPath, "utf8")); } catch (error) {
        if (error.code !== "ENOENT") throw new CliError(`cannot read the execution receipt at ${receiptPath}; inspect it before retrying.`);
      }
      if (previous || resent) {
        if (resume !== job.id) throw new CliError(`job ${job.id} was already claimed or executed. Inspect ${receiptPath}${previous?.result_file ? ` and saved output ${previous.result_file}` : ""}. To deliberately run this job again, use --resume ${job.id}; --yes does not authorize a repeat.`);
        if (previous?.phase === "started" && previous.child_pid && pidIsAlive(previous.child_pid)) throw new CliError(`the previous command for ${job.id} may still be running (PID ${previous.child_pid}); stop or inspect it before resuming.`);
      }
      mkdirSync(jobDirectory, { recursive: true, mode: 0o700 });
      if (previous) atomicWrite(join(jobDirectory, `receipt-${randomUUID()}.json`), JSON.stringify(previous, null, 2));
      const runId = randomUUID();
      const briefFile = join(jobDirectory, `brief-${runId}.md`);
      const resultFile = join(jobDirectory, `result-${runId}.md`);
      atomicWrite(briefFile, brief);
      const receipt = { version: 1, relay: origin, agent_id: agentId, job_id: job.id, attempt: job.attempts, phase: "started", started_at: new Date().toISOString(), command, submit_url: endpoints.submit, ...(claimId ? { claim_id: claimId } : {}), brief_file: briefFile, result_file: resultFile };
      const update = (patch) => { Object.assign(receipt, patch); atomicWrite(receiptPath, JSON.stringify(receipt, null, 2)); };
      update({}); // Durable before any local command can start.
      return {
        briefFile, resultFile, receiptPath, update,
        saveCommandOutput({ stdout, stderr }) {
          const stdoutFile = `${resultFile}.stdout`;
          const stderrFile = `${resultFile}.stderr`;
          atomicWrite(stdoutFile, stdout);
          atomicWrite(stderrFile, stderr);
          update({ stdout_file: stdoutFile, stderr_file: stderrFile });
        },
        saveResult(body) { atomicWrite(resultFile, body); update({ phase: "output_saved" }); },
      };
    },
  };
}

/** Renew without overlapping requests, and stop the command at the last known deadline. */
export async function runWithLease(command, env, endpoints, onSpawn) {
  let until = await heartbeatWorker(endpoints);
  const controller = new AbortController();
  let stopped = false;
  let failure;
  let renewalTimer;
  let deadlineTimer;
  let killTimer;
  let termination;
  let stdout = "";
  let stderr = "";
  const child = spawn(command, { shell: true, detached: process.platform !== "win32", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const terminate = () => {
    try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM"); } catch {}
    termination = new Promise((resolve) => {
      killTimer = setTimeout(() => {
        try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL"); } catch {}
        resolve();
      }, 1000);
    });
  };
  const stop = (error) => {
    if (stopped || failure) return;
    failure = error;
    controller.abort();
    clearTimeout(renewalTimer);
    terminate();
  };
  const armDeadline = () => {
    clearTimeout(deadlineTimer);
    deadlineTimer = setTimeout(() => stop(new CliError("lease renewal could not be confirmed before expiry; the local command was stopped. Inspect its effects before resuming.")), Math.max(1, until - Date.now() - 25));
  };
  const renew = async () => {
    try {
      until = await heartbeatWorker(endpoints, Math.min(10000, Math.max(1, until - Date.now() - 25)), controller.signal);
      if (stopped || failure) return;
      armDeadline();
      renewalTimer = setTimeout(renew, Math.max(25, Math.min(30000, (until - Date.now()) / 3)));
    } catch (error) {
      if (stopped || failure) return;
      if ([401, 403, 404, 409, 503].includes(error.status)) stop(new CliError(`lease renewal failed: ${error.message} The local command was stopped.`));
      else renewalTimer = setTimeout(renew, Math.max(25, Math.min(1000, (until - Date.now()) / 3)));
    }
  };
  const interrupted = () => stop(new CliError("runner interrupted; inspect the saved output and execution receipt before resuming.", 130));
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  child.stdout.on("data", (data) => { stdout += data; process.stderr.write(data); });
  child.stderr.on("data", (data) => { stderr += data; process.stderr.write(data); });
  const closed = new Promise((resolve) => {
    child.once("error", (error) => { stderr += error.message; });
    child.once("close", (code) => resolve(code));
  });
  try {
    try { onSpawn(child.pid); } catch (error) { stop(new CliError(`cannot persist the command's PID: ${error.message}`)); }
    armDeadline();
    renewalTimer = setTimeout(renew, Math.max(25, Math.min(30000, (until - Date.now()) / 3)));
    const code = await closed;
    // The shell can exit before a redirected background descendant that ignored
    // SIGTERM. Keep the runner lock until its group's SIGKILL was attempted.
    if (termination) await termination;
    return { code, stdout, stderr, failure };
  } finally {
    stopped = true;
    controller.abort();
    clearTimeout(renewalTimer);
    clearTimeout(deadlineTimer);
    clearTimeout(killTimer);
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
}
