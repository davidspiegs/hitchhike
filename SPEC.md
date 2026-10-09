# Hitchhike protocol

The relay stores tasks, assigns time-limited claims and returns results to their requester. Agents perform the work in their existing products. The wire envelope is version `0.1`. Types are defined in [src/types.ts](src/types.ts); deployment instructions are in [self-hosting](docs/self-hosting.md) and [hosted operations](docs/hosted-operations.md).

## Authority and privacy

- Authentication determines the workspace and connection. Caller-supplied workspace IDs, sender names, task text and tool output do not grant authority.
- Hosted connection IDs are immutable identities. Display names/handles may help people recognize them; clients route with IDs returned by the relay.
- A connection's sender/receiver permissions and allowlists restrict routing within its workspace. Neither a wildcard destination nor a known job ID grants access to another workspace.
- Results return through the relay. A task cannot supply a callback destination or use a `from` field to impersonate another connection.
- A task includes only the context the sender supplies. The relay does not automatically import complete chats or hidden provider state.
- Task content and outputs are untrusted data. Guidance in a brief does not override the receiving agent's existing user permissions, approval controls or provider policy.
- Task payloads are stored by the hosting operator. Recoverable connection-secret encryption does not make those payloads end-to-end encrypted.

## Deployment and authentication modes

### Hosted

Humans sign up through the explicitly configured identity provider with a verified email. `AUTH_PROVIDER=google` is the default direct-Google flow; `AUTH_PROVIDER=clerk` selects managed identity and the methods enabled in that Clerk application. Missing or invalid provider configuration must fail closed rather than silently switching providers. Public signup is the default (`SIGNUP_MODE=public`) and needs no invitation or email allowlist. Optional operator mode `SIGNUP_MODE=invite` applies `BETA_EMAILS` and denies signup if that list is empty.

Direct Google uses relay session cookies. Clerk mode verifies the Clerk session JWT for authenticated browser requests and does not exchange it for an independent long-lived relay session. Both modes enforce CSRF and origin checks for mutations; `GET /auth/session` reports the signed-in user/workspace and CSRF token. Stable external subjects identify accounts; matching email addresses alone do not merge a direct-Google workspace with a Clerk account. There is no hosted owner-token login. Account/profile and authentication data may be processed by the configured identity provider; task content remains in the relay's storage and is not identity-provider metadata.

Clerk lifecycle events enter through `POST /auth/clerk/webhook`, authenticated with `CLERK_WEBHOOK_SIGNING_SECRET`. Supported subscriptions are `user.updated`, `user.deleted`, `session.ended`, `session.revoked` and `session.removed`. Local logout/deletion denies access immediately and durably retries failed provider actions. Small one-way identity/session hashes prevent deleted credentials recreating accounts; pending cleanup retains the Clerk issuer and opaque subject until completed. These security records are distinct from deleted workspace content.

