# Advanced Features Implementation

This document describes the three advanced features implemented in metaclaw:

## 1. Agent-to-Agent (A2A) Protocol

The A2A protocol enables inter-agent communication and collaboration through a JSON-RPC style messaging system.

### Features

- **Agent Discovery**: Agents can discover each other's capabilities through Agent Cards
- **Task Delegation**: Agents can delegate tasks to other agents with specific capabilities
- **Zero-Trust Architecture**: No shared state between agents; all communication via messages
- **Message Queue**: Asynchronous message routing and handling
- **Capability Matching**: Find agents by specialization or capability

### Usage

Enable A2A in your session configuration:

```json
{
  "sessions": {
    "researcher": {
      "name": "Research Agent",
      "a2a": {
        "enabled": true
      }
    }
  }
}
```

### Available Tools

- `list_agents`: List all available agents and their capabilities
- `find_agents`: Find agents by capability or specialization
- `send_to_agent`: Delegate a task to another agent
- `check_a2a_messages`: Check for incoming messages from other agents
- `respond_to_agent`: Respond to task requests
- `get_my_card`: View your own agent card

### Example Flow

```
Agent A: list_agents()
Agent A: send_to_agent(target="web-researcher", task="Research quantum computing")
Agent B: [receives A2A_REQUEST message automatically]
Agent B: [processes task]
Agent B: respond_to_agent(message_id="...", success=true, output="...")
Agent A: check_a2a_messages() -> [sees response]
```

## 2. Autonomous Curiosity Architecture (ACA)

ACA enables agents to autonomously identify knowledge gaps and generate self-directed learning objectives.

### Features

- **Frontier Detection**: Automatically scans workspace files for knowledge and capability gaps
- **Autonomous Goal Generation**: Creates exploration objectives based on detected frontiers
- **Curiosity State Tracking**: Maintains history of frontiers, objectives, and metrics in CURIOSITY.md
- **Scheduled Exploration**: Can auto-schedule objectives for background execution
- **Progress Metrics**: Tracks knowledge gained and capabilities acquired

### Usage

Enable ACA in your session configuration:

```json
{
  "sessions": {
    "learner": {
      "name": "Learning Agent",
      "aca": {
        "enabled": true,
        "scanInterval": 60,
        "maxGoalsPerCycle": 3
      }
    }
  }
}
```

### Available Tools

- `view_curiosity_state`: View current frontiers and metrics
- `view_objectives`: See generated autonomous objectives
- `trigger_curiosity_scan`: Manually trigger a frontier scan
- `schedule_objective`: Schedule an objective for execution
- `complete_objective`: Mark an objective as completed with results

### Frontier Types

**Knowledge Frontiers**:
- Unknown concepts
- Incomplete information
- Outdated knowledge
- Unexplored topics

**Capability Frontiers**:
- Missing tools
- Inefficient processes
- Error-prone tasks
- Manual workflows

### Example Flow

```
Agent: [ACA scans workspace every 60 minutes]
Agent: [Detects "unclear how to deploy to production" in USER.md]
Agent: [Generates objective: "Research deployment strategies"]
Agent: view_objectives() -> [sees proposed objective]
Agent: schedule_objective(id="...", schedule_at="2026-02-25T02:00:00Z")
Agent: [wakes up at scheduled time]
Agent: [researches deployment]
Agent: complete_objective(success=true, new_knowledge="Docker, Kubernetes...")
```

## 3. Experience-Driven Lifelong Learning (ELL)

ELL enables agents to learn from successful experiences and create reusable skills (currently types defined, full implementation in progress).

### Planned Features

- **Experience Analysis**: Analyze history.jsonl for successful patterns
- **Skill Abstraction**: Extract reusable action sequences as SKILL.md files
- **Effectiveness Tracking**: Monitor skill success rates
- **Knowledge Internalization**: Convert learned patterns into callable tools
- **Cross-Session Sharing**: Share skills between agents

### Configuration

```json
{
  "sessions": {
    "learner": {
      "name": "Adaptive Agent",
      "ell": {
        "enabled": true,
        "minSuccessThreshold": 3
      }
    }
  }
}
```

## Architecture Overview

### Component Interaction

```
┌─────────────┐     A2A Messages    ┌─────────────┐
│   Agent A   │◄───────────────────►│   Agent B   │
│             │                      │             │
│ ┌─────────┐ │                      │ ┌─────────┐ │
│ │   ACA   │ │  Shared Registry   │ │   ACA   │ │
│ │ Manager │ │◄─────────┬─────────►│ │ Manager │ │
│ └─────────┘ │          │          │ └─────────┘ │
│             │    ┌─────▼──────┐   │             │
│ ┌─────────┐ │    │    A2A     │   │ ┌─────────┐ │
│ │   ELL   │ │    │  Registry  │   │ │   ELL   │ │
│ │ Manager │ │    └────────────┘   │ │ Manager │ │
│ └─────────┘ │                      │ └─────────┘ │
└─────────────┘                      └─────────────┘
      │                                      │
      │  Workspace Files                    │
      │  (CURIOSITY.md, SKILL.md)          │
      └──────────────┬──────────────────────┘
                     │
              ┌──────▼────────┐
              │  File System  │
              │   Workspace   │
              └───────────────┘
```

### Data Flow

1. **A2A**: Agent A → A2ARegistry → Agent B (via message queue)
2. **ACA**: FrontierDetector → CuriosityState → GoalGenerator → Schedule
3. **ELL**: History Analysis → Experience Clustering → Skill Generation → Skill File

## Implementation Details

### File Locations

- A2A: `src/a2a/` (types, registry, card-generator, tools)
- ACA: `src/aca/` (types, manager, frontier-detector, goal-generator, curiosity-state, tools)
- ELL: `src/ell/` (types defined, full implementation pending)

### Workspace Files

- `CURIOSITY.md`: ACA state and metrics
- `SKILL.md`: Generated skills (ELL)
- `history.jsonl`: Source data for ELL analysis

### Configuration Schema

See `src/types.ts` for `SessionConfig` interface with:
- `a2a?: { enabled: boolean }`
- `aca?: { enabled: boolean; scanInterval?: number; maxGoalsPerCycle?: number }`
- `ell?: { enabled: boolean; minSuccessThreshold?: number }`

## Future Enhancements

1. **A2A Protocol**:
   - Capability negotiation
   - Task chaining across multiple agents
   - Failure handling and retry logic

2. **ACA**:
   - Machine learning for frontier importance scoring
   - User feedback loop for objective quality
   - Integration with vector memory for semantic frontier detection

3. **ELL**:
   - Complete implementation of experience analyzer
   - Automatic skill file generation
   - Skill effectiveness prediction
   - Cross-session skill marketplace

## Testing

To test the features:

1. Create 2+ sessions with A2A enabled
2. Use `list_agents` to discover capabilities
3. Delegate tasks with `send_to_agent`
4. Enable ACA and observe autonomous frontier detection
5. Review `CURIOSITY.md` for generated objectives

## Performance Considerations

- **A2A**: Minimal overhead, message queue is in-memory
- **ACA**: Scans can be resource-intensive; adjust `scanInterval` accordingly
- **ELL**: History analysis will be memory-bound for large histories

## Security

- **A2A**: Zero-trust model prevents state leakage between agents
- **ACA**: Frontiers are detected only from session's own workspace
- **ELL**: Skills are session-scoped unless explicitly shared

---

For implementation details, see the source code in `src/a2a/`, `src/aca/`, and `src/ell/`.
