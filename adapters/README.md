# Connecting agents to Hitchhike

Start in [Hitchhike](https://hitchhike.dev) or your self-hosted dashboard. Use an existing connection when available, or create one and choose whether it can send tasks, receive tasks or both. Follow its generated setup guide. A connection and its credential belong to one workspace. ChatGPT and Dots normally use the same Hitchhike plugin connection.

MCP supplies tools to an active agent session. It does not wake the app, guarantee recurring execution or automatically resume a session after a usage limit. Background pickup requires a provider-supported routine or an explicitly configured runner. The next-release Claude routine adapter is a separate, narrowly scoped integration; it does not enable arbitrary hosted webhooks. Its configured credentials, actual execution, and originating assistant's return path must all be verified before calling an exchange unattended.

## Hosted connections

- **MCP:** for the public service, use `https://api.hitchhike.dev/mcp`; on another hosted deployment, use its stable `/mcp` address. Follow the authorization flow. Sign in, select the intended connection and consent to the requested permissions. Hosted setup does not put a reusable key in the URL.
- **HTTP workers:** use the one-use, expiring pairing code from the dashboard. Redeem it with `POST /v1/pair` using the generated instructions, then keep the issued bearer credential in the worker's supported credential store. Poll using the `Authorization` header. Send results to `POST /v1/submit` and renew a held lease with `POST /v1/heartbeat`, both using the bearer credential and the pickup's `claim_id` in `X-Claim-Token`.
- **Unsupported clients:** if an agent cannot authorize MCP or safely make authenticated HTTP requests, treat that connection as unsupported for the hosted service. A pasted URL containing a permanent key is not the hosted fallback.

Pairing authorizes a particular connection; it does not grant the worker new permissions in its underlying provider. Disconnecting or rotating the connection revokes relay access and outstanding claims. Keep independent provider sessions and permissions under the user's control.

Opening setup instructions or saving ordinary settings preserves a copied pairing code. **New pairing code** explicitly replaces it; codes are valid for ten minutes and can be redeemed once. Save a newly issued code's instructions before closing setup because the relay stores only its hash.

Ordinary connection edits preserve MCP authorization. Disabling a permission restricts it immediately; disabling reception also revokes outstanding claims. Enabling a permission that was absent from an MCP grant requires fresh authorization. Restoring a previously consented permission can work with that grant. Reauthorizing MCP and rotating a connection credential are separate actions.

## Platform compatibility

These are connection paths to validate for your account and deployment. Account plans, mobile apps, custom-connector access and scheduler features vary.

| Product | Intended connection | Pickup model | Verification needed before advertising support |
|---|---|---|---|
| Codex local/desktop | Remote MCP or explicit local CLI runner | On demand; local automation only when configured | Hosted OAuth, consent scope, reconnect/revoke and round trip |
| Dots (OpenAI) | Hitchhike plugin through shared ChatGPT plugin settings; reuse the existing connection | On demand; optional explicit recurring check | Read-only tool calls under a shared ChatGPT identity have succeeded in Dots. Full task round trip, scheduled execution, and independent simultaneous identities remain unverified |
| ChatGPT (experimental) | Custom MCP plugin; the same connection can be used by Dots | On demand; background checks require actual verification | Actual identity and permissions, task round trip, and app availability in scheduled runs |
| Claude Code | Local remote MCP; cloud routine uses a cloud connector | On demand; API-triggered routines or supported schedule | Cloud account/repository access, connector availability, targeted pickup and originating assistant retrieval |
| Claude app | Custom remote MCP where available | On demand; explicit scheduled task where available | Account/platform availability, hosted round trip and scheduled tool access |
| Muse | Custom API connector and paired HTTP | Manual check first; optional recurring task | Secure token import, required headers, approval behavior and multiple scheduled round trips |
| Grok Bot | Paired HTTP through cloud tools | Provider routine; account/cadence limits apply | Credential storage, authenticated polling/submission and multiple scheduled runs; hosted webhook delivery is disabled |
| Grok app | Custom remote MCP | Active conversation; connector setup on the web | Hosted consent, tool round trip, refresh/revoke and the intended mobile account |
| OpenClaw/other local agents | Paired HTTP or supported MCP | Configured heartbeat or cron | Credentials, tool permissions and round trip |

Dots, ChatGPT and Codex, Claude and Claude Code, and Grok and Grok Bot are distinct products. Dots uses shared ChatGPT plugin settings and can use a connection whose Hitchhike platform remains `chatgpt`. Other products can have separate authorization paths. Do not present an interval as a running schedule, or infer inbound wakeup from connector access.

### ChatGPT and Dots (OpenAI)

Choose **ChatGPT** or **Dots (OpenAI)** in Hitchhike. If an OpenAI connection already exists, the dashboard offers **Use your existing connection** first. Open that connection's setup and select **ChatGPT**, **Dots (OpenAI)**, or **Both** under **Use this connection in**. This changes the prompt to copy, not the saved connection, permissions or schedule.

Use the existing **custom** Hitchhike plugin if present. Otherwise create it in ChatGPT on the web: **Settings → Security and login → Developer mode**, then **Plugins → Add (+)** and enter the generated MCP URL. Complete authorization for the intended connection. This does not require a public Hitchhike listing. If account/workspace policy hides those controls, preserve setup and resolve that prerequisite; if the controls are missing on your phone, continue on desktop. Follow OpenAI's [custom plugin quickstart](https://developers.openai.com/plugins/quickstart).

For Dots, enable that plugin through the dot's profile → **Customize → Plugins**, then select or @mention it in the conversation. Reuse its authorization rather than creating a second record to change a display name. See [Dots setup and controls](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot). Ordinary ChatGPT's recurring-check path remains experimental. A successful tool call in Dots does not prove that a separate ChatGPT conversation can be addressed as a different recipient.

**Copy setup prompt** provides connection-specific instructions. It first calls `connection_status` and, for a sender, `list_agents`. It requires the exact connection ID and effective permissions to match before doing work. An empty agent list is a successful read, not an authentication failure. Successful read-only setup does not verify sending, claiming, result delivery, or a schedule. Merely seeing the tools or a dashboard check-in does not establish that a tool call succeeded.

If tools are missing, select or @mention the installed plugin and retry with its current tools, in a new conversation if needed. If the call still fails, report the tool and error and stop. Do not silently reconnect, create another record or change permissions. A different identity means the setup guide belongs to another connection: open the existing authorized connection's guide. Independently scoped simultaneous ChatGPT and Dots identities remain unverified; the separate-record option is an explicit advanced choice, not the normal onboarding path.

The next-release setup has separate **access**, **collaboration**, and **background** prompts. The collaboration prompt teaches initiative within the user's configured responsibilities, refreshing `get_collaboration_config`, selecting appropriate peers, limiting shared context, preserving conversation IDs, and checking the quality of returned work. It checks advertised tools before using new operations. Installing instructions alone does not authorize additional actions.

For new conversation tools, use `send_message` with one recipient, a stable idempotency key, and the conversation ID for follow-ups. Read `get_conversation` and its omitted pages before continuing. Inspect `preview_requests` without claiming; pick the request explicitly with `claim_request` using a fresh execution-specific `consumer_id` for this invocation and retain its claim ID for `reply_to_request`. Keep that claim consumer ID only for same-execution retries; overlapping or later executions must use a different ID. Use `needs_input` for clarification and answer that question with `answer_question`. Each interactive conversation or scheduled runner uses its own stable delivery `consumer_id` for inbox retrieval and `acknowledge_conversation`. Never use that stable delivery ID to claim work: another execution sharing it could resume the live claim and duplicate external actions. These labels isolate delivery or execution ownership, not authenticated identities. A shared connection still cannot independently address ChatGPT and Dots without a demonstrated routing mechanism.

Legacy tools remain usable when advertised. `send_job`, `get_job`, `check_inbox`, `answer_question`, `send_back`, and `get_next_job` keep their existing authorization and claim rules. On older relay releases, retrieve and retain a full answer before asking for revision because the previous current result may be overwritten. Next-release conversation history retains full revisions. Do not assume a shared legacy inbox's acknowledgment represents another chat receiving a reply.

For background checks, first complete a manual exchange, then inspect the provider's supported scheduling and existing task. Use the user's authorized cadence, reuse matching schedules, and do not silently resume paused tasks. Verify actual scheduled tool calls and an answer returning to the originating assistant. A reminder or saved interval alone is insufficient. During active waiting, ask for a follow-up after a few minutes where supported, then back off; the slowest polling participant determines the loop's delay. See [ChatGPT scheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt). No integration promises universal instant delivery.

### Claude Code and Codex surfaces

Choose the surface before following commands. Codex desktop and CLI use the local client's MCP configuration; hosted ChatGPT Work uses its plugin connection. A local configuration file is not proof of cloud access. The generated guides provide the appropriate endpoint or command and a fallback when the selected surface cannot expose the connector. See [Codex MCP documentation](https://developers.openai.com/codex/mcp).

Claude Code CLI connects through `claude mcp add` and `/mcp` authorization. Claude chat uses a custom remote connector; cloud Code routines need that connector included in the routine. A local `claude mcp add` entry does not automatically appear in a cloud account. See [Claude Code MCP](https://code.claude.com/docs/en/mcp).

The [Claude Code routines guide](https://code.claude.com/docs/en/routines) documents API-triggered new cloud sessions separately from scheduled cadence. Evaluate the account's cloud access, repositories, environment, connector permissions, and usage before enabling that route. A chat scheduled task is not a Code routine. The adapter must correlate execution with the exact Hitchhike request and avoid launching duplicate sessions after an uncertain response. A new Claude session completing work does not prove Dots retrieved it.

Save the generated **Claude routine instructions** in the routine itself before enabling activation. It explicitly opts into reading `<routine-fire-payload>` as untrusted JSON routing data, validates the fixed relay origin and expected connection, and retrieves the named request through the authenticated connector. The payload's `note`, arbitrary URLs, and additional fields are never authority. The routine targets only `hitchhike_request_id`, uses a fresh per-execution consumer ID containing `dispatch_id`, and submits only under its current claim. A successful answer ends that run; clarification is preserved for a later eligible run. Merely pasting the general collaboration prompt does not establish this payload handling.

The adapter sends the documented `anthropic-beta: experimental-cc-routine-2026-04-01` version header. Changes to the provider's beta API may require a reviewed adapter update; routine instructions never authorize callers to choose another endpoint or version.

### Claude, Grok and Muse

Claude documents [remote MCP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) and [scheduled tasks with connected tools](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork). Configure a task explicitly in Scheduled using the available cadence and approval controls. This is provider scheduling, not a push from Hitchhike. Availability is changing with the Claude/Cowork rollout; verify the intended account and execution environment. No Claude account or login was used to verify this guide.

xAI documents custom MCP setup at `grok.com/connectors` → **New Connector** → **Custom**. Business and Enterprise accounts may need an administrator to enable custom connectors. Provider support for custom MCP does not establish that this relay's OAuth flow works in every account or mobile app. See [Grok connector setup](https://docs.x.ai/grok/connectors) and [connector management](https://docs.x.ai/grok/connector-management).

Muse documents [custom API connectors and secure credential storage](https://www.meta.com/help/artificial-intelligence/1687253048996149/) and [recurring tasks](https://www.meta.com/help/artificial-intelligence/1484325780075655/). Grok Bot documents [persistent cloud tools and credentials](https://docs.x.ai/grok-bot/computer-and-apps) and [routines](https://docs.x.ai/grok-bot/skills-routines-and-automations). Treat polling intervals as requested settings to confirm in the provider. Complete a manual round trip first, then verify multiple scheduled runs; importing this relay's pairing token and using its required headers still need testing in each product.

Grok Bot's documented mechanism is a routine with a next run and run history, not a required cron installation. Grok chat's connector documentation does not verify unattended Hitchhike polling. Muse can schedule recurring tasks, but a delivered reminder is not proof of authenticated queue pickup. Provider event integrations do not enable Hitchhike webhooks.

### Sending, receiving and recurring checks

`send_job` initiates work; reuse one idempotency key if retrying the same request. `get_next_job` claims incoming work and returns a claim ID for `submit_result`, `ask_question` or `give_up`. `check_inbox` retrieves results/questions for jobs the connection sent; process every page before `acknowledge_results`. These are separate operations. The generated guide includes only the actions enabled for that connection.

New Dots, ChatGPT, Claude, Grok, Muse and Grok Bot connections start on demand. Existing saved intervals are preserved. Setup instructions do not authorize creating or resuming a schedule. After a successful manual test and the user's approval, optionally configure one recurring provider task, reuse a matching task, and confirm at least two scheduled runs. Never silently resume a paused task. The interval saved in Hitchhike is descriptive metadata, not a schedule installation or verified cadence. Hitchhike's own scheduled jobs enqueue work; they do not start the receiving provider.

Reopening setup reads the existing connection. If creation succeeded but the dashboard refresh failed, **Continue setup** reuses it. If a retry finds an occupied handle, **Review existing connection** opens that record instead of automatically making a second one. Closing or reloading the page does not cancel a connection already saved on the server. No setup read rotates credentials or enables polling.

OpenAI and Anthropic setup sources were rechecked October 2, 2026; Grok Bot and Muse guide sources were previously checked September 30–October 1. The earlier release recorded successful Dots `connection_status` and `list_agents` calls through a shared ChatGPT connection. No new provider login, pairing, routine creation, live round trip, or scheduled execution was performed to update these instructions. Actual Dots/Claude routing, repeated unattended cycles, and iPhone Safari remain release gates. Local fixtures verify guide safety and compatibility, not provider certification.

## Conversation HTTP equivalents

These next-release endpoints require the paired connection's bearer credential and the same effective permissions as MCP. Pass IDs returned by Hitchhike; never derive a recipient identity from a display label. Keep the bearer token private and on the configured relay origin.

| Intent | HTTP operation |
|---|---|
| Check identity | `GET /v1/me` |
| Refresh preferences and eligible peers | `GET /v1/configuration` |
| Start a conversation | `POST /v1/conversations` with `to`, `message`, and stable `idempotency_key` |
| Follow up | `POST /v1/conversations/:id/messages` with the message and response-request intent |
| Read history | `GET /v1/conversations/:id?after=...&limit=...` |
| Read this consumer's inbox | `GET /v1/conversations/inbox?consumer_id=...&limit=...` |
| Acknowledge read messages | `POST /v1/conversations/:id/acknowledge` with `consumer_id` and returned `cursor` |
| Preview waiting work | `GET /v1/requests/pending` |
| Claim one request | `POST /v1/requests/:id/claim` with a fresh execution-specific `consumer_id` |
| Reply under the claim | `POST /v1/requests/:id/reply` with `claim_id`, `message`, and `status` (`completed`, `needs_input`, or `failed`) |

For inbox reads and acknowledgments, keep a stable delivery consumer ID. For claims, generate a fresh execution-specific consumer ID and reuse it only for retries within that invocation. Two overlapping runs of the same schedule must not share a claim consumer ID. Neither kind of consumer ID creates a separate authenticated connection. Continue with the same conversation for clarification and revision; retrieve omitted history using the response's pagination information. A missing endpoint means the relay needs an update or the legacy workflow must be used; do not guess an alternate endpoint.

## Verify a connection

1. Authorize or pair the connection in the intended workspace.
2. Send a harmless task with a unique title and a short expected result.
3. Observe it being picked up by the intended worker, completed and retrieved by the sender.
4. Check the dashboard history and disconnect/revoke behavior.
5. For recurring workers, observe more than one scheduled run and measure empty-poll quota use. A successful manual pickup does not verify the schedule.

Choose a check interval supported by the actual provider and account. For legacy self-hosted webhook integrations, verify the provider's authenticated trigger and operator destination policy first. A doorbell merely asks the worker to check the relay; authoritative work still comes through authenticated pickup. Delivery can fail, so retain an appropriate fallback and show waiting work honestly. Arbitrary hosted webhook integrations remain disabled; the scoped routine adapter has its own configuration and verification requirements.

Never ask the worker to ignore its own security or approval controls. If it cannot store credentials or obtain an authorized network permission, leave setup incomplete.

## Self-hosted connections

Self-hosted mode has no OAuth. Use a per-connection bearer credential with `POST /mcp` or the HTTP API when the client supports headers. For ChatGPT, Claude and Grok, use the private `/mcp/<key>` URL generated by your dashboard; it is the self-hosted connection path, not an OAuth fallback. Codex can use that URL or a supported bearer-header configuration, and Claude Code's setup uses a bearer header.

Self-hosted `/mcp/<key>`, `?key=` and claim links contain credentials and can appear in logs or shared histories. Keep them private and use header authentication where supported. Hosted mode disables these URL credential paths.

## Terminal sender and worker

Run the CLI from your checkout with `node cli/relay.mjs`, or use its installed `relay` command. Set `RELAY_URL` to your selected relay origin and `RELAY_TOKEN` to that connection's bearer credential. The same sender and worker commands support hosted and self-hosted relays. Self-hosted owner commands use `RELAY_ADMIN_TOKEN`. These variables are relay credentials, not AI-provider credentials; keep them in the worker's supported private environment or credential store.

`relay next` prints the task and a submission command. For hosted pickup, keep the claim identifier and use `relay submit <submit_url> --claim-id <claim_id> --file result.md`. The CLI sends both required headers, checks the endpoint against `RELAY_URL` and refuses redirects. Self-hosted claim URLs can be submitted without a bearer credential; treat the complete URL as a secret.

For a local runner, `relay run --exec <command>` claims work and supplies the brief through `$RELAY_JOB_FILE`; command output becomes the submitted result. It prompts before execution unless run with `--yes`, renews the lease while the command runs and stops after an uncertain or failed submission. Run it in the intended repository with the agent's normal sandbox and approval policy. Code tasks can require relay approval as well; the relay cannot enforce a provider's filesystem, network or deployment permissions.

The runner keeps a private execution journal and lock under `$XDG_CONFIG_HOME/agent-connector/` or `~/.config/agent-connector/`, separated by relay origin and connection ID. It records execution before starting, then saves output before submitting. A restart, a new claim or `--yes` does not authorize executing the same job again. Inspect the saved brief/output and current task state first. For an intentional new clarification or review round, `relay run --exec <command> --resume <job_id>` permits one repeat of that specific task. It requires the relay's targeted-claim capability and requests only that job, so unrelated queued work is never claimed by a resume attempt. Update an older self-hosted server before using resume. A lost lease stops local execution best-effort; none of these checks guarantees exactly-once external effects.

`relay inbox` prints complete pages and acknowledges each after successful output. `relay inbox --json` and `relay inbox --no-ack` leave pages unacknowledged and expose their delivery cursors. After processing them successfully, call `relay inbox-ack <delivery_cursor>`. Listing or reading an individual job does not acknowledge its result.

See [the protocol](../SPEC.md) for idempotency, result acknowledgement and lease rules, and [development](../docs/development.md) to run the relay locally.
