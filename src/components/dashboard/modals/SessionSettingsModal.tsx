import React, { useState, useEffect, useRef } from "react";
import { McpServerConfig } from "../types";

// -------- ModelSelector Component --------
const ModelSelector = ({
  value,
  onChange,
  endpoint,
  apiKey,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  endpoint: string;
  apiKey: string;
  placeholder?: string;
}) => {
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchModels = async () => {
    if (!endpoint) return;
    setFetching(true);
    setFetchError("");
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error || "Failed to fetch models");
      } else {
        setModels(data.models || []);
        setOpen(true);
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    } catch {
      setFetchError("Network error");
    } finally {
      setFetching(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = models.filter((m) =>
    m.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="form-input mono"
          style={{ flex: 1 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "model name"}
        />
        <button
          type="button"
          className="btn"
          style={{ whiteSpace: "nowrap", padding: "6px 12px", fontSize: 13 }}
          onClick={fetchModels}
          disabled={fetching || !endpoint}
          title={!endpoint ? "API Endpoint を入力してください" : ""}
        >
          {fetching ? "取得中…" : "モデル一覧"}
        </button>
      </div>
      {fetchError && (
        <div style={{ color: "var(--error, #f87171)", fontSize: 12 }}>
          {fetchError}
        </div>
      )}
      {open && models.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-secondary)",
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ padding: "8px" }}>
            <input
              ref={searchRef}
              className="form-input mono"
              style={{ fontSize: 13, padding: "6px 10px" }}
              placeholder="モデルを検索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: "8px 12px",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                該当なし
              </div>
            ) : (
              filtered.map((m) => (
                <div
                  key={m}
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={{
                    padding: "7px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                    fontFamily: "monospace",
                    background:
                      value === m ? "var(--accent, #6366f1)" : "transparent",
                    color: value === m ? "#fff" : "var(--text)",
                  }}
                  onMouseEnter={(e) => {
                    if (value !== m)
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--bg-primary)";
                  }}
                  onMouseLeave={(e) => {
                    if (value !== m)
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                  }}
                >
                  {m}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const MCP_TEMPLATES: any = {
  custom: { id: "", command: "npx", args: "" },
  figma: { id: "figma", command: "npx", args: "-y\nfigma-developer-mcp" },
  filesystem: {
    id: "filesystem",
    command: "npx",
    args: "-y\n@modelcontextprotocol/server-filesystem\nC:\\path\\to\\dir",
  },
  "brave-search": {
    id: "brave-search",
    command: "npx",
    args: "-y\n@modelcontextprotocol/server-brave-search",
  },
  github: {
    id: "github",
    command: "npx",
    args: "-y\n@modelcontextprotocol/server-github",
  },
};

// -------- Session Settings Modal --------
export const SessionSettingsModal = ({
  sessionId,
  onClose,
  onSave,
  onDelete,
}: any) => {
  const [tab, setTab] = useState<
    "general" | "consult" | "discord" | "slack" | "mcp" | "tools" | "a2a"
  >("general");
  const [config, setConfig] = useState<any>({});
  const [toolsList, setToolsList] = useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<Record<string, McpServerConfig>>(
    {},
  );
  const [mcpStatus, setMcpStatus] = useState<Record<string, any>>({});
  const [mcpFormVisible, setMcpFormVisible] = useState(false);
  const [mcpForm, setMcpForm] = useState({
    id: "",
    command: "npx",
    args: "",
    type: "command",
    endpointUrl: "",
    apiKey: "",
    model: "",
  });
  const [mcpEditId, setMcpEditId] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  const setNested = (path: string[], value: any) => {
    setConfig((prev: any) => {
      const copy = { ...prev };
      let curr = copy;
      for (let i = 0; i < path.length - 1; i++) {
        if (!curr[path[i]]) curr[path[i]] = {};
        curr = curr[path[i]];
      }
      curr[path[path.length - 1]] = value;
      return copy;
    });
  };

  const setDiscordArray = (field: string, csv: string) => {
    const arr = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setNested(["discord", field], arr);
  };

  const setSlackArray = (field: string, csv: string) => {
    const arr = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setNested(["slack", field], arr);
  };

  const groupedTools = React.useMemo(() => {
    const groups: Record<string, any[]> = {};
    toolsList.forEach((t) => {
      const name = t.function.name;
      if (name.startsWith("mcp_")) {
        const serverId = Object.keys(mcpConfig).find((id) =>
          name.startsWith(`mcp_${id}_`),
        );
        if (serverId) {
          const groupName = `MCP: ${serverId}`;
          if (!groups[groupName]) groups[groupName] = [];
          groups[groupName].push(t);
        } else {
          const groupName = "MCP: Other";
          groups[groupName] = groups[groupName] || [];
          groups[groupName].push(t);
        }
      } else {
        let groupName = "Built-in: Other";
        if (name.endsWith("_file") || name === "list_dir")
          groupName = "Built-in: Filesystem";
        else if (name.endsWith("_search")) groupName = "Built-in: Search";
        else if (name.startsWith("memory_")) groupName = "Built-in: Memory";
        else if (name.startsWith("schedule_"))
          groupName = "Built-in: Scheduling";
        else if (name === "exec") groupName = "Built-in: Execution";
        else if (name.startsWith("web_")) groupName = "Built-in: Web";
        else if (name.startsWith("browser_")) groupName = "Built-in: Browser";
        else if (
          name.startsWith("self_") ||
          name === "read_config" ||
          name === "read_config_file"
        )
          groupName = "Built-in: System/Self";
        else if (name.startsWith("git_")) groupName = "Built-in: Git";
        else if (
          name === "list_agents" ||
          name === "find_agents" ||
          name === "send_to_agent" ||
          name === "check_a2a_messages" ||
          name === "respond_to_agent" ||
          name === "get_my_card" ||
          name === "create_session" ||
          name === "list_provider_templates" ||
          name === "send_message_to_session" ||
          name === "read_session_messages" ||
          name === "delegate_task_async" ||
          name === "check_async_tasks" ||
          name === "complete_async_task"
        )
          groupName = "Built-in: A2A";
        else if (
          name === "view_curiosity_state" ||
          name === "view_objectives" ||
          name === "trigger_curiosity_scan" ||
          name === "schedule_objective" ||
          name === "complete_objective"
        )
          groupName = "Built-in: ACA";
        else if (name === "sleep" || name === "clear_history")
          groupName = "Built-in: Utility";

        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(t);
      }
    });
    return groups;
  }, [toolsList, mcpConfig]);

  const loadMcp = () => {
    fetch(`/api/sessions/${sessionId}/mcp`)
      .then((r) => r.json())
      .then(setMcpConfig)
      .catch(() => {});

    fetch(`/api/sessions/${sessionId}/mcp/status`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const map: Record<string, any> = {};
          for (const item of data) map[item.id] = item;
          setMcpStatus(map);
        }
      })
      .catch(() => {});
  };

  const loadTools = () => {
    setToolsLoading(true);
    fetch(`/api/sessions/${sessionId}/tools`)
      .then((r) => r.json())
      .then((data) => {
        if (data.tools) setToolsList(data.tools);
      })
      .catch((err) => console.error("Failed to load tools", err))
      .finally(() => setToolsLoading(false));
  };

  useEffect(() => {
    if (!sessionId) return;
    setConfigLoading(true);
    fetch(`/api/sessions/${sessionId}/config`)
      .then((r) => r.json())
      .then(setConfig)
      .finally(() => setConfigLoading(false));
    loadMcp();
    loadTools();

    // Auto-poll MCP status while the modal is open
    const interval = setInterval(loadMcp, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  const handleSave = async () => {
    const configToSave = { ...config };
    delete configToSave.mcpServers; // Prevent overwriting MCP configurations managed separately

    await fetch(`/api/sessions/${sessionId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configToSave),
    });

    // Also save Discord settings directly via the discord endpoint for consistency
    if (configToSave.discord) {
      await fetch(`/api/sessions/${sessionId}/discord`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave.discord),
      });
    }

    if (configToSave.slack) {
      await fetch(`/api/sessions/${sessionId}/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave.slack),
      });
    }

    onSave();
  };

  const handleToggleMcp = async (id: string, enabled: boolean) => {
    await fetch(`/api/sessions/${sessionId}/mcp/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (enabled) {
      await fetch(`/api/sessions/${sessionId}/mcp/${id}/restart`, {
        method: "POST",
      }).catch(() => {});
    }
    loadMcp();
  };

  const handleRestartMcp = async (id: string) => {
    await fetch(`/api/sessions/${sessionId}/mcp/${id}/restart`, {
      method: "POST",
    });
  };

  const handleDeleteMcp = async (id: string) => {
    if (!confirm(`Delete MCP server "${id}"?`)) return;
    await fetch(`/api/sessions/${sessionId}/mcp/${id}`, { method: "DELETE" });
    loadMcp();
  };

  const handleEditMcp = (id: string) => {
    const cfg = mcpConfig[id];
    setMcpEditId(id);
    setMcpForm({
      id,
      command: cfg.command || "",
      args: (cfg.args || []).join("\n"),
      type: (cfg.type as string) || "command",
      endpointUrl: cfg.endpointUrl || "",
      apiKey: cfg.apiKey || "",
      model: cfg.model || "",
    });
    setMcpFormVisible(true);
  };

  const handleAddMcp = () => {
    setMcpEditId(null);
    setMcpForm({
      id: "",
      command: "npx",
      args: "",
      type: "command",
      endpointUrl: "",
      apiKey: "",
      model: "",
    });
    setMcpFormVisible(true);
  };

  const handleSaveMcp = async () => {
    const { id, command, args, type, endpointUrl, apiKey, model } = mcpForm;
    if (!id) return alert("ID required");
    if (type === "command" && !command) return alert("ID and Command required");
    if (type === "builtin-consult" && !endpointUrl)
      return alert("Endpoint URL required");

    const argsArray =
      type === "command"
        ? args
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const payload =
      type === "builtin-consult"
        ? {
            id,
            type: "builtin-consult",
            endpointUrl,
            apiKey,
            model,
            enabled: true,
          }
        : { id, command, args: argsArray, enabled: true };

    if (mcpEditId) {
      await fetch(`/api/sessions/${sessionId}/mcp/${mcpEditId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      fetch(`/api/sessions/${sessionId}/mcp/${mcpEditId}/restart`, {
        method: "POST",
      }).catch(() => {});
    } else {
      await fetch(`/api/sessions/${sessionId}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      fetch(`/api/sessions/${sessionId}/mcp/${id}/restart`, {
        method: "POST",
      }).catch(() => {});
    }
    setMcpFormVisible(false);
    loadMcp();
  };

  const handleTemplateChange = (e: any) => {
    const tpl = MCP_TEMPLATES[e.target.value];
    if (tpl && e.target.value !== "custom") {
      setMcpForm({
        id: tpl.id,
        command: tpl.command,
        args: tpl.args,
        type: "command",
        endpointUrl: "",
        apiKey: "",
        model: "",
      });
    } else {
      setMcpForm({
        id: "",
        command: "npx",
        args: "",
        type: "command",
        endpointUrl: "",
        apiKey: "",
        model: "",
      });
    }
  };

  return (
    <div
      className="modal-overlay active"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          (e.currentTarget as any)._isMouseDownOnOverlay = true;
        } else {
          (e.currentTarget as any)._isMouseDownOnOverlay = false;
        }
      }}
      onClick={(e) => {
        if (
          e.target === e.currentTarget &&
          (e.currentTarget as any)._isMouseDownOnOverlay
        ) {
          if (!configLoading) handleSave();
        }
        (e.currentTarget as any)._isMouseDownOnOverlay = false;
      }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Session Settings</h2>
          <button
            className="close-btn"
            onClick={onClose}
            disabled={configLoading}
          >
            &times;
          </button>
        </div>
        <div className="modal-body">
          {configLoading ? (
            <div className="modal-skeleton">
              <div className="skeleton-line label" />
              <div className="skeleton-input" />
              <div className="skeleton-line label" />
              <div className="skeleton-input" />
              <div className="skeleton-line label" />
              <div className="skeleton-input" />
              <div className="skeleton-line label" />
              <div className="skeleton-input" />
            </div>
          ) : (
            <>
              <div className="modal-tabs">
                <div
                  className={`modal-tab ${tab === "general" ? "active" : ""}`}
                  onClick={() => setTab("general")}
                >
                  General
                </div>
                <div
                  className={`modal-tab ${tab === "a2a" ? "active" : ""}`}
                  onClick={() => setTab("a2a")}
                >
                  A2A
                </div>
                <div
                  className={`modal-tab ${tab === "consult" ? "active" : ""}`}
                  onClick={() => setTab("consult")}
                >
                  Consult AI
                </div>
                <div
                  className={`modal-tab ${tab === "discord" ? "active" : ""}`}
                  onClick={() => setTab("discord")}
                >
                  Discord
                </div>
                <div
                  className={`modal-tab ${tab === "slack" ? "active" : ""}`}
                  onClick={() => setTab("slack")}
                >
                  Slack
                </div>
                <div
                  className={`modal-tab ${tab === "mcp" ? "active" : ""}`}
                  onClick={() => setTab("mcp")}
                >
                  MCP
                </div>
                <div
                  className={`modal-tab ${tab === "tools" ? "active" : ""}`}
                  onClick={() => {
                    setTab("tools");
                    loadTools();
                  }}
                >
                  Tools
                </div>
              </div>

              {tab === "general" && (
                <div>
                  <div className="form-group">
                    <label className="form-label">Session Name</label>
                    <input
                      className="form-input"
                      value={config.name || ""}
                      onChange={(e) => setNested(["name"], e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input
                      className="form-input"
                      value={config.description || ""}
                      onChange={(e) =>
                        setNested(["description"], e.target.value)
                      }
                    />
                  </div>

                  <div className="settings-title">Provider Config</div>
                  <div className="form-group">
                    <label className="form-label">API Endpoint</label>
                    <input
                      className="form-input mono"
                      value={config.provider?.endpoint || ""}
                      onChange={(e) =>
                        setNested(["provider", "endpoint"], e.target.value)
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">API Key</label>
                    <input
                      type="password"
                      className="form-input mono"
                      placeholder="••••••••"
                      value={config.provider?.apiKey || ""}
                      onChange={(e) =>
                        setNested(["provider", "apiKey"], e.target.value)
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Model</label>
                    <ModelSelector
                      value={config.provider?.model || ""}
                      onChange={(v) => setNested(["provider", "model"], v)}
                      endpoint={config.provider?.endpoint || ""}
                      apiKey={config.provider?.apiKey || ""}
                    />
                  </div>
                  <div className="settings-title">Other</div>
                  <div className="form-group">
                    <label className="form-label">Workspace Path</label>
                    <input
                      className="form-input mono"
                      value={config.workspace || ""}
                      onChange={(e) => setNested(["workspace"], e.target.value)}
                    />
                  </div>

                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.restrictToWorkspace ?? true}
                        onChange={(e) =>
                          setNested(["restrictToWorkspace"], e.target.checked)
                        }
                      />
                      Restrict to Workspace
                    </label>
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.allowSelfModify ?? false}
                        onChange={(e) =>
                          setNested(["allowSelfModify"], e.target.checked)
                        }
                      />
                      Allow AI to modify its own code
                    </label>
                  </div>

                  <div className="env-actions" style={{ marginTop: 24 }}>
                    <button
                      className="btn danger"
                      onClick={() => onDelete(sessionId)}
                    >
                      Delete Session
                    </button>
                  </div>
                </div>
              )}

              {tab === "a2a" && (
                <div>
                  <div className="settings-title">
                    Agent-to-Agent (A2A) Communication
                  </div>
                  <p
                    style={{
                      color: "var(--text-dim)",
                      fontSize: "13px",
                      marginBottom: 16,
                    }}
                  >
                    Configure inter-session communication and collaboration
                    features.
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.a2a?.enabled ?? false}
                        onChange={(e) =>
                          setNested(["a2a", "enabled"], e.target.checked)
                        }
                      />
                      Enable A2A Communication
                    </label>

                    {config.a2a?.enabled && (
                      <label className="form-checkbox">
                        <input
                          type="checkbox"
                          checked={config.a2a?.hiddenFromAgents ?? false}
                          onChange={(e) =>
                            setNested(
                              ["a2a", "hiddenFromAgents"],
                              e.target.checked,
                            )
                          }
                        />
                        Hide this session from other agents (coordinator mode)
                      </label>
                    )}
                  </div>

                  {config.a2a?.enabled && (
                    <div style={{ marginTop: 20 }}>
                      <div className="settings-title">A2A Tools Available</div>
                      <div
                        style={{
                          color: "var(--text-dim)",
                          fontSize: "13px",
                          marginTop: 8,
                        }}
                      >
                        When A2A is enabled, this session can use the following
                        tools:
                      </div>
                      <ul
                        style={{
                          color: "var(--text-dim)",
                          fontSize: "13px",
                          marginTop: 8,
                          paddingLeft: 20,
                        }}
                      >
                        <li>
                          <code>list_agents</code> - Discover other AI sessions
                        </li>
                        <li>
                          <code>create_session</code> - Create new AI sessions
                          dynamically
                        </li>
                        <li>
                          <code>list_provider_templates</code> - View available
                          provider configs
                        </li>
                        <li>
                          <code>send_message_to_session</code> - Send direct
                          messages
                        </li>
                        <li>
                          <code>read_session_messages</code> - Read incoming
                          messages
                        </li>
                        <li>
                          <code>delegate_task_async</code> - Delegate tasks
                          asynchronously
                        </li>
                        <li>
                          <code>check_async_tasks</code> - Monitor task status
                        </li>
                        <li>
                          <code>complete_async_task</code> - Complete delegated
                          tasks
                        </li>
                      </ul>
                    </div>
                  )}

                  {!config.a2a?.enabled && (
                    <div
                      style={{
                        marginTop: 20,
                        padding: 16,
                        backgroundColor: "var(--bg-secondary)",
                        borderRadius: 8,
                        fontSize: "13px",
                      }}
                    >
                      <strong>About A2A:</strong> When enabled, this session can
                      communicate with other sessions, delegate tasks, and
                      participate in multi-agent workflows. Enable A2A on at
                      least 2 sessions for collaboration.
                    </div>
                  )}
                </div>
              )}

              {tab === "consult" && (
                <div className="settings-section">
                  <div className="form-group">
                    <label className="form-label">Consult AI Endpoint</label>
                    <input
                      className="form-input mono"
                      placeholder={config.provider?.endpoint}
                      value={config.consultAi?.endpointUrl || ""}
                      onChange={(e) =>
                        setNested(["consultAi", "endpointUrl"], e.target.value)
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Consult AI API Key</label>
                    <input
                      type="password"
                      className="form-input mono"
                      placeholder="Leave blank to use session API key"
                      value={config.consultAi?.apiKey || ""}
                      onChange={(e) =>
                        setNested(["consultAi", "apiKey"], e.target.value)
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Consult AI Model</label>
                    <ModelSelector
                      value={config.consultAi?.model || ""}
                      onChange={(v) => setNested(["consultAi", "model"], v)}
                      endpoint={
                        config.consultAi?.endpointUrl ||
                        config.provider?.endpoint ||
                        ""
                      }
                      apiKey={
                        config.consultAi?.apiKey ||
                        config.provider?.apiKey ||
                        ""
                      }
                      placeholder={config.provider?.model || "model name"}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.consultAi?.enabled ?? true}
                        onChange={(e) =>
                          setNested(["consultAi", "enabled"], e.target.checked)
                        }
                      />
                      <span>Enable Consult AI Feature</span>
                    </label>
                  </div>
                </div>
              )}

              {tab === "discord" && (
                <div>
                  <div className="form-group">
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.discord?.enabled ?? false}
                        onChange={(e) =>
                          setNested(["discord", "enabled"], e.target.checked)
                        }
                      />
                      <span>Enable Discord integration</span>
                    </label>
                  </div>

                  {config.discord?.enabled && (
                    <>
                      <div className="form-group">
                        <label className="form-label">Bot Token</label>
                        <input
                          type="password"
                          className="form-input mono"
                          value={config.discord?.token || ""}
                          onChange={(e) =>
                            setNested(["discord", "token"], e.target.value)
                          }
                          placeholder="MTIzNDU2Nzg5..."
                        />
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">
                            Target Channels (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.discord?.channels || []).join(", ")}
                            onChange={(e) =>
                              setDiscordArray("channels", e.target.value)
                            }
                            placeholder="123456789, 987654321"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">
                            Target Guilds (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.discord?.guilds || []).join(", ")}
                            onChange={(e) =>
                              setDiscordArray("guilds", e.target.value)
                            }
                            placeholder="123456789"
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">
                            Allowed Users (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.discord?.allowFrom || []).join(", ")}
                            onChange={(e) =>
                              setDiscordArray("allowFrom", e.target.value)
                            }
                            placeholder="user_id1, user_id2"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Command Prefix</label>
                          <input
                            className="form-input mono"
                            value={config.discord?.prefix || ""}
                            onChange={(e) =>
                              setNested(["discord", "prefix"], e.target.value)
                            }
                            placeholder="!chat "
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === "slack" && (
                <div>
                  <div className="form-group">
                    <label className="form-checkbox">
                      <input
                        type="checkbox"
                        checked={config.slack?.enabled ?? false}
                        onChange={(e) =>
                          setNested(["slack", "enabled"], e.target.checked)
                        }
                      />
                      <span>Enable Slack integration</span>
                    </label>
                  </div>

                  {config.slack?.enabled && (
                    <>
                      <div className="form-group">
                        <label className="form-label">Bot Token</label>
                        <input
                          type="password"
                          className="form-input mono"
                          value={config.slack?.botToken || ""}
                          onChange={(e) =>
                            setNested(["slack", "botToken"], e.target.value)
                          }
                          placeholder="xoxb-..."
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">
                          App Token (optional)
                        </label>
                        <input
                          type="password"
                          className="form-input mono"
                          value={config.slack?.appToken || ""}
                          onChange={(e) =>
                            setNested(["slack", "appToken"], e.target.value)
                          }
                          placeholder="xapp-..."
                        />
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">
                            Target Channels (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.slack?.channels || []).join(", ")}
                            onChange={(e) =>
                              setSlackArray("channels", e.target.value)
                            }
                            placeholder="C01234567, C07654321"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">
                            Target Teams (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.slack?.teams || []).join(", ")}
                            onChange={(e) =>
                              setSlackArray("teams", e.target.value)
                            }
                            placeholder="T01234567"
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">
                            Allowed Users (CSV)
                          </label>
                          <input
                            className="form-input mono"
                            value={(config.slack?.allowFrom || []).join(", ")}
                            onChange={(e) =>
                              setSlackArray("allowFrom", e.target.value)
                            }
                            placeholder="U0123ABC, U0456DEF"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Command Prefix</label>
                          <input
                            className="form-input mono"
                            value={config.slack?.prefix || ""}
                            onChange={(e) =>
                              setNested(["slack", "prefix"], e.target.value)
                            }
                            placeholder="!chat "
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === "mcp" && (
                <div>
                  <div className="settings-title">
                    MCP Servers
                    <button className="btn add-btn" onClick={handleAddMcp}>
                      + Add Server
                    </button>
                  </div>

                  {mcpFormVisible && (
                    <div
                      style={{
                        marginBottom: 16,
                        background: "var(--surface2)",
                        padding: 16,
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                      }}
                    >
                      {!mcpEditId && (
                        <div className="form-group">
                          <label className="form-label">Template</label>
                          <select
                            className="form-input"
                            onChange={handleTemplateChange}
                          >
                            <option value="custom">Custom (blank)</option>
                            <option value="figma">Figma</option>
                            <option value="filesystem">Filesystem</option>
                            <option value="brave-search">Brave Search</option>
                            <option value="github">GitHub</option>
                          </select>
                        </div>
                      )}
                      <div className="form-group">
                        <label className="form-label">Server Type</label>
                        <select
                          className="form-input"
                          value={mcpForm.type}
                          onChange={(e) =>
                            setMcpForm({ ...mcpForm, type: e.target.value })
                          }
                        >
                          <option value="command">Command (StdIO)</option>
                          <option value="builtin-consult">
                            Built-in Consult AI
                          </option>
                        </select>
                      </div>
                      <div className="form-row">
                        <div
                          className="form-group"
                          style={{ flex: "0 0 140px" }}
                        >
                          <label className="form-label">Server ID</label>
                          <input
                            className="form-input mono"
                            value={mcpForm.id}
                            onChange={(e) =>
                              setMcpForm({ ...mcpForm, id: e.target.value })
                            }
                            disabled={!!mcpEditId}
                          />
                        </div>
                        {mcpForm.type === "command" && (
                          <div className="form-group">
                            <label className="form-label">Command</label>
                            <input
                              className="form-input mono"
                              value={mcpForm.command}
                              onChange={(e) =>
                                setMcpForm({
                                  ...mcpForm,
                                  command: e.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                      {mcpForm.type === "command" ? (
                        <div className="form-group">
                          <label className="form-label">
                            Arguments (one per line)
                          </label>
                          <textarea
                            className="file-editor"
                            value={mcpForm.args}
                            onChange={(e) =>
                              setMcpForm({ ...mcpForm, args: e.target.value })
                            }
                            rows={3}
                            style={{ minHeight: 56 }}
                            spellCheck="false"
                          />
                        </div>
                      ) : (
                        <>
                          <div className="form-group">
                            <label className="form-label">Endpoint URL</label>
                            <input
                              className="form-input mono"
                              value={mcpForm.endpointUrl}
                              onChange={(e) =>
                                setMcpForm({
                                  ...mcpForm,
                                  endpointUrl: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">API Key</label>
                            <input
                              type="password"
                              className="form-input mono"
                              value={mcpForm.apiKey}
                              onChange={(e) =>
                                setMcpForm({
                                  ...mcpForm,
                                  apiKey: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Model Name (optional)
                            </label>
                            <input
                              className="form-input mono"
                              value={mcpForm.model}
                              onChange={(e) =>
                                setMcpForm({
                                  ...mcpForm,
                                  model: e.target.value,
                                })
                              }
                              placeholder="gpt-4o-mini"
                            />
                          </div>
                        </>
                      )}
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          justifyContent: "flex-end",
                        }}
                      >
                        <button
                          className="btn"
                          onClick={() => setMcpFormVisible(false)}
                        >
                          Cancel
                        </button>
                        <button className="btn primary" onClick={handleSaveMcp}>
                          {mcpEditId ? "Save Changes" : "Add Server"}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="env-list">
                    {Object.keys(mcpConfig).length === 0 ? (
                      <div className="empty">No MCP servers</div>
                    ) : (
                      Object.entries(mcpConfig).map(([id, cfg]) => {
                        const statusData = mcpStatus[id];
                        const isConnected = statusData?.status === "connected";
                        const isError = statusData?.status === "error";
                        const isConnecting =
                          statusData?.status === "connecting";

                        let statusColor = "var(--text-dim)";
                        let statusText = "Stopped";
                        if (isConnecting) {
                          statusColor = "var(--accent)";
                          statusText = "Connecting...";
                        } else if (isConnected) {
                          statusColor = "var(--success)";
                          statusText = `Connected ${typeof statusData.toolCount === "number" ? `(${statusData.toolCount} tools)` : ""}`;
                        } else if (isError) {
                          statusColor = "var(--danger)";
                          statusText = "Error";
                        }

                        return (
                          <div
                            key={id}
                            className="env-item"
                            style={{
                              flexDirection: "column",
                              alignItems: "stretch",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 12,
                              }}
                            >
                              <div className="env-info" style={{ flex: 1 }}>
                                <div
                                  className="env-name"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                  }}
                                >
                                  {id}
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      fontSize: "12px",
                                      fontWeight: "normal",
                                      color: statusColor,
                                      background: "var(--surface2)",
                                      padding: "2px 6px",
                                      borderRadius: "12px",
                                    }}
                                  >
                                    <span
                                      style={{
                                        display: "inline-block",
                                        width: 6,
                                        height: 6,
                                        borderRadius: "50%",
                                        backgroundColor: statusColor,
                                      }}
                                    ></span>
                                    {statusText}
                                  </span>
                                </div>
                                <div className="env-detail mono">
                                  {cfg.type === "builtin-consult"
                                    ? `builtin-consult ${cfg.endpointUrl || ""}`
                                    : `${cfg.command || ""} ${
                                        cfg.args
                                          ?.map((a) =>
                                            a.includes(" ") &&
                                            !a.startsWith('"')
                                              ? `"${a}"`
                                              : a,
                                          )
                                          .join(" ") || ""
                                      }`}
                                </div>
                                {isError && statusData.error && (
                                  <div
                                    style={{
                                      color: "var(--danger)",
                                      fontSize: "12px",
                                      marginTop: 4,
                                      whiteSpace: "pre-wrap",
                                      wordBreak: "break-all",
                                    }}
                                  >
                                    {statusData.error}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div
                              className="env-actions"
                              style={{ flexShrink: 0, display: "flex", gap: 4 }}
                            >
                              <button
                                className="btn"
                                onClick={() => handleEditMcp(id)}
                                title="Edit"
                              >
                                ✎
                              </button>
                              <button
                                className="btn"
                                onClick={() => handleRestartMcp(id)}
                                title="Restart"
                                disabled={cfg.enabled === false}
                              >
                                ↻
                              </button>
                              <button
                                className="btn"
                                onClick={() =>
                                  handleToggleMcp(id, cfg.enabled === false)
                                }
                                title={
                                  cfg.enabled !== false ? "Disable" : "Enable"
                                }
                              >
                                {cfg.enabled !== false ? "⏸" : "▶"}
                              </button>
                              <button
                                className="btn danger"
                                onClick={() => handleDeleteMcp(id)}
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {tab === "tools" && (
                <div>
                  <div className="settings-title">Configure Tools</div>
                  <p
                    style={{
                      color: "var(--text-dim)",
                      fontSize: "13px",
                      marginBottom: 16,
                    }}
                  >
                    Select tools that are available to this session.
                  </p>
                  {toolsLoading ? (
                    <div className="empty">Loading tools...</div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 16,
                      }}
                    >
                      {Object.entries(groupedTools).map(
                        ([groupName, groupTools]: any) => {
                          if (groupTools.length === 0) return null;
                          return (
                            <div key={groupName}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 8,
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={groupTools.every(
                                    (t: any) =>
                                      !(config.disabledTools || []).includes(
                                        t.function.name,
                                      ),
                                  )}
                                  ref={(el) => {
                                    if (el) {
                                      const enabledCount = groupTools.filter(
                                        (t: any) =>
                                          !(
                                            config.disabledTools || []
                                          ).includes(t.function.name),
                                      ).length;
                                      el.indeterminate =
                                        enabledCount > 0 &&
                                        enabledCount < groupTools.length;
                                    }
                                  }}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const toolNames = groupTools.map(
                                      (t: any) => t.function.name,
                                    );
                                    let disabled = config.disabledTools || [];
                                    if (checked) {
                                      disabled = disabled.filter(
                                        (x: string) => !toolNames.includes(x),
                                      );
                                    } else {
                                      const toAdd = toolNames.filter(
                                        (x: string) => !disabled.includes(x),
                                      );
                                      disabled = [...disabled, ...toAdd];
                                    }
                                    setNested(["disabledTools"], disabled);
                                  }}
                                />
                                <h3
                                  style={{
                                    fontSize: "14px",
                                    textTransform: "capitalize",
                                    margin: 0,
                                  }}
                                >
                                  {groupName}
                                </h3>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 8,
                                  paddingLeft: 8,
                                }}
                              >
                                {groupTools.map((t: any) => {
                                  const name = t.function.name;
                                  const enabled = !(
                                    config.disabledTools || []
                                  ).includes(name);
                                  return (
                                    <label
                                      key={name}
                                      className="form-checkbox"
                                      style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: 8,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          const disabled =
                                            config.disabledTools || [];
                                          if (checked) {
                                            setNested(
                                              ["disabledTools"],
                                              disabled.filter(
                                                (x: string) => x !== name,
                                              ),
                                            );
                                          } else {
                                            if (!disabled.includes(name)) {
                                              setNested(
                                                ["disabledTools"],
                                                [...disabled, name],
                                              );
                                            }
                                          }
                                        }}
                                      />
                                      <div>
                                        <div
                                          style={{
                                            fontWeight: "bold",
                                            fontSize: "13px",
                                          }}
                                        >
                                          {name}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: "12px",
                                            color: "var(--text-dim)",
                                          }}
                                        >
                                          {t.function.description}
                                        </div>
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={configLoading}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={configLoading}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
