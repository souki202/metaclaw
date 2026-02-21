# meta-claw

A multi-session AI personal agent system with Discord integration, web dashboard, long-term vector memory, workspace sandboxing, and self-modification capabilities.

## Features

- **Multi-session** — Multiple AI agents, each with their own identity, memory, workspace, and settings
- **Discord** — Route messages from different channels/guilds to different sessions
- **Dashboard** — Web UI at `http://localhost:8080` for chatting, editing workspace files, and viewing memories
- **Long-term Memory** — Semantic vector search for past memories, plus `MEMORY.md` for quick-reference facts
- **Workspace Sandboxing** — AI can only read/write within its designated workspace directory
- **Terminal Access** — AI can run shell commands (within the workspace)
- **Self-modification** — (per-session opt-in) AI can read/modify its own source code and trigger a restart
- **Context Compression** — Automatically summarizes old context when approaching the token limit
- **Heartbeat** — AI runs on a schedule to check for tasks/reminders defined in `HEARTBEAT.md`

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create config from example
cp config.example.json config.json
# Edit config.json with your API key and settings

# 3. Start
npm start
```

The dashboard will be at `http://localhost:8080`.

## Configuration

`config.json` supports:

| Field | Description |
|---|---|
| `dashboard.port` | Dashboard port (default 8080) |
| `discord.token` | Discord bot token |
| `sessions.*` | Session definitions (multiple supported) |

### Session Config

| Field | Description |
|---|---|
| `provider.endpoint` | OpenAI-compatible API endpoint |
| `provider.apiKey` | API key |
| `provider.model` | Model name (e.g. `gpt-4o`, `claude-opus-4-5`) |
| `provider.embeddingModel` | Embedding model (e.g. `text-embedding-3-small`) |
| `provider.contextWindow` | Context window size in tokens |
| `workspace` | Directory for this session's files |
| `restrictToWorkspace` | Limit AI file access to workspace |
| `allowSelfModify` | Allow AI to modify its own source code |
| `tools.exec` | Enable terminal access |
| `tools.web` | Enable web fetch/search |
| `tools.memory` | Enable long-term memory |
| `heartbeat.enabled` | Enable periodic heartbeat |
| `heartbeat.interval` | Heartbeat interval (`30m`, `1h`, `2h30m`) |
| `heartbeat.activeHours` | Only run heartbeat between these hours |

### Using non-OpenAI providers

Any OpenAI-compatible endpoint works:

```json
"provider": {
  "endpoint": "https://api.anthropic.com/v1",
  "apiKey": "sk-ant-...",
  "model": "claude-opus-4-5"
}
```

```json
"provider": {
  "endpoint": "http://localhost:11434/v1",
  "apiKey": "ollama",
  "model": "llama3.1"
}
```

## Workspace Files

Each session has a workspace directory containing:

| File | Purpose |
|---|---|
| `IDENTITY.md` | Who the AI is — name, personality, operating principles |
| `USER.md` | Information about you — preferences, timezone, projects |
| `MEMORY.md` | Quick-reference memory loaded into every conversation |
| `HEARTBEAT.md` | Instructions for periodic background tasks |
| `memory/vectors.json` | Long-term semantic memory (managed by AI) |
| `history.jsonl` | Conversation history log |

## Self-modification

When `allowSelfModify: true` is set, the AI gains access to:

- `self_list` — List source files in `src/`
- `self_read` — Read a source file
- `self_write` — Write/modify a source file
- `self_restart` — Restart meta-claw to apply changes

The restart mechanism: when `self_restart` is called, the process exits with code `75`. The `scripts/runner.js` wrapper detects this and restarts the process automatically.

> [!IMPORTANT]
> Since the AI can modify its own source code, it's recommended to **fork this repository** or **change the remote URL** (`git remote set-url origin ...`) to your own private repository. This prevents your local modifications from being accidentally overwritten by upstream updates and allows you to track changes made by the AI.

### Git Tools

When `allowSelfModify` is enabled, the AI also gains access to Git operations for version control:

| Tool | Description |
|---|---|
| `git_status` | Show working tree status |
| `git_diff` | Show unstaged changes |
| `git_diff_staged` | Show staged changes |
| `git_log` | View recent commit history |
| `git_commit` | Stage all changes and commit |
| `git_branch` | List branches (local and remote) |
| `git_checkout` | Switch branch or restore files |
| `git_stash` | Stash/restore uncommitted changes |
| `git_reset` | Reset HEAD to a commit (soft/mixed/hard) |
| `git_push` | Push commits to remote |
| `git_pull` | Pull changes from remote |

## Multiple Sessions

Sessions are isolated — each has its own:
- Workspace directory and files
- Conversation history
- Long-term memory
- AI provider and model settings
- Tool permissions

Discord routing: configure `discord.channels` and `discord.allowFrom` per session to route different Discord channels to different AI personalities.

## Memory System

Two tiers:
1. **Quick Memory** (`MEMORY.md`) — Always loaded into the system prompt. Keep it short and critical.
2. **Long-term Memory** (vector DB) — Semantically searchable. AI saves and retrieves memories using `memory_save` and `memory_search` tools.
