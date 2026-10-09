/**
 * Shared, weighted resource admissions. These are operation allowances, not a
 * dollar meter: edge requests, authentication lookups and denied D1 reads can
 * still incur infrastructure charges. Apply the edge limiter before this module.
 *
 * An admitted request spends its allowance even if its later work fails. Client
 * retries therefore still cost operations, but do not create a second job quota.
 */
export interface BudgetEnvironment {
  DB: D1Database;
  HOSTED?: string;
  RESOURCE_BUDGETS_ENABLED?: string;
  RESOURCE_GLOBAL_DAILY_OPERATIONS?: string;
  RESOURCE_GLOBAL_MONTHLY_OPERATIONS?: string;
  RESOURCE_WORKSPACE_DAILY_OPERATIONS?: string;
  RESOURCE_WORKSPACE_MONTHLY_OPERATIONS?: string;
  RESOURCE_ESSENTIAL_RESERVE_PERCENT?: string;
  RESOURCE_ANONYMOUS_DAILY_OPERATIONS?: string;
  RESOURCE_ANONYMOUS_MONTHLY_OPERATIONS?: string;
  RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS?: string;
  RESOURCE_OWNER_GLOBAL_MONTHLY_OPERATIONS?: string;
  RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS?: string;
  RESOURCE_OWNER_WORKSPACE_MONTHLY_OPERATIONS?: string;
  RESOURCE_MAINTENANCE_DAILY_OPERATIONS?: string;
  RESOURCE_MAINTENANCE_MONTHLY_OPERATIONS?: string;
  NEW_WORK_PAUSED?: string;
}

export interface ResourceOperation {
  cost: number;
  /** May consume the bounded reserve for retrieval, completion and cleanup. */
  essential?: boolean;
  /** Starts work, sends a follow-up or enables additional automatic work. */
  newWork?: boolean;
}

export const RESOURCE_OPERATIONS = {
  read: { cost: 1 },
  poll: { cost: 2 },
  mutation: { cost: 10 },
  new_work: { cost: 10, newWork: true },
  essential_read: { cost: 1, essential: true },
  result_read: { cost: 1, essential: true },
  completion: { cost: 10, essential: true },
  cancel: { cost: 10, essential: true },
  auth: { cost: 10, essential: true },
  export: { cost: 50, essential: true },
  cleanup: { cost: 10, essential: true },
} as const satisfies Record<string, ResourceOperation>;
export type ResourceOperationName = keyof typeof RESOURCE_OPERATIONS;
export type ResourceOperationInput = ResourceOperationName | ResourceOperation;
export type ProtectedResourceLane = "anonymous" | "owner" | "maintenance";
export interface OwnerResourceActor { owner: boolean; agent: unknown | null }

export interface BudgetPeriodStatus {
  used: number;
  limit: number;
  remaining: number;
  standard_remaining: number;
  resets_at: string;
  near_limit: boolean;
}
export interface BudgetScopeStatus {
  day: BudgetPeriodStatus;
  month: BudgetPeriodStatus;
}
export interface ResourceBudgetStatus {
  enabled: boolean;
  new_work_paused: boolean;
  lane?: ProtectedResourceLane;
  global?: BudgetScopeStatus;
  workspace?: BudgetScopeStatus;
}
export interface BudgetAdmission {
  allowed: boolean;
  enabled: boolean;
  /** Requested weight; charged only when allowed and enabled are both true. */
  cost: number;
  lane?: ProtectedResourceLane;
  reason?: "new_work_paused" | "global_budget_exhausted" | "workspace_budget_exhausted" | "resource_budget_unavailable"
    | "anonymous_budget_exhausted" | "owner_global_budget_exhausted" | "owner_workspace_budget_exhausted"
    | "maintenance_budget_exhausted" | "owner_control_required";
  retryAfterSeconds?: number;
  global?: BudgetScopeStatus;
  workspace?: BudgetScopeStatus;
}

