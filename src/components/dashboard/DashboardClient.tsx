"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { ChatArea } from "./ChatArea";
import { RightPanel } from "./RightPanel";
import {
  GlobalSettingsModal,
  SessionSettingsModal,
  NewSessionModal,
} from "./Modals";
import { SessionData, ChatMessage, Skill } from "./types";

export default function DashboardClient() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);

  const [wsConnected, setWsConnected] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);

  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);

  const [activeModal, setActiveModal] = useState<
    "none" | "global" | "session" | "new-session"
  >("none");

  const loadSessions = async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data);
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

          setMessages((prev) => {
            // Only process events for the current active session
            // We use functional updates to ensure we have the latest state,
            // but we need to check if event.sessionId matches the currently selected one.
            // A small hack: we check currentSession reference via a ref if needed,
            // but here we just process all and filter on render or let the effects handle it.
            // Actually, EventSource passes sessionId. We'll handle state update carefully.
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
      const names = event.data.tools.map((t: any) => t.name).join(", ");
      newMsgs.push({ toolEvents: [{ text: `⚙ ${names}`, success: null }] });
    } else if (event.type === "tool_result") {
      const ok = event.data.success;
      const textToAppend = `${ok ? "✓" : "✗"} ${event.data.tool}: ${event.data.output?.slice(0, 100)}`;

      const lastMsg = newMsgs[newMsgs.length - 1];
      if (lastMsg && lastMsg.toolEvents) {
        // Prevent duplicate appending
        const isDuplicate = lastMsg.toolEvents.some(
          (e: any) => e.text === textToAppend,
        );
        if (!isDuplicate) {
          lastMsg.toolEvents.push({ text: textToAppend, success: ok });
        }
      } else {
        newMsgs.push({
          toolEvents: [{ text: textToAppend, success: ok }],
        });
      }
    } else if (event.type === "stream") {
      setIsThinking(true);
      const lastIdx = newMsgs.length - 1;
      const lastMsg = newMsgs[lastIdx];
      if (lastMsg && lastMsg.isStreaming && lastMsg.role === "assistant") {
        newMsgs[lastIdx] = {
          ...lastMsg,
          content: lastMsg.content + event.data.chunk,
        };
      } else {
        newMsgs.push({
          role: "assistant",
          content: event.data.chunk,
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
          };
        } else {
          newMsgs.push({ role: "assistant", content: event.data.content });
        }
      } else if (
        event.data.role === "user" &&
        event.data.channelId !== "dashboard"
      ) {
        newMsgs.push({ role: "user", content: event.data.content });
      }
    } else if (event.type === "heartbeat") {
      newMsgs.push({
        toolEvents: [
          {
            text: `💓 Heartbeat: ${event.data.response?.slice(0, 100)}`,
            success: true,
          },
        ],
      });
    }

    return newMsgs;
  };

  const loadHistory = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/history`);
      const history = await res.json();
      const formatted = history
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any) => ({ role: m.role, content: m.content }));
      setMessages(formatted);
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const loadSkillsList = async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}/skills`);
      const data = await res.json();
      setAvailableSkills(data);
    } catch (e) {
      setAvailableSkills([]);
    }
  };

  const handleSelectSession = (id: string) => {
    setCurrentSession(id);
    setIsThinking(false);
    loadHistory(id);
    loadSkillsList(id);
  };

  const handleSendMessage = async (msg: string) => {
    if (!currentSession) return;
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setIsThinking(true);

    try {
      await fetch(`/api/sessions/${currentSession}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
    } catch (e: any) {
      setIsThinking(false);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error: " + e.message },
      ]);
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
          onSelectSession={handleSelectSession}
          onNewSession={() => setActiveModal("new-session")}
        />

        <ChatArea
          currentSession={currentSession}
          sessionName={currentSessionName}
          messages={messages}
          isThinking={isThinking}
          availableSkills={availableSkills}
          onSendMessage={handleSendMessage}
          onClearHistory={handleClearHistory}
          onOpenSessionSettings={() => setActiveModal("session")}
        />

        <RightPanel currentSession={currentSession} />
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
