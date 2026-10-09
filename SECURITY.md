# Security policy

Hitchhike is maintained by one person. Reports are handled on a best-effort basis, with no response-time guarantee and no bounty program.

## Reporting a vulnerability

Use GitHub private vulnerability reporting: <https://github.com/davidspiegs/hitchhike/security/advisories/new>.

- Do not open a public issue for a vulnerability.
- Do not include secrets, tokens, or other people's data in a report. Redacted or synthetic examples are enough.
- If private reporting is unavailable to you, open a minimal public issue that only asks for a private channel. Do not describe the vulnerability in that issue.

You will get a reply with either a plan or a reason. Fixes ship in the next published snapshot and, when they affect the hosted beta, in its next deployment.

## Scope

In scope:

- The relay Worker and API in [`src/`](src/)
- The hosted dashboard, landing page and guides in [`web/`](web/)
- The terminal CLI in [`cli/`](cli/)
- Connection instructions and adapters in [`adapters/`](adapters/)
- D1 schema and data migrations in [`migrations/`](migrations/)
- The hosted beta at `https://hitchhike.dev` (frontend) and `https://api.hitchhike.dev` (Worker API)

Out of scope:

- Vulnerabilities in third-party AI providers or the apps connected through Hitchhike
- Findings that require the operator's own credentials (Cloudflare, Vercel, Clerk, `ADMIN_TOKEN`, `ENCRYPTION_KEY`) or a deployment the operator has misconfigured
- Volumetric denial of service against the hosted beta; its quotas and shared limits are documented in [operating the free beta](docs/free-beta-operations.md)
- Social engineering of the maintainer, users, or providers

## Testing against the hosted service

The hosted service is a small free beta. If you test against it:

- Use only workspaces and accounts you own.
- Stay within the published quotas in [operating the free beta](docs/free-beta-operations.md).
- Do not access, modify, or retain other users' data. If you reach it by accident, stop and report it.
- Do not run automated scanners against the hosted beta.

For anything beyond that, run the isolated local suites or your own deployment instead. `npm run test:local` creates disposable databases and loopback servers and contacts no external account; see [Developing Hitchhike](docs/development.md).

## What published source does and does not establish

- Anyone can read the code and run the same checks CI runs.
- Nobody has audited this code. Publishing it is not an audit.
- Publishing the source does not prove what the hosted servers run. To compare a hosted deployment with a published snapshot, read `release` from `GET https://api.hitchhike.dev/healthz`, which returns `{ ok, protocol, release, version }`; `release` is the published snapshot tag (for example `v0.1.0`) the operator passed at deploy time, and `version` is Cloudflare's version identifier for that Worker deployment. The landing page footer at hitchhike.dev shows `Release vX.Y.Z`, linking to that tag in the public repository. Both values are set by the operator; they are a way to check consistency, not a third-party attestation.
- Hosted task content is readable by the operator. Recoverable connection credentials are encrypted by the application, but task titles, instructions, context and results are not end-to-end encrypted. See the [privacy page](https://hitchhike.dev/privacy) and [privacy and operating costs](docs/privacy-and-costs.md).
- Self-hosting gives you control of the relay, its database and its credentials. Each connected provider still receives the context that is sent to its agent and handles it under its own terms.

## Supported versions

Security fixes are made in the maintainer's working repository and published in the next snapshot. The hosted service and the latest published tag are the supported versions; older tags, forks and self-hosted deployments on an earlier tag are not patched separately. Self-hosters should move to the latest tag using the upgrade steps in [Self-hosting](docs/self-hosting.md).

## Security-relevant checks you can run locally

These run offline with generated fixtures, no Cloudflare login, and no provider accounts. CI runs them on every push and pull request.

```bash
npm run typecheck
npm run test:hardening
npm run test:auth
npm run test:clerk
npm run test:local
```

`npm run test:hardening` runs, in order:

| Script | Covers |
|---|---|
| `test:parser-security` | Offline parser and schema regressions; adversarial inputs run in killable child processes |
| `test:auth-boundaries` | Account-boundary regressions using migrated SQLite and the real Clerk SDK with generated signatures |
| `test:resource-budgets` | Resource admission against the real migrations |
| `test:storage-accounting` | Metadata quotas, atomic cascades and durable consumers |
| `test:security-boundaries` | Security boundaries exercised through the real HTTP/MCP Worker with outbound fetch disabled |
| `test:maintenance-storage` | Cleanup remains possible when metadata storage is full |
| `test:transition-permissions` | Atomic requeue routing |

`npm run test:local -- --suite hosted` runs the hosted Wrangler suite, which includes `scripts/security-regression.mjs` against a disposable local hosted relay. None of these contact a real provider; they do not establish that a particular cloud deployment is configured correctly.
