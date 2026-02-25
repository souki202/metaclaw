# Enhanced A2A Quick Start Guide

Get up and running with enhanced Agent-to-Agent communication in 5 minutes.

## Prerequisites

- Node.js installed
- At least one AI provider API key (OpenAI, Anthropic, etc.)

## Step 1: Configure Provider Templates

Edit `config.json` and add provider templates:

```json
{
  "providerTemplates": {
    "openai": {
      "name": "OpenAI",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-YOUR_OPENAI_API_KEY",
      "availableModels": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
      "defaultModel": "gpt-4o",
      "embeddingModel": "text-embedding-3-small",
      "contextWindow": 128000
    },
    "anthropic": {
      "name": "Anthropic",
      "endpoint": "https://api.anthropic.com/v1",
      "apiKey": "sk-ant-YOUR_ANTHROPIC_KEY",
      "availableModels": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
      "defaultModel": "claude-3-5-sonnet-20241022",
      "contextWindow": 200000
    }
  }
}
```

## Step 2: Enable A2A on Sessions

In `config.json`, enable A2A for at least 2 sessions:

```json
{
  "sessions": {
    "default": {
      "name": "Claw",
      "description": "General purpose assistant",
      "provider": {
        "endpoint": "https://api.openai.com/v1",
        "apiKey": "sk-YOUR_KEY",
        "model": "gpt-4o"
      },
      "a2a": {
        "enabled": true
      }
    },
    "researcher": {
      "name": "Research Agent",
      "description": "Specialized in web research",
      "provider": {
        "endpoint": "https://api.openai.com/v1",
        "apiKey": "sk-YOUR_KEY",
        "model": "gpt-4o"
      },
      "tools": {
        "web": true
      },
      "a2a": {
        "enabled": true
      }
    }
  }
}
```

## Step 3: Start the System

```bash
npm run dev
```

Open the dashboard at `http://localhost:8080`

## Step 4: Test Basic Communication

### Test 1: Discover Other Sessions

In the "default" session chat:

```
Use list_agents to see what other sessions are available
```

You should see the "researcher" session listed.

### Test 2: Send a Message

In the "default" session:

```
Use send_message_to_session to send "Hello! Can you help with research?" to session "researcher"
```

Then switch to the "researcher" session and:

```
Use read_session_messages to check for new messages
```

You should see the message from "default".

### Test 3: Delegate a Task

In the "default" session:

```
Use delegate_task_async to ask "researcher" to "Find the latest information about quantum computing breakthroughs in 2024"
```

This creates a background task. Check its status:

```
Use check_async_tasks created_by_me:true
```

Switch to "researcher" and check assigned tasks:

```
Use check_async_tasks assigned_to_me:true
```

## Step 5: Advanced Usage

### Create a New Session

From any session:

```
Use create_session to create a new session called "coder" using "openai" template. Set the identity to focus on software development and code review.
```

### Send Threaded Messages

Organize conversations with thread IDs:

```
Use send_message_to_session to send "Let's discuss the new feature" to "coder" with thread_id "feature-planning"
```

### Complete Tasks

When a task is done, mark it complete:

```
Use complete_async_task with task_id "abc-123" and result "Research complete. Found 5 major breakthroughs..."
```

## Common Patterns

### Pattern 1: Research → Implement

```
Session A: delegate_task_async → researcher (do research)
Researcher: complete_async_task (with findings)
Session A: delegate_task_async → coder (implement based on research)
Coder: complete_async_task (with code)
```

### Pattern 2: Coordination Session

Create a hidden coordinator:

```json
{
  "coordinator": {
    "name": "Task Coordinator",
    "a2a": {
      "enabled": true,
      "hiddenFromAgents": true
    }
  }
}
```

This session can orchestrate others without appearing in lists.

### Pattern 3: Specialized Team

Create specialized sessions:

- **researcher**: web tools, memory for storing findings
- **coder**: exec tools for running code
- **writer**: focused on documentation
- **reviewer**: code review and quality checks

## Troubleshooting

### "Target session not found"

- Verify session exists in config.json
- Check session is running
- Use `list_agents` to see available sessions

