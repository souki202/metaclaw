# Enhanced A2A Implementation Summary

## Overview
This document summarizes the enhanced Agent-to-Agent (A2A) communication system that enables direct session-to-session interaction, asynchronous task delegation, AI-driven session creation, and provider template management.

## Key Features Implemented

### 1. Session-Based Communication
- **Direct Messaging**: Sessions can send direct messages to each other using `send_message_to_session`
- **Message Persistence**: Messages are persisted to `session_messages.jsonl` in each session's workspace
- **Thread Support**: Messages can be organized into threads for conversation tracking
- **Read Status**: Track which messages have been read

### 2. Asynchronous Task Delegation
- **Non-Blocking Delegation**: `delegate_task_async` creates tasks that execute in the background
- **Task Status Tracking**: Monitor task progress with `check_async_tasks`
- **Task Completion**: Complete tasks with results using `complete_async_task`
- **Automatic Cleanup**: Old completed tasks are cleaned up after 24 hours

### 3. AI-Driven Session Creation
- **Dynamic Session Creation**: AI can create new sessions using `create_session` tool
- **Custom Identity**: Set custom IDENTITY.md, SOUL.md, USER.md, MEMORY.md content
- **Provider Templates**: Use pre-configured provider settings
- **Automatic Registration**: New sessions are automatically registered with A2A if enabled

### 4. Provider Template System
- **Reusable Configuration**: Define provider templates once in config
- **List Templates**: Use `list_provider_templates` to see available providers
- **Template Fields**: Includes endpoint, API key, models, context window, etc.

### 5. Session Visibility Control
- **Hidden Sessions**: Sessions can be hidden from `list_agents` using `hiddenFromAgents` flag
- **Selective Discovery**: Control which sessions are discoverable by other agents

## Architecture

### New Files
- **`src/a2a/session-comms.ts`**: SessionCommsManager class for message and task management
- **`src/a2a/enhanced-tools.ts`**: 7 new A2A tools for enhanced capabilities
- **`test-a2a-aca.mjs`**: Configuration validation script

### Modified Files
- **`src/types.ts`**: Added ProviderTemplate, SessionMessage, AsyncTask, SessionCreationParams
- **`src/a2a/types.ts`**: Added hiddenFromAgents to AgentCard
- **`src/a2a/registry.ts`**: Updated to filter hidden sessions
- **`src/a2a/card-generator.ts`**: Added hiddenFromAgents support
- **`src/core/sessions.ts`**: Integrated SessionCommsManager
- **`src/core/agent.ts`**: Added commsManager and sessionManager support
- **`src/tools/index.ts`**: Added 7 new tool definitions and execution cases
- **`config.example.json`**: Added providerTemplates section

## Tool Reference

### 1. `create_session`
Create a new AI session dynamically.

**Parameters:**
- `session_id`: Unique identifier for the session
- `provider_template`: Name of provider template to use
- `name`: Display name
- `description`: Session description
- `identity_content`: Custom IDENTITY.md content (optional)
- `soul_content`: Custom SOUL.md content (optional)
- `user_content`: Custom USER.md content (optional)
- `memory_content`: Custom MEMORY.md content (optional)
- `enable_a2a`: Enable A2A for this session (default: true)
- `hidden_from_agents`: Hide from list_agents (default: false)

### 2. `list_provider_templates`
List available provider templates.

**Returns:** Array of provider templates with name, endpoint, models, etc.

### 3. `send_message_to_session`
Send a direct message to another session.

**Parameters:**
- `target_session`: Session ID to send message to
- `message`: Message content
- `thread_id`: Optional thread ID for organizing conversations

**Returns:** Message ID and timestamp

### 4. `read_session_messages`
Read incoming messages for current session.

**Parameters:**
- `unread_only`: Only show unread messages (default: true)
- `thread_id`: Filter by thread ID (optional)

**Returns:** Array of messages with sender, content, timestamp, read status

### 5. `delegate_task_async`
Delegate a task to another session asynchronously.

**Parameters:**
- `target_session`: Session ID to delegate to
- `task`: Task description
- `context`: Additional context object (optional)

**Returns:** Task ID for tracking

### 6. `check_async_tasks`
Check status of delegated tasks.

