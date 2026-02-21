import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ChatMessage, Skill } from "./types";

interface ExtendedChatMessage extends ChatMessage {
  isStreaming?: boolean;
  toolEvents?: { text: string; success: boolean | null }[];
}

interface ChatAreaProps {
  currentSession: string | null;
  sessionName: string;
  messages: ExtendedChatMessage[];
  isThinking: boolean;
  availableSkills: Skill[];
  onSendMessage: (msg: string) => void;
  onClearHistory: () => void;
  onOpenSessionSettings: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  currentSession,
  sessionName,
  messages,
  isThinking,
  availableSkills,
  onSendMessage,
  onClearHistory,
  onOpenSessionSettings,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [filteredSkills, setFilteredSkills] = useState<Skill[]>([]);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(-1);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, isThinking]);

  const handleInputValue = (val: string) => {
    setInputValue(val);
    const lastWord = val.split(/\s+/).pop() || "";
    if (lastWord.startsWith("/")) {
      const query = lastWord.slice(1).toLowerCase();
      const matched = availableSkills.filter((s) =>
        s.name.toLowerCase().includes(query),
      );
      setFilteredSkills(matched);
      setSelectedSkillIndex(matched.length > 0 ? 0 : -1);
    } else {
      setFilteredSkills([]);
      setSelectedSkillIndex(-1);
    }
  };

  const applySkill = (skill: Skill) => {
    const parts = inputValue.split(/\s+/);
    parts[parts.length - 1] = `/${skill.name} `;
    setInputValue(parts.join(" "));
    setFilteredSkills([]);
    setSelectedSkillIndex(-1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSkillIndex(
          Math.min(selectedSkillIndex + 1, filteredSkills.length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSkillIndex(Math.max(selectedSkillIndex - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredSkills[selectedSkillIndex]) {
          applySkill(filteredSkills[selectedSkillIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setFilteredSkills([]);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    const msg = inputValue.trim();
    if (!msg || isThinking || !currentSession) return;
    setInputValue("");
    setFilteredSkills([]);
    onSendMessage(msg);
  };

  // Convert simple markdown elements (bold, code block, inline code, newline)
  const formatMarkdown = (text: string) => {
    if (!text) return { __html: "" };
    const html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    return { __html: html };
  };

  return (
    <div className="chat-area">
      <div className="chat-toolbar">
        <span className="title">
          {currentSession ? sessionName : "Select a session"}
        </span>
        <div className="spacer"></div>
        {currentSession && (
          <>
            <button className="btn" onClick={onOpenSessionSettings}>
              Settings
            </button>
            <button className="btn danger" onClick={onClearHistory}>
              Clear
            </button>
          </>
        )}
      </div>

      <div className="messages">
        {!currentSession && (
          <div className="empty">Select a session to start chatting</div>
        )}

        {messages.map((m, idx) => (
          <React.Fragment key={idx}>
            {m.toolEvents &&
              m.toolEvents.map((evt, eidx) => (
                <div key={`evt-${idx}-${eidx}`} className="tool-event">
                  <span
                    className={
                      evt.success === null
                        ? ""
                        : evt.success
                          ? "tool-ok"
                          : "tool-err"
                    }
                  >
                    {evt.text}
                  </span>
                </div>
              ))}

            {(m.content || m.isStreaming) && (
              <div className={`message ${m.role}`}>
                <div className="bubble">
                  {m.role === "assistant" && <div className="role">AI</div>}
                  <div dangerouslySetInnerHTML={formatMarkdown(m.content)} />
                </div>
              </div>
            )}
          </React.Fragment>
        ))}

        {isThinking && (
          <div className="message assistant">
            <div className="bubble">
              <div className="typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area" style={{ position: "relative" }}>
        <div
          className={`autocomplete-popup ${filteredSkills.length > 0 ? "active" : ""}`}
        >
          {filteredSkills.map((skill, index) => (
            <div
              key={skill.name}
              className={`autocomplete-item ${index === selectedSkillIndex ? "selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applySkill(skill);
              }}
            >
              <div className="skill-name">/{skill.name}</div>
              <div className="skill-desc">{skill.description}</div>
            </div>
          ))}
        </div>

        <div className="input-row">
          <textarea
            placeholder="Message..."
            rows={1}
            value={inputValue}
            onChange={(e) => {
              handleInputValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height =
                Math.min(e.target.scrollHeight, 200) + "px";
            }}
            onKeyDown={handleKeyDown}
            disabled={!currentSession || isThinking}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!currentSession || isThinking || !inputValue.trim()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};
