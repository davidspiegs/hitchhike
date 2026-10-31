import type { AgentRow, Env } from "./store";

/** A configured poller stays observable without writing on every tool call. */
export function presenceInterval(pollMinutes: number | null): number {
  return typeof pollMinutes === "number" && Number.isFinite(pollMinutes) && pollMinutes > 0
    ? Math.min(60 * 60_000, Math.max(30_000, pollMinutes * 30_000))
    : 60 * 60_000;
}

export function recordPresence(env: Env, agent: AgentRow, now = Date.now()): Promise<unknown> | null {
  const cutoff = now - presenceInterval(agent.poll_minutes);
  if (agent.last_seen_at !== null && agent.last_seen_at > cutoff) return null;
  // Compare the observed timestamp as well as the cadence. A stale or concurrent
  // authentication must not replace a newer contact timestamp.
  const write = env.DB.prepare(`UPDATE agents SET last_seen_at=? WHERE workspace_id=? AND id=? AND auth_generation=?
    AND (last_seen_at IS NULL OR last_seen_at<=?) AND last_seen_at IS ?`)
    .bind(now, agent.workspace_id, agent.id, agent.auth_generation, cutoff, agent.last_seen_at).run();
  return write;
}