export class ResourceBudgetError extends Error {
  readonly status: 403 | 429 | 503;
  readonly code: NonNullable<BudgetAdmission["reason"]>;
  readonly retryAfterSeconds: number;
  constructor(admission: BudgetAdmission) {
    const code = admission.reason ?? "resource_budget_unavailable";
    super(code === "new_work_paused" ? "New work is temporarily paused. Existing results and cancellation remain available within the service allowance."
      : code === "resource_budget_unavailable" ? "Resource budget protection is unavailable. Please retry later."
      : code === "owner_control_required" ? "Only an authenticated workspace owner can use the control and recovery allowance. It cannot start new work."
      : code === "anonymous_budget_exhausted" ? "The anonymous access allowance has been reached. Please retry after it resets."
      : code === "owner_global_budget_exhausted" || code === "owner_workspace_budget_exhausted" ? "The owner control and recovery allowance has been reached. Please retry after it resets."
      : code === "maintenance_budget_exhausted" ? "The maintenance allowance has been reached. Please retry after it resets."
      : code === "global_budget_exhausted" ? "The service resource allowance for this operation has been reached. Please retry after it resets."
      : "This workspace's resource allowance for this operation has been reached. Please retry after it resets.");
    this.name = "ResourceBudgetError";
    this.status = code === "owner_control_required" ? 403 : code === "resource_budget_unavailable" || code === "new_work_paused" ? 503 : 429;
    this.code = code;
    this.retryAfterSeconds = admission.retryAfterSeconds ?? 60;
  }
}

interface Settings {
  globalDay: number;
  globalMonth: number;
  workspaceDay: number;
  workspaceMonth: number;
  reservePercent: number;
}
interface CounterDefinition {
  table: "resource_operation_budgets" | "resource_lane_budgets";
  lane?: ProtectedResourceLane;
  settings: (env: BudgetEnvironment) => Settings;
}
interface CounterRow {
  scope_type: "global" | "workspace";
  scope_id: string;
  day_key: string;
  day_used: number;
  month_key: string;
  month_used: number;
}
interface Periods {
  day: string;
  month: string;
  dayReset: number;
  monthReset: number;
}

/** Hosted protection is mandatory; a false override cannot turn it off. */
export const resourceBudgetsEnabled = (env: BudgetEnvironment): boolean =>
  env.HOSTED === "true" || env.RESOURCE_BUDGETS_ENABLED === "true";

function integer(value: string | undefined, fallback: number, max = 1_000_000_000): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid resource budget configuration");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error("Invalid resource budget configuration");
  return parsed;
}
function settings(env: BudgetEnvironment): Settings {
  return {
    globalDay: integer(env.RESOURCE_GLOBAL_DAILY_OPERATIONS, 100_000),
    globalMonth: integer(env.RESOURCE_GLOBAL_MONTHLY_OPERATIONS, 2_000_000),
    workspaceDay: integer(env.RESOURCE_WORKSPACE_DAILY_OPERATIONS, 4_000),
    workspaceMonth: integer(env.RESOURCE_WORKSPACE_MONTHLY_OPERATIONS, 100_000),
    reservePercent: integer(env.RESOURCE_ESSENTIAL_RESERVE_PERCENT, 10, 50),
  };
}
function protectedSettings(env: BudgetEnvironment, lane: ProtectedResourceLane): Settings {
  if (lane === "owner") return {
    globalDay: integer(env.RESOURCE_OWNER_GLOBAL_DAILY_OPERATIONS, 20_000),
    globalMonth: integer(env.RESOURCE_OWNER_GLOBAL_MONTHLY_OPERATIONS, 300_000),
    workspaceDay: integer(env.RESOURCE_OWNER_WORKSPACE_DAILY_OPERATIONS, 2_000),
    workspaceMonth: integer(env.RESOURCE_OWNER_WORKSPACE_MONTHLY_OPERATIONS, 30_000),
    reservePercent: 0,
  };
  return {
    globalDay: lane === "anonymous" ? integer(env.RESOURCE_ANONYMOUS_DAILY_OPERATIONS, 10_000) : integer(env.RESOURCE_MAINTENANCE_DAILY_OPERATIONS, 20_000),
    globalMonth: lane === "anonymous" ? integer(env.RESOURCE_ANONYMOUS_MONTHLY_OPERATIONS, 300_000) : integer(env.RESOURCE_MAINTENANCE_MONTHLY_OPERATIONS, 500_000),
    workspaceDay: 0, workspaceMonth: 0, reservePercent: 0,
  };
}
const workCounters: CounterDefinition = { table: "resource_operation_budgets", settings };
const protectedCounters = (lane: ProtectedResourceLane): CounterDefinition => ({
  table: "resource_lane_budgets", lane, settings: env => protectedSettings(env, lane),
});

