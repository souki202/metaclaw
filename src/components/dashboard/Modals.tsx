import React, { useState, useEffect } from "react";
import { McpServerConfig } from "./types";

// -------- Global Settings Modal --------
export const GlobalSettingsModal = ({ onClose, onSave }: any) => {
  const [tab, setTab] = useState<"search" | "skills">("search");
  const [provider, setProvider] = useState("brave");
  const [braveKey, setBraveKey] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [vertexProject, setVertexProject] = useState("");
  const [vertexLocation, setVertexLocation] = useState("global");
  const [vertexDatastore, setVertexDatastore] = useState("");
  const [skills, setSkills] = useState<any[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  useEffect(() => {
    fetch("/api/search")
      .then((r) => r.ok && r.json())
      .then((data) => {
        if (data) {
          setProvider(data.provider || "brave");
          setBraveKey(data.braveApiKey || "");
          setSerperKey(data.serperApiKey || "");
          setVertexProject(data.vertexProjectId || "");
          setVertexLocation(data.vertexLocation || "global");
          setVertexDatastore(data.vertexDataStoreId || "");
        }
      });
  }, []);

  const handleSave = async () => {
    await fetch("/api/search", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        braveApiKey: braveKey,
        serperApiKey: serperKey,
        vertexProjectId: vertexProject,
        vertexLocation,
        vertexDataStoreId: vertexDatastore,
      }),
    });
    onSave();
  };

  const loadSkills = async () => {
    setSkillsLoading(true);
    try {
      const res = await fetch("/api/skills");
      if (res.ok) {
        const data = await res.json();
        setSkills(data);
      }
    } catch (e) {
      console.error("Failed to load skills", e);
    }
    setSkillsLoading(false);
  };

  return (
    <div className="modal-overlay active" onClick={handleSave}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ Settings</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-tabs">
            <div
              className={`modal-tab ${tab === "search" ? "active" : ""}`}
              onClick={() => setTab("search")}
            >
              Search Engine
            </div>
            <div
              className={`modal-tab ${tab === "skills" ? "active" : ""}`}
              onClick={() => {
                setTab("skills");
                loadSkills();
              }}
            >
              Skills
            </div>
          </div>

          {tab === "search" && (
            <div className="settings-section" style={{ marginTop: 20 }}>
              <div className="form-group">
                <label className="form-label">Search Provider</label>
                <select
                  className="form-input"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="brave">Brave Search API</option>
                  <option value="serper">Serper (Google Search)</option>
                  <option value="vertex">Google Vertex AI Search</option>
                </select>
              </div>
              {provider === "brave" && (
                <div className="form-group">
                  <label className="form-label">Brave API Key</label>
                  <input
                    type="password"
                    className="form-input mono"
                    value={braveKey}
                    onChange={(e) => setBraveKey(e.target.value)}
                  />
                </div>
              )}
              {provider === "serper" && (
                <div className="form-group">
                  <label className="form-label">Serper API Key</label>
                  <input
                    type="password"
                    className="form-input mono"
                    value={serperKey}
                    onChange={(e) => setSerperKey(e.target.value)}
                  />
                </div>
              )}
              {provider === "vertex" && (
                <>
                  <div className="form-group">
                    <label className="form-label">Project ID</label>
                    <input
                      className="form-input mono"
                      value={vertexProject}
                      onChange={(e) => setVertexProject(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input
                      className="form-input mono"
                      value={vertexLocation}
                      onChange={(e) => setVertexLocation(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Datastore ID</label>
                    <input
                      className="form-input mono"
                      value={vertexDatastore}
                      onChange={(e) => setVertexDatastore(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "skills" && (
            <div className="settings-section" style={{ marginTop: 20 }}>
              {skillsLoading ? (
                <div className="empty" style={{ padding: "24px 0" }}>
                  Loading skills...
                </div>
              ) : skills.length === 0 ? (
                <div className="empty" style={{ padding: "24px 0" }}>
                  No skills installed. Use <code>npx skills add</code> to
                  install them.
                </div>
              ) : (
                <div className="env-list">
                  {skills.map((skill: any, idx) => (
                    <div
                      key={idx}
                      className="env-item"
                      style={{
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 6,
                      }}
                    >
                      <div className="env-name">{skill.name}</div>
                      {skill.description && (
                        <div
                          className="env-detail"
                          style={{ fontSize: "13px", color: "var(--text-dim)" }}
                        >
                          {skill.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
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
  const [tab, setTab] = useState<"general" | "discord" | "mcp" | "tools">(
    "general",
  );
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
  });
  const [mcpEditId, setMcpEditId] = useState<string | null>(null);

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
    fetch(`/api/sessions/${sessionId}/config`)
      .then((r) => r.json())
      .then(setConfig);
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
    });
    setMcpFormVisible(true);
  };

  const handleAddMcp = () => {
    setMcpEditId(null);
    setMcpForm({ id: "", command: "npx", args: "", type: "command", endpointUrl: "", apiKey: "" });
    setMcpFormVisible(true);
  };

  const handleSaveMcp = async () => {
    const { id, command, args, type, endpointUrl, apiKey } = mcpForm;
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
      });
    } else {
      setMcpForm({
        id: "",
        command: "npx",
        args: "",
        type: "command",
        endpointUrl: "",
        apiKey: "",
      });
    }
  };

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
        else if (name.startsWith("memory_")) groupName = "Built-in: Memory";
        else if (name === "exec") groupName = "Built-in: Execution";
        else if (name.startsWith("web_")) groupName = "Built-in: Web";
        else if (name.startsWith("browser_")) groupName = "Built-in: Browser";
        else if (name.startsWith("self_") || name.startsWith("read_config"))
          groupName = "Built-in: System/Self";
        else if (name.startsWith("git_")) groupName = "Built-in: Git";

        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(t);
      }
    });
    return groups;
  }, [toolsList, mcpConfig]);

  return (
    <div className="modal-overlay active" onClick={handleSave}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Session Settings</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-tabs">
            <div
              className={`modal-tab ${tab === "general" ? "active" : ""}`}
              onClick={() => setTab("general")}
            >
              General
            </div>
            <div
              className={`modal-tab ${tab === "discord" ? "active" : ""}`}
              onClick={() => setTab("discord")}
            >
              Discord
            </div>
            <div
              className={`modal-tab ${tab === "mcp" ? "active" : ""}`}
              onClick={() => setTab("mcp")}
            >
              MCP Servers
            </div>
            <div
              className={`modal-tab ${tab === "tools" ? "active" : ""}`}
              onClick={() => setTab("tools")}
            >
              Tools
            </div>
          </div>

          {tab === "general" && (
            <div>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input
                  className="form-input"
                  value={config.name || ""}
                  onChange={(e) =>
                    setConfig({ ...config, name: e.target.value })
                  }
                />
              </div>
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
                  value={config.provider?.apiKey || ""}
                  onChange={(e) =>
                    setNested(["provider", "apiKey"], e.target.value)
                  }
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Model</label>
                  <input
                    className="form-input mono"
                    value={config.provider?.model || ""}
                    onChange={(e) =>
                      setNested(["provider", "model"], e.target.value)
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Embedding Model</label>
                  <input
                    className="form-input mono"
                    value={config.provider?.embeddingModel || ""}
                    onChange={(e) =>
                      setNested(["provider", "embeddingModel"], e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={config.tools?.exec ?? true}
                    onChange={(e) =>
                      setNested(["tools", "exec"], e.target.checked)
                    }
                  />
                  <span>Enable Exec Tool</span>
                </label>
              </div>
              <div
                style={{
                  marginTop: 32,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <button
                  className="btn danger"
                  onClick={() => onDelete(sessionId)}
                >
                  Delete Session
                </button>
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
                      <label className="form-label">Target Guilds (CSV)</label>
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
                      <label className="form-label">Allowed Users (CSV)</label>
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
                      <option value="builtin-consult">Built-in Consult AI</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <div className="form-group" style={{ flex: "0 0 140px" }}>
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
                            setMcpForm({ ...mcpForm, command: e.target.value })
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
                            setMcpForm({ ...mcpForm, apiKey: e.target.value })
                          }
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
                    const isConnecting = statusData?.status === "connecting";

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
                                        a.includes(" ") && !a.startsWith('"')
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
                            title={cfg.enabled !== false ? "Disable" : "Enable"}
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
                  style={{ display: "flex", flexDirection: "column", gap: 16 }}
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
                                      !(config.disabledTools || []).includes(
                                        t.function.name,
                                      ),
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
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// -------- New Session Modal --------
export const NewSessionModal = ({ onClose, onSuccess }: any) => {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [copyFrom, setCopyFrom] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/sessions")
      .then((res) => res.json())
      .then((data) => setSessions(data))
      .catch((err) => console.error("Failed to load sessions", err));
  }, []);

  const handleCreate = async () => {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return alert("Invalid ID");
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: name || id,
        copyFrom: copyFrom || undefined,
        provider: copyFrom ? undefined : { endpoint, apiKey, model },
      }),
    });
    if (res.ok) onSuccess(id);
    else {
      const err = await res.json();
      alert(err.error);
    }
  };

  return (
    <div className="modal-overlay active" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>+ New Session</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Copy From (Optional)</label>
            <select
              className="form-input"
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
            >
              <option value="">None (start fresh)</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Session ID</label>
            <input
              className="form-input mono"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="my-agent"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Agent"
            />
          </div>
          {!copyFrom && (
            <>
              <div className="form-group">
                <label className="form-label">API Endpoint</label>
                <input
                  className="form-input mono"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input
                  type="password"
                  className="form-input mono"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Model</label>
                <input
                  className="form-input mono"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
