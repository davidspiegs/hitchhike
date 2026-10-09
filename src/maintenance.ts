import { admitMaintenanceResourceOperation } from "./budgets";
import { dispatchActivations, activationServiceEnabled, pruneActivationAttempts } from "./activation";
import { maintenance, type Env } from "./store";

const DAY = 86_400_000;
export const HOSTED_WORKSPACES_PER_TICK = 20;
export const HOSTED_SCHEDULES_PER_WORKSPACE = 1;
export const MAINTENANCE_ROWS_PER_OPERATION = 100;
export const HOSTED_ACTIVATION_WORKSPACES_PER_TICK = 4;
export const HOSTED_ACTIVATIONS_PER_WORKSPACE = 1;
interface DueWorkspace { id: string; next_release_beta: number; last_activation_at: number }

/** One service query selects and marks a bounded batch before work begins.
 * Persisted attempt order rotates a backlog across invocations; a failed or
 * interrupted run remains due, but cannot continually jump ahead of its peers.
 * All probes are workspace-scoped and indexed. Idle tenants incur no writes or
 * per-tenant calls, including tenants with the beta enabled but no due work.
 */
async function takeDueWorkspaceRows(env: Env, now: number): Promise<DueWorkspace[]> {
  const result = await env.DB.prepare(`UPDATE workspaces SET last_maintenance_at=?1 WHERE id IN (
    SELECT w.id FROM workspaces w WHERE
      EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=w.id AND j.status='claimed' AND j.lease_expires_at<?1)
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=w.id
        AND j.status NOT IN ('completed','failed','canceled','expired') AND j.expires_at<?1)
      OR (w.paused=0 AND w.security_suspended=0 AND w.identity_restricted=0 AND ?2=1 AND EXISTS (SELECT 1 FROM schedules s
        WHERE s.workspace_id=w.id AND s.enabled=1 AND s.next_run_at<=?1 AND s.next_attempt_at<=?1))
      OR EXISTS (SELECT 1 FROM conversations c WHERE c.workspace_id=w.id
        AND c.last_message_at<?1-min(max(c.retention_days,1),365)*?3
        AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=c.workspace_id AND j.conversation_id=c.id
          AND j.status NOT IN ('completed','failed','canceled','expired')))
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=w.id AND j.completed_at IS NOT NULL
        AND j.conversation_id IS NULL AND j.completed_at<?1-min(max(w.retention_days,1),365)*?3
        AND (j.spec<>'{}' OR j.result IS NOT NULL OR j.thread<>'[]'))
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.workspace_id=w.id AND j.completed_at IS NOT NULL
        AND j.completed_at<?1-max(min(max(w.retention_days,1),365),35)*?3
        AND j.created_at<?1-max(min(max(w.retention_days,1),365),35)*?3
        AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.workspace_id=j.workspace_id AND c.id=j.conversation_id))
      OR EXISTS (SELECT 1 FROM events e WHERE e.workspace_id=w.id
        AND e.ts<?1-min(max(w.retention_days,1),365)*?3)
      OR EXISTS (SELECT 1 FROM claims c WHERE c.workspace_id=w.id AND c.expires_at<?1-?3 AND c.issued_at<?1-?3)
      OR (w.next_release_beta=1 AND w.paused=0 AND w.security_suspended=0 AND w.identity_restricted=0 AND ?2=1 AND ?5=1 AND (
        EXISTS (SELECT 1 FROM activation_dispatches d WHERE d.workspace_id=w.id
          AND d.status IN ('pending','rate_limited') AND d.next_attempt_at<=?1)
        OR EXISTS (SELECT 1 FROM activation_dispatches d WHERE d.workspace_id=w.id
          AND d.status='dispatching' AND d.reserved_until<=?1)
        OR EXISTS (SELECT 1 FROM jobs j JOIN agents a ON a.workspace_id=j.workspace_id AND a.id=j.to_agent AND a.can_work=1
          JOIN activation_configs c ON c.workspace_id=j.workspace_id AND c.agent_id=a.id AND c.enabled=1 AND c.token_ciphertext IS NOT NULL
          WHERE j.workspace_id=w.id AND j.status='queued' AND (j.expires_at IS NULL OR j.expires_at>?1)
            AND EXISTS (SELECT 1 FROM json_each(a.work_types) WHERE value=j.type)
            AND (j.from_agent='owner' OR (
              EXISTS (SELECT 1 FROM json_each(a.accept_from) WHERE value IN ('*',j.from_agent))
              AND EXISTS (SELECT 1 FROM agents sender WHERE sender.workspace_id=j.workspace_id AND sender.id=j.from_agent AND sender.can_request=1
                AND EXISTS (SELECT 1 FROM json_each(sender.request_targets) WHERE value IN ('*',a.id)))))
            AND NOT EXISTS (SELECT 1 FROM conversation_chains chain WHERE chain.workspace_id=j.workspace_id AND chain.root_id=j.chain_root_id AND chain.stopped_at IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM activation_dispatches d WHERE d.workspace_id=j.workspace_id AND d.job_id=j.id
              AND d.generation=CAST(j.attempts AS TEXT)||':'||CAST(j.claims_valid_after AS TEXT)))
      ))
    ORDER BY w.last_maintenance_at,w.id LIMIT ?4
  ) RETURNING id,next_release_beta,last_activation_at`).bind(now, env.SERVICE_PAUSED === "true" ? 0 : 1, DAY, HOSTED_WORKSPACES_PER_TICK, activationServiceEnabled(env) ? 1 : 0)
    .all<DueWorkspace>();
  return result.results ?? [];
}
export async function takeDueMaintenanceWorkspaces(env: Env, now = Date.now()): Promise<string[]> {
  return (await takeDueWorkspaceRows(env, now)).map(row => row.id);
}

