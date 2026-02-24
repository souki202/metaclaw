# Testing Guide: Enhanced A2A Features

This guide provides step-by-step instructions for testing the enhanced Agent-to-Agent (A2A) communication features.

## Prerequisites

1. Copy `config.example.json` to `config.json`
2. Set your API keys in `config.json`
3. Ensure at least 2 sessions have A2A enabled
4. Start the application: `npm run dev`

## Test Suite

### Test 1: Configuration Validation

**Objective**: Verify A2A and ACA configuration is correct

**Steps:**
```bash
node test-a2a-aca.mjs
```

**Expected Result:**
- All sessions load successfully
- A2A enabled count is at least 2
- ACA configuration is valid
- No errors displayed

### Test 2: List Available Agents

**Objective**: Verify sessions can discover each other

**Steps:**
1. Open dashboard
2. Select any session with A2A enabled
3. Send message: "Use list_agents to see what other agents are available"

**Expected Result:**
- Tool executes successfully
- Returns list of other sessions with A2A enabled
- Shows agent names, capabilities, specializations
- Hidden sessions (if any) are not shown

### Test 3: List Provider Templates

**Objective**: Verify provider templates are accessible

**Steps:**
1. In any session, send: "Use list_provider_templates to see available providers"

**Expected Result:**
- Returns list of configured provider templates
- Shows template names, endpoints, available models
- Includes context window and embedding model info

### Test 4: Send Direct Message

**Objective**: Test direct messaging between sessions

**Steps:**
1. In session "default", send: "Use send_message_to_session to send 'Hello from Claw!' to session 'researcher'"
2. Switch to session "researcher"
3. Send: "Use read_session_messages to check for new messages"

**Expected Result:**
- Message sends successfully in session "default"
- Returns message ID and timestamp
- Message appears in "researcher" session
- Shows correct sender, content, and timestamp
- Message marked as unread initially

### Test 5: Message Threading

**Objective**: Test organized conversations with threads

**Steps:**
1. In session "default", send: "Use send_message_to_session to send 'Starting project discussion' to 'coder' with thread_id 'project-alpha'"
2. In session "default", send: "Use send_message_to_session to send 'We need to discuss architecture' to 'coder' with thread_id 'project-alpha'"
3. In session "coder", send: "Use read_session_messages with thread_id 'project-alpha'"

**Expected Result:**
- Both messages sent successfully
- Reading in "coder" returns both messages in thread
- Messages are grouped by thread ID
- Thread ID matches in all messages

### Test 6: Asynchronous Task Delegation

**Objective**: Test non-blocking task delegation

**Steps:**
1. In session "default", send: "Use delegate_task_async to ask 'coder' to 'Create a simple Hello World function in Python'"
2. Note the task ID returned
3. Send immediately: "Use check_async_tasks to see status of tasks I created"
4. Wait 30 seconds
5. In session "coder", send: "Use check_async_tasks to see tasks assigned to me"

**Expected Result:**
- Task creation returns immediately with task ID
- Task status starts as "pending"
- Task appears in creator's outgoing task list
- Task appears in assignee's incoming task list
- Task eventually moves to "processing" status

### Test 7: Complete Async Task

**Objective**: Test task completion workflow

**Steps:**
1. In session "coder", send: "Use check_async_tasks assigned_to_me:true"
2. Note a task ID
3. Send: "Use complete_async_task with task_id '<TASK_ID>' and result 'Created hello_world.py with function that prints Hello World'"
4. In session "default", send: "Use check_async_tasks created_by_me:true"

**Expected Result:**
- Task status updates to "completed"
- Result is stored with the task
- Task has completion timestamp
- Creator can see the completed task with result

### Test 8: Create New Session

**Objective**: Test AI-driven session creation

**Steps:**
1. In session "default", send: "Use create_session to create a new session called 'analyst' using 'openai' provider template. Set the identity to focus on data analysis and statistical modeling."

**Expected Result:**
- Session created successfully
- New directory created in workspaces/analyst/
- IDENTITY.md file created with custom content
- Session config persisted to config.json
- Session automatically registered with A2A
- New session appears in list_agents (if not hidden)

### Test 9: Hidden Session

**Objective**: Test session visibility control

**Steps:**
1. Create session with `hidden_from_agents:true`
2. In another session, send: "Use list_agents"
3. Verify hidden session does not appear in list

**Expected Result:**
- Hidden session not visible in list_agents
- Hidden session still functional
- Can still send messages to hidden session by ID

### Test 10: Message Persistence

**Objective**: Verify messages persist across restarts

**Steps:**
1. Send messages between sessions
2. Stop the application
3. Check workspace directories for `session_messages.jsonl`
4. Restart application
5. Use read_session_messages to verify messages still present