export function resourceBudgetConfigurationIssue(env: BudgetEnvironment): string | null {
  if (!resourceBudgetsEnabled(env)) return null;
  try {
    settings(env);
    for (const lane of ["anonymous", "owner", "maintenance"] as const) protectedSettings(env, lane);
    return null;
  }
  catch { return "Configure resource operation limits as nonnegative integers and the essential reserve as 0–50 percent."; }
}
function periods(now: number): Periods {
  if (!Number.isFinite(now)) throw new Error("Invalid budget time");
  const date = new Date(now);
  const utc = date.toISOString();
  return {
    day: utc.slice(0, 10), month: utc.slice(0, 7),
    dayReset: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
    monthReset: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
  };
}
function standardLimit(limit: number, config: Settings): number {
  return Math.floor(limit * (100 - config.reservePercent) / 100);
}
function periodStatus(used: number, limit: number, reset: number, config: Settings): BudgetPeriodStatus {
  return {
    used, limit, remaining: Math.max(0, limit - used),
    standard_remaining: Math.max(0, standardLimit(limit, config) - used),
    resets_at: new Date(reset).toISOString(),
    near_limit: limit === 0 || used >= limit * 0.8,
  };
}
function scopeStatus(row: CounterRow | undefined, dayLimit: number, monthLimit: number, time: Periods, config: Settings): BudgetScopeStatus {
  return {
    day: periodStatus(row?.day_key === time.day ? row.day_used : 0, dayLimit, time.dayReset, config),
    month: periodStatus(row?.month_key === time.month ? row.month_used : 0, monthLimit, time.monthReset, config),
  };
}
function statuses(rows: CounterRow[], workspace: string | null, time: Periods, config: Settings): Pick<BudgetAdmission, "global" | "workspace"> {
  return {
    global: scopeStatus(rows.find(row => row.scope_type === "global"), config.globalDay, config.globalMonth, time, config),
    ...(workspace === null ? {} : {
      workspace: scopeStatus(rows.find(row => row.scope_type === "workspace" && row.scope_id === workspace), config.workspaceDay, config.workspaceMonth, time, config),
    }),
  };
}
function validWorkspace(workspace: string | null): boolean {
  return workspace === null || typeof workspace === "string" && workspace.length > 0 && workspace.length <= 200;
}
async function readCounters(env: BudgetEnvironment, workspace: string | null, counters = workCounters): Promise<CounterRow[]> {
  const result = await env.DB.prepare(`SELECT scope_type,scope_id,day_key,day_used,month_key,month_used
    FROM ${counters.table} WHERE ${counters.lane ? `lane='${counters.lane}' AND ` : ""}
    ((scope_type='global' AND scope_id='service') OR (scope_type='workspace' AND scope_id=?))`)
    .bind(workspace ?? "").all<CounterRow>();
  if (!result.success) throw new Error("Resource counter read failed");
  return result.results;
}

