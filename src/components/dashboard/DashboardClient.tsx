"use client";

import React, { useState, useEffect, useRef } from "react";
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
  const currentSessionRef = useRef<string | null>(null);

  useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

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
      const toolLines = event.data.tools.map((t: any) => {
        let line = `⚙ ${t.name}`;
        if (t.args) {
          try {
            const parsed =
              typeof t.args === "string" ? JSON.parse(t.args) : t.args;
            const summary = Object.entries(parsed)
              .map(([k, v]) => {
                const val = typeof v === "string" ? v : JSON.stringify(v);
                return `${k}: ${val.length > 60 ? val.slice(0, 57) + "..." : val}`;
              })
              .join(", ");
            if (summary) line += `\n  ${summary.slice(0, 120)}`;
          } catch {}
        }
        return line;
      });
      newMsgs.push({
        toolEvents: toolLines.map((text: string) => ({ text, success: null })),
      });
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
        event.data.channelId !== "dashboard"
      ) {
        setIsThinking(true);
        newMsgs.push({
          role: "user",
          content: event.data.content,
          imageUrls: event.data.imageUrls,
        });
      }
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
        } else if (
          m.role === "assistant" &&
          m.tool_calls &&
          m.tool_calls.length > 0
        ) {
          const toolLines = m.tool_calls.map((t: any) => {
            let line = `⚙ ${t.function.name}`;
            if (t.function.arguments) {
              try {
                const parsed =
                  typeof t.function.arguments === "string"
                    ? JSON.parse(t.function.arguments)
                    : t.function.arguments;
                const summary = Object.entries(parsed)
                  .map(([k, v]) => {
                    const val = typeof v === "string" ? v : JSON.stringify(v);
                    return `${k}: ${val.length > 60 ? val.slice(0, 57) + "..." : val}`;
                  })
                  .join(", ");
                if (summary) line += `\n  ${summary.slice(0, 120)}`;
              } catch {}
            }
            return line;
          });
          currentToolEvents = toolLines.map((text: string) => ({
            text,
            success: null,
          }));
          formatted.push({ toolEvents: currentToolEvents });
          const assistantText = contentToText(m.content);
          if (assistantText) {
            formatted.push({
              role: "assistant",
              content: assistantText,
              reasoning: m.reasoning,
            });
          }
        } else if (m.role === "tool") {
          if (!currentToolEvents) {
            currentToolEvents = [];
            formatted.push({ toolEvents: currentToolEvents });
          }
          const toolText = contentToText(m.content);
          const isError = toolText.startsWith("Error: ");
          const ok = !isError;
          const contentSlice = toolText.slice(0, 100);
          const textToAppend = `${ok ? "✓" : "✗"} ${m.name}: ${contentSlice}`;
          currentToolEvents.push({ text: textToAppend, success: ok });
        } else if (m.role === "assistant" && (m.content || m.reasoning)) {
          const textContent = contentToText(m.content);
          formatted.push({
            role: "assistant",
            content: textContent,
            reasoning: m.reasoning,
          });
          currentToolEvents = null;
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
    setCurrentSession(id);
    setIsThinking(false);
    loadHistory(id);
    loadSkillsList(id);
  };

  const handleSendMessage = async (msg: string, imageUrls?: string[]) => {
    if (!currentSession) return;
    setMessages((prev) => [...prev, { role: "user", content: msg, imageUrls }]);
    setIsThinking(true);

    try {
      await fetch(`/api/sessions/${currentSession}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, imageUrls }),
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
          onCancel={handleCancelGeneration}
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
