import React, { KeyboardEvent, useEffect, useRef, useState } from "react";
import { OrganizationGroupChatMessage, OrganizationUnread } from "./types";

interface OrganizationChatAreaProps {
  organizationId: string | null;
  viewerSessionId: string | null;
  viewerSessionName: string;
  mentionCandidates: string[];
  messages: OrganizationGroupChatMessage[];
  unread: OrganizationUnread;
  onSendMessage: (content: string) => void;
  onMarkRead: () => void;
}

export const OrganizationChatArea: React.FC<OrganizationChatAreaProps> = ({
  organizationId,
  viewerSessionId,
  viewerSessionName,
  mentionCandidates,
  messages,
  unread,
  onSendMessage,
  onMarkRead,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [filteredMentions, setFilteredMentions] = useState<string[]>([]);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  const handleSend = () => {
    const content = inputValue.trim();
    if (!organizationId || !viewerSessionId || !content) return;
    setInputValue("");
    setFilteredMentions([]);
    setSelectedMentionIndex(-1);
    onSendMessage(content);
  };

  const handleInputValue = (value: string) => {
    setInputValue(value);
    const lastWord = value.split(/\s+/).pop() || "";
    if (!lastWord.startsWith("@")) {
      setFilteredMentions([]);
      setSelectedMentionIndex(-1);
      return;
    }

    const query = lastWord.slice(1).toLowerCase();
    const matches = mentionCandidates
      .filter((candidate) => candidate.toLowerCase().includes(query))
      .slice(0, 8);
    setFilteredMentions(matches);
    setSelectedMentionIndex(matches.length > 0 ? 0 : -1);
  };

  const applyMention = (name: string) => {
    const parts = inputValue.split(/\s+/);
    parts[parts.length - 1] = `@${name} `;
    setInputValue(parts.join(" "));
    setFilteredMentions([]);
    setSelectedMentionIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.min(prev + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredMentions[selectedMentionIndex]) {
          applyMention(filteredMentions[selectedMentionIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setFilteredMentions([]);
        setSelectedMentionIndex(-1);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-area">
      <div className="chat-toolbar">
        <span className="title">
          {organizationId ? `# ${organizationId} Group Chat` : "Select group chat"}
        </span>
        <div className="spacer"></div>
        {organizationId && (
          <>
            <span className="org-chat-unread-summary">
              Unread {unread.total} / Mentions {unread.mentions}
            </span>
            <button className="btn" onClick={onMarkRead} disabled={!viewerSessionId}>
              Mark read
            </button>
          </>
        )}
      </div>

      <div className="messages">
        {!organizationId && (
          <div className="empty">Select an organization group chat</div>
        )}

        {organizationId && messages.length === 0 && (
          <div className="empty">No messages yet</div>
        )}

        {messages.map((message) => {
          const isSelf = !!viewerSessionId && message.senderSessionId === viewerSessionId;
          const isMentioned =
            !!viewerSessionId && message.mentionSessionIds.includes(viewerSessionId);

          return (
            <div key={message.id} className={`message ${isSelf ? "user" : "assistant"}`}>
              <div className={`bubble ${isMentioned ? "mention-highlight" : ""}`}>
                <div className="role">
                  {message.senderName}
                  <span className="org-chat-time"> · {new Date(message.timestamp).toLocaleString()}</span>
                </div>
                <div>{message.content}</div>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      <div className="input-area" style={{ position: "relative" }}>
        <div className={`autocomplete-popup ${filteredMentions.length > 0 ? "active" : ""}`}>
          {filteredMentions.map((mention, index) => (
            <div
              key={mention}
              className={`autocomplete-item ${index === selectedMentionIndex ? "selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(mention);
              }}
            >
              <div className="skill-name">@{mention}</div>
            </div>
          ))}
        </div>

        <div className="input-row">
          <textarea
            placeholder={
              viewerSessionId
                ? `Message #${organizationId} (mention with @${viewerSessionName || "session name"})`
                : "No session in this organization"
            }
            rows={1}
            value={inputValue}
            onChange={(e) => {
              handleInputValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
            }}
            onKeyDown={onKeyDown}
            disabled={!organizationId || !viewerSessionId}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!organizationId || !viewerSessionId || !inputValue.trim()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};
