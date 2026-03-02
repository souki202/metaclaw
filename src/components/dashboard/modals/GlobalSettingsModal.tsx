import React, { useState, useEffect } from "react";

// -------- Global Settings Modal --------
export const GlobalSettingsModal = ({ onClose, onSave }: any) => {
  const [tab, setTab] = useState<
    "search" | "embedding" | "memory" | "skills" | "providers"
  >("search");
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
    contextWindow: "",
    useSessionModelForCompression: true,
    memoryCompressionEndpoint: "",
    memoryCompressionApiKey: "",
    memoryCompressionModel: "",
  });
  const [embeddingEndpoint, setEmbeddingEndpoint] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [configLoading, setConfigLoading] = useState(true);

  // Memory Settings State
  const [memMaxRecallCompressed, setMemMaxRecallCompressed] = useState("");
  const [memMaxRecallRaw, setMemMaxRecallRaw] = useState("");
  const [memMaxCritical, setMemMaxCritical] = useState("");
  const [memMaxRelated, setMemMaxRelated] = useState("");
  const [memMaxCue, setMemMaxCue] = useState("");
  const [memMaxFlow, setMemMaxFlow] = useState("");
  const [memTurnRecall, setMemTurnRecall] = useState("");
  const [memAutoRecall, setMemAutoRecall] = useState("");
  const [memMinSim, setMemMinSim] = useState("");
  const [memSalience, setMemSalience] = useState("");
  const [memDedupe, setMemDedupe] = useState("");
  const [memChunkTarget, setMemChunkTarget] = useState("");
  const [memChunkMax, setMemChunkMax] = useState("");

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

    fetch("/api/embedding")
      .then((r) => r.ok && r.json())
      .then((data) => {
        if (data) {
          setEmbeddingEndpoint(data.endpoint || "");
          setEmbeddingApiKey(data.apiKey || "");
          setEmbeddingModel(data.model || "");
        }
      })
      .catch(() => {});

    fetch("/api/memory")
      .then((r) => r.ok && r.json())
      .then((data) => {
        if (data) {
          setMemMaxRecallCompressed(
            data.maxRecallCompressedTokens?.toString() || "",
          );
          setMemMaxRecallRaw(data.maxRecallRawTokens?.toString() || "");
          setMemMaxCritical(data.maxCriticalMemoryTokens?.toString() || "");
          setMemMaxRelated(data.maxRelatedMemoryTokens?.toString() || "");
          setMemMaxCue(data.maxCueTokens?.toString() || "");
          setMemMaxFlow(data.maxFlowContextTokens?.toString() || "");
          setMemTurnRecall(data.turnRecallLimit?.toString() || "");
          setMemAutoRecall(data.autonomousRecallLimit?.toString() || "");
          setMemMinSim(data.minSimilarity?.toString() || "");
          setMemSalience(data.salienceWeight?.toString() || "");
          setMemDedupe(data.dedupeThreshold?.toString() || "");
          setMemChunkTarget(data.autoChunkTargetLength?.toString() || "");
          setMemChunkMax(data.autoChunkMaxLength?.toString() || "");
        }
      })
      .catch(() => {});
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

    // Save embedding settings if on that tab
    if (tab === "embedding") {
      await fetch("/api/embedding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: embeddingEndpoint,
          apiKey: embeddingApiKey,
          model: embeddingModel,
        }),
      });
    }

    // Save memory settings if on that tab
    if (tab === "memory") {
      await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxRecallCompressedTokens: memMaxRecallCompressed,
          maxRecallRawTokens: memMaxRecallRaw,
          maxCriticalMemoryTokens: memMaxCritical,
          maxRelatedMemoryTokens: memMaxRelated,
          maxCueTokens: memMaxCue,
          maxFlowContextTokens: memMaxFlow,
          turnRecallLimit: memTurnRecall,
          autonomousRecallLimit: memAutoRecall,
          minSimilarity: memMinSim,
          salienceWeight: memSalience,
          dedupeThreshold: memDedupe,
          autoChunkTargetLength: memChunkTarget,
          autoChunkMaxLength: memChunkMax,
        }),
      });
    }

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
      contextWindow: "",
      useSessionModelForCompression: true,
      memoryCompressionEndpoint: "",
      memoryCompressionApiKey: "",
      memoryCompressionModel: "",
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
      contextWindow: template.contextWindow?.toString() || "",
      useSessionModelForCompression:
        template.useSessionModelForCompression ?? true,
      memoryCompressionEndpoint: template.memoryCompressionEndpoint || "",
      memoryCompressionApiKey: template.memoryCompressionApiKey || "",
      memoryCompressionModel: template.memoryCompressionModel || "",
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
      useSessionModelForCompression: providerForm.useSessionModelForCompression,
      memoryCompressionEndpoint: providerForm.memoryCompressionEndpoint,
      memoryCompressionApiKey: providerForm.memoryCompressionApiKey,
      memoryCompressionModel: providerForm.memoryCompressionModel,
    };

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
                  className={`modal-tab ${tab === "embedding" ? "active" : ""}`}
                  onClick={() => setTab("embedding")}
                >
                  Embedding
                </div>
                <div
                  className={`modal-tab ${tab === "memory" ? "active" : ""}`}
                  onClick={() => setTab("memory")}
                >
                  Memory
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

              {tab === "embedding" && (
                <div className="settings-section" style={{ marginTop: 20 }}>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-dim)",
                      marginBottom: 16,
                    }}
                  >
                    Global embedding settings used by all sessions for long-term
                    memory.
                  </p>
                  <div className="form-group">
                    <label className="form-label">Embedding API Endpoint</label>
                    <input
                      className="form-input mono"
                      value={embeddingEndpoint}
                      onChange={(e) => setEmbeddingEndpoint(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">API Key</label>
                    <input
                      type="password"
                      className="form-input mono"
                      value={embeddingApiKey}
                      onChange={(e) => setEmbeddingApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Embedding Model</label>
                    <input
                      className="form-input mono"
                      value={embeddingModel}
                      onChange={(e) => setEmbeddingModel(e.target.value)}
                      placeholder="text-embedding-3-small"
                    />
                  </div>
                </div>
              )}

              {tab === "memory" && (
                <div className="settings-section" style={{ marginTop: 20 }}>
                  <p
                    style={{
                      fontSize: 13,
                      color: "var(--text-dim)",
                      marginBottom: 16,
                    }}
                  >
                    Global memory heuristics and token limits. Leave empty to
                    use default constants.
                  </p>

                  <h4 style={{ margin: "16px 0 8px 0" }}>
                    Token Limits (Recall)
                  </h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">
                        Max Recall Compressed Tokens
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="250"
                        value={memMaxRecallCompressed}
                        onChange={(e) =>
                          setMemMaxRecallCompressed(e.target.value)
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Max Recall Raw Tokens
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="25000"
                        value={memMaxRecallRaw}
                        onChange={(e) => setMemMaxRecallRaw(e.target.value)}
                      />
                    </div>
                  </div>

                  <h4 style={{ margin: "16px 0 8px 0" }}>
                    Token Limits (Per Entry)
                  </h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">
                        Max Critical Memory Tokens
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="550"
                        value={memMaxCritical}
                        onChange={(e) => setMemMaxCritical(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Max Related Memory Tokens
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="175"
                        value={memMaxRelated}
                        onChange={(e) => setMemMaxRelated(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Max Cue Tokens</label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="300"
                        value={memMaxCue}
                        onChange={(e) => setMemMaxCue(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Max Flow Context Tokens
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="500"
                        value={memMaxFlow}
                        onChange={(e) => setMemMaxFlow(e.target.value)}
                      />
                    </div>
                  </div>

                  <h4 style={{ margin: "16px 0 8px 0" }}>Recall Heuristics</h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">
                        Turn Recall Limit (Count)
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="30"
                        value={memTurnRecall}
                        onChange={(e) => setMemTurnRecall(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Auto Recall Limit (Count)
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="20"
                        value={memAutoRecall}
                        onChange={(e) => setMemAutoRecall(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min Similarity</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        placeholder="0.34"
                        value={memMinSim}
                        onChange={(e) => setMemMinSim(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Salience Weight</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        placeholder="0.35"
                        value={memSalience}
                        onChange={(e) => setMemSalience(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Dedupe Threshold</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-input"
                        placeholder="0.95"
                        value={memDedupe}
                        onChange={(e) => setMemDedupe(e.target.value)}
                      />
                    </div>
                  </div>

                  <h4 style={{ margin: "16px 0 8px 0" }}>Chunking Rules</h4>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="form-group">
                      <label className="form-label">
                        Auto Chunk Target Length
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="2000"
                        value={memChunkTarget}
                        onChange={(e) => setMemChunkTarget(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        Auto Chunk Max Length
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="2500"
                        value={memChunkMax}
                        onChange={(e) => setMemChunkMax(e.target.value)}
                      />
                    </div>
                  </div>
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

                          <div
                            style={{
                              marginTop: "16px",
                              paddingTop: "16px",
                              borderTop: "1px solid var(--border)",
                            }}
                          >
                            <h4 style={{ margin: "0 0 12px 0" }}>
                              Memory Compression Settings (Optional)
                            </h4>
                            <p
                              style={{
                                fontSize: "12px",
                                color: "var(--text-dim)",
                                marginBottom: "16px",
                              }}
                            >
                              If empty, the global memory settings will be used.
                            </p>

                            <label
                              className="checkbox-label"
                              style={{ marginBottom: "12px" }}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  providerForm.useSessionModelForCompression
                                }
                                onChange={(e) =>
                                  setProviderForm({
                                    ...providerForm,
                                    useSessionModelForCompression:
                                      e.target.checked,
                                  })
                                }
                              />
                              Use this template's endpoint/model for Memory
                              Compression
                            </label>

                            {!providerForm.useSessionModelForCompression && (
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 12,
                                  marginLeft: "24px",
                                }}
                              >
                                <div className="form-group">
                                  <label className="form-label">
                                    Compression API Endpoint
                                  </label>
                                  <input
                                    className="form-input mono"
                                    value={
                                      providerForm.memoryCompressionEndpoint
                                    }
                                    onChange={(e) =>
                                      setProviderForm({
                                        ...providerForm,
                                        memoryCompressionEndpoint:
                                          e.target.value,
                                      })
                                    }
                                    placeholder="https://api.openai.com/v1"
                                  />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">
                                    Compression API Key
                                  </label>
                                  <input
                                    type="password"
                                    className="form-input mono"
                                    value={providerForm.memoryCompressionApiKey}
                                    onChange={(e) =>
                                      setProviderForm({
                                        ...providerForm,
                                        memoryCompressionApiKey: e.target.value,
                                      })
                                    }
                                    placeholder="sk-..."
                                  />
                                </div>
                                <div className="form-group">
                                  <label className="form-label">
                                    Compression Model
                                  </label>
                                  <input
                                    className="form-input mono"
                                    value={providerForm.memoryCompressionModel}
                                    onChange={(e) =>
                                      setProviderForm({
                                        ...providerForm,
                                        memoryCompressionModel: e.target.value,
                                      })
                                    }
                                    placeholder="gpt-4o-mini"
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <div
                            style={{ display: "flex", gap: 8, marginTop: 16 }}
                          >
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
