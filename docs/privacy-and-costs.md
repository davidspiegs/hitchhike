# Privacy and operating costs

[← Back to Hitchhike](../README.md)

The relay stores the task brief, provided context, results, connection settings and task events. It does not automatically ingest unrelated chats. The workspace owner and authorized task participants can access the relevant data; the hosting operator and infrastructure provider can technically access stored data. Credential encryption is not end-to-end encryption of task content. Each receiving AI provider processes whatever context is sent to its agent under that provider's terms and settings.

On a deployment using Clerk, Clerk processes account identifiers, verified email/profile information and authentication/session data. The selected social provider also processes its login. The relay retains an identity mapping and workspace ownership; task briefs, results and agent credentials must not be put in Clerk metadata. Self-hosted admin access does not require Clerk, and a direct-Google deployment uses its configured Google flow instead. Account deletion, backups and provider retention must be described for the actual deployment rather than presented as one universal deletion guarantee.

The relay does not pay for connected agents' model or computer-use subscriptions. Polling, database writes, logs and retained content still cost money and can consume the agent's own quota. A rate-limited free service can fit a small hosting budget, but measure request CPU, D1 rows read/written and payload retention before promising an unlimited service. The application currently references large artifacts by URL; hosted file uploads and coding VMs are outside the initial scope.

Managed authentication and social-provider APIs can add costs. Check your account’s plan, included social connections, usage allowances and current pricing before choosing a sign-in provider: [Clerk pricing](https://clerk.com/pricing) and [X API pricing](https://docs.x.com/x-api/getting-started/pricing). Measure actual usage and use the provider’s spending controls where available; a successful login does not establish its cost at scale.

For infrastructure, review current [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). A separate hosted frontend can also incur hosting costs. Self-hosted single-owner access needs neither Clerk nor a separate frontend host.

The operated service’s disclosures are its [privacy page](https://hitchhike.dev/privacy) and [terms](https://hitchhike.dev/terms).

The free beta uses explicit workspace allowances, shared admission limits and bounded metadata. See [operating the free beta](free-beta-operations.md) for the defaults, recovery behavior and remaining billing risks. These controls are not an unlimited-service promise or a guaranteed dollar spending cap.

## Dependency licenses

Hitchhike is licensed under the [MIT License](../LICENSE). Direct runtime dependencies declare MIT; runtime transitive dependencies also include Unlicense, BSD-2-Clause and 0BSD. Optional development dependencies include LGPL and mixed-license native packages. Preserve the applicable dependency licenses and notices when redistributing them.
