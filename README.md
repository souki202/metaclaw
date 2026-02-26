# meta-claw

**WIP**

A multi-session AI personal agent system featuring Discord / Slack integration, a modern Next.js web dashboard, long-term vector memory, workspace sandboxing, Playwright browser automation, Vision capabilities, and full self-modification tools.

## Features

- **Multi-session Architecture** — Run multiple isolated AI agents concurrently, each maintaining its own identity, memory tier, workspace, and capabilities.
- **Agent-to-Agent (A2A) Communication** — Enable inter-agent collaboration through a JSON-RPC style messaging protocol. Agents can discover capabilities, delegate tasks, and coordinate work autonomously.
- **Autonomous Curiosity Architecture (ACA)** — Agents autonomously detect knowledge gaps and capability frontiers, generating self-directed learning objectives. See `CURIOSITY.md` in workspace for state tracking.
- **Web Dashboard** — Modern Next.js UI (default `http://localhost:8080`) for real-time streaming chat, workspace file editing, memory viewing, and system configuration. Features dark/light mode, chat cancellation, and a **Model Selection UI** with search capability.
- **Discord Integration** — Bidirectional chat synchronization. Route specific Discord channels or guilds to dedicated agent sessions, complete with image and attachment support.
- **Slack Integration** — Bidirectional chat synchronization via Slack bot tokens. Route specific channels or teams to dedicated agent sessions.
- **Browser Automation** — Advanced web interaction using Playwright. The AI can navigate, click, type, and take visual screenshots. Users can track the AI's browser activity in real-time and manually intervene if needed.
- **Vision & Image Support** — Full multi-part message support. AI can process real-time screenshots and images uploaded via dashboard drag-and-drop or Discord.
- **Model Context Protocol (MCP)** — Dynamically connect to local or remote standard MCP servers to expand the AI's toolset. Manage connection statuses directly via the dashboard.
- **Skills System** — Extend functionality through external, installable skills configured on a per-session basis in the UI.
- **Advanced Memory Ecosystem** — Semantic vector database for long-term fact retrieval, `MEMORY.md` for core persistent identity facts, `SOUL.md` for deeper behavioral traits, and `TMP_MEMORY.md` for ephemeral, task-specific context.
- **Workspace Sandboxing & Terminal** — AI operates within a secure workspace boundary, allowing for isolated file system read/writes and terminal command execution (`exec`).
- **Self-Modification & Hot Reloading** — (Opt-in) AI can read/modify its own source code and execute Git actions. The system supports intelligent backend restarts that apply modifications without dropping the Next.js frontend server.
- **Tool Controls** — Specifically toggle individual tools on or off per-session saving context tokens and restricting system capabilities.
- **Schedules** — Register one-time or recurring (cron) self-wakeup tasks with memo payloads.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create config from example
cp config.example.json config.json
# Edit config.json with your API key and settings

# 3. Start
npm run dev
```

The dashboard will be at `http://localhost:8080` (or the port configured in `config.json`).

## Configuration

`config.json` supports configuring the UI dashboard and multiple agent sessions:

| Field | Description |
|---|---|
| `dashboard.port` | Dashboard port (default 8080) |
| `providerTemplates.*` | Reusable provider configurations (endpoint, API key, models) |
| `sessions.*` | Session definitions (multiple supported) |

### Session Config

