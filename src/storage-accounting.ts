/** The trigger-maintained budget includes content, metadata and index headroom.
 * It is conservative accounted storage, not a physical D1 disk measurement. */
import type { Env } from './store';

export const SHARED_ACCOUNTED_STORAGE_LIMIT_BYTES = 1536 * 1024 * 1024;
export const DEFAULT_HOSTED_STORAGE_LIMIT_BYTES = 32 * 1024 * 1024;
export const MAX_CONVERSATION_CONSUMERS = 8;

export async function getAccountedStorage(env: Pick<Env, 'DB' | 'WORKSPACE_ID'>, id = env.WORKSPACE_ID || 'default'): Promise<number> {
  const row = await env.DB.prepare('SELECT accounted_bytes FROM workspace_storage_usage WHERE workspace_id=?')
    .bind(id).first<{ accounted_bytes: number }>();
  return row?.accounted_bytes ?? 0;
}
