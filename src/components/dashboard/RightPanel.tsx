import React, { useState, useEffect } from "react";
import { SystemInfo } from "./types";

interface RightPanelProps {
  currentSession: string | null;
}

interface ScheduleItem {
  id: string;
  memo: string;
  startAt: string;
  repeatCron: string | null;
  nextRunAt: string | null;
  enabled: boolean;
}

const FILES = ["IDENTITY.md", "USER.md", "MEMORY.md"];

export const RightPanel: React.FC<RightPanelProps> = ({ currentSession }) => {
  const [activeTab, setActiveTab] = useState<"files" | "memory" | "system">(
    "files",
  );
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  const [memoryEntries, setMemoryEntries] = useState<any[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [scheduleForm, setScheduleForm] = useState({
    startAt: "",
    repeatCron: "none",
    memo: "",
    enabled: true,
  });

  const toInputDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  const toIsoFromInput = (value: string) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString();
  };

  const formatLocalDateTime = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  };

  // Load files when session changes
  useEffect(() => {
    if (!currentSession) {
      setFileContents({});
      setMemoryEntries([]);
      setSchedules([]);
      setScheduleStatus("");
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

    if (activeTab === "files") {
      loadFiles();
      void loadSchedules();
    }
    if (activeTab === "memory") loadMemory();
  }, [currentSession, activeTab]);

  useEffect(() => {
    if (!currentSession || activeTab !== "files") return;

    void loadSchedules();
    const interval = setInterval(() => {
      void loadSchedules();
    }, 3000);

    return () => clearInterval(interval);
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

  const loadSchedules = async () => {
    if (!currentSession) return;
    try {
      const res = await fetch(`/api/sessions/${currentSession}/schedules`);
      if (res.ok) {
        const items = await res.json();
        setSchedules(items);
      }
    } catch (e) {
      console.error("Error loading schedules", e);
    }
  };

  const resetScheduleForm = () => {
    setEditingScheduleId(null);
    setScheduleForm({
      startAt: "",
      repeatCron: "none",
      memo: "",
      enabled: true,
    });
  };

  const startEditSchedule = (schedule: ScheduleItem) => {
    setEditingScheduleId(schedule.id);
    setScheduleForm({
      startAt: toInputDateTime(schedule.startAt),
      repeatCron: schedule.repeatCron || "none",
      memo: schedule.memo,
      enabled: schedule.enabled,
    });
  };

  const handleSaveSchedule = async () => {
    if (!currentSession) return;
    if (!scheduleForm.startAt || !scheduleForm.memo.trim()) {
      setScheduleStatus("Start At and Memo are required");
      return;
    }

    const payload = {
      startAt: toIsoFromInput(scheduleForm.startAt),
      repeatCron: scheduleForm.repeatCron.trim() || "none",
      memo: scheduleForm.memo,
      enabled: scheduleForm.enabled,
    };

    if (!payload.startAt) {
      setScheduleStatus("Start At is invalid");
      return;
    }

    try {
      setScheduleStatus(editingScheduleId ? "Updating..." : "Creating...");
      const endpoint = editingScheduleId
        ? `/api/sessions/${currentSession}/schedules/${editingScheduleId}`
        : `/api/sessions/${currentSession}/schedules`;
      const method = editingScheduleId ? "PUT" : "POST";

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        setScheduleStatus(err.error || "Failed to save schedule");
        return;
      }

      setScheduleStatus(editingScheduleId ? "Updated" : "Created");
      resetScheduleForm();
      await loadSchedules();
      setTimeout(() => setScheduleStatus(""), 1500);
    } catch (e) {
      setScheduleStatus("Failed to save schedule");
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!currentSession) return;
    if (!confirm("Delete this schedule?")) return;
    try {
      setScheduleStatus("Deleting...");
      const res = await fetch(
        `/api/sessions/${currentSession}/schedules/${scheduleId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json();
        setScheduleStatus(err.error || "Failed to delete schedule");
        return;
      }
      if (editingScheduleId === scheduleId) {
        resetScheduleForm();
      }
      setScheduleStatus("Deleted");
      await loadSchedules();
      setTimeout(() => setScheduleStatus(""), 1500);
    } catch (e) {
      setScheduleStatus("Failed to delete schedule");
    }
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

            <div className="file-section">
              <div className="file-label">Schedules</div>

              <div className="form-group">
                <label className="form-label">Start At</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={scheduleForm.startAt}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      startAt: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Repeat Cron (or none)</label>
                <input
                  className="form-input mono"
                  value={scheduleForm.repeatCron}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      repeatCron: e.target.value,
                    }))
                  }
                  placeholder="none"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Memo</label>
                <textarea
                  className="file-editor"
                  rows={3}
                  value={scheduleForm.memo}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      memo: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="form-checkbox" style={{ marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={scheduleForm.enabled}
                  onChange={(e) =>
                    setScheduleForm((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <label className="form-label" style={{ marginBottom: 0 }}>
                  Enabled
                </label>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button className="btn primary" onClick={handleSaveSchedule}>
                  {editingScheduleId ? "Update" : "Create"}
                </button>
                {editingScheduleId && (
                  <button className="btn" onClick={resetScheduleForm}>
                    Cancel Edit
                  </button>
                )}
              </div>
              {scheduleStatus && (
                <div className="memory-meta">{scheduleStatus}</div>
              )}

              {schedules.length === 0 ? (
                <div className="empty">No schedules registered</div>
              ) : (
                <div>
                  {schedules.map((s) => (
                    <div key={s.id} className="memory-entry">
                      <div>{s.memo}</div>
                      <div className="memory-meta">
                        Next: {formatLocalDateTime(s.nextRunAt)} · Start:{" "}
                        {formatLocalDateTime(s.startAt)}
                      </div>
                      <div className="memory-meta">
                        Repeat: {s.repeatCron || "none"} ·{" "}
                        {s.enabled ? "enabled" : "disabled"}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          className="btn"
                          onClick={() => startEditSchedule(s)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn danger"
                          onClick={() => handleDeleteSchedule(s.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