| Field | Description |
|---|---|
| `provider.endpoint` | OpenAI-compatible API endpoint |
| `provider.apiKey` | API key |
| `provider.model` | Model name (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
| `provider.embeddingModel` | Embedding model (e.g. `text-embedding-3-small`) |
| `provider.contextWindow` | Context window size in tokens |
| `context.maxTokens` | Per-session context upper limit (<= provider.contextWindow). Compression/pruning thresholds follow this value |
| `context.memoryCompressionModel` | Optional model used for compressing recalled raw memories (fallback: `provider.model`) |
| `workspace` | Directory for this session's sandbox files |
| `restrictToWorkspace` | Limit AI file and command access to workspace bounds |
| `allowSelfModify` | Allow AI to modify its own source code within the engine |
| `tools.*` | Tool capability toggles (e.g. `exec`, `web`, `browser`, `memory`) |
| `a2a.enabled` | Enable Agent-to-Agent communication (default: false) |
| `a2a.hiddenFromAgents` | Hide this session from list_agents discovery (default: false) |
| `aca.enabled` | Enable Autonomous Curiosity Architecture (default: false) |
| `aca.scanInterval` | Minutes between frontier scans (default: 60) |
| `aca.maxGoalsPerCycle` | Max objectives per scan (default: 3) |

> Note: You can use any OpenAI-compatible API endpoints natively (e.g., Anthropic, Ollama, OpenRouter).

## Workspace Files

Each session maintains an isolated workspace directory containing:

| File | Purpose |
|---|---|
| `IDENTITY.md` | Who the AI is — name, personality, operating principles |
| `SOUL.md` | Deeper behavioral traits, core values, and immutable rules |
| `USER.md` | Information about you — preferences, timezone, projects |
| `MEMORY.md` | Core quick-reference memory loaded into every conversation |
| `TMP_MEMORY.md` | Ephemeral, short-term context that persists across quick restarts |
| `CURIOSITY.md` | (ACA only) Autonomous curiosity state, frontiers, and objectives |
| `session_messages.jsonl` | (A2A only) Inter-session message history and threads |
| `schedules.json` | Registered self-wakeup schedules for the session |
| `memory/vectors.json` | Long-term semantic memory (managed actively by AI) |
| `history.jsonl` | Conversation and external activity history log |

## Self-modification

When `allowSelfModify: true` is set, the AI gains access to a special set of commands allowing it to:

- Read and list internal core engine code (`src/`, `app/`, etc.)
- Overwrite or surgically edit files
- Execute underlying Git actions (commit, push, pull, branch, stash)
- Restart the backend to commit complex modifications

### Hot Reload vs Restart

With the new Next.js architecture, **hot reload automatically applies changes** to:
- Backend code in the `src/` directory (TypeScript)
- Frontend code in the `app/` directory (React components)

You only need `self_restart` for changes that cannot be hot-reloaded safely (e.g., `npm install`, full config changes, native module updates). The backend will perform an intelligent sub-process restart, ensuring the UI and `npm run dev` foreground process remains uninterrupted.

> [!IMPORTANT]
> Since the AI can modify its own source code autonomously, it's highly recommended to **fork this repository** or **change the remote URL** (`git remote set-url origin ...`) to your own private repository. This prevents local modifications from colliding with upstream updates and secures changes made natively by the AI.

## Multiple Sessions

Agent sessions are deeply isolated — each uniquely provisions:
- Workspace directories and sandboxed file systems
- Live conversation history (including Discord / Slack interactions)
- Long-term memory and short term task logic
- Respective standard AI and embedding provider settings
- Tool module and MCP configurations

Using channel routing, configure `discord.*` and/or `slack.*` (`channels`, `allowFrom`, etc.) per session to map specific chat ecosystems back to unique AI personalities.

## Advanced Features

### Agent-to-Agent (A2A) Communication

Enable inter-agent collaboration by setting `a2a.enabled: true` in your session configuration. The enhanced A2A system enables:
- **Session-to-Session Communication**: Direct messaging between AI sessions (not abstract agents)
- **Asynchronous Task Delegation**: Non-blocking task assignments with status tracking
- **AI-Driven Session Creation**: Create new sessions dynamically with custom identities
- **Provider Templates**: Reusable API configurations for multiple sessions
- **Session Visibility Control**: Hide management sessions from discovery
- **Message Persistence**: Conversation history saved to workspace

**Available A2A Tools:**
- `list_agents` - Discover all registered sessions and their capabilities
- `create_session` - Dynamically create new AI sessions with custom configurations
- `list_provider_templates` - View available API provider configurations
- `send_message_to_session` - Send direct messages to other sessions
- `read_session_messages` - Check and read incoming messages
- `delegate_task_async` - Delegate tasks asynchronously without blocking
- `check_async_tasks` - Monitor delegated task status and results
- `complete_async_task` - Mark delegated tasks as complete with results
- `get_session_outputs` - Retrieve recent text outputs from any active session

### Autonomous Curiosity Architecture (ACA)

Enable autonomous learning by setting `aca.enabled: true`. The system will:
- Automatically scan workspace files to detect knowledge and capability gaps
- Generate self-directed learning objectives based on detected frontiers
- Track progress and metrics in `CURIOSITY.md`
- Optionally auto-schedule objectives for background execution

**Available ACA Tools:**
- `view_curiosity_state` - View detected frontiers and metrics
- `view_objectives` - See proposed and active objectives
- `trigger_curiosity_scan` - Manually trigger a frontier scan
- `schedule_objective` - Schedule an objective for execution
- `complete_objective` - Mark objectives as completed with results

**Configuration:**
```json
{
  "aca": {
    "enabled": true,
    "scanInterval": 60,
    "maxGoalsPerCycle": 3
  }
}
```

### Experience-driven Lifelong Learning (ELL)

(WIP) The ELL system allows agents to internalize patterns and skills based on past experiences:
- **Experience Extraction**: Automatically cluster and analyze successful task outcomes.
- **Skill Internalization**: Generate reusable `SKILL.md` files from detected patterns.
- **Continuous Improvement**: Track effectiveness and duration of internalized skills.

See [ADVANCED_FEATURES.md](ADVANCED_FEATURES.md) for detailed documentation on A2A, ACA, and ELL.

## Memory System Architecture

Three operational memory tiers ensure continuity:
1. **Short-Term Extensible** (`TMP_MEMORY.md`) - Scratchpad for current operations or thoughts tracking over context resets.
2. **Quick Memory** (`MEMORY.md`) - Small footprint identity traits baked globally into every prompt interaction.
3. **Long-term Vector DB** - Dynamically queried semantically leveraging `memory_save` and `memory_search` interactions.
