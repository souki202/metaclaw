import React, { useState, useEffect } from "react";

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
          onClose();
        }
        (e.currentTarget as any)._isMouseDownOnOverlay = false;
      }}
    >
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
