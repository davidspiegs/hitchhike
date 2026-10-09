/** Public guides: one authored model renders both readable pages and agent-friendly text. */
type DocsConfig = { apiUrl: string; siteUrl: string; assets?: Record<string, string> };
type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "steps"; items: string[] }
  | { kind: "copy"; label: string; text: string }
  | { kind: "note"; title: string; text: string };
type Section = { id: string; title: string; blocks: Block[] };
type Guide = { path: string; label: string; title: string; description: string; sections: Section[] };
const REPOSITORY = "https://github.com/davidspiegs/hitchhike";
const UPDATED = "October 4, 2026";
const paragraph = (text: string): Block => ({ kind: "paragraph", text });
const list = (...items: string[]): Block => ({ kind: "list", items });
const steps = (...items: string[]): Block => ({ kind: "steps", items });
const copy = (label: string, text: string): Block => ({ kind: "copy", label, text });
const note = (title: string, text: string): Block => ({ kind: "note", title, text });

export const publicPrompts = (siteUrl: string) => ({
  explain: `Read ${siteUrl}/docs.md and explain how Hitchhike could help the AI assistants I already use work together. Give me a few practical examples based on their actual tools, and explain what setup and background work would require. Ask which assistants I use if you need to.`,
  setup: `Help me connect my assistants through Hitchhike using ${siteUrl}/docs/connect and ${siteUrl}/docs.md. Check which assistant and device I’m using, reuse an existing connection where possible, and guide me through Connect and Ready. Use my connection’s own guide and short introduction, including the optional schedule I select. Help me finish setup and explain any account, permission, or scheduling limitation we encounter.`,
  ongoing: "If helpful, you may use my connected Hitchhike assistants to offload tasks, work on research, collaborate, or get a second opinion. Use your judgment about whether to involve them and which assistant fits the work. Load my current Hitchhike settings, share relevant context within my permissions, and bring useful replies back into the task. There’s no need to delegate every request.",
});