### Messages not appearing

- Ensure both sessions have `a2a.enabled: true`
- Check workspace directory exists
- Look for `session_messages.jsonl` in workspace

### Tasks stuck in "pending"

- Verify target session is active
- Check logs in workspace/logs/
- Ensure no errors in dashboard console

## Next Steps

1. **Read the full documentation**:
   - [A2A Tools Reference](A2A_TOOLS_REFERENCE.md) - All tools and parameters
   - [Implementation Guide](ENHANCED_A2A_IMPLEMENTATION.md) - Architecture details
   - [Testing Guide](TESTING_ENHANCED_A2A.md) - Comprehensive test suite

2. **Experiment with workflows**:
   - Create task pipelines
   - Set up message threads
   - Build specialized agent teams

3. **Customize identities**:
   - Edit `IDENTITY.md` in workspace directories
   - Define roles and specializations
   - Create focused personalities

4. **Monitor and optimize**:
   - Check `session_messages.jsonl` for history
   - Review completed tasks
   - Adjust scan intervals if using ACA

## Configuration Validation

Verify your setup is correct:

```bash
node test-a2a-aca.mjs
```

This checks:
- Configuration structure
- A2A enablement
- Provider templates
- Session validity

## Example Workflows

### Workflow 1: Multi-Step Project

```
1. User → default: "I need to build a todo app"
2. default → researcher: delegate_task_async "Research best todo app architectures"
3. researcher: Research and complete_async_task
4. default → coder: delegate_task_async "Implement todo app based on research"
5. coder: Code and complete_async_task
6. default → reviewer: delegate_task_async "Review the code"
7. reviewer: Review and complete_async_task
8. default → user: "Project complete, here's the summary..."
```

### Workflow 2: Continuous Learning

```
1. researcher: Periodically scan for new topics
2. researcher → default: send_message with findings
3. default: Process and store in memory
4. default → researcher: send_message with follow-up questions
```

### Workflow 3: Collaborative Problem Solving

```
1. default: Encounters complex problem
2. default → researcher: "Find solutions to X"
3. default → coder: "Draft implementation for Y"
4. Both work in parallel (async tasks)
5. default: Combine results when both complete
```

## Tips for Success

1. **Name sessions clearly** - Use descriptive names that indicate purpose
2. **Use thread IDs** - Organize related messages together
3. **Delegate long tasks async** - Keep UX responsive
4. **Check task status regularly** - Monitor progress of delegated work
5. **Persist messages** - Messages save automatically on shutdown
6. **Hide coordinators** - Use `hiddenFromAgents: true` for orchestrators
7. **Define clear identities** - Give each session a specific role
8. **Use provider templates** - Define once, reuse everywhere

## FAQ

**Q: How many sessions can I run?**
A: As many as your system can handle. Each session runs independently.

**Q: Can sessions use different AI providers?**
A: Yes! Each session can use a different provider or model.

**Q: Do messages persist across restarts?**
A: Yes, messages are saved to `session_messages.jsonl` in the workspace.

**Q: Can I manually edit messages?**
A: Yes, edit `session_messages.jsonl` (one JSON object per line).

**Q: How do I delete old messages?**
A: Delete or truncate `session_messages.jsonl` in the workspace.

**Q: Can tasks be cancelled?**
A: Not yet - this is a planned feature for future releases.

**Q: How long are completed tasks kept?**
A: 24 hours, then automatically cleaned up.

## Getting Help

- Check logs: `<workspace>/logs/`
- Review documentation: See files listed above
- Validate config: `node test-a2a-aca.mjs`
- Inspect message files: `<workspace>/session_messages.jsonl`

## What's Next?

You now have a working multi-session AI system with:
- ✅ Inter-session communication
- ✅ Asynchronous task delegation
- ✅ Dynamic session creation
- ✅ Message persistence
- ✅ Flexible configuration

Explore advanced features:
- Set up complex workflows
- Create specialized agent teams
- Enable ACA for autonomous learning
- Integrate with Discord/Slack
- Build custom tools with MCP

Happy collaborating! 🤖✨