Remote MCP uses the stable `/mcp` endpoint, OAuth authorization-code flow with S256 PKCE, explicit connection consent, resource-bound scopes and revocable tokens. Discovery is published at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`. The grant is tied to a connection and workspace, not a general right to administer the relay.

HTTP workers redeem an expiring one-use pairing code and use the resulting credential in `Authorization: Bearer ...`. Hosted submissions use `POST /v1/submit` with that credential and `X-Claim-Token`; the claim comes from authenticated pickup. Hosted reusable agent credentials and claim capabilities must not appear in URL paths or query strings.

Pairing codes expire after ten minutes and can be redeemed once. Reading setup or saving ordinary settings does not replace a code. Explicitly requesting a new pairing code invalidates the old one; only the hash is retained after issuance.

Ordinary connection edits preserve an OAuth grant. Effective permission is the intersection of the grant's scopes and current connection permissions. Adding a permission absent from that grant requires new authorization; restoring a previously consented permission can use the existing grant. Credential rotation invalidates prior grants and claims. Disabling reception revokes held claims without rotating credentials, and re-enabling it does not revive those claims.

The development-only `/auth/dev` login is restricted to explicitly enabled loopback configurations. Public configurations must leave `ALLOW_DEV_AUTH=false`. Separately, `CLERK_ALLOW_DEVELOPMENT=true` permits Clerk development keys on a non-loopback preview; leave it false for public launch. Local tests do not verify production social-provider consent/callback behavior.

### Self-hosted compatibility

Owner and connection credentials identify the `default` workspace. The owner credential (`ADMIN_TOKEN`, shown as **Owner key** in the dashboard) is accepted through an authorization header, with no Clerk or Google account required. Self-hosted mode has no OAuth flow. MCP clients use a bearer header when supported, or the dashboard's private `/mcp/{key}` URL. Self-hosted integrations also support `?key=`, tokenized submit URLs and browser claim forms. Treat these URLs as secrets. Hosted mode disables these URL credential paths.

Use a separate `ENCRYPTION_KEY` for recoverable connection credentials. An optional previous key supports controlled rotation; retain the old key until migration/re-encryption is verified. Losing an encryption key can require reconnecting agents.

## Task envelope

`POST /v1/jobs` accepts a task from an authorized sender:

| Field | Required | Meaning |
|---|---|---|
| `type` | Yes | `task` for general work; optional guidance categories are `research`, `summarize`, `monitor`, `digest`, `review`, `build` |
| `to` | Yes | A connection ID returned by the relay, or `*` for an eligible worker in this workspace |
| `title` | Yes | Short label, up to 120 characters |
| `goal` | Yes | Complete brief, up to 20,000 characters |
| `inputs` | No | Relevant structured context, up to 64 KB |
| `constraints` | No | Scope and limits as a list of strings |
| `acceptance` | No | Expected result or completion criteria |
| `output` | No | Markdown/JSON preference, optional JSON schema and summary limit |
| `artifacts` | No | HTTPS references to larger inputs, with name and optional metadata |
| `priority` | No | Integer from -10 to 10 |
| `expires_in_minutes` | No | Task lifetime; default three days |
| `lease_seconds` | No | Worker claim duration, within server limits |
| `max_attempts` | No | Work attempt budget, default three and maximum five; answered clarifications have a separate bounded allowance |
| `idempotency_key` | Recommended | Stable identifier for one logical handoff; reuse it after a lost response |
| `parent_id` | No | Related task in the same workspace; subject to descendant/depth limits |
| `v` | No | Envelope version, `0.1` |

Choose `task` when a specialized category adds no value. Categories provide instructions and lease defaults; they do not enforce an agent-side sandbox. `build` is approval-gated by default. A general task is not permission to take an action the user has not authorized.

The server stamps sender identity. Unknown envelope fields and routing/callback fields are rejected. Global HTTP and MCP payload caps apply in addition to individual field limits; keep large documents at referenced locations the worker is actually authorized to access.

Example:

```http
POST /v1/jobs
Authorization: Bearer <connection credential>
Idempotency-Key: brief-review-001
Content-Type: application/json

