# Developing Hitchhike

[← Back to Hitchhike](../README.md) · [Self-hosting](self-hosting.md)

Use Node.js 22.16 or newer on the 22.x line, or Node.js 24 or newer, npm and Git. The local suites use the built-in `node:sqlite` API, including `StatementSync.columns()`. Clone the repository and install from the checked-in lockfile:

```bash
git clone https://github.com/davidspiegs/hitchhike.git
cd hitchhike
npm ci
```

No Cloudflare login or AI-provider account is needed for the isolated local checks. The npm package is private; run the source from your checkout rather than looking for a published `hitchhike` npm package.

## Run the checks

The same checks used by [CI](../.github/workflows/ci.yml) are:

CI runs them on both Node.js 22 and 24.

```bash
npm run typecheck
npm run test:auth
npm run test:clerk
npm run test:clerk-ui
npm run test:connections
npm run test:dashboard-ux
npm run test:migration
npm run test:web
npm run test:inbox-http
npm run test:cli
npm run test:workflow
npm run test:public-pages
npm run test:delivery
npm run test:maintenance
npm run test:next
npm run test:onboarding-review
npm run test:hardening
npm run test:release-snapshot
npm run test:local
```

`test:web` builds into a temporary directory and removes it afterwards. It preserves existing `web/dist` and `.vercel/output` deployment output, and checks that production builds reject missing or example public configuration.

`test:local` creates temporary Wrangler configurations, random local encryption keys and separate disposable D1 databases for self-hosted and hosted tests. It applies every migration, chooses available loopback ports, runs the suites and stops the emulators on exit. It does not use your `.dev.vars`, Cloudflare secrets or remote database. Google and external agent accounts are not contacted by the test runner.

To run one group:

```bash
npm run test:local -- --suite legacy
npm run test:local -- --suite hosted
```

`legacy` is the suite name for single-owner self-hosted compatibility. The hosted group also runs security regressions. Neither group substitutes for the separate Clerk, UI, migration, delivery or maintenance checks above.

The existing `npm test` runs `scripts/e2e.mjs` against an already running server. Prefer `test:local` unless deliberately testing a disposable deployment: end-to-end suites create and mutate data. `test:production` and `test:production:single-origin` are read-only operator smoke checks targeting live origins, defaulting to the operated Hitchhike service. `test:production` also requires the hosted API's `/healthz` to report a `release` stamped at deploy time (see [Releases](#releases)). They are separate operator checks, not part of the newcomer quickstart or CI; inspect the script's target settings before running them for your own deployment.

## Run the dashboard locally

From the repository root, after `npm ci`:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` in your editor. Replace the sample `ADMIN_TOKEN` and `ENCRYPTION_KEY` with two different random local secrets. Keep `HOSTED=false`, `PUBLIC_URL=http://127.0.0.1:8787` and `ALLOW_DEV_AUTH=false`. You can leave the Google and Clerk fields empty for this single-owner mode. This file is gitignored; do not commit it.

You can generate the local secrets in a password manager. Alternatively, if OpenSSL is available, run this command twice, save the values separately and paste one into each setting in `.dev.vars`:

```bash
openssl rand -base64 32
```

Then apply migrations to the local database and start the Worker:

```bash
npx --no-install wrangler d1 migrations apply DB --local --config wrangler.selfhost.jsonc
npx --no-install wrangler dev --local --ip 127.0.0.1 --config wrangler.selfhost.jsonc --port 8787
```

