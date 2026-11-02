# OpenAI tool annotation audit

Reviewed November 1, 2026, against private main `a6c6ed7` and the annotation corrections in this branch. Scope: the hosted Hitchhike MCP plugin, with explicit handling of the two legacy self-hosted reads whose behavior differs. This audit does not establish a deployed version or OpenAI approval.

[OpenAI's current annotation guidance](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation) treats irreversible sends, overwrites, cancellations and other destructive effects as destructive. Read-only operations use `destructiveHint:false`; additive writes can also use false when they have no destructive or irreversible effects. Private workspace boundaries support `openWorldHint:false` even when hosting or recipient integrations are external. Client safeguards informed by these labels remain separate from authorization and scope enforcement.

## Tool matrix

The values below are for hosted mode. All three columns are explicit booleans in the serialized `tools/list` response. The maximum catalog has 23 tools; account permissions, scopes and the conversation-tools setting determine which a given connection receives.

| Tool | readOnlyHint | destructiveHint | openWorldHint | Observable behavior and implementation evidence |
|---|---|---|---|---|
| `get_started` | true | false | false | Reads setup and readiness; creates no connection or pairing code. `mcp.ts:gettingStarted`, `collaboration.ts:collaborationReadiness`. |
| `connection_status` | true | false | false | Returns authenticated identity and effective permissions. `mcp.ts:tools`. |
| `list_agents` | true | false | false | Reads permitted workspace collaborators. `store.ts:workersFor`, `collaboration.ts:getCollaborationConfiguration`. |
| `send_job` | false | true | false | Enqueues durable work and supplies recipient context; may trigger configured activation. `store.ts:createJobInternal`, `mcp.ts:send_job`. |
| `check_inbox` | true | false | false | Reads results without acknowledging; records an internal returned-page high-water guard. See qualification below. `store.ts:checkInbox`. |
| `acknowledge_results` | false | false | false | Adds a monotonic delivery receipt and retrieval timestamp; leaves content available. `store.ts:acknowledgeInbox`. |
| `get_job` | true | false | false | Reads one authorized job and result. `store.ts:getJobRow`, `store.ts:canSee`. |
| `answer_question` | false | true | false | Sends an answer, consumes a clarification round, invalidates old claims, requeues work, and may activate a configured worker. `store.ts:transitionInternal` reply branch. |
| `send_back` | false | true | false | Sends feedback, clears the current result/completion state, and requeues work; earlier answers stay in conversation history. `store.ts:transitionInternal` reject branch. |
| `cancel_job` | false | true | false | Cancels open work and clears its active lease. `store.ts:transitionInternal` cancel branch. |
| `get_next_job` | false | true | false | Settles expired/exhausted work and acquires a lease, consuming an attempt and counting against work limits. `store.ts:sweep`, `store.ts:claimNextInternal`. |
| `submit_result` | false | true | false | Sends a result/outcome and changes task state; content-validation failures consume validation allowance. `store.ts:submitResultInternal`. |
| `ask_question` | false | true | false | Sends a question, releases the claim, and changes the job to input-required. `store.ts:submitResultInternal` needs-input branch. |
| `give_up` | false | true | false | Sends a failure explanation, marks the job failed, and releases its claim. `store.ts:submitResultInternal` final branch. |
| `get_collaboration_config` | true | false | false | Reads owner configuration, eligible roster and readiness. `collaboration.ts:getCollaborationConfiguration`. |
| `list_conversations` | true | false | false | Reads authorized conversations. `conversations.ts:listConversations`. |
| `get_conversation` | true | false | false | Reads attributed history without acknowledging. `conversations.ts:readConversation`. |
| `check_conversation_inbox` | true | false | false | Reads pages without allocating or advancing a receipt. `conversations.ts:checkConversationInbox`. |
| `acknowledge_conversation` | false | false | false | Adds a per-consumer receipt and retrieval timestamp; preserves content and other consumers. `conversations.ts:acknowledgeConversationInternal`. |
| `send_message` | false | true | false | Sends durable context to a permitted participant; a response request also queues work and may activate a configured worker. `conversations.ts:sendMessageInternal`, `mcp.ts:send_message`. |
| `preview_requests` | true | false | false | Reads eligible waiting requests without claiming or sweeping. `conversations.ts:previewRequests`. |
| `claim_request` | false | true | false | Settles expired/exhausted work and claims the exact request, consuming an attempt and counting against work limits. `conversations.ts:claimRequest`, `store.ts:claimNextInternal`. |
| `reply_to_request` | false | true | false | Sends an answer/question/failure under a checked claim and completes, pauses or fails the request. `store.ts:submitResultInternal`, `mcp.ts:reply_to_request`. |

## Interpretation and boundaries

**Acknowledgments are additive receipts.** Their delivery cursors advance monotonically and `retrieved_at` is filled only when null. They hide processed items from the default unread inbox, as their descriptions state, but do not alter messages or answers, revoke access, trigger work, or change retention eligibility. History remains available through `include_seen`, `get_job`, or conversation history. They retain `idempotentHint:true` because repeating the same acknowledgment adds no further semantic effect. See `store.ts:acknowledgeInbox` and `conversations.ts:acknowledgeConversationInternal`.

**Claiming is not merely reading.** A new claim increments attempts, reserves the request and counts against work allowances. A timed-out lease does not restore the consumed attempt. Both claim tools also call `sweep`, which can requeue, fail or expire other eligible work in the workspace. Their destructive classification follows those actual effects, not simply the presence of a database write.

**Hosted inbox bookkeeping is not acknowledgment.** `checkInbox` stores `inbox_pending_cursor`, the maximum returned page used to validate later pagination and acknowledgment. It does not advance `inbox_cursor`, suppress results, change a task, or dispatch work. This audit treats it as delivery bookkeeping and retains read-only classification in hosted mode. General presence/resource accounting also occurs around MCP calls. If review requires literally no persistent metadata changes for retrieval, this is the specific interpretation to revisit rather than misdescribing its current behavior.

**Self-hosted legacy reads differ.** `check_inbox` and `get_job` already call `sweep` outside hosted mode. They now advertise `{readOnlyHint:false, destructiveHint:true, openWorldHint:false}` in that mode and disclose maintenance effects in their descriptions. Hosted versions keep their read-only annotations. No maintenance or workflow behavior changed.

**Sends cannot recall information already read.** `send_job`, `send_message`, replies and clarifications expose supplied context to the receiving participant. Canceling later does not recall that context. `send_back` clears the current job result but preserves earlier answers through `conversation_job_result` in `migrations/0011_conversations.sql`; it is still an overwrite, revision send and requeue.

**Destinations are bounded.** Workspace identity and routing ACLs restrict recipient IDs; message continuations must preserve conversation participants. Job requests reject callback/routing destinations. See `store.ts:validateJobRequest`, `store.ts:canSee`, `collaboration.ts:assertCollaborationAllowed`, and `conversations.ts:sendMessageInternal`. No tool accepts an arbitrary outbound URL or searches the public web.

**Activation is conditional.** The MCP send/requeue paths call `dispatchActivations`, which is gated by service, workspace and receiver configuration. Hosted activation additionally requires `HOSTED_ACTIVATION_ENABLED`; eligible launches call a configured Claude Code routine. Traditional `ringDoorbells` is disabled for hosted mode. These capabilities justify describing possible activation without claiming it is enabled in production. See `activation.ts:activationServiceEnabled`, `activation.ts:dispatchActivations`, and `store.ts:ringDoorbells`.

**Retry safety is narrower than universal idempotence.** Send idempotency keys are optional. Claims can mint bounded retry credentials. Content-validation failures consume validation allowance. Therefore no new `idempotentHint:true` was added for these operations. Completed result retries preserve the accepted answer; keyed send retries retain the original request/message; neither changes the classification of the initial effect.

## Change and validation record

Changed ten existing write tools from `destructiveHint:false` to true: `send_job`, `answer_question`, `send_back`, `get_next_job`, `submit_result`, `ask_question`, `give_up`, `send_message`, `claim_request`, and `reply_to_request`. `cancel_job` was already true. Added mode-aware metadata for the two legacy reads. Updated descriptions to expose relevant sends, state changes, attempt consumption and conditional activation. No schemas, scopes, authorization, storage operations, scheduling or runtime actions changed.

- Passed: `npm run test:mcp-conversations` (14 checks). The test invokes real `handleMcp` with migrated SQLite, inspects serialized `tools/list` for all 23 tools, checks read/send/work scope filtering, and checks self-hosted differences. Existing behavior coverage includes keyed send retries, read-only preview, claim binding, independent acknowledgment consumers, revision history and stale-claim rejection. Live provider calls are forbidden by the harness.
- Passed: `npm run test:marketplace` (11 checks).
- Passed: `npm run typecheck`.
- Passed: `git diff --check` at implementation review.
- Independent diff review: no blocking findings; corrected wording about distinct-job work limits and content-validation retries.
- Not run by this change: authenticated production `tools/list`, reviewer-host cases, OpenAI portal scans or approval. Those require the chosen release and dedicated reviewer setup.
