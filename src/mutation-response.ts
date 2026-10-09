import { jobView, type JobRow } from './store';
import type { sendMessage } from './conversations';

/** A send grant authorizes a mutation, never a read of stored conversation data. */
export const mayReadMutation = (scopes?: readonly string[], owner = false) => owner || scopes === undefined || scopes.includes('relay:read');
export function mutationJob(row: JobRow, scopes?: readonly string[], owner = false) {
  return mayReadMutation(scopes, owner) ? jobView(row) : {
    id: row.id, status: row.status, conversation_id: row.conversation_id,
  };
}
export function mutationConversation(result: Awaited<ReturnType<typeof sendMessage>>, scopes?: readonly string[], owner = false) {
  if (mayReadMutation(scopes, owner)) return result;
  return {
    conversation: { id: result.conversation.id },
    message: result.message ? { id: result.message.id } : null,
    request: result.request ? { id: result.request.id, status: result.request.status, conversation_id: result.request.conversation_id } : null,
    replay: result.replay,
  };
}
