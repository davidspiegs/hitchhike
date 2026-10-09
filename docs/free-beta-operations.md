# Operating the free beta

The beta is free. Its limits protect a small shared service; they are not paid tiers or a promise of unlimited background execution. Connected assistants use their owners' provider accounts. Hitchhike does not supply model credits.

## Default workspace allowances

| Resource | Allowance |
|---|---:|
| Connections | 5 |
| New response requests | 500 per calendar month; 50 in a rolling 24 hours |
| Outstanding requests | 20 |
| Retained storage | 32 MiB, including conservatively accounted metadata |
| Weighted resource operations | 100,000 per UTC calendar month; 4,000 per UTC day |
| Independent delivery consumers | 8 per connection |
| Claim credentials | Original capability plus 3 recent retry capabilities per attempt |

Replies, clarification, checks, acknowledgment and transport retries do not consume additional **new response requests**. They still use infrastructure and therefore consume resource operations. Reads and verified OAuth token issuance cost 1, queue/inbox polls 2, targeted claims and mutations/completions 10, and exports 50. Each MCP operation in a batch is charged independently, including notifications. Ten percent of work capacity is reserved for existing-result retrieval, completion, cancellation, export, connection identity, the connection's current configuration and the protocol handshake needed to reach them. This reserve is finite, not an unlimited bypass.

Anonymous traffic does not consume the shared work allowance. The edge gate and bounded authentication throttles protect credential verification; new valid OAuth client registrations additionally use their own allowance (10,000/day; 300,000/month). A rejected address cannot consume the shared edge bucket. Routing rejects encoded aliases before authentication so the admission gate and router agree on the endpoint.

Already-authenticated owners use separate capacity for allowlisted inspection, pause, credential management, cancellation, export and deletion from the first request. Dashboard reads therefore cannot consume the assistants' work allowance. This owner capacity permits no polling, claims or new task dispatch. It is bounded at 2,000/day and 30,000/month per workspace, and 20,000/day and 300,000/month service-wide. Agents cannot use it. Maintenance has its own 20,000/day and 500,000/month service allowance; exhausting agent budgets does not stop retention cleanup. All periods in this paragraph are UTC calendar periods.

An open dashboard tab checks after 15 seconds, then backs off through 30 seconds, one minute, two minutes, five minutes and fifteen minutes. Automatic refresh does not fetch every connection's configuration. It reads the overview plus at most one configuration, and the Activity list when visible: at most three reads per round, with 100 automatic rounds per rolling 24 hours per tab session. Navigation and explicit actions can add reads; the server allowance still bounds all tabs together. Hidden tabs stop checking, focus events are coalesced, and a read response's `Retry-After` pauses subsequent owner reads until its deadline. A rejected work request does not pause the owner's ability to inspect the workspace.

Completed persistent conversations are kept together for 30 days after their last message; outstanding requests prevent deletion of their conversation. Accounted storage includes duplicated conversation content, identifiers, configuration, claims, receipts and audit records. The calculation deliberately includes row/index headroom. It is not a disk-size measurement. Existing over-budget data is preserved during migration; positive growth is refused until space is available. Reductions, cleanup and access revocation remain available.

The existing limit of two configured polling workers is retained. Additional connections can work on demand. Prefer slower checks when idle and a verified short interval only while awaiting an answer. A prompt does not create a provider schedule.

The monthly request ceiling is also subject to available storage. Measured synthetic completed exchanges with a 1 KiB brief and 4 KiB answer use about 46.7 KB of conservative accounting each; 500 take about 22.3 MiB before additional history or configuration. Long answers, revisions and extra consumers use more. The shared 1.5 GiB cap is unchanged: it fits about 48 completely full 32 MiB allowances, or 150 workspaces averaging about 10 MiB. Monitor aggregate growth before inviting more users or raising limits.

## Shared service protections

The hosted template requires three Cloudflare rate-limit bindings. Cheap address/network and service buckets run before database-backed authentication. Unknown tokens, anonymous OAuth calls and pairing requests cannot evade the ingress gate by changing their credential text. OAuth clients, sessions, consent requests, token histories and throttle buckets have separate cardinality limits and cleanup.

