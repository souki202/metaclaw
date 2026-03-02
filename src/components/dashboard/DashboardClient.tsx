"use client";

import React, { useState, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { OrganizationChatArea } from "./OrganizationChatArea";
import { RightPanel } from "./RightPanel";
import {
  GlobalSettingsModal,
  SessionSettingsModal,
  NewSessionModal,
} from "./Modals";
import {
  SessionData,
  ChatMessage,
  Skill,
  OrganizationGroupChatMessage,
  OrganizationUnread,
} from "./types";

export default function DashboardClient() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [currentOrganizationChat, setCurrentOrganizationChat] = useState<
    string | null
  >(null);
  const [organizationUnread, setOrganizationUnread] = useState<
    Record<string, OrganizationUnread>
  >({});
  const [organizationMessages, setOrganizationMessages] = useState<
    OrganizationGroupChatMessage[]
  >([]);

  const [wsConnected, setWsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [schedulesBySession, setSchedulesBySession] = useState<
    Record<string, any[]>
  >({});

  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);

  const [activeModal, setActiveModal] = useState<
    "none" | "global" | "session" | "new-session"
  >("none");
  const [newSessionDefaultOrg, setNewSessionDefaultOrg] = useState("default");
  const currentSessionRef = useRef<string | null>(null);
  const currentOrganizationChatRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  useEffect(() => {
    currentOrganizationChatRef.current = currentOrganizationChat;
  }, [currentOrganizationChat]);

  const findViewerSessionIdForOrg = (
    orgId: string,
    sessionList: SessionData[] = sessions,
    preferredSessionId: string | null = currentSessionRef.current,
  ): string | null => {
    const preferred = sessionList.find((s) => s.id === preferredSessionId);
    if (preferred && (preferred.organizationId || "default") === orgId) {
      return preferred.id;
    }

    const first = sessionList.find(
      (s) => (s.organizationId || "default") === orgId,
    );
    return first?.id || null;
  };

  const refreshOrganizationUnread = async (
    sessionList: SessionData[] = sessions,
    preferredSessionId: string | null = currentSessionRef.current,
  ) => {
    const orgs = Array.from(
      new Set(sessionList.map((s) => s.organizationId || "default")),
    );

    const entries = await Promise.all(
      orgs.map(async (orgId) => {
        const viewerSessionId = findViewerSessionIdForOrg(
          orgId,
          sessionList,
          preferredSessionId,
        );

        if (!viewerSessionId) {
          return [orgId, { total: 0, mentions: 0 }] as const;
        }

        try {
          const res = await fetch(
            `/api/organizations/${encodeURIComponent(orgId)}/group-chat?viewerSessionId=${encodeURIComponent(viewerSessionId)}&limit=1`,
          );
          if (!res.ok) {
            return [orgId, { total: 0, mentions: 0 }] as const;
          }
          const data = await res.json();
          return [
            orgId,
            {
              total: Number(data?.unread?.total || 0),
              mentions: Number(data?.unread?.mentions || 0),
            },
          ] as const;
        } catch {
          return [orgId, { total: 0, mentions: 0 }] as const;
        }
      }),
    );

    setOrganizationUnread(Object.fromEntries(entries));
  };

  const loadOrganizationMessages = async (orgId: string) => {
    const viewerSessionId = findViewerSessionIdForOrg(orgId);
    if (!viewerSessionId) {
      setOrganizationMessages([]);
      return;
    }

    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(orgId)}/group-chat?viewerSessionId=${encodeURIComponent(viewerSessionId)}&limit=200`,
      );
      const data = await res.json();
      setOrganizationMessages(
        Array.isArray(data?.messages) ? data.messages : [],
      );
    } catch (e) {
      console.error("Failed to load organization group chat", e);
      setOrganizationMessages([]);
    }
  };

  const markOrganizationMessagesAsRead = async (orgId: string) => {
    const viewerSessionId = findViewerSessionIdForOrg(orgId);
    if (!viewerSessionId) return;

    try {
      await fetch(
        `/api/organizations/${encodeURIComponent(orgId)}/group-chat/read`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerSessionId }),
        },
      );
      await refreshOrganizationUnread();
    } catch (e) {
      console.error("Failed to mark org chat as read", e);
    }
  };

  const loadSessions = async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data);
      await refreshOrganizationUnread(data, currentSessionRef.current);
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  // WebSocket / EventSource connection
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: any;

    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setWsConnected(true);
      es.onerror = () => {
        setWsConnected(false);
        if (es) es.close();
        reconnectTimer = setTimeout(connect, 3000);
      };

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          if (event.type === "connected") return;

          // session_list_update: セッション一覧を再取得（新規作成/削除/busy変化）
          if (event.type === "session_list_update") {
            loadSessions();
            return;
          }

          if (event.type === "organization_group_chat") {
            const orgId = event.data?.organizationId;
            if (typeof orgId === "string") {
              refreshOrganizationUnread();
              if (currentOrganizationChatRef.current === orgId) {
                const message = event.data?.message as
                  | OrganizationGroupChatMessage
                  | undefined;
                if (message?.id) {
                  setOrganizationMessages((prev) => {
                    if (prev.some((m) => m.id === message.id)) return prev;
                    return [...prev, message];
                  });
                }
              }
            }
            return;
          }

          // schedule_update はセッションフィルタ前に処理する（非表示セッションも更新）
          if (event.type === "schedule_update" && event.sessionId) {
            setSchedulesBySession((prev) => ({
              ...prev,
              [event.sessionId]: event.data as any[],
            }));
            return;
          }

          if (
            !event.sessionId ||
            event.sessionId !== currentSessionRef.current
          ) {
            return;
          }

          setMessages((prev) => {
            return processEvent(prev, event);
          });
        } catch (err) {
          console.error(err);
        }
      };
    };

    connect();

    return () => {
      if (es) es.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  // A helper to process streaming events
  const processEvent = (prevMessages: any[], event: any) => {
    // If the event doesn't match the current active view, we might not update it exactly here
    // But since the current active session isn't directly bound in the closure, we rely on
    // reloading history on session switch.

    // For simplicity, we process the event. If the user changes sessions, history gets reloaded anyway.
    let newMsgs = [...prevMessages];

    if (event.type === "tool_call") {
      setIsThinking(true);
      const toolEvents = event.data.tools.map((t: any) => {
        let argsObj = {};
        if (t.args) {
          try {
            argsObj = typeof t.args === "string" ? JSON.parse(t.args) : t.args;
          } catch {}
        }
        return { name: t.name, args: argsObj, success: null };
      });
      newMsgs.push({
        toolEvents,
      });
    } else if (event.type === "tool_result") {
      const ok = event.data.success;
      const toolName = event.data.tool;
      const output = event.data.output || "";

      const lastMsg = newMsgs[newMsgs.length - 1];
      if (lastMsg && lastMsg.toolEvents) {
        // Prevent duplicate appending
        const isDuplicate = lastMsg.toolEvents.some(
          (e: any) => e.name === toolName && e.success !== null,
        );
        if (!isDuplicate) {
          // Find the matching tool call and update its success/output
          const eventIndex = lastMsg.toolEvents.findIndex(
            (e: any) => e.name === toolName && e.success === null,
          );
          if (eventIndex >= 0) {
            lastMsg.toolEvents[eventIndex] = {
              ...lastMsg.toolEvents[eventIndex],
              success: ok,
              output: output,
            };
          } else {
            lastMsg.toolEvents.push({
              name: toolName,
              success: ok,
              output: output,
            });
          }
        }
      } else {
        newMsgs.push({
          toolEvents: [{ name: toolName, success: ok, output: output }],
        });
      }
    } else if (event.type === "stream") {
      setIsThinking(true);
      const lastIdx = newMsgs.length - 1;
      const lastMsg = newMsgs[lastIdx];
      if (lastMsg && lastMsg.isStreaming && lastMsg.role === "assistant") {
        if (event.data.type === "reasoning") {
          newMsgs[lastIdx] = {
            ...lastMsg,
            reasoning: (lastMsg.reasoning || "") + event.data.chunk,
          };
        } else {
          newMsgs[lastIdx] = {
            ...lastMsg,
            content: lastMsg.content + event.data.chunk,
          };
        }
      } else {
        newMsgs.push({
          role: "assistant",
          content: event.data.type === "reasoning" ? "" : event.data.chunk,
          reasoning: event.data.type === "reasoning" ? event.data.chunk : "",
          isStreaming: true,
        });
      }
    } else if (event.type === "message") {
      if (event.data.role === "assistant") {
        setIsThinking(false);
        let streamIdx = -1;
        for (let i = newMsgs.length - 1; i >= 0; i--) {
          if (newMsgs[i].role === "assistant" && newMsgs[i].isStreaming) {
            streamIdx = i;
            break;
          }
        }
        if (streamIdx !== -1) {
          newMsgs[streamIdx] = {
            ...newMsgs[streamIdx],
            isStreaming: false,
            content: event.data.content,
            reasoning: event.data.reasoning,
          };
        } else {
          newMsgs.push({
            role: "assistant",
            content: event.data.content,
            reasoning: event.data.reasoning,
          });
        }
      } else if (
        event.data.role === "user" &&
        event.data.channelId !== "dashboard" &&
        event.data.channelId !== "system"
      ) {
        setIsThinking(true);
        newMsgs.push({
          role: "user",
          content: event.data.content,
          imageUrls: event.data.imageUrls,
        });
      }
    } else if (
      event.type === "memory_update" &&
      event.data?.kind === "recall"
    ) {
      newMsgs.push({
        memoryRecall: {
          mode: event.data.mode || "turn",
          count: event.data.count || 0,
          memories: Array.isArray(event.data.memories)
            ? event.data.memories
            : [],
        },
      });
    } else if (event.type === "cancelled") {
      setIsThinking(false);
    }

    return newMsgs;
  };

  const contentToText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .filter((part: any) => part?.type === "text")
      .map((part: any) => part?.text ?? "")
      .join("\n");
  };

  const loadHistory = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/history`);
      const history = await res.json();

      if (!Array.isArray(history)) {
        console.warn("History is not an array:", history);
        setMessages([]);
        return;
      }

      const formatted: any[] = [];
      let currentToolEvents: any[] | null = null;

      for (const m of history) {
        if (m.role === "user") {
          // Handle multi-part content with images
          const content = m.content;
          const imageUrls: string[] = [];
          let textContent = "";
          if (typeof content === "string") {
            textContent = content;
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === "text") textContent += part.text || "";
              if (
                part.type === "image_url" &&
                part.image_url?.url &&
                !part.image_url.url.startsWith("data:")
              ) {
                imageUrls.push(part.image_url.url);
              }
            }
          }
          formatted.push({
            role: "user",
            content: textContent,
            imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          });
          currentToolEvents = null;
        } else if (m.role === "assistant") {
          const assistantText = contentToText(m.content);
          if (assistantText || m.reasoning) {
            formatted.push({
              role: "assistant",
              content: assistantText,
              reasoning: m.reasoning,
            });
          }

          if (m.tool_calls && m.tool_calls.length > 0) {
            currentToolEvents = m.tool_calls.map((t: any) => {
              let argsObj = {};
              if (t.function.arguments) {
                try {
                  argsObj =
                    typeof t.function.arguments === "string"
                      ? JSON.parse(t.function.arguments)
                      : t.function.arguments;
                } catch {}
              }
              return {
                name: t.function.name,
                args: argsObj,
                success: null,
              };
            });
            formatted.push({ toolEvents: currentToolEvents });
          } else {
            currentToolEvents = null;
          }
        } else if (m.role === "tool") {
          if (!currentToolEvents) {
            currentToolEvents = [];
            formatted.push({ toolEvents: currentToolEvents });
          }
          const toolText = contentToText(m.content);
          const ok = !toolText.startsWith("Error: ");

          // Match with existing pending tool call if any
          const eventIndex = currentToolEvents.findIndex(
            (e: any) => e.name === m.name && e.success === null,
          );
          if (eventIndex >= 0) {
            currentToolEvents[eventIndex] = {
              ...currentToolEvents[eventIndex],
              success: ok,
              output: toolText,
            };
          } else {
            currentToolEvents.push({
              name: m.name,
              success: ok,
              output: toolText,
            });
          }
        }
      }

      setMessages(formatted);
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const loadSkillsList = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/skills`);
      const data = await res.json();
      setAvailableSkills(Array.isArray(data) ? data : []);
    } catch (e) {
      setAvailableSkills([]);
    }
  };

  const handleSelectSession = (id: string) => {
    setCurrentOrganizationChat(null);
    setCurrentSession(id);
    setIsThinking(false);
    loadHistory(id);
    loadSkillsList(id);
    const selected = sessions.find((s) => s.id === id);
    if (selected) {
      refreshOrganizationUnread(sessions, id);
    }
  };

  const handleSelectOrganizationChat = (organizationId: string) => {
    setCurrentOrganizationChat(organizationId);
    setMessages([]);
    setIsThinking(false);
    loadOrganizationMessages(organizationId);
    markOrganizationMessagesAsRead(organizationId);
  };

  const handleSendMessage = async (
    msg: string,
    imageUrls?: string[],
    textFiles?: { name: string; url: string; size: number }[],
  ) => {
    if (!currentSession) return;
    setMessages((prev) => [...prev, { role: "user", content: msg, imageUrls }]);
    setIsThinking(true);

    try {
      await fetch(`/api/sessions/${currentSession}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          imageUrls,
          textFiles: textFiles?.map((tf) => ({ name: tf.name, url: tf.url })),
        }),
      });
    } catch (e: any) {
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: " + e.message },
      ]);
    }
  };

  const handleCancelGeneration = async () => {
    if (!currentSession) return;
    try {
      await fetch(`/api/sessions/${currentSession}/cancel`, {
        method: "POST",
      });
      setIsThinking(false);
    } catch (e) {
      console.error("Failed to cancel", e);
    }
  };

  const handleSendOrganizationMessage = async (content: string) => {
    if (!currentOrganizationChat) return;
    const viewerSessionId = findViewerSessionIdForOrg(currentOrganizationChat);
    if (!viewerSessionId) return;

    try {
      await fetch(
        `/api/organizations/${encodeURIComponent(currentOrganizationChat)}/group-chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            senderType: "human",
            senderSessionId: viewerSessionId,
            senderName: "Human",
          }),
        },
      );
    } catch (e) {
      console.error("Failed to send organization group message", e);
    }
  };

  const handleClearHistory = async () => {
    if (!currentSession || !confirm("Clear conversation history?")) return;
    try {
      const res = await fetch(`/api/sessions/${currentSession}/history`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages([]);
      } else {
        const err = await res.json();
        alert("Error clearing history: " + err.error);
      }
    } catch (e: any) {
      alert("Request failed: " + e.message);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setActiveModal("none");
        setCurrentSession(null);
        setMessages([]);
        loadSessions();
      } else {
        const err = await res.json();
        alert(err.error);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const currentSessionName =
    sessions.find((s) => s.id === currentSession)?.name || currentSession || "";

  const organizationViewerSessionId = currentOrganizationChat
    ? findViewerSessionIdForOrg(currentOrganizationChat)
    : null;
  const organizationViewerSessionName = organizationViewerSessionId
    ? sessions.find((s) => s.id === organizationViewerSessionId)?.name ||
      organizationViewerSessionId
    : "";

  const organizationMentionCandidates = currentOrganizationChat
    ? sessions
        .filter(
          (session) =>
            (session.organizationId || "default") === currentOrganizationChat,
        )
        .map((session) => session.name)
        .filter((name): name is string => !!name && name.trim().length > 0)
        .sort((a, b) => a.localeCompare(b))
    : [];

  return (
    <>
      <header>
        <h1>🐾 meta-claw</h1>
        <div className="status">
          <button
            className="btn icon"
            onClick={() => setActiveModal("global")}
            title="Settings"
          >
            ⚙️
          </button>
          <div className={`dot ${wsConnected ? "" : "offline"}`}></div>
          <span id="ws-status">
            {wsConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </header>

      <div className="main-content">
        <Sidebar
          sessions={sessions}
          currentSession={currentSession}
          currentOrganizationChat={currentOrganizationChat}
          organizationUnread={organizationUnread}
          onSelectSession={handleSelectSession}
          onSelectOrganizationChat={handleSelectOrganizationChat}
          onNewSession={(organizationId: string) => {
            setNewSessionDefaultOrg(organizationId || "default");
            setActiveModal("new-session");
          }}
        />

        {currentOrganizationChat ? (
          <OrganizationChatArea
            organizationId={currentOrganizationChat}
            viewerSessionId={organizationViewerSessionId}
            viewerSessionName={organizationViewerSessionName}
            mentionCandidates={organizationMentionCandidates}
            messages={organizationMessages}
            unread={
              organizationUnread[currentOrganizationChat] || {
                total: 0,
                mentions: 0,
              }
            }
            onSendMessage={handleSendOrganizationMessage}
            onMarkRead={() =>
              markOrganizationMessagesAsRead(currentOrganizationChat)
            }
          />
        ) : (
          <ChatArea
            currentSession={currentSession}
            sessionName={currentSessionName}
            messages={messages}
            isThinking={isThinking}
            availableSkills={availableSkills}
            onSendMessage={handleSendMessage}
            onCancel={handleCancelGeneration}
            onClearHistory={handleClearHistory}
            onOpenSessionSettings={() => setActiveModal("session")}
          />
        )}

        <RightPanel
          currentSession={currentSession}
          externalSchedules={
            currentSession ? (schedulesBySession[currentSession] ?? null) : null
          }
        />
      </div>

      {activeModal === "global" && (
        <GlobalSettingsModal
          onClose={() => setActiveModal("none")}
          onSave={() => setActiveModal("none")}
        />
      )}

      {activeModal === "session" && currentSession && (
        <SessionSettingsModal
          sessionId={currentSession}
          onClose={() => setActiveModal("none")}
          onSave={() => {
            setActiveModal("none");
            loadSessions();
          }}
          onDelete={handleDeleteSession}
        />
      )}

      {activeModal === "new-session" && (
        <NewSessionModal
          defaultOrganizationId={newSessionDefaultOrg}
          onClose={() => setActiveModal("none")}
          onSuccess={(id: string) => {
            setActiveModal("none");
            loadSessions().then(() => handleSelectSession(id));
          }}
        />
      )}
    </>
  );
}
