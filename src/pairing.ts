import { workspaceAccountAllowed, type AuthEnv } from "./auth";
import { openAgentKey } from "./crypto";
import { setupText } from "./render";
import { getCollaborationConfiguration, getWorkspaceRelease } from "./collaboration";
import { pairingInstructions } from "./platforms";
import { backgroundSelectionForConfiguration } from "./setup-preferences";
import { RelayError, workspaceId, type AgentRow, type Env } from "./store";
import { parseJSON, randomToken, sha256 } from "./util";

const TEN_MINUTES = 10 * 60 * 1000;

/** Only called after owner authentication and CSRF verification. */
export async function issuePairing(env: Env, agentId: string, origin: string, now = Date.now()) {
  if (!(await workspaceAccountAllowed(env as AuthEnv,workspaceId(env)))) throw new RelayError(403,"account_restricted","This account is restricted.");
  const agent = await env.DB.prepare("SELECT * FROM agents WHERE id=? AND workspace_id=?")
    .bind(agentId, workspaceId(env)).first<AgentRow>();
  if (!agent) throw new RelayError(404, "not_found", "No such connection.");
  const configuration = await getCollaborationConfiguration(env, { owner: false, agent });
  const release = await getWorkspaceRelease(env);
  const code = randomToken("pair_", 12);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM pairing_codes WHERE workspace_id=? AND agent_id=?")
      .bind(workspaceId(env), agentId),
    env.DB.prepare("INSERT INTO pairing_codes(code_hash,workspace_id,agent_id,auth_generation,created_at,expires_at) VALUES(?,?,?,?,?,?)")
      .bind(await sha256(code), workspaceId(env), agentId, agent.auth_generation, now, now + TEN_MINUTES),
  ]);
  const instructions = pairingInstructions({
    agentId: agent.id, name: agent.name, token: "", relayUrl: origin, hosted: true, pairingCode: code,
    canWork: !!agent.can_work, canRequest: !!agent.can_request, workTypes: parseJSON<string[]>(agent.work_types, []),
    pollMinutes: agent.poll_minutes, platform: agent.platform, conversationTools: release.enabled,
    instructionProfile: configuration.settings.instructions.profile, background: backgroundSelectionForConfiguration(configuration),
  });
  return { code, expires_at: new Date(now + TEN_MINUTES).toISOString(), instructions };
}

/** Atomically consume the code; a second redemption cannot return credentials. */
export async function redeemPairing(env: Env, code: unknown, origin: string, now = Date.now()) {
  if (typeof code !== "string" || !/^pair_[A-Za-z0-9_-]{16}$/.test(code)) {
    throw new RelayError(400, "invalid_pairing", "That pairing code is invalid or has expired. Create a new one in the dashboard.");
  }
  const row = await env.DB.prepare(`UPDATE pairing_codes SET redeemed_at=?
    WHERE code_hash=? AND redeemed_at IS NULL AND expires_at>?
      AND EXISTS(SELECT 1 FROM agents a WHERE a.id=pairing_codes.agent_id
        AND a.workspace_id=pairing_codes.workspace_id AND a.auth_generation=pairing_codes.auth_generation)
      AND EXISTS(SELECT 1 FROM workspaces w WHERE w.id=pairing_codes.workspace_id AND w.security_suspended=0 AND w.identity_restricted=0)
    RETURNING workspace_id,agent_id,auth_generation`)
    .bind(now, await sha256(code), now).first<{workspace_id:string;agent_id:string;auth_generation:number}>();
  if (!row) throw new RelayError(400, "invalid_pairing", "That pairing code is invalid, already used, or expired. Create a new one in the dashboard.");
  if (!(await workspaceAccountAllowed(env as AuthEnv,row.workspace_id))) throw new RelayError(403,"account_restricted","This account is restricted.");
  const agent = await env.DB.prepare("SELECT * FROM agents WHERE id=? AND workspace_id=? AND auth_generation=?")
    .bind(row.agent_id, row.workspace_id, row.auth_generation).first<AgentRow>();
  if (!agent) throw new RelayError(400, "invalid_pairing", "This connection was disconnected. Connect it again from the dashboard.");
  const token = await openAgentKey(env.ENCRYPTION_KEY || env.ADMIN_TOKEN || "", agent.id, agent.key_ciphertext,
    env.ENCRYPTION_KEY_PREVIOUS || env.ADMIN_TOKEN);
  if (!token) throw new RelayError(409, "key_unavailable", "This connection needs a new credential. Reconnect it from the dashboard.");
  const scoped = { ...env, WORKSPACE_ID: row.workspace_id };
  if ((await getWorkspaceRelease(scoped)).enabled) {
    const configuration = await getCollaborationConfiguration(scoped, { owner: false, agent });
    const preference = configuration.settings.instructions;
    const prompt = preference.custom_prompt ?? configuration.runtime_instructions.working_preference ?? "";
    const storage = `Store the returned token privately and use it only in Authorization headers on ${origin}. No separate access-check or working-prompt paste is needed.`;
    const bootstrap = `${storage} Verify connection ${agent.id} with authenticated GET /v1/me, then read GET /v1/configuration for the current working preference and versioned runtime_instructions. Follow that runtime guidance when starting or continuing relay work.`;
    return {
      agent: { id: agent.id, name: agent.name, can_request: !!agent.can_request, can_work: !!agent.can_work },
      token, relay_url: origin, working_preference: preference,
      instructions: `${bootstrap}\n\n${prompt}`,
    };
  }
  return {
    agent: { id: agent.id, name: agent.name, can_request: !!agent.can_request, can_work: !!agent.can_work },
    token,
    relay_url: origin,
    instructions: setupText({agentId:agent.id,name:agent.name,token,relayUrl:origin,canWork:!!agent.can_work,
      canRequest:!!agent.can_request,workTypes:parseJSON<string[]>(agent.work_types,[]),pollMinutes:agent.poll_minutes,hosted:true}),
  };
}