The hosted template and initial production rollout admit 20 workspaces, with 2,000,000 shared weighted operations per UTC month and 100,000 per UTC day. Configure `HOSTED_WORKSPACE_LIMIT` explicitly: the compatibility fallback is 150 and is not a capacity promise. Twenty workspaces' full 100,000-unit monthly allocations fit the shared work ceiling; ordinary hourly checking leaves room for useful exchanges. Shared owner, storage and ingress limits still apply. Increase admission only after reviewing actual active usage and aggregate headroom. Workspace budgets are charged together with the shared counter in one SQL statement. Deleting a workspace does not refund the shared allowance. New work can be paused with `NEW_WORK_PAUSED=true`; ordinary per-workspace pause remains a separate user control. `HOSTED_WORKSPACE_LIMIT=0` closes new signup while keeping existing accounts usable.

Shared tenant storage growth stops at 1.5 GiB of conservative accounted storage. Self-hosted `default` data retains its configured limits. Hosted Worker CPU is limited to 250 ms per invocation in `wrangler.hosted.jsonc`. Keep logging sampled; never log request bodies, provider tokens or raw auth errors.

Hosted routine activation requires operator opt-in with `HOSTED_ACTIVATION_ENABLED=true`. It is off by default and must remain off until the actual provider journey has been verified. When explicitly enabled, every admitted launch requires available receiver capacity, current permissions, resource budget and rolling launch allowances (50 service-wide/day, 10/workspace/day by default). Pending or uncertain launches reserve capacity. An uncertain provider outcome must be investigated rather than automatically fired again. Deleting a request or account does not refund a recent launch.

## Budget and alerts

Set a monthly target for variable infrastructure charges, in addition to existing account subscriptions, before opening signup. Application counters measure resource admissions, not actual invoice dollars. The limits above leave substantial headroom under the cost model for admitted relay work. They should be adjusted only after measuring Worker CPU, D1 rows read/written, actual retained database bytes and frontend/auth usage.

**There is no guaranteed dollar cutoff.** Rejected HTTP requests still invoke Workers; Cloudflare rate-limit counters are local to a Cloudflare location, and denied resource admissions still perform small indexed reads. Frontend traffic and identity-provider traffic are also outside the relay ledger. Other applications may share the same Cloudflare, Vercel or Clerk billing accounts. A provider billing alert is a notification, not an automatic spending stop.

Use a Cloudflare billing alert as an early warning, and review usage before raising limits. The workspace UI warns at 80% of its day/month operation budget. Operators can inspect the global fixed counter without reading task content:

```sql
SELECT day_key,day_used,month_key,month_used,updated_at
FROM resource_operation_budgets
WHERE scope_type='global' AND scope_id='service';
SELECT COUNT(*) AS workspaces FROM workspaces WHERE id<>'default';
SELECT COALESCE(SUM(accounted_bytes),0) AS tenant_accounted_bytes
FROM workspace_storage_usage WHERE workspace_id<>'default';
```

At unexpectedly high usage, close signup and pause new work, inspect aggregate source/route metrics, then block abusive traffic at the provider edge where supported. Do not automatically pause unrelated projects that share the same hosting account. The global ledger protects against distributing work across many accounts; it does not make denial of service impossible.

## Rollout

1. Apply additive migrations `0014` through `0021` to the isolated staging database first.
2. Run `npm run typecheck`, `npm run test:hardening`, `npm run test:next`, authentication/migration/maintenance checks and the actual local Wrangler legacy/hosted suites. Ordinary SQLite alone does not establish D1 compatibility.
3. Configure all ingress bindings and CPU/budget variables before deploying hosted code. Missing hosted protection fails closed. Preserve existing operator secrets and exact API/frontend origins.
4. Verify staging readiness, limits, recovery and API behavior. Its sample-data fixture disables provider networking; it cannot prove real provider authentication or unattended execution.
5. Roll production security changes out deliberately with beta UI activation controlled per workspace. Keep provider wake disabled until the Dots/Claude end-to-end test succeeds. Do not describe a browser-sized viewport as an actual iPhone test.

Normal permission edits attenuate the scopes of existing OAuth grants without silently adding privileges. Restricting an account invalidates sessions, OAuth and claims and blocks paired keys. Clearing an identity restriction requires fresh verified sign-in; operator suspension cannot be cleared through workspace preferences. Recoverable credentials remain encrypted, while task content remains operator-readable as disclosed in the privacy page.

OAuth refresh consumption and replacement issuance are atomic. A token-capacity or database failure leaves the presenting credential usable for a later retry; unexpired spent refresh hashes remain for replay detection. Requested scope can narrow but cannot expand the presenting token's authority. Deleting a hosted Google/dev account retains only an identity hash and expiry for a 30-day signup cooldown so deletion cannot repeatedly reset its allowances. Clerk's existing identity tombstone behavior is unchanged.
