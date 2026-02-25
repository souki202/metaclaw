import React from "react";
import { SessionData } from "./types";

interface SidebarProps {
  sessions: SessionData[];
  currentSession: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSession,
  onSelectSession,
  onNewSession,
}) => {
  return (
    <div className="sidebar">
      <div className="sidebar-header">Sessions</div>
      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === currentSession ? "active" : ""}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="avatar">
              {s.name ? s.name.charAt(0).toUpperCase() : "?"}
              {s.isBusy && <span className="busy-dot" title="Busy" />}
            </div>
            <div className="info">
              <div className="name">
                {s.name}
                {s.isBusy && <span className="busy-label"> ⚙</span>}
              </div>
              {s.model && <div className="model">{s.model}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="add-session-btn" onClick={onNewSession}>
          + New Session
        </button>
      </div>
    </div>
  );
};
