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
    // Ideally requires a session to query, but fallback to a standard list if available.
    // As per dashboard.html, it used currentSession. We will skip deep implementation
    // for this stub if no session is active.
    setSkillsLoading(false);
  };

  return (
    <div className="modal-overlay active">
      <div className="modal">
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
              <p className="form-hint">
                Skills require an active session context to list. Use{" "}
                <code>npx skills add</code> to install them.
              </p>
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

// -------- Session Settings Modal --------
export const SessionSettingsModal = ({
  sessionId,
  onClose,
  onSave,
  onDelete,
}: any) => {
  const [tab, setTab] = useState<"general" | "discord" | "mcp">("general");
  const [config, setConfig] = useState<any>({});
  const [mcpConfig, setMcpConfig] = useState<Record<string, McpServerConfig>>(
    {},
  );

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${sessionId}/config`)
      .then((r) => r.json())
      .then(setConfig);
    fetch(`/api/sessions/${sessionId}/mcp`)
      .then((r) => r.json())
      .then(setMcpConfig)
      .catch(() => {});
  }, [sessionId]);

  const handleSave = async () => {
    await fetch(`/api/sessions/${sessionId}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    onSave();
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

  return (
    <div className="modal-overlay active">
      <div className="modal">
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
            </div>
          )}

          {tab === "mcp" && (
            <div className="env-list">
              {Object.keys(mcpConfig).length === 0 ? (
                <div className="empty">No MCP servers</div>
              ) : (
                Object.entries(mcpConfig).map(([id, cfg]) => (
                  <div key={id} className="env-item">
                    <div className="env-info">
                      <div className="env-name">{id}</div>
                      <div className="env-detail mono">
                        {cfg.command} {cfg.args?.join(" ")}
                      </div>
                    </div>
                  </div>
                ))
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

  const handleCreate = async () => {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return alert("Invalid ID");
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: name || id,
        provider: { endpoint, apiKey, model },
      }),
    });
    if (res.ok) onSuccess(id);
    else {
      const err = await res.json();
      alert(err.error);
    }
  };

  return (
    <div className="modal-overlay active">
      <div className="modal">
        <div className="modal-header">
          <h2>+ New Session</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
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
