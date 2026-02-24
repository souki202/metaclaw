# Testing A2A and ACA Features

This guide provides step-by-step instructions for testing the Agent-to-Agent (A2A) communication and Autonomous Curiosity Architecture (ACA) features.

## Prerequisites

1. Node.js installed
2. API key for an OpenAI-compatible provider
3. metaclaw repository cloned

## Setup

1. **Install dependencies**
```bash
npm install
```

2. **Create configuration**
```bash
cp config.example.json config.json
```

3. **Edit config.json**
   - Replace `sk-YOUR_API_KEY` with your actual API key
   - Ensure at least 2 sessions have `a2a.enabled: true`
   - Ensure at least 1 session has `aca.enabled: true`

4. **Start the system**
```bash
npm run dev
```

5. **Open the dashboard**
   - Navigate to `http://localhost:8080` (or your configured port)

## Testing A2A (Agent-to-Agent Communication)

### Test 1: Agent Discovery

1. Open the **default** session in the dashboard
2. Send a message: "Use list_agents to see all available agents"
3. Expected result: Should see a list of 3 agents (default, coder, researcher) with their capabilities

### Test 2: Task Delegation

1. In the **default** session, send:
   ```
   Use send_to_agent to ask the researcher session to research "quantum computing basics"
   ```
2. Expected result: Task sent successfully with a request ID

3. Switch to the **researcher** session
4. Send: "Use check_a2a_messages to see if I have any incoming tasks"
5. Expected result: Should see the task request from the default agent

### Test 3: Task Response

1. In the **researcher** session, after receiving the request:
   ```
   Research quantum computing basics and use respond_to_agent to send the results back
   ```
2. Expected result: Response sent successfully

3. Switch back to **default** session
4. Send: "Use check_a2a_messages to see if I have any responses"
5. Expected result: Should see the research results from researcher agent

### Test 4: Capability Search

1. In any session, send:
   ```
   Use find_agents to find agents with web-research capability
   ```
2. Expected result: Should find the researcher agent (and possibly others with web tools enabled)

### Test 5: Agent Card

1. In any session, send: "Use get_my_card to see my own capabilities"
2. Expected result: Should see the agent's name, description, specializations, and available tools

## Testing ACA (Autonomous Curiosity Architecture)

### Test 1: Initial Curiosity State

1. Open any session with ACA enabled (e.g., **default**)
2. Send: "Use view_curiosity_state to see my curiosity state"
3. Expected result: Should show curiosity state (may be empty initially)

### Test 2: Trigger Frontier Scan

1. In the same session, send:
   ```
   Use trigger_curiosity_scan to scan for knowledge and capability frontiers
   ```
2. Expected result: Scan completes with counts of frontiers found and objectives generated

### Test 3: View Generated Objectives

1. Send: "Use view_objectives to see what objectives were generated"
2. Expected result: Should see a list of proposed objectives based on detected frontiers

### Test 4: Check CURIOSITY.md File

1. Navigate to the session's workspace directory (e.g., `./data/sessions/default/`)
2. Open `CURIOSITY.md`
3. Expected result: File exists with curiosity state, frontiers, and metrics in JSON format

### Test 5: Schedule an Objective

1. In the session, send:
   ```
   Use view_objectives to see the objective IDs, then use schedule_objective to schedule one
   ```
2. Expected result: Objective marked as scheduled

### Test 6: Complete an Objective

1. Work on a proposed objective
2. When complete, send:
   ```
   Use complete_objective with the objective_id, marking it as successful and providing a summary
   ```
3. Expected result: Objective marked as completed, metrics updated

### Test 7: Automatic Frontier Scanning

1. Wait for the configured scan interval (60 minutes for default session)
2. Check `CURIOSITY.md` or use `view_curiosity_state`
3. Expected result: New scan should have occurred automatically, with updated timestamp

## Workspace Files to Check

After running tests, verify the following files exist:

### For A2A-enabled sessions:
- Agent cards registered in the A2A registry (visible via `list_agents`)
- No specific files created (A2A is in-memory)

### For ACA-enabled sessions:
- `{workspace}/CURIOSITY.md` - Contains:
  - Current status (enabled/disabled)
  - Last scan timestamp
  - Knowledge and capability frontiers
  - Generated objectives
  - Metrics (objectives completed, knowledge gained, etc.)
  - Full state in JSON format

## Troubleshooting

### A2A Not Working

1. Verify `a2a.enabled: true` in config.json for multiple sessions
2. Check console logs for agent registration messages
3. Ensure sessions are started (visible in dashboard)
4. Try restarting the system

### ACA Not Working

1. Verify `aca.enabled: true` in config.json
2. Check if `CURIOSITY.md` exists in workspace
3. Look for ACA-related console logs
4. Try manually triggering a scan with `trigger_curiosity_scan`

### Tools Not Available

1. Check if tools are disabled in `disabledTools` config
2. Verify the session has A2A/ACA properly configured
3. Check console for tool registration errors

## Expected Behavior Summary

### A2A Tools (when a2a.enabled: true)
- ✅ `list_agents` - Lists all registered agents
- ✅ `find_agents` - Searches agents by capability/specialization
- ✅ `send_to_agent` - Sends task request to another agent
- ✅ `check_a2a_messages` - Checks incoming messages
- ✅ `respond_to_agent` - Responds to task requests
- ✅ `get_my_card` - Views own agent card

### ACA Tools (when aca.enabled: true)
- ✅ `view_curiosity_state` - Views frontiers and metrics
- ✅ `view_objectives` - Views proposed/active objectives
- ✅ `trigger_curiosity_scan` - Manually triggers frontier scan
- ✅ `schedule_objective` - Schedules objective for execution
- ✅ `complete_objective` - Marks objective as completed

### Automatic Behaviors
- A2A: Agent cards automatically generated and registered on session start
- A2A: Incoming task requests automatically queued and visible
- ACA: Frontier scans run automatically at configured intervals
- ACA: `CURIOSITY.md` automatically created and updated

## Next Steps

1. Experiment with different task types in A2A communication
2. Observe how ACA detects different types of frontiers
3. Try scheduling objectives at specific times
4. Monitor metrics in `CURIOSITY.md` over time
5. Test with different session configurations

## References

- Full documentation: [ADVANCED_FEATURES.md](ADVANCED_FEATURES.md)
- Configuration examples: [config.example.json](config.example.json)
- Source code:
  - A2A: `src/a2a/`
  - ACA: `src/aca/`
