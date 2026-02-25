# UI Settings Implementation - Testing Guide

## Overview
This document describes the UI changes for provider templates and A2A settings configuration.

## Features Added

### 1. Global Settings Modal - Provider Templates Tab

**Location**: Settings button (top right) → Provider Templates tab

**Features**:
- View all configured provider templates
- Add new provider templates
- Edit existing provider templates
- Delete provider templates

**Fields**:
- Template Name (e.g., "OpenAI", "Anthropic")
- API Endpoint (e.g., "https://api.openai.com/v1")
- API Key (password field)
- Available Models (comma-separated list)
- Default Model
- Embedding Model (optional)
- Context Window (optional)

**API**:
- GET `/api/provider-templates` - Fetch all provider templates
- PUT `/api/provider-templates` - Save provider templates

### 2. Session Settings Modal - A2A Tab

**Location**: Session Settings (gear icon) → A2A tab

**Features**:
- Enable/disable A2A communication for the session
- Hide session from other agents (coordinator mode)
- View list of available A2A tools when enabled
- Information about A2A features

**Settings**:
- **Enable A2A Communication** (checkbox) - Enables inter-session communication
- **Hide from agents** (checkbox) - Prevents this session from appearing in `list_agents`

**Available Tools Display**:
When A2A is enabled, shows:
- `list_agents` - Discover other AI sessions
- `create_session` - Create new AI sessions dynamically
- `list_provider_templates` - View available provider configs
- `send_message_to_session` - Send direct messages
- `read_session_messages` - Read incoming messages
- `delegate_task_async` - Delegate tasks asynchronously
- `check_async_tasks` - Monitor task status
- `complete_async_task` - Complete delegated tasks

## Testing Steps

### Test 1: Provider Templates CRUD

1. Start the application: `npm run dev`
2. Open dashboard at `http://localhost:8080`
3. Click Settings (⚙️) in top right corner
4. Click "Provider Templates" tab
5. Click "+ Add Provider Template"
6. Fill in the form:
   - Name: "Test Provider"
   - Endpoint: "https://api.example.com/v1"
   - API Key: "test-key-123"
   - Available Models: "model-1, model-2"
   - Default Model: "model-1"
7. Click "Add Template"
8. Verify template appears in the list
9. Click edit (✏️) button
10. Modify the name to "Test Provider Updated"
11. Click "Save Changes"
12. Verify the name is updated
13. Click delete (🗑️) button
14. Verify template is removed from list
15. Click "Save Settings"
16. Reopen Settings → Provider Templates
17. Verify changes persisted

**Expected**: All CRUD operations work correctly and data persists to `config.json`

### Test 2: A2A Settings

1. Open dashboard
2. Click on a session's gear icon (Session Settings)
3. Click "A2A" tab
4. Verify checkbox "Enable A2A Communication" is visible
5. Check the "Enable A2A Communication" checkbox
6. Verify "Hide from agents" checkbox appears
7. Verify "A2A Tools Available" section appears with tool list
8. Check "Hide from agents" checkbox
9. Click "Save"
10. Reopen Session Settings → A2A tab
11. Verify both checkboxes are still checked
12. Uncheck "Enable A2A Communication"
13. Verify "Hide from agents" checkbox disappears
14. Verify info box about A2A appears
15. Click "Save"
16. Open `config.json`
17. Verify `sessions.<session_id>.a2a.enabled` is false
18. Verify `sessions.<session_id>.a2a.hiddenFromAgents` is removed or false

**Expected**: A2A settings save correctly to session config

### Test 3: Integration Test

1. Configure 2 provider templates (e.g., OpenAI and Anthropic)
2. Create/enable A2A on two sessions
3. Hide one session from agents
4. In the visible session, send message to AI: "Use list_agents"
5. Verify only the non-hidden session appears
6. Try to send message to hidden session by ID
7. Verify it works (hidden sessions can still receive messages)

**Expected**: Hidden sessions don't appear in list but are still functional

## Files Modified

### New Files
- `app/api/provider-templates/route.ts` - API route for provider templates

### Modified Files
- `src/components/dashboard/Modals.tsx` - Added provider templates and A2A tabs

## Configuration Schema

### Provider Templates
```json
{
  "providerTemplates": {
    "openai": {
      "name": "OpenAI",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "availableModels": ["gpt-4o", "gpt-4o-mini"],
      "defaultModel": "gpt-4o",
      "embeddingModel": "text-embedding-3-small",
      "contextWindow": 128000
    }
  }
}
```

### A2A Session Config
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

## UI Components

### Global Settings Modal Tabs
1. Search Engine (existing)
2. **Provider Templates (NEW)**
3. Skills (existing)

### Session Settings Modal Tabs
1. General (existing)
2. **A2A (NEW)**
3. Consult AI (existing)
4. Discord (existing)
5. Slack (existing)
6. MCP (existing)
7. Tools (existing)

## Troubleshooting

### Provider templates not saving
- Check browser console for errors
- Verify `/api/provider-templates` endpoint is accessible
- Check file permissions on `config.json`

### A2A settings not persisting
- Verify session config API is working: GET `/api/sessions/<id>/config`
- Check that session exists in config.json
- Restart server if hot-reload doesn't pick up changes

### UI not showing tabs
- Clear browser cache
- Check browser console for React errors
- Verify TypeScript compilation succeeded

## Success Criteria

✅ Provider templates tab appears in Global Settings
✅ Can add, edit, and delete provider templates
✅ Provider templates save to config.json
✅ A2A tab appears in Session Settings
✅ Can enable/disable A2A communication
✅ Can hide sessions from agent discovery
✅ Settings persist across page reloads
✅ Configuration files are valid JSON

## Notes

- Provider templates are stored at the global config level
- A2A settings are stored per-session
- Hidden sessions are still accessible by direct session ID
- Changes require saving before taking effect
- Some changes may require server restart (provider templates)