/** At most twenty workspace passes and twenty schedule attempts per invocation.
 * Existing maintenance prunes complete conversations atomically. The separate
 * provider budget permits four launches/retries total, fairly rotated, so beta
 * work cannot multiply the D1 statement or external-request budget by 20 x 8.
 */
export async function scheduledMaintenance(env: Env, relayUrl: string, now = Date.now()) {
  if (env.HOSTED !== "true") {
    const scoped = { ...env, WORKSPACE_ID: "default" };
    const result = await maintenance(scoped, relayUrl, now);
    await dispatchActivations(scoped, relayUrl, now);
    return { workspaces: 1, failed: 0, requeued: result.requeued.length, created: result.created.length };
  }
  const admission=await admitMaintenanceResourceOperation(env,{cost:20,essential:true},now);
  if (!admission.allowed) return {workspaces:0,failed:0,requeued:0,created:0};
  await pruneActivationAttempts(env,now,100);
  const rows = await takeDueWorkspaceRows(env, now);
  const activationRows = env.SERVICE_PAUSED === "true" || !activationServiceEnabled(env) ? [] : rows.filter(row => row.next_release_beta)
    .sort((a, b) => a.last_activation_at - b.last_activation_at || a.id.localeCompare(b.id))
    .slice(0, HOSTED_ACTIVATION_WORKSPACES_PER_TICK);
  const activationIds = new Set(activationRows.map(row => row.id));
  if (activationRows.length) {
    // Persist before I/O so a broken workspace cannot monopolize the next tick.
    await env.DB.prepare(`UPDATE workspaces SET last_activation_at=? WHERE id IN (${activationRows.map(() => '?').join(',')})`)
      .bind(now, ...activationIds).run();
  }
  const totals = { workspaces: rows.length, failed: 0, requeued: 0, created: 0 };
  for (const row of rows) {
    try {
      const scoped = { ...env, WORKSPACE_ID: row.id };
      if (!(await admitMaintenanceResourceOperation(scoped,{cost:1,essential:true},now)).allowed) continue;
      const result = await maintenance(scoped, relayUrl, now, {
        scheduleLimit: HOSTED_SCHEDULES_PER_WORKSPACE,
        sweepLimit: MAINTENANCE_ROWS_PER_OPERATION,
        prune: true,
      });
      totals.requeued += result.requeued.length;
      totals.created += result.created.length;
      if (activationIds.has(row.id)) await dispatchActivations(scoped, relayUrl, now, fetch, { limit: HOSTED_ACTIVATIONS_PER_WORKSPACE });
    } catch {
      // Report only aggregate failure counts; one tenant must not stop its peers.
      totals.failed++;
    }
  }
  return totals;
}
