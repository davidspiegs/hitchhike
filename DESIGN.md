# Hitchhike interface direction

Hitchhike makes existing assistants work together. The website is a calm place to connect, configure, and understand them. It is not a replacement chat application.

## Visual and interaction system

Use the existing bus mark and wordmark, warm orange for primary action, clean white content, and a pale cool gray navigation surface. Product typography uses the platform sans with a fixed 32px desktop / 27px mobile heading and readable 15px body. Borders separate continuous rows; do not turn every fact into a card. Keep the main heading, explanation, and next action visible together.

Your agents is the default. Agent configuration owns purpose, collaborators, work categories, sharing instructions, and background method. Activity is a secondary trace with full history and clear status. Workspace settings is secondary navigation.

Setup uses dedicated, resumable pages. Pairing assistants need a connection step and a readiness page; MCP assistants also receive one short introduction to paste after installation. Optional preferences and troubleshooting stay in disclosures. Existing five-step deep links remain compatible. Each header names the assistant without repeating the provider when it is the same name. Native hash routes preserve browser back/forward and static authenticated /app compatibility. No setup dialogs or nested scrolling. Connection access, peer exchanges, and background execution are independent milestones.

Mobile navigation is a compact top navigation, not a squeezed sidebar. Inputs are at least 16px and interactive targets at least 44px; preserve safe areas and allow natural document scrolling. No fixed bottom forms competing with iOS keyboard. Clipboard failures leave selectable text visible. State survives provider app switching and ordinary refreshes. Credentials and generated pairing secrets stay out of browser storage.

## Prototype and evidence

`web/prototype/index.html` is a self-contained local interactive design prototype with representative fictional data. It supports desktop/mobile layouts, connection setup, editable configuration, activity, conversation history, workspace preferences, and empty/partial/working/delayed/disconnected/failed/loading states. The prototype is illustrative; none of its connection claims are live evidence.

The legacy workspace uses 264px sidebar plus task-first content, fixed drawers, an agent-creation dialog, additional setup drawers, and long instructions. Those nested interaction layers are concrete mobile risk areas. Physical iPhone reproduction and live provider identity/background proof remain release checks; browser simulation cannot establish them.

## Acceptance

Review full desktop and mobile compositions, every prototype state, visible focus, contrast, long text, copy failures, page back navigation, reload and interrupted creation. Production rendering must use text nodes for untrusted provider/agent text, preserve auth/CSRF/CSP, and distinguish verified server evidence from configuration declarations.

## Working-instruction choices

Two primary native radio choices offer flexible starting points: Use your judgment and Be available to help. Existing selected preferences remain available without rewriting the person's choices. They occupy continuous rows with a subdued selected surface. The short prompt describes intent; exact relay mechanics are fetched by the assistant. Paired assistants receive their preference through pairing, without a second required copy step. Saved/unsaved status sits alongside Save; replacement and reset preserve edited text until the person explicitly chooses a new starter. Selection never changes authorization.

Provider background guidance is optional and identifies where recurring-task instructions belong. Claude chat's hourly task and Claude Code's cloud routine use separate copy and controls. Detailed recovery stays in the page's disclosure flow. The [connecting assistants guide](docs/connecting-assistants.md) describes the resulting setup flow and provider instructions.


## Simplified setup and consent

All connections use two visible pages, Connect and Ready. Ready keeps one editable MCP introduction in view, with working preferences and cadence adjustment in disclosures. Paired assistants load saved preferences through one pairing paste. The next action is always available; verification is an observation, never an onboarding obstacle. Optional tests sit below the main flow.

Authorization is a focused 480px reading column with the bus identity, the chosen connection name, readable permissions, and a single confirmation action. Scoped setup carries the connection into this screen without a selector. Technical IDs and callback details stay available in a disclosure. Generic legacy links retain an explicit selector. Mobile uses a natural single-column document with comfortable controls and no nested scroll surface.
