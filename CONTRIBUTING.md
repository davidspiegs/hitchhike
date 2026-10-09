# Contributing to Hitchhike

Setup fixes, clearer instructions, reproducible client reports and small pull requests are welcome. For a larger change, open an issue describing the use case and proposed behavior before building it.

## How the public repository works

`https://github.com/davidspiegs/hitchhike` is a snapshot of the maintainer's private working repository. Each release is published there as one squashed commit tagged `vX.Y.Z`; the public repository carries no development history. Pull requests opened there are not merged directly. Open an issue, or a pull request as a proposal, and if the change is accepted it is applied in the private repository, credited in the release notes and shipped in the next snapshot. CI in the public repository still runs on each snapshot, so the checks below reflect what was published.

## Set up and run the checks

Follow [Developing Hitchhike](docs/development.md). In short: Node.js 22.16+ (22.x) or 24+, then

```bash
git clone https://github.com/davidspiegs/hitchhike.git
cd hitchhike
npm ci
```

No Cloudflare login or AI-provider account is needed for the local checks. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the following on Node.js 22 and 24:

```bash
npm run typecheck
npm run test:auth
npm run test:clerk
npm run test:clerk-ui
npm run test:dashboard-ux
npm run test:connections
npm run test:inbox-http
npm run test:cli
npm run test:workflow
npm run test:migration
npm run test:web
npm run test:public-pages
npm run test:delivery
npm run test:maintenance
npm run test:next
npm run test:onboarding-review
npm run test:hardening
npm run test:release-snapshot
npm run test:local
```

Tests are plain Node scripts under [`scripts/`](scripts/) using `node:assert`. `test:local` creates disposable Wrangler configurations and databases on loopback ports and does not read your `.dev.vars` or any remote database.

## CI and forks

CI has read-only repository permissions, references no secrets, and does not deploy, publish or touch a remote database. Pull requests from forks run the same workflow, so they are safe to open.

## Pull requests

- Keep each pull request small and focused on one change.
- Add or extend the relevant unit script in `scripts/` and wire it into `package.json` and CI if it is new.
- In the description, say what changed, which checks you ran, and what you did not verify. The project deliberately separates verified claims from unverified ones; a local test result, a real client round trip and a cloud deployment check are different kinds of evidence, and a pull request should not present one as another.
- Keep examples pointed at loopback or clearly marked placeholders. Do not commit `.dev.vars`, tokens, database exports or real task histories.
- New provider documentation should distinguish a successful manual round trip from background execution, refresh and revocation checks.
- Client reports should name the product, connection mode and manual or scheduled pickup, with expected and actual behavior. Redact credentials and private task content.

## Hosted deployment

The hosted service at hitchhike.dev and api.hitchhike.dev is operated separately by the maintainer. Publishing a snapshot never changes it; deployments are a separate operator step. If you want to run your own relay, [Self-hosting](docs/self-hosting.md) is the supported path.

## Security

Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.

## License

Hitchhike is published under the [Elastic License 2.0](LICENSE). By submitting a change you agree that it may be included in Hitchhike under that license.