**Expected Result:**
- Messages saved to session_messages.jsonl on shutdown
- File contains one JSON object per line
- Messages reload on startup
- All message history preserved

### Test 11: Task Status Tracking

**Objective**: Test task lifecycle monitoring

**Steps:**
1. Create an async task
2. Check status immediately - should be "pending"
3. Wait for processing - status becomes "processing"
4. Complete the task - status becomes "completed"
5. Check completed task includes timestamps for created/started/completed

**Expected Result:**
- Task progresses through all states
- Each state transition has timestamp
- Can track task from creation to completion
- Task history preserved for 24 hours

### Test 12: Multi-Session Collaboration

**Objective**: Test complex multi-session workflow

**Steps:**
1. In "default": Delegate research task to "researcher"
2. In "researcher": Accept task, do research, complete with findings
3. In "default": Get results, delegate implementation to "coder"
4. In "coder": Implement based on research, complete with code
5. In "default": Review all completed tasks

**Expected Result:**
- Tasks flow smoothly between sessions
- Each session can see relevant tasks
- Results from one task inform the next
- Complete workflow tracked with timestamps

### Test 13: Provider Template Usage

**Objective**: Test session creation with different providers

**Steps:**
1. List provider templates
2. Create session with "openai" template
3. Create another session with "anthropic" template
4. Verify both sessions work correctly

**Expected Result:**
- Both sessions created successfully
- Each uses correct API endpoint
- Models available match template configuration
- Sessions can communicate via A2A

### Test 14: Error Handling

**Objective**: Test error scenarios

**Steps:**
1. Try to send message to non-existent session
2. Try to complete task that doesn't exist
3. Try to create session with invalid provider template
4. Try to delegate task to inactive session

**Expected Result:**
- Appropriate error messages returned
- System remains stable
- Clear indication of what went wrong
- No crashes or data corruption

### Test 15: Concurrent Operations

**Objective**: Test multiple operations simultaneously

**Steps:**
1. Send 5 messages to different sessions rapidly
2. Create 3 async tasks at once
3. Check all operations complete successfully

**Expected Result:**
- All messages delivered
- All tasks created
- No message loss or corruption
- Task IDs all unique

## Verification Checklist

After running all tests, verify:

- [ ] All sessions can discover each other (unless hidden)
- [ ] Messages send and receive correctly
- [ ] Message threading works
- [ ] Async tasks delegate without blocking
- [ ] Task status updates correctly
- [ ] Tasks can be completed with results
- [ ] New sessions can be created by AI
- [ ] Provider templates work correctly
- [ ] Hidden sessions not visible in list_agents
- [ ] Messages persist across restarts
- [ ] Multiple concurrent operations work
- [ ] Error handling is appropriate
- [ ] No data loss or corruption
- [ ] Workspace files created correctly
- [ ] Config updates persist correctly

## Common Issues and Solutions

### Issue: Messages not appearing
**Solution**: Check both sessions have A2A enabled, verify workspace directory exists

### Issue: Task stuck in "pending"
**Solution**: Verify target session is active and running

### Issue: Session creation fails
**Solution**: Check provider template exists and has valid API key

### Issue: Messages not persisting
**Solution**: Verify write permissions on workspace directory

### Issue: Cannot see other sessions
**Solution**: Check A2A is enabled on both sessions, verify not hidden

## Performance Testing

### Load Test: Multiple Messages
Send 100 messages between sessions and measure:
- Delivery time
- Memory usage
- Message file size

### Load Test: Many Tasks
Create 50 async tasks simultaneously and measure:
- Task creation time
- Processing throughput
- System resource usage

### Stress Test: Session Creation
Create 10 new sessions rapidly and verify:
- All sessions created successfully
- No ID conflicts
- Config remains valid
- All sessions functional

## Debugging Tips

1. **Enable Verbose Logging**: Check logs in `<workspace>/logs/`
2. **Inspect Message Files**: View `session_messages.jsonl` directly
3. **Check Config**: Verify `config.json` after session creation
4. **Monitor Resources**: Watch CPU and memory during operations
5. **Use Test Script**: Run `node test-a2a-aca.mjs` for quick validation

## Reporting Issues

When reporting issues, include:
1. Test number and objective
2. Exact steps taken
3. Expected vs actual result
4. Log files from affected sessions
5. Config file (sanitize API keys)
6. Message files (if relevant)
7. System info (OS, Node version)

## Success Criteria

Tests pass if:
- All 15 tests complete without errors
- All items in verification checklist are checked
- Performance is acceptable (messages < 100ms, tasks < 1s creation)
- No data loss or corruption observed
- System remains stable under load
- Error handling is clear and helpful
