import React, { useState, useEffect } from "react";
import { SystemInfo } from "./types";

interface RightPanelProps {
  currentSession: string | null;
}

const FILES = ["IDENTITY.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];

export const RightPanel: React.FC<RightPanelProps> = ({ currentSession }) => {
  const [activeTab, setActiveTab] = useState<"files" | "memory" | "system">(
    "files",
  );
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const [memoryEntries, setMemoryEntries] = useState<any[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  // Load files when session changes
  useEffect(() => {
    if (!currentSession) {
      setFileContents({});
      setMemoryEntries([]);
      return;
    }

    const loadFiles = async () => {
      const contents: Record<string, string> = {};
      for (const f of FILES) {
        try {
          const res = await fetch(`/api/sessions/${currentSession}/files/${f}`);
          if (res.ok) {
            const data = await res.json();
            contents[f] = data.content || "";
          }
        } catch (e) {
          console.error(`Error loading file ${f}`, e);
        }
      }
      setFileContents(contents);
    };

    const loadMemory = async () => {
      try {
        const res = await fetch(`/api/sessions/${currentSession}/memory`);
        if (res.ok) {
          const entries = await res.json();
          setMemoryEntries(entries);
        }
      } catch (e) {
        console.error("Error loading memory", e);
      }
    };

    if (activeTab === "files") loadFiles();
    if (activeTab === "memory") loadMemory();
  }, [currentSession, activeTab]);

  // Load system info periodically if system tab active
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const loadSystemInfo = async () => {
      try {
        const res = await fetch("/api/system");
        if (res.ok) {
          const info = await res.json();
          setSystemInfo(info);
        }
      } catch (e) {
        console.error("Error loading system info", e);
      }
    };

    if (activeTab === "system") {
      loadSystemInfo();
      interval = setInterval(loadSystemInfo, 5000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTab]);

  const handleSaveFile = async (filename: string) => {
    if (!currentSession) return;
    try {
      setSaveStatus((prev) => ({ ...prev, [filename]: "Saving..." }));
      const content = fileContents[filename] || "";
      await fetch(`/api/sessions/${currentSession}/files/${filename}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setSaveStatus((prev) => ({ ...prev, [filename]: "Saved!" }));
      setTimeout(() => {
        setSaveStatus((prev) => ({ ...prev, [filename]: "" }));
      }, 1500);
    } catch (e) {
      setSaveStatus((prev) => ({ ...prev, [filename]: "Error" }));
      setTimeout(() => {
        setSaveStatus((prev) => ({ ...prev, [filename]: "" }));
      }, 1500);
    }
  };

  const handleFileChange = (filename: string, value: string) => {
    setFileContents((prev) => ({ ...prev, [filename]: value }));
  };

  const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";

  return (
    <div className="right-panel">
      <div className="tabs">
        <div
          className={`tab ${activeTab === "files" ? "active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          Files
        </div>
        <div
          className={`tab ${activeTab === "memory" ? "active" : ""}`}
          onClick={() => setActiveTab("memory")}
        >
          Memory
        </div>
        <div
          className={`tab ${activeTab === "system" ? "active" : ""}`}
          onClick={() => setActiveTab("system")}
        >
          System
        </div>
      </div>

      <div className={`tab-content ${activeTab === "files" ? "active" : ""}`}>
        {!currentSession ? (
          <div className="empty">Select a session</div>
        ) : (
          <div>
            {FILES.map((f) => (
              <div key={f} className="file-section">
                <div className="file-label">
                  {f}
                  <button
                    className="btn save-btn"
                    onClick={() => handleSaveFile(f)}
                  >
                    {saveStatus[f] || "Save"}
                  </button>
                </div>
                <textarea
                  className="file-editor"
                  rows={5}
                  value={fileContents[f] || ""}
                  onChange={(e) => handleFileChange(f, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`tab-content ${activeTab === "memory" ? "active" : ""}`}>
        {!currentSession ? (
          <div className="empty">Select a session</div>
        ) : memoryEntries.length === 0 ? (
          <div className="empty">No long-term memories yet</div>
        ) : (
          <div>
            {memoryEntries.slice(0, 50).map((e, idx) => (
              <div key={idx} className="memory-entry">
                <div>{e.text && e.text.slice(0, 200)}</div>
                <div className="memory-meta">
                  {e.metadata?.timestamp?.slice(0, 10)}{" "}
                  {e.metadata?.category ? `· ${e.metadata.category}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`tab-content ${activeTab === "system" ? "active" : ""}`}>
        {systemInfo ? (
          <div className="system-info">
            <div className="row">
              <span>Uptime</span>
              <span className="val">{Math.floor(systemInfo.uptime)}s</span>
            </div>
            <div className="row">
              <span>Sessions</span>
              <span className="val">{systemInfo.sessions}</span>
            </div>
            <div className="row">
              <span>Node</span>
              <span className="val">{systemInfo.nodeVersion}</span>
            </div>
            <div className="row">
              <span>Heap Used</span>
              <span className="val">
                {formatMB(systemInfo.memory.heapUsed)}
              </span>
            </div>
            <div className="row">
              <span>RSS</span>
              <span className="val">{formatMB(systemInfo.memory.rss)}</span>
            </div>
            <div className="row">
              <span>Version</span>
              <span className="val">{systemInfo.version}</span>
            </div>
          </div>
        ) : (
          <div className="empty">Loading...</div>
        )}
      </div>
    </div>
  );
};
