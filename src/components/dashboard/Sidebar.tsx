import React from "react";
import { OrganizationUnread, SessionData } from "./types";

interface SidebarProps {
  sessions: SessionData[];
  currentSession: string | null;
  currentOrganizationChat: string | null;
  organizationUnread: Record<string, OrganizationUnread>;
  onSelectSession: (id: string) => void;
  onSelectOrganizationChat: (organizationId: string) => void;
  onNewSession: (organizationId: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSession,
  currentOrganizationChat,
  organizationUnread,
  onSelectSession,
  onSelectOrganizationChat,
  onNewSession,
}) => {
  const sessionsByOrg = sessions.reduce<Record<string, SessionData[]>>(
    (acc, session) => {
      const organizationId = session.organizationId || "default";
      if (!acc[organizationId]) {
        acc[organizationId] = [];
      }
      acc[organizationId].push(session);
      return acc;
    },
    {},
  );

  const organizationIds = Object.keys(sessionsByOrg).sort((a, b) =>
    a.localeCompare(b),
  );

  const preferredOrg =
    sessions.find((s) => s.id === currentSession)?.organizationId ||
    organizationIds[0] ||
    "default";

  return (
    <div className="sidebar">
      <div className="sidebar-header">Organizations</div>
      <div className="session-list">
        {organizationIds.map((organizationId) => (
          <div key={organizationId} className="organization-group">
            <div className="organization-name">{organizationId}</div>
            <div
              className={`session-item group-chat-item ${currentOrganizationChat === organizationId ? "active" : ""}`}
              onClick={() => onSelectOrganizationChat(organizationId)}
            >
              <div className="avatar">#</div>
              <div className="info">
                <div className="name">
                  Group Chat
                  {organizationUnread[organizationId]?.mentions > 0 && (
                    <span className="unread-badge mention">
                      @{organizationUnread[organizationId].mentions}
                    </span>
                  )}
                  {organizationUnread[organizationId]?.total > 0 && (
                    <span className="unread-badge">
                      {organizationUnread[organizationId].total}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {sessionsByOrg[organizationId].map((s) => (
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
        ))}
      </div>
      <div className="sidebar-footer">
        <button
          className="add-session-btn"
          onClick={() => onNewSession(preferredOrg)}
        >
          + New Session
        </button>
      </div>
    </div>
  );
};
