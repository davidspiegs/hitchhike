# Directory listings

OpenAI approval is the current priority. This runbook separates installable packages from directory review readiness. OpenAI preparation was updated November 1, 2026; the Anthropic and xAI notes below retain the October 30 research and must be rechecked before those submissions.

Release audit baseline (November 1, 2026) and prepared candidate:

- At the audit baseline, production reported release **v0.1.3**. These version observations are dated evidence; verify current Worker and frontend deployments before claiming a change is live.
- At that baseline, the public repository contained the installable plugin from release **v0.1.3**, public commit `a695f3b`, with plugin manifest version **0.1.0**. Public-install observations below refer to this baseline.
- The prepared source package is plugin **0.1.1**, with corrected annotations and reproducible OpenAI cases. It is an **OpenAI submission candidate, not submitted or approved**. Actual host tests and a demo recording remain; no recording URL is ready.
- Intended publisher: **David Spiegel**, subject to platform identity verification. Availability: **all available countries**, represented by `publication.countries: []`. The package declares no purchases or payment processing.


| Directory | Path | Repo-side status |
|---|---|---|
| OpenAI plugin directory (ChatGPT and Codex) | ZIP upload at [platform.openai.com/plugins](https://platform.openai.com/plugins) | Plugin 0.1.1 in preparation; reviewer access, host tests, demo and portal checks remain |
| Claude Connectors Directory | MCP connector at [claude.ai/directory/manage](https://claude.ai/directory/manage) | Copy ready below |
| Claude plugin directory (claude.ai, Cowork, Claude Code) | Plugin bundle at [claude.ai/directory/manage](https://claude.ai/directory/manage), from the public GitHub repo | Public plugin 0.1.0 exists; updated 0.1.1 is unpublished |
| Claude Code, self-distributed | `/plugin marketplace add davidspiegs/hitchhike` | Public plugin 0.1.0 installs; self-distribution is not directory approval |
| Codex, self-distributed | `codex plugin marketplace add davidspiegs/hitchhike` | Public plugin 0.1.0 installs; self-distribution is not directory approval |
| SpaceXSI Marketplace (Grok Bot and Cursor; Grok chat "coming soon") | Form at [x.ai/bot/marketplace/submit-a-plugin](https://x.ai/bot/marketplace/submit-a-plugin) | Copy ready below |
| Grok Build plugin catalog | Pull request to [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) | Entry drafted below |
| Grok chat connectors (grok.com) | None. Its catalog lists only connectors maintained by xAI ([docs](https://docs.x.ai/grok/connectors)) | Nothing to build |

Anthropic's own Claude Code marketplace, `claude-plugins-official`, "doesn't take submissions through the directory portal" ([Claude Code docs](https://code.claude.com/docs/en/plugins/publish)); only an Anthropic partner contact can arrange a listing there. The portal's plugin bundle is the open path, and a listed plugin reaches Claude Code as `hitchhike@synced`.

## What's in the repo

- **`plugins/hitchhike/`**, one plugin folder that every host reads:
  - `.claude-plugin/plugin.json` and `.mcp.json` for Claude Code, the Claude plugin directory and Grok Build, which also accepts the Claude manifest.
  - `plugin.json` and `mcp.json` in the portable [Agent Plugins](https://agent-plugins.org) format, for the OpenAI directory, Codex and Cursor. `plugin.json` carries the OpenAI listing, the reviewer test cases and the release notes under `extensions.com.openai`.
  - `skills/delegate-to-agents`, an exact copy of `adapters/skills/delegate-to-agents`. `npm run test:marketplace` fails if the two drift.
  - `assets/icon.png` (1024px) and `assets/composer-icon.png` (256px, tighter crop for small sizes).
- **`.claude-plugin/marketplace.json`** and **`.agents/plugins/marketplace.json`**, the Claude Code and Codex marketplaces that point at that folder.
- **`marketplace/icons/`**: square SVG masters built from `web/landing/assets/hitchhike-bus-mark.svg` without redrawing it, plus PNG exports from 16 to 1024px. The white tile matches the bus artwork, which was drawn for a light background. Sizes 16 to 48 use `hitchhike-icon-small.svg`, which crops tighter so the bus stays readable. To regenerate: `rsvg-convert -w <size> -h <size> marketplace/icons/hitchhike-icon.svg -o marketplace/icons/hitchhike-icon-<size>.png`.
- **`GET /.well-known/openai-apps-challenge`** returns the `OPENAI_APPS_CHALLENGE` value as plain text, or 404 when it isn't set. OpenAI checks it to verify the MCP domain.
- **Tool annotations.** The prepared hosted catalog has 23 tools: 10 reads, 2 additive acknowledgment writes, and 11 destructive/irreversible operations. Ten earlier write classifications changed to destructive; `cancel_job` was already destructive. All destinations remain bounded to the owner's workspace (`openWorldHint:false`). Self-hosted `check_inbox` and `get_job` also advertise their existing maintenance effects. See the [annotation audit](openai-annotation-audit.md); these corrections still need deployment verification.

Checks:

```bash
npm run test:marketplace
claude plugin validate plugins/hitchhike --strict --profile directory
```

The initial Claude directory validation and isolated Claude Code/Codex installs passed for the earlier package; those installs only established registration and the need for authentication. Current preparation passes `test:marketplace` (11 checks), `test:mcp-conversations` (14 checks, including serialized annotations and scope filtering), and typecheck. Rerun validators against the exact final package. These local checks do not establish reviewer login, host execution or directory approval.

## OpenAI: plugin directory for ChatGPT and Codex

ChatGPT and Codex share one directory, so one submission covers both ([plugins overview](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission)). A remote MCP server without UI qualifies; screenshots are only for servers that return UI ([submission errors](https://developers.openai.com/plugins/deploy/submission-errors)).

| Requirement | Source | Hitchhike |
|---|---|---|
| ZIP with a root `plugin.json` (Agent Plugins 1.0.0) and `mcp.json`; OpenAI fields under `extensions.com.openai` | [Submission](https://developers.openai.com/plugins/deploy/submission) | Draft source in `plugins/hitchhike`; final archive awaits review materials and inspection |
| Display name and subtitle ≤ 30 characters; long description ≤ 4,000; up to 3 starter prompts ≤ 128 characters with no @mentions; a category | [Submission field reference](https://developers.openai.com/plugins/deploy/submission) | ✅ Checked by `test:marketplace` |
| HTTPS website, support, privacy and terms URLs, identifying the same publisher as the submission | [Submission](https://developers.openai.com/plugins/deploy/submission) | ⚠️ Support goes to GitHub issues, which are public |
| Square icon, PNG/JPEG/WebP/SVG, 48–4096px, ≤ 5 MiB; `brandColor` ≥ 2:1 against white, dark ≥ 2:1 against `#212121` | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ `#EC5C20` measures 3.43:1 and 4.69:1 |
| OAuth 2.1 with S256 PKCE, protected-resource metadata or a `WWW-Authenticate` challenge, and authorization-server metadata. CIMD preferred; DCR supported | [Authentication](https://developers.openai.com/plugins/build/auth) | v0.1.3 baseline advertises the 401 challenge, S256, DCR and CIMD. Complete reviewer OAuth on the exact submitted deployment |
| Redirect: `https://chatgpt.com/connector_platform_oauth_redirect` when the server returns RFC 9207 `iss`, otherwise a per-callback URI | [Authentication](https://developers.openai.com/plugins/build/auth) | ✅ Advertises and returns `iss`. Nothing to allowlist: DCR accepts any HTTPS redirect, and CIMD accepts redirects on the client document's own origin |
| Domain verification: the exact token as plain text at `https://<mcp host>/.well-known/openai-apps-challenge` | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ Route added. Token pending: the operator sets it |
| `readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans on every tool | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines) | All 23 prepared tools are explicitly classified; inspect the deployed catalog after release |
| Exactly 5 positive and 3 negative test cases, a reviewer-accessible demo video, release notes | [Submission](https://developers.openai.com/plugins/deploy/submission) | Revised cases and release notes are drafted. Actual host runs and a playable demo recording remain |
| Demo account with a login and password: fully featured, with sample data, and no MFA, email or SMS codes, magic links or new sign-up | [Submission](https://developers.openai.com/plugins/deploy/submission), [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | Dedicated account bootstrap is being prepared; fresh-browser password login, sample data and host access still require evidence |
| Publish under a verified individual or business name; EU-data-residency projects can't submit MCP plugins | [Review requirements](https://developers.openai.com/plugins/deploy/app-review) | Intended verified individual: David Spiegel. Platform identity verification remains an operator step |
| Privacy policy covering data categories, purposes, recipients, retention and controls | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines) | ✅ `/privacy` covers these, including PostHog and Vercel Analytics |
| Review timeline, fees | Not stated. After publishing, people find the plugin by direct link or name search; featured placement is OpenAI's choice ([review requirements](https://developers.openai.com/plugins/deploy/app-review)) | — |

OpenAI-specific gaps and risks:

1. **Corrected action classifications need release verification.** The prepared server marks irreversible sends, result/revision changes, claims and cancellation destructive. The two acknowledgment tools remain non-destructive because they add receipt state while preserving content. See the [tool-by-tool audit](openai-annotation-audit.md). Host confirmation behavior must be tested; labels do not guarantee a particular UI or grant permission.
2. **Service ownership and scope.** The guidelines restrict unofficial pass-through intermediaries. Hitchhike owns its workspace, queues, permissions and durable conversation history. Optional owner-configured activation can call a supported provider API, so do not claim that no third-party API is ever called. Describe the exact submitted deployment and its limitations accurately.
3. **The name is a single dictionary word.** The guidelines discourage these unless the word is clearly tied to the brand; `hitchhike.dev` is the tie.
4. **The MCP host can't change after publishing.** `https://api.hitchhike.dev/mcp` is permanent for this listing ([review requirements](https://developers.openai.com/plugins/deploy/app-review)).

## Anthropic: Claude Connectors Directory

Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector** ([submit a connector](https://claude.com/docs/connectors/building/submission)). A Pro, Max or Ultra account submits for itself; free accounts can't submit ([publish](https://claude.com/docs/directory/publish)). Every submission gets an automated policy scan and is listed as **Community** by default. Anthropic may escalate a listing to Verified review. "Review time isn't fixed" ([publish](https://claude.com/docs/directory/publish)). No fee is stated, and listing isn't guaranteed ([directory terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)).

| Requirement | Source | Hitchhike |
|---|---|---|
| Remote server over HTTPS | [Submission](https://claude.com/docs/connectors/building/submission) | ✅ |
| Every tool has a `title` plus the applicable `readOnlyHint: true` or `destructiveHint: true` | [Review criteria](https://claude.com/docs/connectors/building/review-criteria) | ✅ All 23 tools have titles and explicit hints |
| Tool descriptions must not tell Claude to call tools the user didn't ask for, or to pull behavioural instructions from external sources | [Review criteria](https://claude.com/docs/connectors/building/review-criteria) | ✅ #17 reworded the two descriptions that read as instructions. See relay instructions below |
| OAuth: DCR, CIMD (only if metadata advertises `client_id_metadata_document_supported: true`), or an Anthropic-held client. S256 required, 401 with `resource_metadata`, `resource` exactly matching the URL | [Authentication](https://claude.com/docs/connectors/building/authentication) | ✅ DCR, S256, exact `resource`, rotating refresh tokens with `invalid_grant`. CIMD is in the v0.1.3 baseline; verify the exact live authentication flow before submission |
| Callbacks: `https://claude.ai/api/mcp/auth_callback`; Claude Code uses loopback | [Authentication](https://claude.com/docs/connectors/building/authentication) | ✅ DCR and CIMD accept both. CIMD matches loopback callbacks on any port |
| Listing: name ≤ 100 characters, one-liner ≤ 200, description ≤ 2,000, 1–5 categories, documentation URL, privacy URL, support contact, icon, permanent slug | [Submission](https://claude.com/docs/connectors/building/submission) | ✅ Copy below. The icon has no published pixel spec, so use `marketplace/icons/hitchhike-icon-1024.png` |
| Reviewer test account: "credentials for a fully populated account" | [Submission](https://claude.com/docs/connectors/building/submission) | ❌ Same demo account as OpenAI |
| Privacy policy explaining data collection, use and retention | [Directory policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | ✅ |

**Relay instructions.** Hitchhike's job is to hand Claude a brief written by another assistant, so expect reviewers to read the tool descriptions closely. #17 rewrote `get_next_job` and `get_collaboration_config` to describe what they return rather than direct the next call, and a test keeps the operational guidance in the server `instructions`. Results are marked as untrusted task data. Tool changes reach a live listing without resubmitting ([after publishing](https://claude.com/docs/connectors/building/after-publishing)).

## Anthropic: plugin directory (claude.ai, Cowork and Claude Code)

The same portal takes a **Plugin bundle**, submitted from a GitHub repo that the connected GitHub account can push to. The repo may be private during review but must be public before the listing goes live. The limit is 10 submissions per organization per day ([submit a plugin](https://claude.com/docs/plugins/submit)). Blocking checks are a README of at least 40 words outside code blocks and a license file or field ([pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)). `claude plugin validate --profile directory` runs the local subset of these checks; it asks for a square 512–2048px PNG icon under 2 MB.

Hitchhike status: the original plugin passed the strict directory profile and is already public in release v0.1.3. The updated plugin 0.1.1 remains unpublished; rerun validation before its release. Claude submission is deferred while OpenAI approval is prepared.

## xAI

### SpaceXSI Marketplace: Grok Bot and Cursor, with Grok chat "coming soon"

The [submission form](https://x.ai/bot/marketplace/submit-a-plugin) takes an MCP server URL or a public GitHub repo. It asks for name, work email, organization name and handle, a "1:1 SVG or PNG with a background plate" logotype URL, where to list, a description and testing instructions with test credentials. Submitting means agreeing to the [Publisher Terms](https://cursor.com/marketplace-publisher-terms), which require:
- your terms and privacy policy to be visible to all users,
- no training on or sale of plugin data,
- permissive open-source licenses,
- plugins that are free to users "directly or indirectly" (§3.1).

Cursor says its catalog is curated: it works with "a small group of trusted partners" ([marketplace security](https://cursor.com/help/security-and-privacy/marketplace-security.md)). No timeline is published.

Hitchhike status: ✅ MIT license, public privacy and terms pages, hosted MCP URL, square logo with a white plate. ⚠️ Accepting §3.1 constrains future pricing of the hosted service. The icon is already in the public repository at `plugins/hitchhike/assets/icon.png`; verify the chosen raw URL before submitting.

### Grok Build plugin catalog

Open to pull requests: add one entry to `.grok-plugin/marketplace.json` that points at a public repo, pinned to a full 40-character commit SHA, then regenerate `plugin-index.json` and pass `scripts/validate-catalog.py` ([CONTRIBUTING](https://github.com/xai-org/plugin-marketplace/blob/main/CONTRIBUTING.md)). Remote entries can name a subfolder with `path`, and `.claude-plugin/plugin.json` is accepted. Review checks source legitimacy, and "a personal-account source for a branded plugin" is questioned. `davidspiegs/hitchhike` is a personal account, so expect that question; moving the public repo to an organization would answer it.

Draft entry. Fill in the SHA of the public release commit that contains `plugins/hitchhike`:

```json
{
  "name": "hitchhike",
  "description": "Send tasks, prompts and follow-ups to your other AI assistants (ChatGPT, Codex, Claude, Grok Bot, Muse) through Hitchhike's hosted MCP server, and pick up work they send back.",
  "category": "productivity",
  "source": {
    "source": "url",
    "url": "https://github.com/davidspiegs/hitchhike.git",
    "sha": "<40-character commit SHA>",
    "path": "plugins/hitchhike"
  },
  "homepage": "https://hitchhike.dev",
  "keywords": ["hitchhike", "hitchhike relay", "hitchhike.dev"],
  "domains": ["hitchhike.dev", "api.hitchhike.dev"]
}
```

### Grok chat connectors

There is no third-party submission path. grok.com's connector docs describe built-in connectors "maintained by SpaceXSI" and custom MCP connectors only ([connectors](https://docs.x.ai/grok/connectors)). Users keep adding Hitchhike as a custom connector, as `web/public-docs.ts` already explains. The form above lists Grok chat as "coming soon".

## Shared gaps

#17 fixed two earlier gaps:
- **First-time dead end.** A directory install uses the generic `https://api.hitchhike.dev/mcp`. New users can now create their first connection on the consent screen.
- **Registration ceiling.** CIMD is supported, and the DCR cap counts only unclaimed registrations.

Migration `0022`, the #17 fixes and the later #19 security correction shipped before the recorded v0.1.3 baseline. Do not repeat the old migration/deploy checklist as if those changes were still pending. Remaining preparation includes:

1. **Reviewer sign-in and fixtures.** Verify a dedicated synthetic account can sign in from a fresh browser and complete OAuth without inaccessible challenges. Keep global authentication safeguards intact; any supported review exception must be scoped to this account. A protocol/API rehearsal is separate from a ChatGPT/Codex review-case run.
2. **Support contact.** The only channels are a GitHub profile link (`/privacy`) and public GitHub issues (`/terms`). A support page or email address is safer for directories and keeps private details out of public issues.
3. **Minor.** `serverInfo.name` is `agent-connector`, while the title is already "Hitchhike". Also, `https://hitchhike.dev/favicon.ico` returns 404; some directories fetch a site favicon.

## Reviewer demo account

Use a dedicated **OpenAI** review account and synthetic workspace. Keep conversation tools enabled: the cases use `get_collaboration_config`, `send_message`, `check_conversation_inbox`, `preview_requests`, `claim_request` and `reply_to_request`. Later marketplace reviews can reuse the fixture design after access and isolation are separately verified.

- A verified-email password account containing no real user data. Store its login/password only in private operator storage and secure portal reviewer fields.
- **ChatGPT** and **Research helper** connections with send/receive permissions restricted to each other. Both support `task`, `research` and `review`; neither has a schedule, webhook or activation configured.
- A completed, unacknowledged **OpenAI review: Launch checklist** conversation from ChatGPT to Research helper, with the synthetic three-item checklist answer.
- Two queued requests from Research helper to ChatGPT: **OpenAI review: Offsite names** asks for three fictional offsite names; **OpenAI review: Offsite budget** deliberately omits its budget and expects a clarification question.
- Use exact current fixture IDs in secure setup notes, or select the newest active matching title. Reset only while no host test or reviewer is active. Preserve earlier history and refuse unknown work rather than canceling it implicitly.
- Pending fixtures expire after the normal three-day default. Verify readiness and refresh fixtures before submission and subsequent review rounds; account availability alone is insufficient. No refresh automation is implied.

A synthetic helper response verifies protocol behavior, not autonomous assistant execution. Record actual ChatGPT/Codex positive and negative case evidence separately, then capture the real demo.

## Listing copy

The OpenAI copy lives in `plugins/hitchhike/plugin.json`. The fields below are for the forms.

**Claude Connectors Directory**

- **Name:** Hitchhike
- **One-liner:** Let Claude hand tasks, questions and follow-ups to your other AI assistants, such as ChatGPT, Codex, Grok Bot and Muse, and get their answers back.
- **Description:** Hitchhike lets the AI assistants you already use work together. Connect it, then ask Claude to send a task, a question or a request for a second opinion to another assistant in your Hitchhike workspace: ChatGPT, Codex, Claude Code, Grok, Grok Bot or Muse. Later, ask Claude to check for the reply and bring the result back into your conversation. Claude can also pick up requests your other assistants send to it, ask a clarifying question and send back its answer. Each assistant works through its own account, tools and permissions. You decide which assistants can send work, which can receive it, who each one can hand work to and what kinds of work it takes. A request carries only the context Claude includes in it; Hitchhike does not copy your chat history or files. Hitchhike does not start other apps: a receiving assistant picks up a request when you use it or on a schedule you set up there, so replies can take time. Hitchhike is open source under the MIT License.
- **Categories:** Productivity; Developer tools (pick the closest matches the portal offers)
- **Documentation:** https://hitchhike.dev/docs/connect · **Privacy:** https://hitchhike.dev/privacy · **Support:** https://github.com/davidspiegs/hitchhike/issues, or a support address once one exists
- **Slug:** `hitchhike` (permanent)
- **Use cases:** reads and writes. Prerequisites: a Hitchhike account and at least one other connected assistant. First-time users create Claude's connection on the sign-in screen.
- **Authentication:** OAuth. Claude registers through CIMD and falls back to DCR. No Anthropic-held client.
- **Data handling:** your own API.
- **Example prompts:**
  - Which of my assistants can I hand work to through Hitchhike?
  - Ask one of my other assistants through Hitchhike to review this plan and send back the three biggest risks.
  - Check Hitchhike for replies to the work I sent.
  - Is any work waiting for me in Hitchhike? Pick up the next request and answer it.

**SpaceXSI Marketplace form**

- **Organization:** Hitchhike, handle `hitchhike`
- **Website:** https://hitchhike.dev
- **Listing:** Grok Bot, plus Cursor if wanted; Grok when it opens
- **MCP URL:** https://api.hitchhike.dev/mcp
- **Brief description:** Hitchhike lets Grok Bot send tasks, prompts and follow-ups to your other AI assistants (ChatGPT, Codex, Claude, Muse) and pick up work they send back. It uses an open-source, OAuth-protected MCP server.
- **Testing instructions:** the demo account above. Enter its credentials in the form, never in this repo.

## Operator checklist

Preparation can be assisted, but identity verification and legal attestations belong to the publisher. Complete review materials before uploading the final draft. Submission, approval and publication are separate milestones.

**Before OpenAI submission**

1. Finish and verify the dedicated review account, ordinary OAuth connection, bounded permissions and seeded fixtures. Do not weaken instance-wide authentication safeguards for the reviewer.
2. Rehearse the five positive and three negative cases in the supported host, recording actual results. Honor confirmations required for irreversible actions. Resolve failures and reset synthetic fixtures while the account is idle.
3. Record a real, short walkthrough with readable prompts and returned results. Host it at a reviewer-accessible URL, verify playback and permissions, and add `review.demo_recording_url` to the manifest. A script or screenshot is not a completed recording.
4. Finalize the support contact and verify website, support, privacy and terms pages. Confirm publisher **David Spiegel**, all-country availability (`countries: []`) and the no-commerce declaration in the saved metadata.
5. Release the approved server changes through the normal private deployment/public snapshot process, choosing the next actual repository release version rather than reusing v0.1.2. Verify the deployed code/catalog and public plugin 0.1.1 source. Rerun package checks on the exact final archive; do not publish private operating files or credentials.

**OpenAI** ([submission guide](https://developers.openai.com/plugins/deploy/submission))

1. Complete individual verification for **David Spiegel** in the [OpenAI Platform organization settings](https://platform.openai.com/settings/organization/general). Use a supported project with global data residency.
2. After the materials above are complete, create and inspect a ZIP rooted at `plugin.json`, `mcp.json`, `skills/`, `assets/` and `README.md`. From `plugins/hitchhike`: `zip -r -X ~/Desktop/hitchhike-openai.zip plugin.json mcp.json skills assets README.md -x '*.DS_Store'`. Keep private reviewer credentials and app bindings out of the archive.
3. Open [platform.openai.com/plugins](https://platform.openai.com/plugins) → **Upload new or existing plugin**, choose the intended verified identity, and upload the prepared ZIP as a draft. Inspect the imported listing, countries, review cases, release notes and demo URL.
4. Under **MCPs → Connect**, copy the portal's exact challenge token, set `OPENAI_APPS_CHALLENGE` on the production API Worker, and confirm `https://api.hitchhike.dev/.well-known/openai-apps-challenge` returns it as plain text. Complete verification and OAuth with the review account. Resolve required scans and run saved-version review checks.
5. Add the account login/password and precise connection/fixture instructions only in secure reviewer-access fields. Recheck fresh-browser access and usable sample data.
6. The authorized publisher completes attestations and submits for review. Record the actual submitted state; a successful upload is not submission or approval.
7. After approval, publish the approved release and verify its directory availability.

**Claude Connectors Directory** ([submission guide](https://claude.com/docs/connectors/building/submission))

1. Use a Pro, Max or Ultra Claude account.
2. Go to [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector** → `https://api.hitchhike.dev/mcp`.
3. Fill the listing from the copy above and upload `marketplace/icons/hitchhike-icon-1024.png`.
4. Enter the reviewer credentials under **Test & launch**.
5. Accepting the compliance acknowledgements is your call. Then submit.

**Claude plugin directory** ([submission guide](https://claude.com/docs/plugins/submit))

1. Once the intended plugin release is public, go to [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **Plugin bundle**.
2. Connect GitHub with push access to `davidspiegs/hitchhike`, and choose the `plugins/hitchhike` folder.
3. Answer the data questions and submit.

**SpaceXSI Marketplace**

1. Read the [Publisher Terms](https://cursor.com/marketplace-publisher-terms), especially §3.1, which requires the plugin to be free to users.
2. Fill the [submission form](https://x.ai/bot/marketplace/submit-a-plugin) from the copy above and submit.

**Grok Build catalog**

1. Fork [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace).
2. Add the draft entry with the public release commit SHA from `git ls-remote https://github.com/davidspiegs/hitchhike.git HEAD`.
3. Run `python3 scripts/generate-plugin-index.py` and `python3 scripts/validate-catalog.py`.
4. Open the pull request.
