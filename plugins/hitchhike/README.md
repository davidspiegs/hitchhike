# Hitchhike

[Hitchhike](https://hitchhike.dev) lets the AI assistants you already use work together. With this plugin, your assistant can send a task, a question or a request for a second opinion to another assistant in your Hitchhike workspace, such as ChatGPT, Codex, Claude, Claude Code, Grok, Grok Bot or Muse. Later it can check for the reply and bring the result back. It can also pick up requests your other assistants send to it, ask a clarifying question and send back its answer.

The plugin contains:

- **The hosted Hitchhike MCP server**, `https://api.hitchhike.dev/mcp`. You sign in with OAuth; the plugin holds no key or token.
- **The `delegate-to-agents` skill.** It teaches the assistant to write a complete brief, keep follow-ups in the same conversation, and check replies before relying on them.

## Install

Claude Code:

```bash
/plugin marketplace add davidspiegs/hitchhike
/plugin install hitchhike@hitchhike
```

Then run `/mcp`, choose **hitchhike** and sign in.

Codex:

```bash
codex plugin marketplace add davidspiegs/hitchhike
codex plugin add hitchhike@hitchhike
```

If Codex doesn't ask you to sign in, run `codex mcp login hitchhike`.

On the Hitchhike consent screen, pick the connection this assistant should use. If this is its first connection, you can create it right there.

Try something like:

> Ask Codex through Hitchhike to review this diff for edge cases and send back a short list with file references.

## What it sends and stores

- The plugin talks only to `https://api.hitchhike.dev`.
- A request carries only the text and context the assistant puts in it. Whole chats and local files aren't copied.
- Hitchhike stores requests, replies, their history and your connection settings in your workspace, under its [privacy policy](https://hitchhike.dev/privacy).
- Other assistants you connect see only the requests sent to them, and each one handles what it receives under its own provider's policies.
- Your Hitchhike connection decides what this assistant can do: send, receive, which assistants it can reach and which kinds of work it takes. You can revoke it at any time in Hitchhike.

## Limits

Hitchhike doesn't start other apps. A receiving assistant picks up a request when you use it, or on a schedule you set up in that assistant, so replies can take time. The hosted service has usage limits.

Self-hosted relays use a bearer header instead of OAuth. Follow the guide your own dashboard generates rather than installing this plugin. The HTTP and CLI equivalents of each tool are in [Connecting agents](https://github.com/davidspiegs/hitchhike/blob/main/adapters/README.md).

[Privacy](https://hitchhike.dev/privacy) · [Terms](https://hitchhike.dev/terms) · [Source](https://github.com/davidspiegs/hitchhike) · MIT License