**Parameters:**
- `created_by_me`: Show tasks I created (default: false)
- `assigned_to_me`: Show tasks assigned to me (default: true)

**Returns:** Array of tasks with status, creation time, results

### 7. `complete_async_task`
Mark a task as complete with results.

**Parameters:**
- `task_id`: Task ID to complete
- `result`: Result message (for completion)
- `error`: Error message (for failure)

## Type Definitions

### SessionMessage
```typescript
interface SessionMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  read: boolean;
  threadId?: string;
}
```

### AsyncTask
```typescript
interface AsyncTask {
  id: string;
  fromSession: string;
  toSession: string;
  task: string;
  context?: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### ProviderTemplate
```typescript
interface ProviderTemplate {
  name: string;
  endpoint: string;
  apiKey: string;
  availableModels: string[];
  defaultModel: string;
  embeddingModel?: string;
  contextWindow?: number;
}
```

## Configuration

### Provider Templates
Add to config.json:
```json
{
  "providerTemplates": {
    "openai": {
      "name": "OpenAI",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-YOUR_KEY",
      "availableModels": ["gpt-4o", "gpt-4o-mini"],
      "defaultModel": "gpt-4o",
      "embeddingModel": "text-embedding-3-small",
      "contextWindow": 128000
    }
  }
}
```

### Session A2A Configuration
```json
{
  "sessions": {
    "my_session": {
      "a2a": {
        "enabled": true,
        "hiddenFromAgents": false
      }
    }
  }
}
```

## Usage Examples

### Example 1: Send a Message
```
Use send_message_to_session to send "Hello from Claw!" to session "researcher"
```

### Example 2: Delegate a Task
```
Use delegate_task_async to ask "coder" session to "Implement a new API endpoint for user profiles"
```

### Example 3: Create a New Session
```
Use create_session to create a session called "analyzer" using "openai" template with custom identity focusing on data analysis
```

### Example 4: Check for Messages
```
Use read_session_messages to see if I have any new messages
```

## File Locations

### Message Persistence
- Messages saved to: `<workspace>/session_messages.jsonl`
- Format: One JSON object per line

### Session Configuration
- Config file: `config.json`
- Session workspaces: `./workspaces/<session_id>/` (default)

## Implementation Details

### Circular Dependency Avoidance
- Agent receives `getSessionManager` function instead of direct reference
- SessionCommsManager is shared across all sessions
- Tool context uses lazy evaluation for sessionManager

### Async Task Processing
- Tasks are processed using `setImmediate` for non-blocking execution
- Task status updates are atomic
- Background processing continues even after tool returns

### Message Threading
- Thread IDs can be any string (e.g., "task-123", "conversation-xyz")
- Messages with same thread ID are grouped together
- Threads are independent of task delegation

## Testing

Run the validation script:
```bash
node test-a2a-aca.mjs
```

This validates:
- Configuration structure
- A2A enablement on sessions
- ACA configuration
- Provider templates (if present)

## Best Practices

1. **Use Threads**: Organize related messages into threads for clarity
2. **Async by Default**: Use async task delegation for long-running operations
3. **Check Task Status**: Periodically check task status to monitor progress
4. **Hide Management Sessions**: Set `hiddenFromAgents: true` for coordinator sessions
5. **Provider Templates**: Define providers once, reuse across sessions
6. **Message Cleanup**: Messages persist across restarts; clean up old threads periodically

## Future Enhancements

Potential additions:
- Message acknowledgment system
- Priority levels for async tasks
- Task cancellation
- Batch message operations
- Message search and filtering
- Task dependencies and chaining
- Session discovery broadcast
- Message encryption for sensitive data

## Troubleshooting

### Messages Not Persisting
- Check workspace directory exists
- Verify write permissions on workspace
- Check logs for save/load errors

### Tasks Not Processing
- Verify target session is active
- Check task status with `check_async_tasks`
- Look for errors in task error field

### Session Creation Fails
- Verify provider template exists
- Check API keys are valid
- Ensure session ID is unique
- Verify workspace directory is writable

## Support

For issues or questions:
1. Check the logs in `<workspace>/logs/`
2. Verify configuration with `node test-a2a-aca.mjs`
3. Review ADVANCED_FEATURES.md for A2A and ACA details
4. Check TESTING_A2A_ACA.md for testing guidelines