{
  "type": "task",
  "to": "<worker id from this workspace>",
  "title": "Review the launch brief",
  "goal": "Review the attached brief. Identify unclear onboarding steps and return a short prioritized list.",
  "inputs": { "audience": "People using two or more AI apps" },
  "constraints": ["Use only the supplied brief; do not publish or contact anyone."],
  "acceptance": ["Each finding includes the section and a concrete suggested improvement."]
}
```

## Result envelope

Workers can submit JSON or Markdown. JSON fields include `status` (`completed`, `failed`, `needs_input`), `summary`, `body`, `data`, `sources`, `artifacts`, `question`, `error` and optional self-reported `confidence`.

For Markdown, the parser extracts a summary, the first JSON block and source links when present. `NEEDS_INPUT:` asks a question; `FAILED:` reports inability to finish. The relay stamps worker identity, submission time, provenance and validation results.

Individual job reads and MCP results are compact by default: request `full: true` in MCP or `?full=1` on an HTTP job read for the full body. HTTP inbox pages include the full arrived result. JSON-schema validation checks format, required fields and structure. It does **not** verify factual correctness, source reliability, authorized execution or whether the acceptance criteria are actually satisfied. After the configured validation retry allowance, a result may be delivered with its validation issues visible so the requester can decide what to do.

## State and claim semantics

The task states are `needs_approval`, `queued`, `claimed`, `input_required`, `completed`, `failed`, `canceled` and `expired`.

HTTP pickup at `/v1/work/next` accepts an optional `job_id` to constrain both a new claim and replay of a held lease to that exact task. All workspace, routing, permission, expiry and quota checks still apply; an unavailable task returns no job and never selects a different one. `GET /v1/me` advertises `capabilities.targeted_claim: true` for connection credentials. Clients must check that capability before relying on targeted pickup, because older servers may ignore the query parameter.

1. Creation puts a task in `queued`, or `needs_approval` when required.
2. An eligible worker atomically claims it. At most the configured number of live leases may be held by that worker.
3. The worker returns a result, asks a question or reports failure. A requester can answer, send back with feedback or cancel.
4. An expired lease can be retried up to the task's work attempt budget. Task expiry and cancellation stop further work from changing the result.

Claim attempt generations increase monotonically to fence old workers. Answering a valid question grants a separate continuation credit, so clarification does not consume the work attempt budget. Each task permits at most five answered clarification rounds. The relay checks that cap before accepting another question; at the cap the worker must complete or report failure instead of leaving an unanswerable task. Task expiry and storage limits still apply throughout the conversation.

Claims are fenced to the current lease attempt and connection authorization generation. An old worker cannot overwrite a newer attempt with a late result, failure or question. Rotating/disconnecting a connection revokes its prior claim capabilities. MCP submission also binds the claim to the authenticated worker. Receiving the same task again after losing local context is not a fresh authorization to repeat an external side effect.

Use heartbeats when a legitimate task exceeds its lease. A rejected stale claim requires checking current task state; it must not silently create a second job. Relay retry safety does not make external agent actions exactly-once. Workers should use their own idempotency checks before repeating writes to third-party systems.

## Idempotency and inbox delivery

An idempotency key is scoped to workspace and sender. Retrying creation with the same key returns the original task rather than another copy. Generate a new key only for intentionally new work. Keep the same brief on retries.

MCP and HTTP inbox reads do not acknowledge results. `check_inbox` and `GET /v1/inbox` return oldest-first pages with a `delivery_cursor` and, when needed, `next_cursor`. The HTTP JSON page includes `arrived`, `pending` and `has_more`; MCP presents those results and pending work as text. Process the complete page, then call MCP `acknowledge_results` or `POST /v1/inbox/ack` with JSON `{ "delivery_cursor": <returned cursor> }`. Repeating a read before acknowledgement returns the outstanding results; repeating acknowledgement is safe. Use `next_cursor` as the next read's `cursor` to page ahead without acknowledging prematurely.

HTTP inbox reads require the connection bearer and `relay:read`; they support `limit` from 1 to 100 (default 20), a relay-issued integer `cursor` and `include_seen=true` to include acknowledged history. HTTP acknowledgement returns `{ "ok": true }`. Job list/detail reads and dashboard viewing do not acknowledge a connection's inbox. The CLI's human-readable `inbox` acknowledges each successfully printed page; JSON and `--no-ack` modes require explicit `inbox-ack` after processing.

Acknowledgement means the sender received the page. It does not approve the content or attest that the task was successfully performed. This distinction lets the UI separate result-ready from result-retrieved without hiding an answer after a lost response.

## HTTP surface

| Actor | Endpoint | Purpose |
|---|---|---|
| Hosted connection | `POST /v1/pair` | Redeem JSON `{ "code": "<pairing code>" }` once for a bearer credential and setup instructions |
| Worker | `GET/POST /v1/work/next` | Claim eligible work; Markdown by default, JSON with `?format=json` |
| Hosted worker | `POST /v1/submit` | Result with bearer authorization and `X-Claim-Token` |
| Worker | `POST /v1/heartbeat` | Renew a held claim with bearer authorization and `X-Claim-Token` |
| Legacy worker | `POST /v1/submit/{claim_token}` | Self-hosted compatibility submission |
| Legacy worker | `POST /v1/submit/{claim_token}/heartbeat` | Self-hosted compatibility heartbeat |
| Legacy worker | `GET /w/{claim_token}` | Self-hosted compatibility form |
| Sender | `POST /v1/jobs` | Create/retry a handoff |
| Connection | `GET /v1/inbox` | Read a retryable inbox page with `relay:read`; does not acknowledge |
| Connection | `POST /v1/inbox/ack` | Acknowledge a complete page using its `delivery_cursor` and `relay:read` |
| Participant | `GET /v1/jobs`, `GET /v1/jobs/{id}` | Authorized task list/result retrieval |
| Sender/owner | `POST /v1/jobs/{id}/reply`, `/reject`, `/accept`, `/cancel` | Task transitions, subject to permission |
| Owner | `POST /v1/jobs/{id}/approve` | Release an approval-gated task |
| Owner | `/v1/admin/agents` and per-agent setup/removal routes | Connection administration |
| Owner | `/v1/admin/schedules` | Bounded recurring tasks |
| Owner | `GET /v1/events`, `/v1/admin/overview` | Workspace activity and dashboard data |

An unauthorized ID must not disclose the existence or contents of another workspace's task. Hosted browser administration uses the signed-in session and CSRF token, not an agent bearer credential. Route details for pairing, workspace settings/export/deletion and OAuth are maintained in the corresponding implementation and covered by hosted tests.

## MCP surface

`POST /mcp` supports the implementation's advertised protocol versions and request schema. Clients must use the returned discovery/version information rather than assuming compatibility from a vendor name. The handler bounds payloads and batches; one HTTP batch is not an exemption from per-operation permissions or quotas.

| Permission | Tools |
|---|---|
| Send | `list_agents`, `send_job`, `answer_question`, `send_back`, `cancel_job` |
| Read | `check_inbox`, `acknowledge_results`, `get_job` |
| Work | `get_next_job`, `submit_result`, `ask_question`, `give_up` |

Tool visibility and execution depend on connection permissions and OAuth scopes. `send_job` uses `task` for the brief, corresponding to HTTP `goal`, and accepts an `idempotency_key`. Worker tools use the `claim_id` returned by `get_next_job`. Recoverable argument/validation errors use `isError: true`; callers must inspect the result rather than treating a transport-level success as task completion.

## Budgets, scheduling and retention

Hosted defaults target five connections, two background workers, 50 new handoffs/day, 500/month, 20 open tasks, 32 MiB of stored workspace content and 30-day task history. Self-hosted `default` workspaces have separate limits. Limits are server policy.

Per-agent sender/receiver limits and allowlists remain in force. Workspace limits, pause state, payload size, concurrency, retries, schedules and task descendants require independent enforcement. Task text cannot raise a budget. A quota response should leave already-created tasks and results identifiable so callers can recover rather than repeatedly resubmit. `SERVICE_PAUSED=true` and workspace pause stop mutations, including in-flight submissions and heartbeats; already stored results and exports remain readable. Resume before workers can complete pending work.

Scheduled jobs use retry-safe creation. Failure preserves the occurrence's original idempotency slot and sets a separate retry time, backing off from five minutes to one hour. Repeated permanent template/permission errors disable a schedule after three failures; quota and unexpected errors remain retryable. Success and intentional edits reset failure state. Removing their authorized sender/receiver must prevent orphaned schedules from continuing to create work. Hosted agent wake webhook setup and dispatch are currently disabled, including when `WAKE_ALLOWED_HOSTS` is populated; the inbound Clerk identity webhook is separate. The delivery module's exact hostname allowlist, public HTTPS/443 requirement, redirect rejection and bounded at-least-once retries support legacy hardening and future reviewed integration. Receivers deduplicate `X-Relay-Delivery-Id`. A doorbell is a pickup hint, not a source of task authority. MCP itself never wakes a client.

Retention applies to task payloads, result bodies and related audit excerpts. Export and deletion operate within the authenticated workspace. Application deletion does not instantly erase infrastructure backups: operators must document the actual recovery window of their Cloudflare plan. Do not call the audit log permanently append-only when retention/deletion can remove it.

## Verification boundary

The [local checks](docs/development.md#run-the-checks) use isolated emulators and test credentials to exercise self-hosted compatibility, hosted authentication/authorization, tenant isolation and security regressions. They do not deploy or connect to real provider accounts. Each deployment needs its own identity-provider configuration, browser MCP authorization, provider pickup/result/revocation checks and load measurement. See [connection verification](adapters/README.md#verify-a-connection) and [hosted operations](docs/hosted-operations.md).

## Hosted free-beta resource admission

New-work allowances are distinct from weighted API-operation budgets. HTTP and MCP share atomic workspace/service admission, including polling, replies and retries; MCP batches debit each operation. See [operator defaults and recovery](docs/free-beta-operations.md). Caller output schemas use the [bounded structural subset](docs/output-schemas.md); unsupported executable features are rejected explicitly, including on previously saved schemas.
