import React, { useState, useEffect } from "react";

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
  const [providerTemplates, setProviderTemplates] = useState<
    Record<string, any>
  >({});
  const [providersLoading, setProvidersLoading] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({
    name: "",
    endpoint: "",
    apiKey: "",
    availableModels: [] as string[],
    defaultModel: "",
    description: "",
    embeddingModel: "text-embedding-3-small",
    contextWindow: "",
  });
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    setConfigLoading(true);
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
      })
      .finally(() => setConfigLoading(false));
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
      description: "",
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
      description: template.description || "",
      embeddingModel: template.embeddingModel || "",
      contextWindow: template.contextWindow?.toString() || "",
    });
  };

  const handleSaveProvider = () => {
    if (!providerForm.name) return;

    const key =
      editingProvider === "__new__"
        ? providerForm.name.toLowerCase().replace(/[^a-z0-9]/g, "-")
        : editingProvider!;
    const newTemplate: any = {
      name: providerForm.name,
      endpoint: providerForm.endpoint,
      apiKey: providerForm.apiKey,
      availableModels: providerForm.availableModels,
      defaultModel: providerForm.defaultModel,
      description: providerForm.description,
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
          <h2>⚙️ Settings</h2>
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
            </div>
          ) : (
            <>
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
                              style={{
                                fontSize: "13px",
                                color: "var(--text-dim)",
                              }}
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
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                          }}
                        >
                          <div className="form-group">
                            <label className="form-label">Template Name</label>
                            <input
                              className="form-input"
                              value={providerForm.name}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  name: e.target.value,
                                })
                              }
                              placeholder="e.g., OpenAI, Anthropic"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">API Endpoint</label>
                            <input
                              className="form-input mono"
                              value={providerForm.endpoint}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  endpoint: e.target.value,
                                })
                              }
                              placeholder="https://api.openai.com/v1"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">API Key</label>
                            <input
                              type="password"
                              className="form-input mono"
                              value={providerForm.apiKey}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  apiKey: e.target.value,
                                })
                              }
                              placeholder="sk-..."
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Available Models (comma-separated)
                            </label>
                            <input
                              className="form-input mono"
                              value={providerForm.availableModels.join(", ")}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  availableModels: e.target.value
                                    .split(",")
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="gpt-4o, gpt-4o-mini"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">Default Model</label>
                            <input
                              className="form-input mono"
                              value={providerForm.defaultModel}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  defaultModel: e.target.value,
                                })
                              }
                              placeholder="gpt-4o"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Description (for AI selection)
                            </label>
                            <textarea
                              className="form-input"
                              style={{ minHeight: "60px", resize: "vertical" }}
                              value={providerForm.description}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  description: e.target.value,
                                })
                              }
                              placeholder="e.g., Use this for general tasks, it has good balance of speed and intelligence."
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Embedding Model (optional)
                            </label>
                            <input
                              className="form-input mono"
                              value={providerForm.embeddingModel}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  embeddingModel: e.target.value,
                                })
                              }
                              placeholder="text-embedding-3-small"
                            />
                          </div>
                          <div className="form-group">
                            <label className="form-label">
                              Context Window (optional)
                            </label>
                            <input
                              type="number"
                              className="form-input"
                              value={providerForm.contextWindow}
                              onChange={(e) =>
                                setProviderForm({
                                  ...providerForm,
                                  contextWindow: e.target.value,
                                })
                              }
                              placeholder="128000"
                            />
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn"
                              onClick={() => setEditingProvider(null)}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn primary"
                              onClick={handleSaveProvider}
                            >
                              {editingProvider === "__new__"
                                ? "Add Template"
                                : "Save Changes"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ marginBottom: 16 }}>
                            <button
                              className="btn primary"
                              onClick={handleAddProvider}
                            >
                              + Add Provider Template
                            </button>
                          </div>
                          {Object.keys(providerTemplates).length === 0 ? (
                            <div
                              className="empty"
                              style={{ padding: "24px 0" }}
                            >
                              No provider templates configured. Add one to get
                              started.
                            </div>
                          ) : (
                            <div className="env-list">
                              {Object.entries(providerTemplates).map(
                                ([key, template]: [string, any]) => (
                                  <div
                                    key={key}
                                    className="env-item"
                                    style={{
                                      flexDirection: "column",
                                      alignItems: "flex-start",
                                      gap: 6,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        width: "100%",
                                      }}
                                    >
                                      <div className="env-name">
                                        {template.name}
                                      </div>
                                      <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                          className="btn-icon"
                                          onClick={() =>
                                            handleEditProvider(key)
                                          }
                                          title="Edit"
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          className="btn-icon"
                                          onClick={() =>
                                            handleDeleteProvider(key)
                                          }
                                          title="Delete"
                                        >
                                          🗑️
                                        </button>
                                      </div>
                                    </div>
                                    <div
                                      className="env-detail"
                                      style={{
                                        fontSize: "13px",
                                        color: "var(--text-dim)",
                                      }}
                                    >
                                      {template.endpoint}
                                    </div>
                                    {template.description && (
                                      <div
                                        className="env-detail"
                                        style={{
                                          fontSize: "12px",
                                          color: "var(--text-dim)",
                                          fontStyle: "italic",
                                        }}
                                      >
                                        {template.description}
                                      </div>
                                    )}
                                    <div
                                      className="env-detail"
                                      style={{
                                        fontSize: "13px",
                                        color: "var(--text-dim)",
                                      }}
                                    >
                                      Models:{" "}
                                      {template.availableModels?.join(", ") ||
                                        "none"}
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </>
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
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
