import React, { useState, useEffect } from "react";
import { McpServerConfig } from "./types";

// -------- Global Settings Modal --------
export const GlobalSettingsModal = ({ onClose, onSave }: any) => {
  const [tab, setTab] = useState<"search" | "skills" | "providers">("search");
  const [provider, setProvider] = useState("brave");
  const [braveKey, setBraveKey] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [vertexProject, setVertexProject] = useState("");
  const [vertexLocation, setVertexLocation] = useState("global");
  const [vertexDatastore, setVertexDatastore] = useState("");
  const [skills, setSkills] = useState<any[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [providerTemplates, setProviderTemplates] = useState<Record<string, any>>({});
  const [providersLoading, setProvidersLoading] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: "",
    endpoint: "",
    apiKey: "",
    availableModels: [] as string[],
    defaultModel: "",
    embeddingModel: "",
    contextWindow: "",
  });

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

    // Save provider templates if on that tab
    if (tab === "providers") {
      await fetch("/api/provider-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerTemplates),
      });
    }

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

  const loadProviders = async () => {
    setProvidersLoading(true);
    try {
      const res = await fetch("/api/provider-templates");
      if (res.ok) {
        const data = await res.json();
        setProviderTemplates(data || {});
      }
    } catch (e) {
      console.error("Failed to load provider templates", e);
    }
    setProvidersLoading(false);
  };

  const handleAddProvider = () => {
    setEditingProvider("__new__");
    setProviderForm({
      name: "",
      endpoint: "",
      apiKey: "",
      availableModels: [],
      defaultModel: "",
      embeddingModel: "",
      contextWindow: "",
    });
  };

  const handleEditProvider = (key: string) => {
    const template = providerTemplates[key];
    setEditingProvider(key);
    setProviderForm({
      name: template.name || "",
      endpoint: template.endpoint || "",
      apiKey: template.apiKey || "",
      availableModels: template.availableModels || [],
      defaultModel: template.defaultModel || "",
      embeddingModel: template.embeddingModel || "",
      contextWindow: template.contextWindow?.toString() || "",
    });
  };

  const handleSaveProvider = () => {
    if (!providerForm.name) return;

    const key = editingProvider === "__new__" ? providerForm.name.toLowerCase().replace(/[^a-z0-9]/g, "-") : editingProvider!;
    const newTemplate: any = {
      name: providerForm.name,
      endpoint: providerForm.endpoint,
      apiKey: providerForm.apiKey,
      availableModels: providerForm.availableModels,
      defaultModel: providerForm.defaultModel,
    };

    if (providerForm.embeddingModel) {
      newTemplate.embeddingModel = providerForm.embeddingModel;
    }
    if (providerForm.contextWindow) {
      newTemplate.contextWindow = parseInt(providerForm.contextWindow, 10);
    }

    setProviderTemplates({
      ...providerTemplates,
      [key]: newTemplate,
    });
    setEditingProvider(null);
  };

  const handleDeleteProvider = (key: string) => {
    const { [key]: _, ...rest } = providerTemplates;
    setProviderTemplates(rest);
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
              className={`modal-tab ${tab === "providers" ? "active" : ""}`}
              onClick={() => {
                setTab("providers");
                loadProviders();
              }}
            >
              Provider Templates
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

          {tab === "providers" && (
            <div className="settings-section" style={{ marginTop: 20 }}>
              {providersLoading ? (
                <div className="empty" style={{ padding: "24px 0" }}>
                  Loading provider templates...
                </div>
              ) : (
                <>
                  {editingProvider ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div className="form-group">
                        <label className="form-label">Template Name</label>
                        <input
                          className="form-input"
                          value={providerForm.name}
                          onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                          placeholder="e.g., OpenAI, Anthropic"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">API Endpoint</label>
                        <input
                          className="form-input mono"
                          value={providerForm.endpoint}
                          onChange={(e) => setProviderForm({ ...providerForm, endpoint: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">API Key</label>
                        <input
                          type="password"
                          className="form-input mono"
                          value={providerForm.apiKey}
                          onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                          placeholder="sk-..."
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Available Models (comma-separated)</label>
                        <input
                          className="form-input mono"
                          value={providerForm.availableModels.join(", ")}
                          onChange={(e) => setProviderForm({
                            ...providerForm,
                            availableModels: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                          })}
                          placeholder="gpt-4o, gpt-4o-mini"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Default Model</label>
                        <input
                          className="form-input mono"
                          value={providerForm.defaultModel}
                          onChange={(e) => setProviderForm({ ...providerForm, defaultModel: e.target.value })}
                          placeholder="gpt-4o"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Embedding Model (optional)</label>
                        <input
                          className="form-input mono"
                          value={providerForm.embeddingModel}
                          onChange={(e) => setProviderForm({ ...providerForm, embeddingModel: e.target.value })}
                          placeholder="text-embedding-3-small"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Context Window (optional)</label>
                        <input
                          type="number"
                          className="form-input"
                          value={providerForm.contextWindow}
                          onChange={(e) => setProviderForm({ ...providerForm, contextWindow: e.target.value })}
                          placeholder="128000"
                        />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" onClick={() => setEditingProvider(null)}>
                          Cancel
                        </button>
                        <button className="btn primary" onClick={handleSaveProvider}>
                          {editingProvider === "__new__" ? "Add Template" : "Save Changes"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <button className="btn primary" onClick={handleAddProvider}>
                          + Add Provider Template
                        </button>
                      </div>
                      {Object.keys(providerTemplates).length === 0 ? (
                        <div className="empty" style={{ padding: "24px 0" }}>
                          No provider templates configured. Add one to get started.
                        </div>
                      ) : (
                        <div className="env-list">
                          {Object.entries(providerTemplates).map(([key, template]: [string, any]) => (
                            <div
                              key={key}
                              className="env-item"
                              style={{
                                flexDirection: "column",
                                alignItems: "flex-start",
                                gap: 6,
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                                <div className="env-name">{template.name}</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <button
                                    className="btn-icon"
                                    onClick={() => handleEditProvider(key)}
                                    title="Edit"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    className="btn-icon"
                                    onClick={() => handleDeleteProvider(key)}
                                    title="Delete"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                              <div
                                className="env-detail"
                                style={{ fontSize: "13px", color: "var(--text-dim)" }}
                              >
                                {template.endpoint}
                              </div>
                              <div
                                className="env-detail"
                                style={{ fontSize: "13px", color: "var(--text-dim)" }}
                              >
                                Models: {template.availableModels?.join(", ") || "none"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
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
                  onChange={(e) => setNested(["description"], e.target.value)}
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
                <input
                  className="form-input mono"
                  value={config.provider?.model || ""}
                  onChange={(e) =>
                    setNested(["provider", "model"], e.target.value)
                  }
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

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
              <div className="settings-title">Agent-to-Agent (A2A) Communication</div>
              <p
                style={{
                  color: "var(--text-dim)",
                  fontSize: "13px",
                  marginBottom: 16,
                }}
              >
                Configure inter-session communication and collaboration features.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
                        setNested(["a2a", "hiddenFromAgents"], e.target.checked)
                      }
                    />
                    Hide this session from other agents (coordinator mode)
                  </label>
                )}
              </div>

              {config.a2a?.enabled && (
                <div style={{ marginTop: 20 }}>
                  <div className="settings-title">A2A Tools Available</div>
                  <div style={{ color: "var(--text-dim)", fontSize: "13px", marginTop: 8 }}>
                    When A2A is enabled, this session can use the following tools:
                  </div>
                  <ul style={{ color: "var(--text-dim)", fontSize: "13px", marginTop: 8, paddingLeft: 20 }}>
                    <li><code>list_agents</code> - Discover other AI sessions</li>
                    <li><code>create_session</code> - Create new AI sessions dynamically</li>
                    <li><code>list_provider_templates</code> - View available provider configs</li>
                    <li><code>send_message_to_session</code> - Send direct messages</li>
                    <li><code>read_session_messages</code> - Read incoming messages</li>
                    <li><code>delegate_task_async</code> - Delegate tasks asynchronously</li>
                    <li><code>check_async_tasks</code> - Monitor task status</li>
                    <li><code>complete_async_task</code> - Complete delegated tasks</li>
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
                  <strong>About A2A:</strong> When enabled, this session can communicate
                  with other sessions, delegate tasks, and participate in multi-agent
                  workflows. Enable A2A on at least 2 sessions for collaboration.
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
                <input
                  className="form-input mono"
                  placeholder={config.provider?.model}
                  value={config.consultAi?.model || ""}
                  onChange={(e) =>
                    setNested(["consultAi", "model"], e.target.value)
                  }
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
                    <label className="form-label">App Token (optional)</label>
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
                        onChange={(e) => setSlackArray("channels", e.target.value)}
                        placeholder="C01234567, C07654321"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Target Teams (CSV)</label>
                      <input
                        className="form-input mono"
                        value={(config.slack?.teams || []).join(", ")}
                        onChange={(e) => setSlackArray("teams", e.target.value)}
                        placeholder="T01234567"
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Allowed Users (CSV)</label>
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
                      <div className="form-group">
                        <label className="form-label">
                          Model Name (optional)
                        </label>
                        <input
                          className="form-input mono"
                          value={mcpForm.model}
                          onChange={(e) =>
                            setMcpForm({ ...mcpForm, model: e.target.value })
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