Open [127.0.0.1:8787](http://127.0.0.1:8787) and enter the `ADMIN_TOKEN` you set in the dashboard's **Owner key** field. The Worker serves the dashboard and API together. Press Ctrl+C in the terminal to stop it. Wrangler retains local data in `.wrangler/` for your next run.

On macOS or Linux, `RELAY_URL=http://127.0.0.1:8787 npm run open` opens that dashboard. Set `RELAY_URL` explicitly for a different relay and sign in there. This helper does not read credential files or sign you in automatically; it accepts an HTTPS origin or an HTTP loopback origin, without a path, query, fragment or credentials.

This path uses the self-host template and a local database. Keep `--local` in these commands.

`ALLOW_DEV_AUTH` is a test-only hosted login bypass. Leave it `false` outside an isolated loopback test. Never enable it on a publicly reachable deployment.

## Find your way around

| Path | What lives there |
|---|---|
| [`src/`](../src/) | Shared Worker/API, authorization, task storage, MCP and self-hosted dashboard |
| [`migrations/`](../migrations/) | D1 schema and data migrations |
| [`web/`](../web/) | Separate hosted frontend and its build |
| [`cli/relay.mjs`](../cli/relay.mjs) | Terminal sender/worker commands; run `node cli/relay.mjs --help` |
| [`adapters/`](../adapters/README.md) | Connection instructions and client compatibility boundaries |
| [`scripts/`](../scripts/) | Local tests, fixtures and verification tools |
| [`SPEC.md`](../SPEC.md) | Task protocol, permissions, leases and result delivery |

The hosted frontend is built separately with `npm run build:web`, producing `web/dist` and `.vercel/output`. It reads four public settings: `HITCHHIKE_API_URL`, `HITCHHIKE_CLERK_FRONTEND_API`, `HITCHHIKE_CLERK_PUBLISHABLE_KEY` and `HITCHHIKE_SITE_URL` (the frontend's own HTTPS origin). The placeholders in [`web/config.public.json`](../web/config.public.json) point at `example.test`. Outside Vercel the build refuses to use them unless you pass `HITCHHIKE_ALLOW_EXAMPLE_CONFIG=1`:

```bash
HITCHHIKE_ALLOW_EXAMPLE_CONFIG=1 npm run build:web
```

A build with `VERCEL_ENV=production` requires all four values explicitly and rejects `example.test` configuration; `VERCEL_ENV=development` or `preview` still falls back to the example file. Only `HITCHHIKE_RELEASE` stamps the release: when it is set to a published snapshot tag matching `[A-Za-z0-9._-]{1,64}` (for example `v0.1.0`), the build adds `<meta name="hitchhike-release">` and a `Release <value>` footer link to that tag's release page on GitHub; without it, or with an invalid value, no release is shown. To inspect a build elsewhere, use `npm run build:web -- --output-root <temporary-directory>`; both output directories are created beneath that root. See [frontend configuration](hosted-operations.md#frontend-and-api-origins). Local self-hosted dashboard development does not need Vercel or Clerk. The Worker serves `/terms` and `/privacy` only in hosted mode; a self-hosted relay returns 404 for both and its dashboard does not link them.

## Releases

Development happens in the maintainer's private repository. The public repository at `https://github.com/davidspiegs/hitchhike` receives one squashed snapshot commit per release, tagged `vX.Y.Z`, produced by `scripts/release-snapshot.mjs`. The script exports the private checkout's tracked files only (gitignored `private/`, `*.local.jsonc`, `wrangler.production.jsonc` and `.dev.vars` are never included), refuses to run if the source tree is dirty, if the mirror's `origin` equals the source's `origin`, if the tag already exists, or if a forbidden path or secret pattern is present, then syncs the mirror working tree, commits `Release vX.Y.Z` and creates the annotated tag. It prints the push and deploy commands but does not run them.

1. Finish the change in the private repository and run the checks above.
2. Dry-run the snapshot into a clone of the public repository, then run it for real:

   ```bash
   npm run release:snapshot -- --mirror ../hitchhike-public --version vX.Y.Z --check
   npm run release:snapshot -- --mirror ../hitchhike-public --version vX.Y.Z
   ```

3. Review the result with `git -C ../hitchhike-public show --stat`, push `main` and the tag with the printed `git push origin main vX.Y.Z` command, and publish a GitHub release for that tag with notes describing what changed.
4. Set `HITCHHIKE_RELEASE=vX.Y.Z` in the Vercel project's Production environment and redeploy the frontend. Deploy the hosted Worker with the same tag, as described in [hosted operations](hosted-operations.md#deploy-and-operate): `npx --no-install wrangler deploy --config wrangler.hosted.local.jsonc --var HITCHHIKE_RELEASE:vX.Y.Z`.
5. Run `npm run test:production`. It fails if `GET https://api.hitchhike.dev/healthz` does not report a stamped `release`.

Hosted deployments should correspond to a published tag, so anyone can compare the hosted service with the published source. If the hosted service needs to run ahead of the last snapshot, cut a new snapshot first.

Publishing a snapshot never deploys anything; CI has no deploy credentials.

## Contribute

Small fixes, clearer setup instructions and reproducible client reports are welcome. For a larger change, start a discussion or issue explaining the use case and proposed behavior before building it. Send a pull request with what changed and how you checked it; run the relevant local checks above. Pull requests in the public repository are proposals: accepted changes are applied in the private repository and ship in the next snapshot, as described in [CONTRIBUTING.md](../CONTRIBUTING.md#how-the-public-repository-works).

Useful places to start include a confusing setup step, a missing client test or a focused regression case. A client report should name the product, connection mode and manual or scheduled pickup, and describe the expected result and actual behavior. Redact credentials and private task content.

Keep new examples pointed at loopback or clearly marked placeholders. Do not commit `.dev.vars`, tokens, database exports or real task histories. New provider documentation should distinguish a successful manual round trip from background execution, refresh and revocation checks.

CI verifies changes; it does not deploy, publish or touch a remote database. Treat local test results, real client round trips and cloud deployment checks as separate evidence.