function guides(config: DocsConfig): Guide[] {
  const mcp = new URL("/mcp", config.apiUrl).href;
  const prompts = publicPrompts(config.siteUrl);
  return [
    {
      path: "/docs", label: "Start here", title: "A little help from your other assistants",
      description: "Hitchhike connects the AI assistants you already use, so they can exchange work without you carrying every prompt and answer between apps.",
      sections: [
        { id: "how-it-works", title: "The connection between your assistants", blocks: [
          paragraph("You keep working with your assistant in its own app. It can send a request to a connected assistant through Hitchhike, receive an answer, ask a follow-up, and keep the exchange together. Each assistant uses its own tools and account."),
          list("Ask another assistant to check a plan or offer an independent view.", "Hand off a research task to an assistant with useful sources or browser tools.", "Let a coding assistant use findings from another assistant while it continues your project."),
          paragraph("Explore [use cases and optional prompts](/docs/use-cases): a more proactive ChatGPT, sharing the workload across accounts, browser tasks, and a second opinion before a build."),
          paragraph("You choose who may collaborate, what context they may share, and what work they may do. Any permitted assistant can ask another for help; there are no permanent lead and worker roles."),
        ] },
        { id: "getting-started", title: "Connect, then you’re ready", blocks: [
          steps("Open [Your agents](/sign-in) and choose **Connect an assistant**. Select the assistant, the place you use it, and whether you want background checks.", "Follow **Connect → Ready** using that connection’s own guide. For an MCP assistant, connect and paste its short introduction. For Muse or Grok Bot, one private pairing paste also loads your preferences and requests the selected schedule.", "Finish setup. Connect another assistant when you want them to work together; a test exchange is optional."),
          paragraph("The [connection guide](/docs/connect) covers the provider steps. Your introduction includes any selected [background checks](/docs/background), so there is no separate schedule prompt to copy."),
        ] },
        { id: "ask-your-agent", title: "Prefer to work through your assistant?", blocks: [
          paragraph("Copy one of these prompts into the assistant you already use. They contain no credentials and work as a starting point before you connect."),
          copy("Explain Hitchhike to me", prompts.explain),
          copy("Help me get connected", prompts.setup),
        ] },
        { id: "what-to-expect", title: "What to expect", blocks: [
          list("**Your apps do the work.** Hitchhike carries requests and replies; it does not provide a model or a computer for your assistants.", "**Connecting is not waking.** An assistant must be active or have a supported, configured way to check for work.", "**Usage stays with each service.** Your providers keep their own plan rules and limits; some products share an allowance. Hitchhike does not combine credits or bypass limits.", "**The hosted beta is free, with limits.** Availability and workspace limits can change. Your assistants’ subscriptions remain separate."),
          paragraph("For data handling and retention, read [Using Hitchhike](/docs/using-hitchhike#history-and-retention) and the [privacy page](/privacy)."),
        ] },
      ],
    },
    {
      path: "/docs/use-cases", label: "Use cases", title: "Put your other assistants to work",
      description: "Keep your main assistant in the conversation. Let connected agents take on work, bring another perspective, and make more of the accounts you already have.",
      sections: [
        { id: "proactive-chatgpt", title: "A more proactive ChatGPT, even on Plus", blocks: [
          paragraph("Want some of the follow-through of a dot without a Pro plan? Give ChatGPT an ongoing responsibility, connect a helper such as Muse or Grok Bot, and use a supported recurring task to pick up replies and move the next step forward. For example: keep a shortlist of potential customers up to date and bring you the promising additions."),
          paragraph("OpenAI documents **hourly Scheduled tasks on eligible paid accounts**, including Plus. Hitchhike’s ordinary ChatGPT path is experimental: its tools must be available and permitted in the actual scheduled run. This gives you scheduled follow-through, rather than the full Dots experience. See [ChatGPT task availability](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)."),
          copy("Try an ongoing responsibility", "Help me keep a shortlist of potential customers up to date. If helpful, you may use my connected Hitchhike assistants to offload research, collaborate, or get a second opinion. Use the customer criteria and sources we agree on. If background checks are enabled in my Hitchhike introduction, use that schedule and reuse a matching active task. Report its saved status, next run, or any account limitation. Bring me useful additions or decisions that need me; keep quiet when nothing has changed."),
          paragraph("Choose background checks for each helper during setup. The same introduction requests the selected schedule; the provider reports whether it could save it. An hourly check can add almost an hour at each end. If you want to observe the full exchange, use the [optional background diagnostic](/docs/background#verify-background)."),
        ] },
        { id: "share-the-workload", title: "Let your Dot delegate a build to Claude Code", blocks: [
          paragraph("Your Dot can hold the brief and coordinate the project while a connected Claude Code session implements it. With Claude Code signed into your Claude subscription, the build uses that account’s allowance, leaving Codex capacity for the work you choose to run there. It is especially useful when one account is close to its limit and another has room."),
          copy("Try delegating a build", "Help me build the feature we’ve outlined. If Claude Code is a good fit, you may delegate the implementation to my connected Claude Code agent through Hitchhike. Give it the agreed brief and relevant project context, let it ask questions, and bring back the changes and test results for review. Keep track of the work here so I don’t have to carry messages between apps."),
          paragraph("Connect Claude Code in the environment with repository access, then keep it checking Hitchhike in an active session or configure a supported recurring runner. Hitchhike’s hosted Claude Code wake adapter is currently disabled; a relay message does not launch a new Code session by itself. See [coding-agent setup](/docs/connect#coding-agents) and [background options](/docs/background#other-runners)."),
          paragraph("Your Dot still uses its own allowance to plan, send requests, and review results. Savings vary with the task and amount of back-and-forth; allowances are not pooled. Codex execution counts toward its applicable limits, as described in [OpenAI’s usage guide](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan). Claude Code configured with an API key or cloud provider uses that service’s billing instead of a Claude subscription; see [Claude usage and costs](https://code.claude.com/docs/en/costs)."),
        ] },
        { id: "browser-work", title: "Offload the long browser sessions", blocks: [
          paragraph("Comparing dozens of vendors, checking product pages, or gathering a directory can take many browser steps. Let your Dot define the goal and hand that legwork to Muse or Grok Bot, then use the returned findings to help you decide."),
          copy("Try handing off browser work", "Help me compare the vendors on this shortlist. If helpful, you may ask Muse or Grok Bot through Hitchhike to visit their sites, gather current pricing and relevant features, and return source links. Then help me weigh the tradeoffs. Use whichever connected agent has the right access and room for the task."),
          paragraph("**Muse has a free tier**, with usage limits. **Grok Bot is included in eligible Cursor and SuperGrok subscriptions**, with its own allowance and optional paid usage. Both offer cloud browser work that can continue while your laptop is closed. Check [Muse’s current offering](https://ai.meta.com/muse/) and [Grok Bot’s plans](https://cursor.com/help/grok-bot/plans) when choosing a helper."),
          paragraph("The helper uses its own browser, apps, and permissions. Hitchhike does not transfer your Dot’s computer access or signed-in browser sessions. Local computer work needs that provider’s supported access and an available device; cloud work uses the provider’s environment. See [Muse’s tools](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) and [Grok Bot’s computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)."),
        ] },
        { id: "review-before-building", title: "Bring in another model before the build", blocks: [
          paragraph("Ask Claude to review your Dot’s proposed approach before it sends work to Codex. Claude can challenge assumptions, flag missing requirements, and suggest better checks. Your Dot can weigh that feedback and improve the brief before implementation begins."),
          copy("Try a review before implementation", "Help me turn this idea into a build plan. Before sending it to Codex, ask my connected Claude agent through Hitchhike to review the approach, question assumptions, and point out missing requirements. Consider its feedback and improve the brief where it helps, then give Codex the resulting plan. Bring any important unresolved decisions back to me."),
          paragraph("You can choose a reviewer such as **Claude Fable 5.1 or Opus 5.5 at max effort**, where your Claude surface and plan support it. Configure the model and effort in the receiving provider; Hitchhike does not select them for you. See [Claude effort settings](https://code.claude.com/docs/en/model-config#adjust-effort-level). The same pattern works for a difficult email, proposal, or research conclusion."),
          paragraph("Dots already uses GPT-6 Astra and can delegate parallel work, according to [OpenAI’s Dots guide](https://learn.chatgpt.com/docs/dots). Adding Claude brings another model’s perspective and tools into that workflow."),
        ] },
        { id: "research-team", title: "Build a lead list across several assistants", blocks: [
          paragraph("Split a research project into useful pieces: Muse finds companies, Grok Bot looks for contacts, and your main assistant checks the assembled list. Each request can include the findings from the previous step, so you do not have to keep pasting context between apps."),
          copy("Try a small research team", "Help me build a lead list. Ask Muse through Hitchhike to find US companies that announced a Series A in the past 90 days, with dates and source links. Then ask Grok Bot to find founders and public business contact details for those companies. Review the combined list, fill any gaps you can, and if helpful ask my connected GPT-6 Astra agent in Codex for another research pass. Keep unknown details marked as unknown and bring me a concise, sourced shortlist."),
          paragraph("Use the helper’s actual research access and share the relevant brief and results. You can set up the same pattern for vendor comparisons, interview preparation, or a draft that needs a fresh reader. There is no need to involve every assistant in every task."),
        ] },
        { id: "make-it-yours", title: "Make it fit the way you work", blocks: [
          paragraph("These are starting points, not fixed roles. Your Dot can usually coordinate, Grok Bot can usually be available to help, and either can ask another permitted assistant for input when it makes sense. Save those preferences in [agent configuration](/docs/using-hitchhike#working-preferences)."),
          copy("Give your assistant room to decide", prompts.ongoing),
          paragraph("Start with [two connected assistants](/docs/connect) and give them useful work. Select a schedule during setup if you want follow-through while you are away. Each provider’s permissions and usage limits still apply."),
        ] },
      ],
    },
    {
      path: "/docs/connect", label: "Connect assistants", title: "Connect the assistants you use",
      description: "Choose the right app and surface first. Your saved setup guide supplies the connection details and lets you return to unfinished steps.",
      sections: [
        { id: "before-you-start", title: "Before you start", blocks: [
          paragraph("In [Your agents](/sign-in), create or open the connection for the assistant you want to use. Choose its surface: chat, desktop, terminal, or cloud. An existing connection is usually the right place to continue."),
          paragraph("**Copy the MCP URL or command from your connection’s own guide.** On the hosted service, that connection-specific URL carries its identity into authorization. Sign in and confirm access; the connection is already selected. Self-hosted connections use the URL supplied by their own guide."),
          paragraph(`The [generic hosted MCP endpoint](${mcp}) remains available for compatibility. It asks you to choose a connection explicitly during authorization. Prefer your connection’s own guide for new setup.`),
          paragraph("Setup follows **Connect → Ready**. The short introduction loads your saved preferences and requests the optional schedule you selected. You can finish setup without sending a test request; observed access, exchanges, and background runs are shown separately."),
          note("On a phone", "Some providers require desktop web or the computer running a local agent to add a connection. Save your progress and continue there if the required control is missing. Provider labels and availability vary by account, workspace, and app version."),
        ] },
        { id: "chatgpt-and-dots", title: "Dots and ChatGPT", blocks: [
          steps("Check your personal ChatGPT plugins for an existing Hitchhike connection. To create one, use desktop web: **Settings → Security and login → Developer mode**, then **Plugins → Add (+)**. Enter the MCP server URL from your connection’s own Hitchhike guide.", "Complete Hitchhike authorization for the connection already selected by that URL. Open the new plugin in your personal Plugins list and install it if an install (+) action is shown. This is a custom personal plugin; you do not need a public Hitchhike directory listing.", "For **Dots**, select the plugin in the intended dot’s **Customize → Plugins** controls. For **ChatGPT**, the documented route is a new **Work** chat. Select or @mention Hitchhike in the conversation that will use it.", "On **Ready**, give that assistant the short introduction. It checks the connection, loads your current preferences, and requests any selected schedule. Finish setup."),
          paragraph("Dots and ChatGPT can share one authenticated connection. A different display name does not make them separately addressable destinations, and a reply is not automatically copied into both chats. Ordinary ChatGPT use remains experimental; verify the tools in the actual conversation."),
          paragraph("ChatGPT chat starts with an hourly schedule requested; Dots starts without a fixed schedule. Change or turn off that choice before copying the introduction. If you use both with one connection, choose which will own the schedule and introduce the other without requesting a duplicate."),
          paragraph("Provider reference: [OpenAI custom plugin quickstart](https://developers.openai.com/plugins/quickstart) and [Dots getting started](https://learn.chatgpt.com/docs/dots/getting-started)."),
        ] },
        { id: "claude", title: "Claude chat", blocks: [
          steps("Open **Customize → Connectors → Add → Add custom connector** (some versions use Settings). Enter Hitchhike and the MCP URL from your connection’s own guide. A managed workspace may need its owner to add the connector first.", "Continue through authentication. Choose **Sign in now** when offered. If Claude asks how to identify its OAuth client, choose **Register automatically**, which matches Hitchhike’s registration flow. Sign in to Hitchhike and confirm access to the connection already selected by its URL.", "Enable Hitchhike in the intended conversation through **+ → Connectors**. On **Ready**, paste the short introduction and finish setup. It includes the hourly schedule requested by default, unless you change or turn off that option."),
          paragraph("Some accounts expose these controls on mobile; if yours does not, continue on web or desktop. Claude chat’s connector and Scheduled tasks are separate from local Claude Code configuration and Code cloud routines."),
          paragraph("Provider reference: [Claude custom remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)."),
        ] },
        { id: "grok-chat", title: "Grok chat", blocks: [
          steps("Open [Grok connectors](https://grok.com/connectors), choose **New Connector → Custom**, and enter Hitchhike with the MCP URL from your connection’s own guide.", "Sign in to Hitchhike and confirm access to the connection already selected by that URL. Enable the connector in your intended Grok conversation.", "On **Ready**, paste the short introduction and finish setup. It loads your preferences and requests the selected schedule; hourly is the starting choice for Grok chat."),
          paragraph("Grok chat and Grok Bot are separate products and use different setup paths. Scheduling and connector access depend on the actual account; Grok should report any limitation when it receives the introduction."),
          paragraph("Provider reference: [Grok custom connectors](https://docs.x.ai/grok/connectors)."),
        ] },
        { id: "coding-agents", title: "Codex and Claude Code", blocks: [
          paragraph("Use the surface-specific guide on the computer where the agent runs. Copy its exact command or URL so authorization opens for the right connection. For Codex CLI, use the guide’s add-server and login commands. For Claude Code, use its add-server command, then open **/mcp** to authorize Hitchhike."),
          paragraph("Inspect an existing Hitchhike MCP entry before adding another. Codex desktop may offer **Settings → MCP servers**; the terminal route is a fallback on the same computer. Refresh the client’s tools, then use the short introduction on **Ready** and finish setup."),
          note("Cloud is a separate setup", "Local MCP configuration does not prove access in a cloud session. Use the cloud route in your guide and verify tools there. Hitchhike’s Claude Code wake adapter is currently disabled on the hosted service."),
          paragraph("Provider references: [Codex MCP](https://developers.openai.com/codex/mcp) and [Claude Code MCP](https://code.claude.com/docs/en/mcp)."),
        ] },
        { id: "grok-bot-and-muse", title: "Grok Bot, Muse, and other HTTP assistants", blocks: [
          paragraph("Choose the assistant in Hitchhike and give it the generated, one-use pairing instructions. The agent needs authenticated HTTP tools and private credential storage."),
          paragraph("Keep pairing instructions private. If a code expires, generate another in the same connection’s setup page. If the provider cannot securely store its credential, setup is incomplete. Grok chat and Grok Bot are different products; a Bot routine does not establish support in Grok chat."),
          paragraph("The private pairing paste also loads your saved preferences and requests the schedule you selected. Muse and Grok Bot start with a check every **10 minutes requested**; change or turn it off before copying. This is a requested preference, not a documented provider minimum. The assistant reports whether it saved the schedule or encountered a limitation; there is no second introduction or background prompt to paste."),
          paragraph("Provider references: [Grok Bot skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) and [Muse recurring tasks](https://www.meta.com/help/artificial-intelligence/1484325780075655/)."),
        ] },
        { id: "first-exchange", title: "Optional: observe an exchange", blocks: [
          paragraph("You can finish setup and request a schedule without running a test exchange. If you want to check collaboration, ask one assistant to send a small, harmless request to another. If the recipient is on demand, ask it to check once. Have it reply, then ask the sender to retrieve the answer in the same exchange."),
          paragraph("Connection access, a saved schedule, and observed exchanges are separate evidence. A queued request is waiting for pickup; an answer being ready is different from the sender having retrieved it. See [troubleshooting](/docs/troubleshooting) if a step stops."),
        ] },
      ],
    },
    {
      path: "/docs/using-hitchhike", label: "Work together", title: "Let your assistants use their judgment",
      description: "You decide who may collaborate and what they can share. The assistants decide when that help is useful within those boundaries.",
      sections: [
        { id: "working-preferences", title: "Give them a useful starting point", blocks: [
          paragraph("An agent’s configuration offers optional, editable preferences such as **Use your judgment** or **Be available to help**. Describe its useful tools and responsibilities; a different model is not automatically better at every task."),
          copy("Optional ongoing-use prompt", prompts.ongoing),
          paragraph("For a connected assistant, prefer the short introduction generated by its setup page. It includes the exact connection identity and any selected schedule. Current configuration and tool guidance are retrieved when work starts or continues; you do not need to paste a protocol manual into every chat."),
        ] },
        { id: "permissions", title: "Choose collaborators and permissions", blocks: [
          list("**In Hitchhike:** choose permitted collaborators, work categories, sharing preferences, responsibilities, and actions that need further approval.", "**In the provider:** allow the specific Hitchhike tools needed by your workflow. Interactive sends may ask for approval. Unattended sends and claims cannot proceed while waiting for you.", "**For external actions:** the receiving assistant’s own tool permissions still apply. Permission to send a relay message does not authorize unrelated changes elsewhere."),
          paragraph("ChatGPT’s Hitchhike-specific **Allow all actions** setting, where offered, allows sends and claims that **Allow low-risk actions** may block. Claude offers **All tools → Always allow**, or individual tool choices. Choose the relay actions you want to authorize; other apps retain their own settings."),
          paragraph("Provider references: [ChatGPT app permissions](https://help.openai.com/en/articles/20001495-managing-app-permissions-in-chatgpt) and [Claude connector permissions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)."),
        ] },
        { id: "context-and-follow-ups", title: "Keep the context with the work", blocks: [
          paragraph("Supply the task, relevant context, and what a useful answer should accomplish. The recipient can ask a clarification, return an answer, and receive a revision request within the same conversation. Previous messages remain attributed to their sender."),
          paragraph("Share relevant task context and explicitly approved sources. Hitchhike does not automatically ingest whole chats. Its recipient and work-category restrictions are enforced by the relay; sharing preferences guide the assistants and cannot reliably classify every piece of arbitrary text."),
          paragraph("Text, pinned context, and links are supported. Hosted attachments and collaborative document editing are not included. Long histories are paginated; an assistant can retrieve earlier answers instead of assuming they disappeared."),
        ] },
        { id: "activity-and-stopping", title: "See what is happening", blocks: [
          paragraph("Use **Activity** to inspect requests and replies, clarify work, and understand failures. Connection access, a successful exchange, and observed background activity are separate milestones."),
          paragraph("Stopping a work chain prevents further relay dispatch and invalidates pending claims. It cannot guarantee that work already running in another provider stops immediately. Follow that provider’s controls if you need to stop its current execution."),
          paragraph("Work limits pause additional requests; replies and clarification are part of the existing exchange. Follow the displayed limit and retry guidance instead of creating another account or chain to get around it."),
        ] },
        { id: "history-and-retention", title: "History and retention", blocks: [
          paragraph("The default retention period is **30 days after the conversation’s last message**, with no deletion while requests are outstanding. The conversation shows its policy and expiry. Read or save useful results before that expiry."),
          paragraph("Reading a reply does not delete its conversation. Supported clients track scheduled and interactive checks separately so one does not hide the other’s unread replies. They still share the same authenticated connection."),
          paragraph("Hitchhike stores the context and replies sent through it. The workspace owner and authorized participants can access relevant data, and the hosting operator can technically access stored content. Each receiving provider handles supplied context under its own terms. See [Privacy](/privacy) and [Terms](/terms)."),
        ] },
      ],
    },
    {
      path: "/docs/background", label: "Background checks", title: "Keep work moving when you step away",
      description: "Choose optional background checks during setup. Your assistant receives the selected schedule in its introduction and reports whether its app can save it.",
      sections: [
        { id: "connecting-is-not-waking", title: "Choose the schedule in the same setup", blocks: [
          paragraph("Choose or turn off background checks before copying your introduction. It asks the assistant to create the selected schedule, reuse a matching active task, leave paused tasks paused, and report whether it saved the task, its next run, or a limitation. Muse and Grok Bot receive that request in the same private pairing paste."),
          paragraph("There is no separate background setup or run prompt to paste. You can finish setup without a manual exchange or scheduled-run test. Hitchhike records the requested preference; the provider creates the task, and actual runs are observed separately."),
          list("**Claude, Grok, and ChatGPT chat:** hourly is the requested starting choice, subject to the account’s scheduling and connector support.", "**Muse and Grok Bot:** every 10 minutes is the requested starting choice. Their documentation does not establish this as a minimum or guarantee this cadence.", "**Dots:** no fixed schedule is selected by default. Choose one only if you want it.", "**Local coding agents:** use an available runner or schedule in the environment where they run."),
        ] },
        { id: "claude-hourly", title: "Claude chat: an hourly Scheduled task", blocks: [
          paragraph("For Claude chat, the introduction requests an hourly task under **Scheduled** unless you select another option or turn it off. Claude should include the Hitchhike connector and report the saved task or limitation. Scheduled tasks are available in Cowork and eligible versions of the new Claude experience; your account’s controls determine what is available."),
          paragraph("An hourly receiver may take nearly an hour, plus provider delays, to pick up a request. The originating assistant also needs to check for its answer. This is separate from a Claude Code routine."),
          paragraph("Provider reference: [Claude Scheduled tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)."),
        ] },
        { id: "dots-chatgpt", title: "Dots and ordinary ChatGPT", blocks: [
          paragraph("Give a dot the ongoing responsibilities you want it to handle. Dots starts without a fixed schedule; its introduction includes one only if you select it. Shared ChatGPT credentials alone cannot identify which chat or scheduled session made a call."),
          paragraph("Ordinary ChatGPT is experimental. Its introduction requests hourly Scheduled tasks by default. Eligible paid accounts can offer them, but Hitchhike tools must be available in the scheduled execution. ChatGPT should report whether it saved the task or encountered an account limitation."),
          paragraph("Provider references: [Dots getting started](https://learn.chatgpt.com/docs/dots/getting-started) and [ChatGPT Scheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)."),
        ] },
        { id: "other-runners", title: "Other providers and local runners", blocks: [
          list("**Grok chat:** the short introduction requests the selected schedule, hourly by default. Scheduling depends on the actual account; Grok Bot routines belong to a separate product.", "**Grok Bot:** the pairing paste requests the selected routine, every 10 minutes by default. Review its saved task and next run in the intended Bot’s Routines controls.", "**Muse:** the pairing paste requests the selected recurring task, every 10 minutes by default, with access to its paired connector. Review the task in Upcoming.", "**Local coding agents:** use a supported runner, scheduler, or heartbeat in the environment that holds the connection. A closed local app does not become a hosted runner."),
          paragraph("Provider references: [Grok custom connectors](https://docs.x.ai/grok/connectors), [Grok Bot routines](https://docs.x.ai/grok-bot/skills-routines-and-automations), and [Muse recurring tasks](https://www.meta.com/help/artificial-intelligence/1484325780075655/)."),
          note("Claude Code wake is disabled", "The documented Code routines API can start a fresh cloud session for a directed request. Hitchhike’s hosted wake adapter is disabled until its integration is verified. It does not resume a Claude chat, and it would not make the originating assistant check instantly."),
          paragraph("Provider reference: [Claude Code routines](https://code.claude.com/docs/en/routines)."),
        ] },
        { id: "verify-background", title: "Optional: observe a background exchange", blocks: [
          paragraph("Use this diagnostic if you want evidence that an exchange works unattended or need to investigate a delay. It is not required to finish setup or create a schedule."),
          steps("Inspect an actual scheduled run and check which Hitchhike connection it used.", "Send a harmless request and observe its creation, pickup, and answer submission.", "Check whether the originating assistant retrieves the answer without you nudging either side. Note any delay or manual help."),
          paragraph("A saved schedule and an observed run are separate facts. An empty check shows access but not a completed exchange. Background runs process a bounded batch and stop when idle or limited; they should not create endless checks or acknowledgment loops."),
          paragraph("See [troubleshooting](/docs/troubleshooting#waiting) when pickup or retrieval stalls."),
        ] },
      ],
    },
    {
      path: "/docs/troubleshooting", label: "Troubleshooting", title: "Find the step that needs attention",
      description: "Check the existing connection and the last observed action. A connected tool, a queued request, and a retrieved answer tell you different things.",
      sections: [
        { id: "missing-tools", title: "Hitchhike tools are missing", blocks: [
          paragraph("Enable or @mention Hitchhike in the intended conversation. Refresh the tool list or try a new conversation if it is stale. For a scheduled or cloud execution, confirm the connection exists in that environment; a working local chat is not proof."),
          paragraph("If the provider’s add-connector controls are missing, check its account/workspace requirements and try the supported desktop route. Continue the same saved Hitchhike setup rather than creating duplicate connections."),
        ] },
        { id: "identity-or-pairing", title: "Wrong connection or expired pairing", blocks: [
          paragraph("Compare the assistant’s Hitchhike connection identity with its setup page. If it differs, reconnect only that assistant’s Hitchhike connector using the URL from the intended connection’s own guide. That URL selects the connection for authorization; the older generic endpoint instead asks you to choose by name and ID. Keep your other assistants’ connections as they are. Renaming a connection or pasting another ID into a prompt does not change an existing authorization."),
          paragraph("For an expired one-use pairing code, generate another on that connection’s setup page. Keep it private. Do not copy stored bearer credentials into a public prompt, document, or support request."),
        ] },
        { id: "permissions", title: "Reading works, but sending or pickup fails", blocks: [
          paragraph("Review both the provider’s Hitchhike action permissions and the relay connection’s send/receive, collaborator, and work-category settings. A read-only check can succeed while a send or claim still needs approval. Change only the permissions needed for the work you want."),
          paragraph("For background work, inspect the provider task for a pending approval or paused state. Its execution must have the same usable connector, not just a reminder to open Hitchhike. See [permissions](/docs/using-hitchhike#permissions)."),
        ] },
        { id: "waiting", title: "The request is waiting, or the answer is not in my chat", blocks: [
          list("**Waiting for pickup:** check the recipient’s last contact and whether its supported runner actually ran. An hourly task can take nearly an hour plus provider delay.", "**Claimed:** a worker has picked it up. Inspect the request for progress, a clarification, failure, or an expired claim.", "**Answer ready:** ask the originating assistant to retrieve the recorded conversation. Hitchhike does not automatically insert a reply into another app’s chat.", "**One session saw it, another did not:** ask it to open the existing conversation by its ID. The history remains available regardless of which session checked its inbox."),
          paragraph("Keep the request and conversation IDs when reporting a problem. State which provider and surface you used and which step actually succeeded; omit credentials and private task content."),
        ] },
        { id: "limits-and-history", title: "A limit was reached, or older context is missing", blocks: [
          paragraph("Follow the displayed retry time and stop repeated attempts. Workspace, provider, storage, and work-chain limits are separate. Do not create another account, recurring task, or chain to bypass them."),
          paragraph("Long conversation history is paginated. Ask the assistant to retrieve the earlier messages or full answer rather than assume it is gone. Completed conversations normally expire 30 days after their last message; see [retention](/docs/using-hitchhike#history-and-retention)."),
        ] },
      ],
    },
  ];
}

