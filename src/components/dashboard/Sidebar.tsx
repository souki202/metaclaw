import React, { useState, useRef } from "react";
import { OrganizationUnread, SessionData } from "./types";

interface SidebarProps {
  sessions: SessionData[];
  currentSession: string | null;
  currentOrganizationChat: string | null;
  organizationUnread: Record<string, OrganizationUnread>;
  onSelectSession: (id: string) => void;
  onSelectOrganizationChat: (organizationId: string) => void;
  onNewSession: (organizationId: string) => void;
  onReorderSessions: (orgId: string, orderedIds: string[]) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSession,
  currentOrganizationChat,
  organizationUnread,
  onSelectSession,
  onSelectOrganizationChat,
  onNewSession,
  onReorderSessions,
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragOrgRef = useRef<string | null>(null);

  // セッションをorderでソートしてからorg別にグループ化
  const sortedSessions = [...sessions].sort((a, b) => {
    const aOrder = a.order ?? Infinity;
    const bOrder = b.order ?? Infinity;
    return aOrder - bOrder;
  });

  const sessionsByOrg = sortedSessions.reduce<Record<string, SessionData[]>>(
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

  const handleDragStart = (
    e: React.DragEvent,
    sessionId: string,
    orgId: string,
  ) => {
    setDraggingId(sessionId);
    dragOrgRef.current = orgId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sessionId);
  };

  const handleDragOver = (
    e: React.DragEvent,
    targetId: string,
    targetOrgId: string,
  ) => {
    e.preventDefault();
    // org跨ぎは無効
    if (dragOrgRef.current !== targetOrgId) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer.dropEffect = "move";
    if (targetId !== draggingId) {
      setDragOverId(targetId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (
    e: React.DragEvent,
    targetId: string,
    targetOrgId: string,
  ) => {
    e.preventDefault();
    setDragOverId(null);

    if (!draggingId || draggingId === targetId) return;
    // org跨ぎは無効
    if (dragOrgRef.current !== targetOrgId) return;

    const orgSessions = sessionsByOrg[targetOrgId] || [];
    const ids = orgSessions.map((s) => s.id);

    const fromIndex = ids.indexOf(draggingId);
    const toIndex = ids.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const newIds = [...ids];
    newIds.splice(fromIndex, 1);
    newIds.splice(toIndex, 0, draggingId);

    onReorderSessions(targetOrgId, newIds);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverId(null);
    dragOrgRef.current = null;
  };

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
                draggable
                className={[
                  "session-item",
                  s.id === currentSession ? "active" : "",
                  s.id === draggingId ? "dragging" : "",
                  s.id === dragOverId ? "drag-over" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelectSession(s.id)}
                onDragStart={(e) => handleDragStart(e, s.id, organizationId)}
                onDragOver={(e) => handleDragOver(e, s.id, organizationId)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, s.id, organizationId)}
                onDragEnd={handleDragEnd}
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
                <div className="drag-handle" title="ドラッグして並び替え">
                  ⠿
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
