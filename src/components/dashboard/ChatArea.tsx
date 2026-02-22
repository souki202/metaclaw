import React, {
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  DragEvent,
} from "react";
import { ChatMessage, Skill } from "./types";

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface ExtendedChatMessage extends ChatMessage {
  isStreaming?: boolean;
  toolEvents?: { text: string; success: boolean | null }[];
  imageUrls?: string[];
}

interface ChatAreaProps {
  currentSession: string | null;
  sessionName: string;
  messages: ExtendedChatMessage[];
  isThinking: boolean;
  availableSkills: Skill[];
  onSendMessage: (msg: string, imageUrls?: string[]) => void;
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
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

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
    if ((!msg && pendingImages.length === 0) || isThinking || !currentSession)
      return;
    const finalMsg = msg || "この画像を確認してください。";
    setInputValue("");
    setFilteredSkills([]);
    onSendMessage(
      finalMsg,
      pendingImages.length > 0 ? pendingImages : undefined,
    );
    setPendingImages([]);
  };

  // Image upload via file input
  const handleFileSelect = async (files: FileList | null) => {
    if (!files || !currentSession) return;
    await uploadFiles(Array.from(files));
  };

  // Upload files to server and get URLs
  const uploadFiles = async (files: File[]) => {
    if (!currentSession) return;
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (const file of imageFiles) {
        formData.append("images", file);
      }

      const res = await fetch(`/api/sessions/${currentSession}/upload`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setPendingImages((prev) => [...prev, ...data.urls]);
      }
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setIsUploading(false);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const removePendingImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
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
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      .replace(/\n/g, "<br>");
    return { __html: html };
  };

  // Render content that may be multi-part (with images)
  const renderContent = (content: string | ContentPart[] | undefined) => {
    if (!content) return null;

    if (typeof content === "string") {
      return <div dangerouslySetInnerHTML={formatMarkdown(content)} />;
    }

    // Multi-part content
    return (
      <>
        {content.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                key={i}
                dangerouslySetInnerHTML={formatMarkdown(part.text)}
              />
            );
          }
          if (part.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url;
            // Don't render base64 data URLs inline (too large for chat history)
            // Only render file-served URLs
            if (url.startsWith("data:")) {
              return (
                <div key={i} className="chat-image-placeholder">
                  📷 [画像]
                </div>
              );
            }
            return (
              <div key={i} className="chat-image-wrapper">
                <img
                  src={url}
                  alt="Image"
                  className="chat-image"
                  onClick={() => window.open(url, "_blank")}
                />
              </div>
            );
          }
          return null;
        })}
      </>
    );
  };

  return (
    <div
      className="chat-area"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay - covers the entire chat area for easy drop */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <span className="drag-icon">📷</span>
            <span>画像をドロップしてアップロード</span>
          </div>
        </div>
      )}

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

            {(m.content || m.isStreaming || m.imageUrls) && (
              <div className={`message ${m.role}`}>
                <div className="bubble">
                  {m.role === "assistant" && <div className="role">AI</div>}
                  {renderContent(
                    m.content as string | ContentPart[] | undefined,
                  )}
                  {/* Show user-attached images */}
                  {m.imageUrls && m.imageUrls.length > 0 && (
                    <div className="chat-images">
                      {m.imageUrls.map((url, i) => (
                        <div key={i} className="chat-image-wrapper">
                          <img
                            src={url}
                            alt={`Attached ${i + 1}`}
                            className="chat-image"
                            onClick={() => window.open(url, "_blank")}
                          />
                        </div>
                      ))}
                    </div>
                  )}
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

        {/* Pending images preview */}
        {pendingImages.length > 0 && (
          <div className="pending-images">
            {pendingImages.map((url, i) => (
              <div key={i} className="pending-image-item">
                <img src={url} alt={`Pending ${i + 1}`} />
                <button
                  className="remove-image-btn"
                  onClick={() => removePendingImage(i)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-row">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <button
            className="attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={!currentSession || isThinking || isUploading}
            title="画像を添付"
          >
            {isUploading ? "⏳" : "📎"}
          </button>
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
            onPaste={async (e) => {
              // Handle paste of images
              const items = Array.from(e.clipboardData.items);
              const imageItems = items.filter((item) =>
                item.type.startsWith("image/"),
              );
              if (imageItems.length > 0) {
                e.preventDefault();
                const files = imageItems
                  .map((item) => item.getAsFile())
                  .filter((f): f is File => f !== null);
                if (files.length > 0) {
                  await uploadFiles(files);
                }
              }
            }}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={
              !currentSession ||
              isThinking ||
              (!inputValue.trim() && pendingImages.length === 0)
            }
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};