/** Only expose the workspace portion to workspace owners; global usage is operator data. */
export async function resourceBudgetStatus(env: BudgetEnvironment, workspace: string | null, now = Date.now()): Promise<ResourceBudgetStatus> {
  return counterStatus(env, workspace, now, workCounters);
}

/** Owner recovery counters; callers must authenticate before exposing a workspace's status. */
export async function resourceControlBudgetStatus(env: BudgetEnvironment, workspace: string, now = Date.now()): Promise<ResourceBudgetStatus> {
  return counterStatus(env, workspace, now, protectedCounters("owner"));
}

async function counterStatus(env: BudgetEnvironment, workspace: string | null, now: number, counters: CounterDefinition): Promise<ResourceBudgetStatus> {
  if (!resourceBudgetsEnabled(env)) return { enabled: false, new_work_paused: false };
  try {
    if (!validWorkspace(workspace)) throw new Error("Invalid workspace");
    const config = counters.settings(env), time = periods(now);
    return { enabled: true, new_work_paused: env.NEW_WORK_PAUSED === "true", ...(counters.lane ? { lane: counters.lane } : {}),
      ...statuses(await readCounters(env, workspace, counters), workspace, time, config) };
  } catch { throw new ResourceBudgetError({ allowed: false, enabled: true, cost: 0, reason: "resource_budget_unavailable" }); }
}

/**
 * One SQLite statement makes both admissions indivisible. The MATERIALIZED gate
 * is evaluated before either UPSERT, so one counter cannot consume allowance
 * while the other is denied. A denied SELECT yields zero rows and zero writes.
 * Only fixed global/workspace scopes and UTC periods can enter the table.
 * Late arrivals from a previous period cannot roll counters backward.
 *
 * This allowance belongs to authenticated work. Use the separate anonymous,
 * owner-control or maintenance helpers for those admission boundaries. Supplying
 * a workspace ID is not authorization; authenticate before calling this helper.
 */
export async function admitResourceOperation(
  env: BudgetEnvironment, workspace: string | null, input: ResourceOperationInput, now = Date.now(),
): Promise<BudgetAdmission> {
  return admitCounters(env, workspace, input, now, workCounters);
}

