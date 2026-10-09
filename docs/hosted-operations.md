# Operating a hosted instance

[← Back to Hitchhike](../README.md) · [Self-hosting without managed sign-in](self-hosting.md)

This is the multi-user operator guide for running your own hosted instance. The single-owner self-hosted relay needs neither Clerk nor Vercel.

Prepare a checkout using the [development instructions](development.md), then copy the example configuration and create a database in your Cloudflare account:

```bash
cp wrangler.hosted.jsonc wrangler.hosted.local.jsonc
npx --no-install wrangler login
npx --no-install wrangler d1 create my-hitchhike-hosted --config wrangler.hosted.local.jsonc
```

`wrangler.hosted.jsonc` uses the example name `my-hitchhike-hosted` and contains placeholders. In your gitignored copy, choose your Worker/database names, set the returned D1 `database_id`, replace `PUBLIC_URL` with your exact API origin and choose the identity provider below. Keep the database binding name `DB`. Use `wrangler.hosted.local.jsonc` in every `--config` command.

Set secrets through Wrangler's prompts rather than the configuration file. Generate a separate random `ENCRYPTION_KEY` in a password manager and store it with `npx --no-install wrangler secret put ENCRYPTION_KEY --config wrangler.hosted.local.jsonc`. Public hosted deployments require an encryption key of at least 32 characters and reject known sample values; missing or weak configuration fails closed. Leave `SIGNUP_MODE=public`, `ALLOW_DEV_AUTH=false` and do not set a hosted `ADMIN_TOKEN`.

### Human identity: Clerk or direct Google

`AUTH_PROVIDER=google` is the default. Set `AUTH_PROVIDER=clerk` explicitly to select Clerk; a broken configuration does not fall back to a different identity provider. These settings apply to hosted human sign-in. MCP authorization and paired worker credentials remain relay-managed in either hosted mode. Verify the identity provider and social login configuration for your instance after running the local tests.