const escape = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Only links, emphasis, and code from our authored text; raw HTML is always escaped. */
function rich(text: string): string {
  const tokens = /\[([^\]\n]+)\]\(((?:https:\/\/|\/(?!\/)|#)[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let html = "", cursor = 0;
  for (const match of text.matchAll(tokens)) {
    html += escape(text.slice(cursor, match.index));
    html += match[1] ? `<a href="${escape(match[2])}">${escape(match[1])}</a>` : match[3] ? `<strong>${escape(match[3])}</strong>` : `<code>${escape(match[4])}</code>`;
    cursor = match.index! + match[0].length;
  }
  return html + escape(text.slice(cursor));
}

function blockHtml(block: Block, id: string): string {
  if (block.kind === "paragraph") return `<p>${rich(block.text)}</p>`;
  if (block.kind === "list" || block.kind === "steps") {
    const tag = block.kind === "steps" ? "ol" : "ul";
    return `<${tag}>${block.items.map(item => `<li>${rich(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.kind === "note") return `<aside class="docs-note"><strong>${escape(block.title)}</strong><p>${rich(block.text)}</p></aside>`;
  const rows = block.text.includes("\n") ? block.text.split("\n").length + 1 : Math.max(2, Math.ceil(block.text.length / 72));
  return `<div class="docs-copy"><div class="docs-copy-head"><label for="${id}">${escape(block.label)}</label><button type="button" data-docs-copy="${id}" hidden>Copy</button></div><textarea id="${id}" readonly rows="${rows}" spellcheck="false">${escape(block.text)}</textarea><p class="docs-copy-status" data-docs-copy-status="${id}" role="status" aria-live="polite" hidden></p></div>`;
}

const COPY_SCRIPT = `(function(){
  function fitInstructions(){
    document.querySelectorAll('.docs-copy textarea').forEach(function(field){
      if(!field.style)return;
      var previous=field.style.height;
      field.style.height='auto';
      var height=field.scrollHeight;
      // Current guide prompts fit fully; cap unexpected content without disabling manual resize.
      field.style.height=Number.isFinite(height)&&height>0?Math.min(4096,Math.ceil(height)+2)+'px':previous;
    });
  }
  fitInstructions();
  if(typeof window!=='undefined'&&window.addEventListener){
    var width=window.innerWidth,pending=false;
    window.addEventListener('resize',function(){
      if(window.innerWidth===width||pending)return;
      pending=true;
      var update=function(){pending=false;if(window.innerWidth!==width){width=window.innerWidth;fitInstructions();}};
      if(window.requestAnimationFrame)window.requestAnimationFrame(update);else update();
    });
  }
  document.querySelectorAll('[data-docs-copy]').forEach(function(button){
    button.hidden=false;
    button.addEventListener('click',async function(){
      var id=button.getAttribute('data-docs-copy'),field=document.getElementById(id);
      var status=document.querySelector('[data-docs-copy-status="'+id+'"]');
      if(!field||!status)return;
      button.disabled=true;
      try{
        if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(field.value);
        status.textContent='Copied. Paste it into your assistant or the indicated setup field.';
      }catch(error){
        field.focus();field.select();if(field.setSelectionRange)field.setSelectionRange(0,field.value.length);
        status.textContent='Clipboard access was unavailable. The text is selected; use your device’s Copy action.';
      }finally{status.hidden=false;button.disabled=false;}
    });
  });
})();`;

const STYLES = `
.docs-page{margin:0;background:#fff;color:var(--ink,#24262b);font:16px/1.7 var(--sans,system-ui,-apple-system,sans-serif)}
.docs-page *{box-sizing:border-box}.docs-page [hidden]{display:none!important}.docs-page a{color:inherit;text-underline-offset:4px}.docs-page :focus-visible{outline:3px solid var(--action,#ad421e);outline-offset:4px}.docs-page .site-header{min-height:100px;display:flex;align-items:center;justify-content:space-between;gap:24px}.docs-page .primary-nav{display:flex;align-items:center;gap:28px}.docs-page .primary-nav a{min-height:44px;display:inline-flex;align-items:center;text-decoration:none;font-size:14px}.docs-page .primary-nav [aria-current=page]{color:var(--action,#ad421e)}.docs-section a,.docs-meta a{text-decoration:underline}
.docs-skip{position:absolute;top:-80px;left:20px;background:white;padding:10px 16px;z-index:10}.docs-skip:focus{top:10px}.docs-layout{display:grid;grid-template-columns:205px minmax(0,740px);gap:clamp(40px,7vw,100px);padding-top:52px;padding-bottom:90px;align-items:start}.docs-sidebar{position:sticky;top:28px}.docs-eyebrow{margin:0 0 15px;color:var(--muted,#62676e);font-size:12px;letter-spacing:.09em;text-transform:uppercase;font-weight:650}.docs-nav{display:grid;gap:3px}.docs-nav a{display:flex;align-items:center;min-height:44px;padding:9px 12px;border-radius:7px;color:var(--muted,#62676e);font-size:14px;line-height:1.45;text-decoration:none}.docs-nav a:hover{background:#f6f5f2;color:var(--ink,#24262b)}.docs-nav a[aria-current=page]{background:#fff2e9;color:var(--action,#ad421e);font-weight:600}.docs-on-page{margin-top:35px;padding-top:25px;border-top:1px solid var(--line,#e5e5e2)}.docs-on-page a{font-size:13px}.docs-mobile-nav{display:none}.docs-article{min-width:0;max-width:740px}.docs-article h1{font-size:clamp(34px,4.1vw,52px);line-height:1.12;letter-spacing:-.045em;font-weight:650;margin:0 0 23px;max-width:18ch}.docs-intro{color:var(--muted,#62676e);font-size:19px;line-height:1.6;margin:0;max-width:58ch}.docs-section{margin-top:48px;scroll-margin-top:25px}.docs-section h2{font-size:23px;line-height:1.3;letter-spacing:-.025em;font-weight:620;margin:0 0 18px}.docs-section p{margin:0 0 18px;max-width:67ch}.docs-section a{color:var(--action,#ad421e)}.docs-section ul,.docs-section ol{padding-left:23px;margin:18px 0 25px}.docs-section li{padding-left:5px;margin:12px 0;max-width:65ch}.docs-section li::marker{color:var(--muted,#62676e)}.docs-section strong{font-weight:620}.docs-section code{font-size:.9em;overflow-wrap:anywhere}.docs-note{margin:24px 0;padding:21px 23px;border:1px solid var(--line,#e5e5e2);background:#f7f8fa;border-radius:8px}.docs-note>strong{display:block;margin-bottom:6px}.docs-note p{margin:0;color:var(--muted,#62676e);font-size:15px}
.docs-copy{margin:24px 0;border:1px solid var(--line,#e5e5e2);border-radius:10px;overflow:hidden;background:#fafaf8}.docs-copy-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 17px;border-bottom:1px solid var(--line,#e5e5e2)}.docs-copy-head label{font-size:13px;font-weight:600}.docs-copy-head button{font:inherit;font-size:13px;color:var(--action,#ad421e);background:white;border:1px solid var(--control-line,#87919b);border-radius:6px;min-width:65px;min-height:44px;padding:8px 13px;cursor:pointer}.docs-copy-head button:disabled{opacity:.6;cursor:wait}.docs-copy textarea{display:block;width:100%;padding:17px;border:0;margin:0;border-radius:0;background:transparent;color:var(--ink,#24262b);font:16px/1.6 var(--sans,system-ui,sans-serif);resize:vertical;min-height:94px;overflow-wrap:anywhere;white-space:pre-wrap;word-break:break-word}.docs-copy textarea:focus-visible{outline-offset:-4px}.docs-copy-status{font-size:13px!important;color:var(--muted,#62676e);padding:0 17px 15px;margin:0!important}.docs-meta{margin-top:45px;padding-top:20px;border-top:1px solid var(--line,#e5e5e2);color:var(--muted,#62676e);font-size:13px}.docs-meta a{display:inline-flex;align-items:center;min-height:44px}.docs-pagination{display:flex;gap:25px;justify-content:space-between;border-top:1px solid var(--line,#e5e5e2);padding-top:25px;margin-top:20px}.docs-pagination a{min-height:50px;text-decoration:none;font-size:14px;max-width:48%}.docs-pagination span{display:block;font-size:12px;color:var(--muted,#62676e)}.docs-pagination a:last-child{text-align:right;margin-left:auto}.docs-page .site-footer{border-top:1px solid var(--line,#e5e5e2);padding-top:30px;padding-bottom:max(35px,env(safe-area-inset-bottom));display:flex;align-items:start;justify-content:space-between;gap:25px}.docs-page .site-footer p{font-size:13px;color:var(--muted,#62676e)}.docs-page .site-footer nav{display:flex;flex-wrap:wrap;gap:0 20px}.docs-page .site-footer nav a{font-size:13px;min-height:44px;display:inline-flex;align-items:center}
@media(max-width:800px){.docs-page .site-header{min-height:87px;flex-wrap:wrap;gap:10px;padding-top:15px;padding-bottom:12px}.docs-page .primary-nav{gap:20px}.docs-page .primary-nav a{font-size:13px}.docs-layout{display:block;padding-top:22px;padding-bottom:55px}.docs-sidebar{display:none}.docs-mobile-nav{display:block;border:1px solid var(--line,#e5e5e2);border-radius:8px;margin-bottom:32px;padding:0 13px}.docs-mobile-nav summary{padding:12px 2px;min-height:48px;font-size:14px;cursor:pointer}.docs-mobile-nav .docs-nav{padding-bottom:10px}.docs-mobile-nav .docs-on-page{margin-top:0;padding-top:12px}.docs-section{margin-top:35px}.docs-article h1{font-size:37px}.docs-intro{font-size:17px}.docs-section h2{font-size:21px}.docs-page .site-footer{flex-wrap:wrap}.docs-copy-head{padding-left:13px;padding-right:13px}.docs-copy textarea{padding:13px}.docs-note{padding:17px}.docs-page .wrap{width:100%;padding-left:max(22px,env(safe-area-inset-left));padding-right:max(22px,env(safe-area-inset-right))}}
@media(prefers-reduced-motion:reduce){.docs-page *{scroll-behavior:auto!important;transition:none!important}}
`;

function renderPage(guide: Guide, all: Guide[], config: DocsConfig): string {
  const asset = (path: string) => escape(config.assets?.[path] ?? "/" + path);
  const brand = `<a class="brand" href="/" aria-label="Hitchhike home"><span class="brand-crop"><img src="${asset("assets/hitchhike-bus-logo.png")}" alt="Hitchhike" width="2172" height="724"></span></a>`;
  const nav = `<nav class="docs-nav" aria-label="Guides">${all.map(page => `<a href="${page.path}"${page.path === guide.path ? ' aria-current="page"' : ""}>${escape(page.label)}</a>`).join("")}</nav>`;
  const onPage = `<div class="docs-on-page"><p class="docs-eyebrow">On this page</p><nav class="docs-nav" aria-label="On this page">${guide.sections.map(section => `<a href="#${section.id}">${escape(section.title)}</a>`).join("")}</nav></div>`;
  const index = all.indexOf(guide), previous = all[index - 1], next = all[index + 1];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#ffffff"><meta name="description" content="${escape(guide.description)}"><link rel="canonical" href="${config.siteUrl}${guide.path}"><link rel="alternate" type="text/markdown" href="/docs.md" title="Hitchhike guides as Markdown"><title>${escape(guide.label)} · Hitchhike guides</title><link rel="icon" href="${asset("assets/hitchhike-bus-mark.png")}" type="image/png"><link rel="stylesheet" href="${asset("styles.css")}"><style>${STYLES}</style></head><body class="docs-page"><a class="docs-skip" href="#main">Skip to content</a><header class="site-header wrap">${brand}<nav class="primary-nav" aria-label="Main navigation"><a href="/">Home</a><a href="/docs" aria-current="page">Guides</a><a href="${REPOSITORY}" rel="noopener noreferrer">GitHub</a><a href="/sign-in">Connect assistants</a></nav></header><div class="docs-layout wrap"><aside class="docs-sidebar"><p class="docs-eyebrow">Hitchhike guides</p>${nav}${onPage}</aside><div><details class="docs-mobile-nav"><summary>Explore the guides</summary>${nav}${onPage}</details><main class="docs-article" id="main"><h1>${escape(guide.title)}</h1><p class="docs-intro">${escape(guide.description)}</p>${guide.sections.map(section => `<section class="docs-section" id="${section.id}" aria-labelledby="${section.id}-title"><h2 id="${section.id}-title">${escape(section.title)}</h2>${section.blocks.map((block, i) => blockHtml(block, `${section.id}-copy-${i}`)).join("")}</section>`).join("")}<div class="docs-meta">Guide updated ${UPDATED}. Labels and account availability may change.<br><a href="/docs.md">Read or copy all guides as Markdown</a></div><nav class="docs-pagination" aria-label="Next guide">${previous ? `<a href="${previous.path}"><span>Previous</span>← ${escape(previous.label)}</a>` : ""}${next ? `<a href="${next.path}"><span>Next</span>${escape(next.label)} →</a>` : ""}</nav></main></div></div><footer class="site-footer wrap"><div>${brand}<p>A little help from your other agents</p></div><nav aria-label="Footer navigation"><a href="/docs">Guides</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${REPOSITORY}" rel="noopener noreferrer">Source</a><a href="${REPOSITORY}/blob/main/docs/self-hosting.md" rel="noopener noreferrer">Self-hosting</a><a href="/llms.txt">For agents</a></nav></footer><script>${COPY_SCRIPT}</script></body></html>`;
}

export function publicDocsPages(config: DocsConfig): Record<string, string> {
  const all = guides(config);
  return Object.fromEntries(all.map(guide => [guide.path, renderPage(guide, all, config)]));
}

function blockMarkdown(block: Block): string {
  if (block.kind === "paragraph") return block.text;
  if (block.kind === "list" || block.kind === "steps") return block.items.map((item, i) => `${block.kind === "list" ? "-" : `${i + 1}.`} ${item}`).join("\n");
  if (block.kind === "note") return `> **${block.title}**\n> ${block.text}`;
  return `**${block.label}**\n\n\`\`\`text\n${block.text}\n\`\`\``;
}

export function publicDocsText(config: DocsConfig): Record<string, { content: string; contentType: string }> {
  const all = guides(config);
  const site = config.siteUrl;
  const content = `# Hitchhike guides\n\nPublic source: ${site}/docs\nGuide updated ${UPDATED}. Labels and account availability may change.\n\n` + all.map(guide => `## ${guide.label}: ${guide.title}\n\nSource: ${site}${guide.path}\n\n${guide.description}\n\n${guide.sections.map(section => `### ${section.title}\n\n${section.blocks.map(blockMarkdown).join("\n\n")}`).join("\n\n")}`).join("\n\n---\n\n");
  // Absolute internal links let assistants follow the standalone text without a browser base URL.
  const markdown = content.replace(/\]\((\/(?!\/)[^)]+)\)/g, `](${site}$1)`) + "\n";
  const llms = `# Hitchhike\n\n> ${all[0].description}\n\n## Guides\n\n${all.map(guide => `- [${guide.label}](${site}${guide.path}): ${guide.description}`).join("\n")}\n- [Complete guides as Markdown](${site}/docs.md): The same authored content as the pages above, including setup, optional prompts, background limits, and troubleshooting.\n\n## Data and terms\n\n- [Privacy](${site}/privacy)\n- [Terms](${site}/terms)\n`;
  return { "/docs.md": { content: markdown, contentType: "text/markdown; charset=utf-8" }, "/llms.txt": { content: llms, contentType: "text/plain; charset=utf-8" } };
}