async function admitCounters(
  env: BudgetEnvironment, workspace: string | null, input: ResourceOperationInput, now: number, counters: CounterDefinition,
): Promise<BudgetAdmission> {
  const operation: ResourceOperation | undefined = typeof input === "string" ? RESOURCE_OPERATIONS[input] : input;
  const cost = operation?.cost ?? 0;
  if (!resourceBudgetsEnabled(env)) return { allowed: true, enabled: false, cost: 0 };
  if (!operation || !Number.isSafeInteger(cost) || cost < 1 || cost > 1_000 || !validWorkspace(workspace)) {
    return { allowed: false, enabled: true, cost, reason: "resource_budget_unavailable", retryAfterSeconds: 60 };
  }
  if (operation.newWork && env.NEW_WORK_PAUSED === "true") {
    return { allowed: false, enabled: true, cost, reason: "new_work_paused", retryAfterSeconds: 60 };
  }
  try {
    const config = counters.settings(env), time = periods(now);
    const cap = (limit: number) => operation.essential ? limit : standardLimit(limit, config);
    const targets = ["('global','service',?,?)"];
    const values: (number | string)[] = [cap(config.globalDay), cap(config.globalMonth)];
    if (workspace !== null) {
      targets.push("('workspace',?,?,?)");
      values.push(workspace, cap(config.workspaceDay), cap(config.workspaceMonth));
    }
    values.push(time.day, cost, time.month, cost, time.day, time.month);
    if (workspace !== null) values.push(workspace);
    values.push(time.day, cost, time.month, cost, now);
    const result = await env.DB.prepare(`WITH targets(scope_type,scope_id,day_limit,month_limit) AS (VALUES ${targets.join(",")}),
      admission AS MATERIALIZED (
        SELECT 1 WHERE NOT EXISTS (
          SELECT 1 FROM targets t LEFT JOIN ${counters.table} b
          ON b.scope_type=t.scope_type AND b.scope_id=t.scope_id ${counters.lane ? `AND b.lane='${counters.lane}'` : ""}
          WHERE (CASE WHEN b.day_key=? THEN b.day_used ELSE 0 END)+? > t.day_limit
          OR (CASE WHEN b.month_key=? THEN b.month_used ELSE 0 END)+? > t.month_limit
          OR b.day_key>? OR b.month_key>?
        ) ${workspace === null ? "" : "AND EXISTS (SELECT 1 FROM workspaces WHERE id=?)"}
      )
      INSERT INTO ${counters.table} (${counters.lane ? "lane," : ""}scope_type,scope_id,day_key,day_used,month_key,month_used,updated_at)
      SELECT ${counters.lane ? `'${counters.lane}',` : ""}scope_type,scope_id,?,?,?,?,? FROM targets WHERE EXISTS (SELECT 1 FROM admission)
      ON CONFLICT(${counters.lane ? "lane," : ""}scope_type,scope_id) DO UPDATE SET
        day_used=CASE WHEN ${counters.table}.day_key=excluded.day_key THEN ${counters.table}.day_used+excluded.day_used ELSE excluded.day_used END,
        month_used=CASE WHEN ${counters.table}.month_key=excluded.month_key THEN ${counters.table}.month_used+excluded.month_used ELSE excluded.month_used END,
        day_key=excluded.day_key,month_key=excluded.month_key,updated_at=excluded.updated_at
      RETURNING scope_type,scope_id,day_key,day_used,month_key,month_used`).bind(...values).all<CounterRow>();
    if (!result.success) throw new Error("Resource admission failed");
    if (result.results.length === targets.length) {
      return { allowed: true, enabled: true, cost, ...statuses(result.results, workspace, time, config) };
    }
    if (result.results.length !== 0) throw new Error("Incomplete resource admission");
    // Rejections only read for actionable retry/reset information. They must not
    // increment either counter or create a separate rejection/audit ledger.
    const state = statuses(await readCounters(env, workspace, counters), workspace, time, config);
    let reason: BudgetAdmission["reason"] = "resource_budget_unavailable";
    let reset = now + 60_000;
    for (const [scope, status] of [["workspace", state.workspace], ["global", state.global]] as const) {
      if (!status) continue;
      for (const period of [status.day, status.month]) {
        if ((operation.essential ? period.remaining : period.standard_remaining) < cost) {
          reason = scope === "global" ? "global_budget_exhausted" : "workspace_budget_exhausted";
          reset = Math.max(reset, Date.parse(period.resets_at));
        }
      }
    }
    return { allowed: false, enabled: true, cost, reason, retryAfterSeconds: Math.max(1, Math.ceil((reset - now) / 1000)), ...state };
  } catch {
    // Missing migration, unavailable D1 or invalid operator configuration must
    // never silently allow unmetered hosted work.
    return { allowed: false, enabled: true, cost, reason: "resource_budget_unavailable", retryAfterSeconds: 60 };
  }
}

export async function assertResourceOperation(env: BudgetEnvironment, workspace: string | null, operation: ResourceOperationInput, now = Date.now()): Promise<BudgetAdmission> {
  const admission = await admitResourceOperation(env, workspace, operation, now);
  if (!admission.allowed) throw new ResourceBudgetError(admission);
  return admission;
}

async function admitProtectedOperation(env: BudgetEnvironment, workspace: string | null, operation: ResourceOperationInput, now: number, lane: ProtectedResourceLane): Promise<BudgetAdmission> {
  const admission = await admitCounters(env, workspace, operation, now, protectedCounters(lane));
  const result: BudgetAdmission = { ...admission, lane };
  if (result.reason === "global_budget_exhausted") {
    result.reason = lane === "anonymous" ? "anonymous_budget_exhausted" : lane === "owner" ? "owner_global_budget_exhausted" : "maintenance_budget_exhausted";
  } else if (result.reason === "workspace_budget_exhausted") result.reason = "owner_workspace_budget_exhausted";
  return result;
}

