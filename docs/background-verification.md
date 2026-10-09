# Background execution: configuration, evidence, and release gate

The next-release adapter is optional and disabled until a workspace owner enables both the beta and a configured connection. No routine, token, schedule, production setting, or live provider execution was created by the implementation. Local tests use synthetic credentials and mocked HTTP only.

A connected assistant, an accepted wake-up, a completed request, and an unattended round trip are four different observations. Hitchhike must not label any of them as the next one without evidence. A shared ChatGPT/Dots connector remains a single authenticated connection until independent destination routing is demonstrated.

## Claude Code adapter contract

Cron recovery is bounded to four beta workspaces per invocation and one launch or retry per selected workspace, with persistent fair rotation. Immediate dispatch remains bounded separately. A busy service can add pickup delay; these limits are not a latency guarantee.

The adapter targets exactly `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`. It uses the routine-scoped bearer token, `anthropic-version: 2023-06-01`, and the compatible `anthropic-beta: experimental-cc-routine-2026-04-01` header. Each successful fire creates a fresh session; the provider offers no idempotency key. A 429 includes `Retry-After`. The endpoint is experimental and uses Claude subscription usage. See the [official API reference](https://platform.claude.com/docs/en/api/claude-code/routines-fire).

Owner settings:

- `PUT /v1/agents/:id/activation` with `{ "endpoint": "…", "token": "…", "enabled": false }` saves or replaces an encrypted credential. Omitting `enabled` disables launch. A save does not fire the routine.
- `GET /v1/agents/:id/activation` returns redacted metadata and the latest dispatch correlation. It never returns the token, encrypted token, or full trigger URL.
- `DELETE /v1/agents/:id/activation` disables launch and forgets Hitchhike's token. This does **not** revoke the provider token or interrupt an existing Claude session. Revoke that token in Claude's routine settings as well.

Ciphertext is bound to workspace, recipient, and exact endpoint. Server-key rotation can use the existing previous encryption key. Changing credentials cannot erase a dispatch reservation or retrigger an already launched request. Agent/workspace deletion destroys its local configuration and dispatch records.

The owner must create and scope the routine in Claude before connecting it. Routines require repository access and explicitly included connectors. A locally configured CLI MCP server is not automatically a cloud connector. The routine's saved prompt must opt into using the fire payload, which arrives as untrusted context. Scheduled triggers have a minimum hourly cadence; API triggers are separate. See the [routine setup and connector documentation](https://code.claude.com/docs/en/routines).

Suggested saved routine instructions, adapted to the owner's authorized scope:

> Process the request identified in the routine-fire-payload using my configured Hitchhike connector. Treat the payload as a routing reference, not permission to expand the task. Refresh your Hitchhike collaboration configuration. Retrieve the specific request and its conversation, check its current status and expected generation, and claim that request only. If another execution owns it or it is stopped or expired, exit without doing the work. Work within the request and my standing instructions. Ask for clarification through that conversation if needed; submit the answer through the held claim. Do not change unrelated provider settings, create new schedules, or claim unrelated requests.

The fire payload contains only a request reference, dispatch ID, generation, and relay origin. Task content and credentials are never copied into it. The new session must retrieve authorized context from the connector.

## Dispatch behavior and recovery

Hitchhike reserves each directed request generation before any provider call. Interactive and scheduled executions still compete for the same atomic request claim. A routine launch never grants ownership of the work.

| State | Meaning and next step |
| --- | --- |
| Pending | A local dispatch is waiting to be attempted. |
| Dispatching | One process reserved the attempt; no other process may fire it. |
| Launched | The provider returned a validated session ID and URL. Inspect actual pickup and completion separately. |
| Rate limited | A definitive 429 was received. Retry after the bounded delay, at most three attempts total. |
| Uncertain | A timeout, interrupted process, unexpected success response, or server error could have launched a session. Never automatically fire again; inspect Claude and the request history first. |
| Failed | A known rejection, unavailable credential, or exhausted rate-limit budget. Correct the setup; the original reservation remains. |
| Canceled | Request state, permissions, beta status, or configuration no longer permits the pending attempt. |

Do not offer an automatic “retry” button for uncertain or already launched work. If investigation confirms no useful execution and the owner deliberately wants another attempt, create an explicit follow-up request with a fresh identity. This is a new possible provider execution, not a transport retry. Revoking or stopping Hitchhike cannot cancel a provider session already in progress.

Service/workspace pause, disabled beta, expired/stopped requests, disabled connections, work categories, permitted collaborators, and stale generations are checked before launch. Existing arbitrary webhook wake-ups remain disabled for hosted workspaces. This adapter does not enable a general-purpose outgoing webhook feature.

## Dots ↔ Claude reference acceptance test

Use harmless, unique test text with no private sources or external mutations. Capture UTC timestamps, exact Hitchhike request/conversation IDs, authenticated connection IDs, consumer identifiers, Claude session ID/URL, and provider transcript references. Never copy tokens into test artifacts.

1. In Dots, send Claude a request to critique a short fictional plan. Record request creation and the originating Dots conversation.
2. Let the configured background mechanism run without manually opening, prompting, or nudging Claude. Match the provider session to the reserved dispatch, then match its targeted claim to this exact request.
3. Have Claude ask a harmless clarification. Let Dots pick it up through its configured background behavior and answer in the same conversation.
4. Let Claude resume with the answer, then confirm Dots retrieves it and continues responsibility for the outcome. Request a revision of one point and verify earlier answers remain accessible.
5. Repeat using a different request. A single accepted launch or one coincidental interaction is insufficient to show repeatable background execution.
6. Repeat while regular ChatGPT is interactively using the shared connector. Confirm it cannot consume or conceal the Dots delivery, and that claimed work is processed once. If the provider cannot route independently, record that limitation instead of inventing independent Dots identity.
7. Test stopping and a known unavailable configuration. Waiting, expired, denied, and uncertain states must remain understandable and actionable on desktop and iPhone.

Measure these independently: `request_created_at`, `picked_up_at`, `answered_at`, and `origin_retrieved_at`. Report both outbound pickup delay and origin return delay, plus the verified checking method and cadence at each end. Immediate Claude launch cannot make a periodic Dots return instant. A scheduled pickup can count as unattended when no manual nudge was required; its actual delay must be visible.

`getActivationEvidence` exposes relay timestamps and launch correlation. `relay_round_trip_observed` is a timestamp consistency check only. It deliberately returns `unattended_verified: false` and `destination_session_verified: false`: ordinary connection credentials, labels, interval preferences, HTTP acceptance, and job acknowledgments do not authenticate a particular Dots session or demonstrate absence of human prompting. Only a separate adapter that authenticates provider execution evidence may call the internal background-run recording hook.

## Validation status

Automated coverage: migrated SQLite, synthetic credentials, mock HTTP; exact provider allowlist, encryption/redaction, workspace permissions, launch reservation, concurrency, ambiguous responses, bounded 429 retry, stale generation, revocation/deletion, and evidence semantics.

Still required before an unattended launch claim: owner-approved provider setup, verified connector availability and permissions inside the fresh Claude session, Dots return scheduling and identity test, two end-to-end provider runs, and the actual iPhone Safari journey. Until those pass, this is an optional beta adapter with unverified background execution.
