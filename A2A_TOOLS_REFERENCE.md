# Enhanced A2A Tools Quick Reference

## Overview
7 new tools for advanced session-to-session communication and collaboration.

---

## 1. list_agents
**Purpose**: Discover available AI sessions

**Usage**:
```
Use list_agents to see what other agents are available
```

**Returns**:
- Agent names and session IDs
- Capabilities and specializations
- Available tools
- Current status

**Notes**: Hidden sessions won't appear

---

## 2. create_session
**Purpose**: Dynamically create new AI sessions

**Usage**:
```
Use create_session to create a session called "analyst" using "openai" template with custom identity focusing on data analysis
```

**Parameters**:
- `session_id` (required): Unique identifier
- `provider_template` (required): Template name from config
- `name` (required): Display name
- `description` (required): Session description
- `identity_content` (optional): Custom IDENTITY.md text
- `soul_content` (optional): Custom SOUL.md text
- `user_content` (optional): Custom USER.md text
- `memory_content` (optional): Custom MEMORY.md text
- `enable_a2a` (optional): Enable A2A (default: true)
- `hidden_from_agents` (optional): Hide from list (default: false)

**Returns**:
- Session ID
- Workspace path
- Configuration details

**Notes**:
- Provider template must exist in config
- Session ID must be unique
- Creates workspace and config entry

---

## 3. list_provider_templates
**Purpose**: View available provider configurations

**Usage**:
```
Use list_provider_templates to see available providers
```

**Returns**:
- Template name
- API endpoint
- Available models
- Default model
- Context window
- Embedding model

**Notes**: Templates defined in config.json

---

## 4. send_message_to_session
**Purpose**: Send direct messages to other sessions

**Usage**:
```
Use send_message_to_session to send "Hello!" to session "researcher"
```

**Parameters**:
- `target_session` (required): Recipient session ID
- `message` (required): Message text
- `thread_id` (optional): Thread identifier for grouping

**Returns**:
- Message ID
- Timestamp
- Delivery confirmation

**Notes**:
- Messages persist across restarts
- Use thread_id to organize conversations

---

## 5. read_session_messages
**Purpose**: Check incoming messages

**Usage**:
```
Use read_session_messages to check for new messages
Use read_session_messages with thread_id "project-alpha"
```

**Parameters**:
- `unread_only` (optional): Only unread (default: true)
- `thread_id` (optional): Filter by thread

**Returns**:
- Sender session ID
- Message content
- Timestamp
- Read status
- Thread ID (if any)

**Notes**:
- Marks messages as read after viewing
- Can filter by thread for organized reading

---

## 6. delegate_task_async
**Purpose**: Delegate tasks to other sessions without blocking

**Usage**:
```
Use delegate_task_async to ask "coder" to "Implement a REST API for user management"
```

**Parameters**:
- `target_session` (required): Session to delegate to
- `task` (required): Task description
- `context` (optional): Additional data object

**Returns**:
- Task ID for tracking
- Creation timestamp
- Initial status

**Notes**:
- Non-blocking: returns immediately
- Task processes in background
- Use check_async_tasks to monitor

---

## 7. check_async_tasks
**Purpose**: Monitor async task status

**Usage**:
```
Use check_async_tasks to see tasks assigned to me
Use check_async_tasks created_by_me:true
```

**Parameters**:
- `created_by_me` (optional): Show tasks I created (default: false)
- `assigned_to_me` (optional): Show tasks for me (default: true)

**Returns**:
- Task ID
- From/to session IDs
- Task description
- Current status
- Results (if completed)
- Timestamps

**Notes**:
- Shows pending, processing, completed, and failed tasks
- Old completed tasks cleaned after 24 hours

---

## 8. complete_async_task
**Purpose**: Mark delegated tasks as complete

**Usage**:
```
Use complete_async_task with task_id "abc123" and result "API implemented successfully"
```

**Parameters**:
- `task_id` (required): Task identifier
- `result` (optional): Success message/result
- `error` (optional): Error message (for failures)

**Returns**:
- Updated task status
- Completion timestamp

**Notes**:
- Use `result` for successful completion
- Use `error` for failures
- Task creator can see results with check_async_tasks

---

## Common Workflows

### 1. Simple Message Exchange
```
Session A: send_message_to_session -> Session B
Session B: read_session_messages
Session B: send_message_to_session -> Session A (reply)
Session A: read_session_messages
```

### 2. Async Task Delegation
```
Session A: delegate_task_async -> Session B
Session A: check_async_tasks (created_by_me)
Session B: check_async_tasks (assigned_to_me)
Session B: [Do the work]
Session B: complete_async_task with result
Session A: check_async_tasks (see result)
```

### 3. Multi-Session Collaboration
```
Session A: delegate_task_async -> Session B (research)
Session B: complete_async_task with findings
Session A: delegate_task_async -> Session C (implement)
Session C: complete_async_task with code
Session A: check_async_tasks (review all)
```

### 4. Creating Specialized Agent
```
Session A: list_provider_templates
Session A: create_session with custom identity
Session A: send_message_to_session -> new session
New Session: read_session_messages
```

### 5. Threaded Conversation
```
Session A: send_message_to_session with thread_id="project-x"
Session A: send_message_to_session with thread_id="project-x"
Session B: read_session_messages with thread_id="project-x"
```

---

## Tips and Best Practices

1. **Use Threads**: Organize related messages with thread_id
2. **Async for Long Tasks**: Use delegate_task_async for anything > 30 seconds
3. **Check Status Regularly**: Monitor tasks with check_async_tasks
4. **Hide Coordinators**: Set hidden_from_agents=true for management sessions
5. **Template Reuse**: Define providers once, use for all sessions
6. **Descriptive Task Names**: Be specific in task descriptions
7. **Include Context**: Pass relevant data in task context field
8. **Read Before Sending**: Check for messages before sending to avoid confusion

---

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "Target session not found" | Invalid session ID | Check with list_agents |
| "Provider template not found" | Invalid template name | Use list_provider_templates |
| "Task not found" | Invalid task ID | Use check_async_tasks |
| "Session ID already exists" | Duplicate session | Choose different ID |
| "Failed to save messages" | Write permission | Check workspace permissions |

---

## Configuration Requirements

### Enable A2A
```json
{
  "sessions": {
    "my_session": {
      "a2a": {
        "enabled": true
      }
    }
  }
}
```

### Add Provider Template
```json
{
  "providerTemplates": {
    "openai": {
      "name": "OpenAI",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-YOUR_KEY",
      "availableModels": ["gpt-4o"],
      "defaultModel": "gpt-4o"
    }
  }
}
```

### Hide Session from Discovery
```json
{
  "sessions": {
    "hidden_session": {
      "a2a": {
        "enabled": true,
        "hiddenFromAgents": true
      }
    }
  }
}
```

---

## File Locations

- **Messages**: `<workspace>/session_messages.jsonl`
- **Config**: `./config.json`
- **Workspaces**: `./workspaces/<session_id>/`
- **Logs**: `<workspace>/logs/`

---

## See Also

- `ENHANCED_A2A_IMPLEMENTATION.md` - Full implementation details
- `TESTING_ENHANCED_A2A.md` - Comprehensive testing guide
- `ADVANCED_FEATURES.md` - A2A and ACA overview
- `config.example.json` - Configuration examples