/**
 * Charge unauthenticated allocation or failed-authentication boundaries after
 * the cheap edge limiter. Never make this a prerequisite for an authenticated
 * request: anonymous exhaustion must not block an existing owner's recovery.
 */
export async function admitAnonymousResourceOperation(env: BudgetEnvironment, now = Date.now()): Promise<BudgetAdmission> {
  return admitProtectedOperation(env, null, { cost: 1 }, now, "anonymous");
}
export async function assertAnonymousResourceOperation(env: BudgetEnvironment, now = Date.now()): Promise<BudgetAdmission> {
  const admission = await admitAnonymousResourceOperation(env, now);
  if (!admission.allowed) throw new ResourceBudgetError(admission);
  return admission;
}

/**
 * For an allowlisted control/recovery route after its owner authentication.
 * This helper never authorizes a route. The caller must use its authenticated
 * actor and workspace, and must not use this allowance to create new work.
 * Agents cannot spend it even when their ordinary/essential allowance is empty.
 */
export async function admitOwnerResourceOperation(
  env: BudgetEnvironment, workspace: string, actor: OwnerResourceActor, input: ResourceOperationInput = "read", now = Date.now(),
): Promise<BudgetAdmission> {
  const operation: ResourceOperation | undefined = typeof input === "string" ? RESOURCE_OPERATIONS[input] : input;
  if (actor?.owner !== true || actor?.agent !== null || operation?.newWork || typeof workspace !== "string" || !validWorkspace(workspace)) {
    return { allowed: false, enabled: resourceBudgetsEnabled(env), cost: operation?.cost ?? 0, lane: "owner", reason: "owner_control_required" };
  }
  return admitProtectedOperation(env, workspace, input, now, "owner");
}
export async function assertOwnerResourceOperation(
  env: BudgetEnvironment, workspace: string, actor: OwnerResourceActor, operation: ResourceOperationInput = "read", now = Date.now(),
): Promise<BudgetAdmission> {
  const admission = await admitOwnerResourceOperation(env, workspace, actor, operation, now);
  if (!admission.allowed) throw new ResourceBudgetError(admission);
  return admission;
}

/** Internal maintenance only: one bounded service allowance, no agent-spendable workspace counter. */
export async function admitMaintenanceResourceOperation(
  env: BudgetEnvironment, operation: ResourceOperationInput = { cost: 20 }, now = Date.now(),
): Promise<BudgetAdmission> {
  return admitProtectedOperation(env, null, operation, now, "maintenance");
}
export async function assertMaintenanceResourceOperation(
  env: BudgetEnvironment, operation: ResourceOperationInput = { cost: 20 }, now = Date.now(),
): Promise<BudgetAdmission> {
  const admission = await admitMaintenanceResourceOperation(env, operation, now);
  if (!admission.allowed) throw new ResourceBudgetError(admission);
  return admission;
}

/** Tools must be charged before dispatch, including invalid/replayed calls. */
export function resourceOperationForTool(name: string): ResourceOperationName {
  switch (name) {
    case "send_job": case "send_message": case "answer_question": case "send_back": return "new_work";
    case "check_inbox": case "check_conversation_inbox": case "preview_requests": case "get_next_job": return "poll";
    case "get_job": case "get_conversation": return "result_read";
    case "acknowledge_results": case "acknowledge_conversation": case "submit_result":
    case "reply_to_request": case "ask_question": case "give_up": return "completion";
    case "cancel_job": return "cancel";
    case "claim_request": return "mutation";
    case "connection_status": case "get_collaboration_config": return "essential_read";
    case "list_agents": case "list_conversations": return "read";
    default: return "mutation";
  }
}

