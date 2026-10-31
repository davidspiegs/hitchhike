# Directory listings

How Hitchhike gets listed in the OpenAI, Anthropic and xAI directories: what each one requires, what Hitchhike already has, what is missing, and what only the operator can do. Requirements were read from the official pages on October 30, 2026. Directories change often, so recheck a requirement before relying on it.

| Directory | Path | Repo-side status |
|---|---|---|
| OpenAI plugin directory (ChatGPT and Codex) | ZIP upload at [platform.openai.com/plugins](https://platform.openai.com/plugins) | Package ready in `plugins/hitchhike` |
| Claude Connectors Directory | MCP connector at [claude.ai/directory/manage](https://claude.ai/directory/manage) | Copy ready below |
| Claude plugin directory (claude.ai, Cowork, Claude Code) | Plugin bundle at [claude.ai/directory/manage](https://claude.ai/directory/manage), from the public GitHub repo | Plugin ready; must reach the public repo first |
| Claude Code, self-distributed | `/plugin marketplace add davidspiegs/hitchhike` | Ready once in the public repo; no review |
| Codex, self-distributed | `codex plugin marketplace add davidspiegs/hitchhike` | Ready once in the public repo; no review |
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
- **Tool annotations.** Every tool now states `readOnlyHint`, `destructiveHint` and `openWorldHint`, and the `Tool` type requires all three. Values didn't change, and `openWorldHint` is `false` because tools only reach the owner's own workspace.

Checks:

```bash
npm run test:marketplace
claude plugin validate plugins/hitchhike --strict --profile directory
```

Both passed with nothing to report when these files were added. A test install into isolated Claude Code and Codex homes registered `https://api.hitchhike.dev/mcp`, and both reported that it needs authentication. Sign-in wasn't attempted.

## OpenAI: plugin directory for ChatGPT and Codex

ChatGPT and Codex share one directory, so one submission covers both ([plugins overview](https://developers.openai.com/plugins/build/plugins), [submission](https://developers.openai.com/plugins/deploy/submission)). A remote MCP server without UI qualifies; screenshots are only for servers that return UI ([submission errors](https://developers.openai.com/plugins/deploy/submission-errors)).

| Requirement | Source | Hitchhike |
|---|---|---|
| ZIP with a root `plugin.json` (Agent Plugins 1.0.0) and `mcp.json`; OpenAI fields under `extensions.com.openai` | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ `plugins/hitchhike` |
| Display name and subtitle ≤ 30 characters; long description ≤ 4,000; up to 3 starter prompts ≤ 128 characters with no @mentions; a category | [Submission field reference](https://developers.openai.com/plugins/deploy/submission) | ✅ Checked by `test:marketplace` |
| HTTPS website, support, privacy and terms URLs, identifying the same publisher as the submission | [Submission](https://developers.openai.com/plugins/deploy/submission) | ⚠️ Support goes to GitHub issues, which are public |
| Square icon, PNG/JPEG/WebP/SVG, 48–4096px, ≤ 5 MiB; `brandColor` ≥ 2:1 against white, dark ≥ 2:1 against `#212121` | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ `#EC5C20` measures 3.43:1 and 4.69:1 |
| OAuth 2.1 with S256 PKCE, protected-resource metadata or a `WWW-Authenticate` challenge, and authorization-server metadata. CIMD preferred; DCR supported | [Authentication](https://developers.openai.com/plugins/build/auth) | ✅ Live: 401 challenge, S256 and DCR. CIMD is merged (#17) and goes live with the next Worker deploy |
| Redirect: `https://chatgpt.com/connector_platform_oauth_redirect` when the server returns RFC 9207 `iss`, otherwise a per-callback URI | [Authentication](https://developers.openai.com/plugins/build/auth) | ✅ Advertises and returns `iss`. Nothing to allowlist: DCR accepts any HTTPS redirect, and CIMD accepts redirects on the client document's own origin |
| Domain verification: the exact token as plain text at `https://<mcp host>/.well-known/openai-apps-challenge` | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ Route added. Token pending: the operator sets it |
| `readOnlyHint`, `destructiveHint` and `openWorldHint` as explicit booleans on every tool | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines) | ✅ Every tool sets all three. ⚠️ See destructive sends below |
| Exactly 5 positive and 3 negative test cases, a reviewer-accessible demo video, release notes | [Submission](https://developers.openai.com/plugins/deploy/submission) | ✅ Cases and notes in `plugin.json`. Video pending |
| Demo account with a login and password: fully featured, with sample data, and no MFA, email or SMS codes, magic links or new sign-up | [Submission](https://developers.openai.com/plugins/deploy/submission), [guidelines](https://developers.openai.com/plugins/plugin-guidelines) | ❌ Not created. Sign-in uses Clerk; see Shared gaps |
| Publish under a verified individual or business name; EU-data-residency projects can't submit MCP plugins | [Review requirements](https://developers.openai.com/plugins/deploy/app-review) | ❌ Operator step |
| Privacy policy covering data categories, purposes, recipients, retention and controls | [Guidelines](https://developers.openai.com/plugins/plugin-guidelines) | ✅ `/privacy` covers these, including PostHog and Vercel Analytics |
| Review timeline, fees | Not stated. After publishing, people find the plugin by direct link or name search; featured placement is OpenAI's choice ([review requirements](https://developers.openai.com/plugins/deploy/app-review)) | — |

OpenAI-specific gaps and risks:

1. **Destructive sends.** The guidelines ask for `destructiveHint: true` on "irreversible sends". Hitchhike marks `send_job`, `send_message`, `reply_to_request` and similar tools as additive (`false`), which is the MCP meaning; only `cancel_job` is destructive. The automated scan may flag them, and findings can be appealed. Flipping them would add a confirmation to every send in Claude, which affects unattended runs, so it is a product decision rather than a listing fix.
2. **"Unofficial connectors… pass-through intermediary software layers" can't be approved** ([guidelines](https://developers.openai.com/plugins/plugin-guidelines)). Hitchhike is its own workspace service and calls no third-party API for the user, and the listing copy says so. Expect a reviewer to look closely all the same.
3. **The name is a single dictionary word.** The guidelines discourage these unless the word is clearly tied to the brand; `hitchhike.dev` is the tie.
4. **The MCP host can't change after publishing.** `https://api.hitchhike.dev/mcp` is permanent for this listing ([review requirements](https://developers.openai.com/plugins/deploy/app-review)).

## Anthropic: Claude Connectors Directory

Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector** ([submit a connector](https://claude.com/docs/connectors/building/submission)). A Pro, Max or Ultra account submits for itself; free accounts can't submit ([publish](https://claude.com/docs/directory/publish)). Every submission gets an automated policy scan and is listed as **Community** by default. Anthropic may escalate a listing to Verified review. "Review time isn't fixed" ([publish](https://claude.com/docs/directory/publish)). No fee is stated, and listing isn't guaranteed ([directory terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)).

| Requirement | Source | Hitchhike |
|---|---|---|
| Remote server over HTTPS | [Submission](https://claude.com/docs/connectors/building/submission) | ✅ |
| Every tool has a `title` plus the applicable `readOnlyHint: true` or `destructiveHint: true` | [Review criteria](https://claude.com/docs/connectors/building/review-criteria) | ✅ All 22 tools have titles and explicit hints |
| Tool descriptions must not tell Claude to call tools the user didn't ask for, or to pull behavioural instructions from external sources | [Review criteria](https://claude.com/docs/connectors/building/review-criteria) | ✅ #17 reworded the two descriptions that read as instructions. See relay instructions below |
| OAuth: DCR, CIMD (only if metadata advertises `client_id_metadata_document_supported: true`), or an Anthropic-held client. S256 required, 401 with `resource_metadata`, `resource` exactly matching the URL | [Authentication](https://claude.com/docs/connectors/building/authentication) | ✅ DCR, S256, exact `resource`, rotating refresh tokens with `invalid_grant`. CIMD, which the docs prefer for high traffic, is merged (#17) and goes live with the next Worker deploy |
| Callbacks: `https://claude.ai/api/mcp/auth_callback`; Claude Code uses loopback | [Authentication](https://claude.com/docs/connectors/building/authentication) | ✅ DCR and CIMD accept both. CIMD matches loopback callbacks on any port |
| Listing: name ≤ 100 characters, one-liner ≤ 200, description ≤ 2,000, 1–5 categories, documentation URL, privacy URL, support contact, icon, permanent slug | [Submission](https://claude.com/docs/connectors/building/submission) | ✅ Copy below. The icon has no published pixel spec, so use `marketplace/icons/hitchhike-icon-1024.png` |
| Reviewer test account: "credentials for a fully populated account" | [Submission](https://claude.com/docs/connectors/building/submission) | ❌ Same demo account as OpenAI |
| Privacy policy explaining data collection, use and retention | [Directory policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy) | ✅ |

**Relay instructions.** Hitchhike's job is to hand Claude a brief written by another assistant, so expect reviewers to read the tool descriptions closely. #17 rewrote `get_next_job` and `get_collaboration_config` to describe what they return rather than direct the next call, and a test keeps the operational guidance in the server `instructions`. Results are marked as untrusted task data. Tool changes reach a live listing without resubmitting ([after publishing](https://claude.com/docs/connectors/building/after-publishing)).

## Anthropic: plugin directory (claude.ai, Cowork and Claude Code)

The same portal takes a **Plugin bundle**, submitted from a GitHub repo that the connected GitHub account can push to. The repo may be private during review but must be public before the listing goes live. The limit is 10 submissions per organization per day ([submit a plugin](https://claude.com/docs/plugins/submit)). Blocking checks are a README of at least 40 words outside code blocks and a license file or field ([pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)). `claude plugin validate --profile directory` runs the local subset of these checks; it asks for a square 512–2048px PNG icon under 2 MB.

Hitchhike status: ✅ the plugin passes the strict directory profile. ❌ It isn't in the public repo yet: it reaches `davidspiegs/hitchhike` only through the release snapshot.

## xAI

### SpaceXSI Marketplace: Grok Bot and Cursor, with Grok chat "coming soon"

The [submission form](https://x.ai/bot/marketplace/submit-a-plugin) takes an MCP server URL or a public GitHub repo. It asks for name, work email, organization name and handle, a "1:1 SVG or PNG with a background plate" logotype URL, where to list, a description and testing instructions with test credentials. Submitting means agreeing to the [Publisher Terms](https://cursor.com/marketplace-publisher-terms), which require:
- your terms and privacy policy to be visible to all users,
- no training on or sale of plugin data,
- permissive open-source licenses,
- plugins that are free to users "directly or indirectly" (§3.1).

Cursor says its catalog is curated: it works with "a small group of trusted partners" ([marketplace security](https://cursor.com/help/security-and-privacy/marketplace-security.md)). No timeline is published.

Hitchhike status: ✅ MIT license, public privacy and terms pages, hosted MCP URL, square logo with a white plate. ⚠️ Accepting §3.1 constrains future pricing of the hosted service. ❌ Logotype URL: use the raw GitHub URL of `plugins/hitchhike/assets/icon.png` once the public repo has it.

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

Both need migration `0022` and a Worker deploy to go live. These remain, and they affect several directories:

1. **Reviewer sign-in.** Both OpenAI and Anthropic need a username and password that work without MFA, email codes or magic links. Clerk must allow password sign-in for the reviewer account, without new-device email verification.
2. **Support contact.** The only channels are a GitHub profile link (`/privacy`) and public GitHub issues (`/terms`). A support page or email address is safer for directories and keeps private details out of public issues.
3. **Minor.** `serverInfo.name` is `agent-connector`, while the title is already "Hitchhike". Also, `https://hitchhike.dev/favicon.ico` returns 404; some directories fetch a site favicon.

## Reviewer demo account

One seeded workspace serves OpenAI, Anthropic and xAI reviewers. Production gives new workspaces the conversation tools (`get_collaboration_config`, `send_message`, `check_conversation_inbox`, `preview_requests`, `claim_request`, `reply_to_request` and others). Its config sets `NEXT_RELEASE_DEFAULT_ENABLED` to `"true"`, unlike the `wrangler.hosted.jsonc` template. The OpenAI test cases name those tools, so leave them on in the demo workspace.

- A password sign-in account, used only for reviews, with no real data.
- Connection **ChatGPT**: can send and receive, may hand work to Research helper and accept work from it.
- Connection **Research helper**: can send and receive, takes `research` and `review` work.
- Seeded state. Create it by signing an MCP client, such as Claude Code, in to each connection in turn:
  - a conversation in which ChatGPT asked Research helper about the launch checklist, with Research helper's completed answer not yet acknowledged by ChatGPT;
  - two requests from Research helper to ChatGPT, waiting to be claimed. One is "Suggest three names for a team offsite"; the other should leave room for a budget question.
- Reset the seeded requests after each review round.

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

Only the operator can do these. Do them in order: the listings scan the live server and read the public repo.

**Before any submission**

1. Apply migration `0022` with `npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc`. Then deploy the API Worker, so that CIMD, in-place first connections, the annotations and the challenge route go live. Check that Vercel has deployed `main` for the frontend.
2. Publish to the public repo: `node scripts/release-snapshot.mjs --mirror ~/hitchhike-public --version v0.1.2`, then run the push commands it prints.
3. In the [Clerk dashboard](https://dashboard.clerk.com), allow password sign-in. Create the reviewer account and seed it as described in Reviewer demo account.
4. Record a short demo video covering the five positive test cases, and host it at an unlisted URL.
5. Decide on destructive sends and the support contact.

**OpenAI** ([submission guide](https://developers.openai.com/plugins/deploy/submission))

1. Complete individual verification for the publishing name in the [OpenAI Platform organization settings](https://platform.openai.com/settings/organization/general). Use a project with global data residency.
2. From `plugins/hitchhike`, run: `zip -r -X ~/Desktop/hitchhike-openai.zip plugin.json mcp.json skills assets README.md -x '*.DS_Store'`. The ZIP leaves out the Claude-only `.claude-plugin/` and `.mcp.json`.
3. Open [platform.openai.com/plugins](https://platform.openai.com/plugins) → **Upload new or existing plugin**, choose the verified identity, and upload the ZIP.
4. Under **MCPs → Connect**:
   1. Copy the challenge token.
   2. Set it on the API Worker: `npx wrangler secret put OPENAI_APPS_CHALLENGE --config wrangler.production.jsonc`.
   3. Confirm `https://api.hitchhike.dev/.well-known/openai-apps-challenge` returns the token.
   4. Verify, connect and sign in with the reviewer account.
   5. Resolve the scan findings.
5. Under **Review details**, add the demo video URL and the reviewer credentials.
6. **Submit for review**. Accepting the attestations is your call.
7. After approval, select **Publish**.

**Claude Connectors Directory** ([submission guide](https://claude.com/docs/connectors/building/submission))

1. Use a Pro, Max or Ultra Claude account.
2. Go to [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **MCP connector** → `https://api.hitchhike.dev/mcp`.
3. Fill the listing from the copy above and upload `marketplace/icons/hitchhike-icon-1024.png`.
4. Enter the reviewer credentials under **Test & launch**.
5. Accepting the compliance acknowledgements is your call. Then submit.

**Claude plugin directory** ([submission guide](https://claude.com/docs/plugins/submit))

1. Once step 2 of "Before any submission" is done, go to [claude.ai/directory/manage](https://claude.ai/directory/manage) → **Submit new** → **Plugin bundle**.
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