For **direct Google**, register a Google OAuth web client with the exact redirect URI `<PUBLIC_URL>/auth/google/callback`. A separate `workers.dev` origin can be used in this mode. Configure the Google app for the intended public audience, then store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` through `wrangler secret put <NAME> --config wrangler.hosted.local.jsonc`.

For **Clerk**, create an application for your own deployment name and domain, and enable the sign-in methods you want to support. Require a verified email for every supported method. Configure the Worker using:

| Setting | Value |
|---|---|
| `AUTH_PROVIDER` | `clerk` |
| `PUBLIC_URL` | Exact canonical HTTPS origin of the relay API |
| `FRONTEND_URL` | Optional browser origin for a separate Clerk frontend; omit for single-origin/self-hosted deployments |
| `CLERK_PUBLISHABLE_KEY` | Publishable key for the selected Clerk instance |
| `CLERK_SECRET_KEY` | Matching backend secret, set with `wrangler secret put` |
| `CLERK_ISSUER` | Exact HTTPS Clerk Frontend API origin, with no path |
| `CLERK_JWT_KEY` | Optional public PEM verification key for that instance |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret for the Clerk lifecycle webhook described below |
| `CLERK_ALLOW_DEVELOPMENT` | `false` for public launch; explicit `true` permits development keys on a non-loopback preview |

Use keys and issuer from the same Clerk instance. Social client secrets belong in Clerk's provider configuration, not the Worker's direct-Google variables. Follow Clerk's production domain, DNS and social-provider requirements for a public deployment; a development instance has different constraints. See [Clerk environments](https://clerk.com/docs/guides/development/managing-environments), [Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google) and [GitHub setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/github).

If enabling X sign-in, follow [Clerk's X/Twitter v2 setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/x-twitter). Copy the exact Clerk redirect URI into the provider configuration and supply its OAuth 2.0 client ID and client secret to Clerk. Keep only the scopes required for sign-in.

Do not merge an existing direct-Google workspace into a Clerk account solely because their emails match. Plan and verify any identity migration before switching a populated deployment. Test all enabled login methods, logout/revocation, identity-provider failure, workspace access and signed-out MCP consent before promoting the change.

Configure a Clerk webhook endpoint at `<PUBLIC_URL>/auth/clerk/webhook` and subscribe to `user.updated`, `user.deleted`, `session.ended`, `session.revoked` and `session.removed`. Store its signing secret as `CLERK_WEBHOOK_SIGNING_SECRET`; the SDK verifies incoming signatures. User events invalidate the short profile cache and apply account restrictions/deletion, while session events revoke local access. The setting is optional for running the integration, but configure and verify lifecycle delivery before production. This inbound identity webhook is separate from agent wake webhooks.

Local logout and deletion block access immediately; failed provider cleanup is persisted and retried. Deletion removes relay workspace content and authorizations and requests deletion of that application's Clerk user, not the user's Google/GitHub/X account. The relay retains small one-way identity/session hashes to prevent deleted credentials recreating data. Pending provider cleanup also retains the Clerk issuer and opaque subject until completed; it does not retain raw credential tokens for that purpose.

### Deploy and operate

`SIGNUP_MODE` defaults to `public`. For restricted access, choose `SIGNUP_MODE=invite` and supply comma-separated `BETA_EMAILS`; an empty list then denies signup.

Apply migrations with `npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.hosted.local.jsonc` (the `npm run db:hosted:remote` shortcut runs the same command and expects that gitignored copy to exist) before explicitly deploying with:

```bash
npx --no-install wrangler deploy --config wrangler.hosted.local.jsonc --var HITCHHIKE_RELEASE:vX.Y.Z
```

`HITCHHIKE_RELEASE` stamps the published snapshot tag the deployment was built from (for example `v0.1.0`); the Worker accepts up to 64 characters of letters, digits, `.`, `_` and `-` and withholds anything else. `GET <PUBLIC_URL>/healthz` returns `{ ok: true, protocol: "0.1", release, version }`, where `release` is that stamped value (`null` when the variable is unset or invalid) and `version` is Cloudflare's version identifier for the running Worker deployment, read from the `version_metadata` binding `CF_VERSION_METADATA` that the template already declares (`null` if the binding is absent). `npm run test:production` (`scripts/split-production-smoke.mjs`) fails against a hosted API deployed without a stamped release. No command in CI deploys, publishes or touches a remote database. For a new instance, verify domain registration where required, real human/MCP authorization flows, provider round trips and recovery before inviting users.

The hosted configuration binds `RATE_LIMITER` at 120 requests per 60 seconds per application key. Choose a dedicated numeric namespace when copying deployments. This Cloudflare limiter handles bursts and is not an exact global monthly counter; database-backed workspace allowances remain separate.

`SERVICE_PAUSED=true` stops new work and in-progress mutations, including worker submissions and heartbeats. Existing stored results and exports remain readable. Resume the service before workers can complete in-flight tasks. Workspace pause provides the corresponding workspace-level control.

Hosted cron runs every five minutes and selects at most 20 workspaces with due work, in persisted rotation order. Each selected workspace attempts one scheduled task, processes at most 100 jobs per lease/expiry transition, and cleans up at most 100 rows per retention category. Failed schedules retain their original occurrence and idempotency slot, and back off from five minutes to at most one hour. Repeated permanent template/permission failures disable the schedule after three failures; quota and unexpected failures remain retryable. Success or an intentional schedule edit resets failure state. Repeated identical errors update the saved failure count without adding an activity event on every tick. Due sibling schedules and other workspaces remain eligible. Idle workspaces receive no maintenance calls or timestamp writes; the single indexed discovery query still reads workspace rows.

These are throughput bounds, not a five-minute delivery guarantee. With a stable backlog of `N` continuously due workspaces, one rotation normally takes `ceil(N / 20) * 5` minutes; multiple due schedules in one workspace need multiple rotations. Failures and new arrivals can extend that delay. Missed schedule slots coalesce into one current task. Retention marks content eligible for bounded cleanup, so deletion can also lag the configured cutoff. Monitor due-work age and database duration, and move dispatch to a durable queue before promising tighter timing or increasing throughput beyond these bounds.

The hosted maintenance workload is designed for Workers Paid. Check your account's current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and measure SQL use and CPU before increasing throughput. `npm run test:maintenance` covers idle discovery, fairness, cleanup bounds, pending account deletions and provider retries; those tests do not establish production cost or capacity.

**Hosted agent wake webhook setup and delivery are currently disabled.** Hosted pickup uses polling or an active MCP session. Setting `WAKE_ALLOWED_HOSTS` does not override that restriction. The delivery module retains a comma-separated **exact hostname** allowlist for legacy operator hardening and future reviewed support, such as `hooks.provider.example,api.provider.example`, with no wildcard/subdomain matching. Supported destinations require public HTTPS on port 443 without URL credentials, and redirects are not followed. The module's bounded retries use stable `X-Relay-Delivery-Id` values for receiver deduplication; this is not an exactly-once task execution guarantee.

## Frontend and API origins

A hosted instance can serve its dashboard from the Worker, or use a separate frontend. With a separate frontend, `PUBLIC_URL` is the exact canonical API origin and `FRONTEND_URL` is the exact browser origin. The frontend’s public configuration must match the backend’s `/auth/config`; it does not need Clerk backend secrets or relay encryption keys.

The checked-in [`web/config.public.json`](../web/config.public.json) contains example configuration. The build reads four public settings: `HITCHHIKE_API_URL` (the Worker's `PUBLIC_URL`), `HITCHHIKE_CLERK_FRONTEND_API`, `HITCHHIKE_CLERK_PUBLISHABLE_KEY` and `HITCHHIKE_SITE_URL` (the frontend's own origin, which the landing page, `robots.txt` and `sitemap.xml` use). For the separate Clerk frontend, provide your instance's public values when building:

```bash
HITCHHIKE_API_URL=https://api.example.com \
HITCHHIKE_CLERK_FRONTEND_API=https://clerk.example.com \
HITCHHIKE_CLERK_PUBLISHABLE_KEY=pk_live_REPLACE_WITH_YOUR_PUBLISHABLE_KEY \
HITCHHIKE_SITE_URL=https://www.example.com \
npm run build:web
```

All three URL values must be exact HTTPS origins with no path. Use the publishable key and Frontend API origin from the same Clerk instance as the backend. These are public frontend values; never pass a Clerk secret key to the build. Set all four values in the Vercel project's Production environment, and in Preview as well if preview deployments should run against a real backend. When `VERCEL_ENV=production`, the build fails if a value is missing or if the API origin, Clerk origin, site origin or decoded publishable key still points to `example.test`. When `VERCEL_ENV` is `development` or `preview`, missing values fall back to the example file. Outside Vercel, the build fails unless all four are set or `HITCHHIKE_ALLOW_EXAMPLE_CONFIG=1` explicitly allows the placeholders; see [local build notes](development.md#find-your-way-around).

The build also stamps the release. It reads only `HITCHHIKE_RELEASE`; set it in the Vercel project to the same published snapshot tag the Worker was deployed with. A value matching `[A-Za-z0-9._-]{1,64}` produces a `<meta name="hitchhike-release">` tag and a `Release <value>` footer link to that tag's release page on GitHub; when the variable is unset or invalid, both are omitted. Keep the Vercel value and the Worker's `--var HITCHHIKE_RELEASE:` equal so the footer link and `/healthz` `release` identify the same snapshot.

The build emits `web/dist` and the Vercel Build Output API directory `.vercel/output`. `test:web` uses separate temporary output and preserves both deployment directories. The Worker-served dashboard, including direct-Google and single-owner self-hosted modes, does not need that build. `/terms` and `/privacy` are served by the Worker only in hosted mode and return 404 from a self-hosted relay.

Test allowed and rejected origins, sign-in, consent, OAuth discovery, signed identity webhooks and a complete handoff after an origin change. Existing grants are bound to the API resource; changing an MCP URL can require reconnecting clients. Do not silently broaden old grants to a new resource.

Keep a coordinated record of frontend, Worker, domain routing and identity-provider settings before a cutover. Rolling back code alone does not restore DNS or the previous OAuth resource. Restore a compatible combination, verify its advertised discovery URLs and access controls, and reconnect clients as needed. Follow the [database and compatible-code recovery precautions](self-hosting.md#upgrades-and-recovery); never deploy pre-Clerk code against a database populated with Clerk sessions.