/** HTTP admission is per request; MCP tools/call additionally uses the tool map. */
export function resourceOperationForHttp(method: string, path: string): ResourceOperationName {
  method = method.toUpperCase();
  if (path === "/v1/admin/export") return "export";
  if (method === "DELETE" || /\/(?:cancel|stop)$/.test(path)) return "cancel";
  if (/^\/(?:auth|oauth)(?:\/|$)/.test(path)) return "auth";
  // Polling must fit the supported cadence; actual work remains independently
  // bounded by claim, open-job and new-request limits. Hono maps HEAD to GET.
  if (path === "/v1/work/next" && ["GET", "POST", "HEAD"].includes(method)) return "poll";
  if (method === "GET" || method === "HEAD") {
    if (path === "/v1/me" || path === "/v1/configuration") return "essential_read";
    if (/^\/v1\/(?:inbox|requests\/pending|conversations\/inbox)$/.test(path)) return "poll";
    if (/^\/v1\/(?:jobs|conversations)\/[^/]+$/.test(path) || /^\/w\/[^/]+$/.test(path)) return "result_read";
    return "read";
  }
  if (/^\/v1\/(?:submit|heartbeat)(?:\/|$)/.test(path) || /\/(?:accept|ack|acknowledge|heartbeat)$/.test(path)
    || /^\/v1\/requests\/[^/]+\/reply$/.test(path)) return "completion";
  if (path === "/v1/jobs" || path === "/v1/conversations" || /\/conversations\/[^/]+\/messages$/.test(path)
    || /^\/v1\/admin\/agents\/[^/]+\/test$/.test(path)
    || /\/(?:approve|reply|reject|extend)$/.test(path) || path === "/v1/admin/schedules" || path === "/v1/admin/tick") return "new_work";
  return "mutation";
}

/** Owner inspection and recovery use their own finite allowance from the first
 * request. Keep the route allowlist explicit: future reads may claim or poll.
 * This classification does not authenticate the caller or authorize a route.
 */
export function isOwnerResourceControlRoute(method: string, path: string): boolean {
  method = method.toUpperCase();
  const operation = resourceOperationForHttp(method, path);
  if (operation === "new_work" || operation === "poll") return false;
  if (method === "GET" || method === "HEAD") {
    return ["/v1/types", "/v1/me", "/v1/configuration", "/v1/workspace/release", "/v1/conversations",
      "/v1/jobs", "/v1/events", "/v1/admin/overview", "/v1/admin/agents", "/v1/admin/schedules",
      "/v1/admin/workspace", "/v1/admin/export"].includes(path)
      || /^\/v1\/agents\/[^/]+\/(?:collaboration|activation)$/.test(path)
      || /^\/v1\/requests\/[^/]+\/activation$/.test(path)
      || /^\/v1\/admin\/agents\/[^/]+\/setup$/.test(path)
      || /^\/v1\/(?:jobs|conversations)\/[^/]+$/.test(path);
  }
  if (method === "DELETE") return path === "/v1/admin/workspace"
    || /^\/v1\/admin\/(?:agents|schedules)\/[^/]+$/.test(path)
    || /^\/v1\/agents\/[^/]+\/activation$/.test(path);
  if (method === "PUT") return path === "/v1/workspace/release"
    || /^\/v1\/agents\/[^/]+\/collaboration$/.test(path);
  if (method === "PATCH") return path === "/v1/admin/workspace"
    || /^\/v1\/agents\/[^/]+\/onboarding$/.test(path);
  if (method === "POST") return path === "/v1/admin/agents"
    || /^\/v1\/admin\/agents\/[^/]+\/(?:setup|pairing)$/.test(path)
    || /^\/v1\/jobs\/[^/]+\/cancel$/.test(path)
    || /^\/v1\/conversations\/[^/]+\/stop$/.test(path);
  return false;
}
