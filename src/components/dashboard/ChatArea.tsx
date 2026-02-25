import React, {
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  DragEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, Skill } from "./types";
import remarkBreaks from "remark-breaks";

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface ExtendedChatMessage extends ChatMessage {
  isStreaming?: boolean;
  toolEvents?: {
    name: string;
    args: Record<string, any>;
    success: boolean | null;
    output?: string;
  }[];
  imageUrls?: string[];
  reasoning?: string;
}

const ReasoningBlock: React.FC<{
  reasoning: string;
  isStreaming?: boolean;
  autoCollapseTriggered?: boolean;
}> = ({ reasoning, isStreaming, autoCollapseTriggered }) => {
  // 以前のセッションからの復元時は collapsed (false) にする。
  // 新規ストリーミング中のみ例外的に思考内容が見えるようにする。
  const [isExpanded, setIsExpanded] = useState(
    !!(isStreaming && !autoCollapseTriggered),
  );

  useEffect(() => {
    if (autoCollapseTriggered) {
      setIsExpanded(false);
    }
  }, [autoCollapseTriggered]);

  if (!reasoning) return null;

  return (
    <div className="reasoning-block">
      <div
        className={`reasoning-header ${isExpanded ? "expanded" : ""}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            overflow: "hidden",
          }}
        >
          <span>{isStreaming ? "Thinking..." : "Reasoning"}</span>
          {!isExpanded && (
            <div className="reasoning-preview">{reasoning.slice(-100)}</div>
          )}
        </div>
        <span className="toggle-icon">▶</span>
      </div>
      {isExpanded && <div className="reasoning-content">{reasoning}</div>}
    </div>
  );
};

const ToolEventBlock: React.FC<{
  event: {
    name: string;
    args: Record<string, any>;
    success: boolean | null;
    output?: string;
  };
}> = ({ event }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusIcon = () => {
    if (event.success === null) return "⏳";
    if (event.success) return "✓";
    return "✗";
  };

  const getStatusClass = () => {
    if (event.success === null) return "";
    if (event.success) return "tool-ok";
    return "tool-err";
  };

  const formatData = (data: any) => {
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  const summaryArgs = Object.entries(event.args)
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${val.length > 30 ? val.slice(0, 27) + "..." : val}`;
    })
    .join(", ");

  const summaryText = summaryArgs
    ? ` { ${summaryArgs.slice(0, 60)}${summaryArgs.length > 60 ? "..." : ""} }`
    : "{}";

  return (
    <div className={`tool-event ${isExpanded ? "expanded" : ""}`}>
      <div
        className="tool-event-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div>
          <span className={getStatusClass()}>{getStatusIcon()}</span>{" "}
          <span className="tool-name">{event.name}</span>
          {!isExpanded && (
            <span style={{ opacity: 0.7, marginLeft: "8px" }}>
              {summaryText}
            </span>
          )}
        </div>
        <span className="tool-event-toggle">▶</span>
      </div>

      {isExpanded && (
        <div className="tool-event-content">
          <div style={{ marginBottom: "8px" }}>
            <strong style={{ opacity: 0.7 }}>Arguments:</strong>
            <pre
              style={{
                margin: "4px 0",
                background: "rgba(0,0,0,0.2)",
                padding: "8px",
                borderRadius: "4px",
              }}
            >
              {formatData(event.args)}
            </pre>
          </div>

          <div>
            <strong style={{ opacity: 0.7 }}>Result:</strong>
            {event.success === null ? (
              <div
                style={{ fontStyle: "italic", opacity: 0.7, marginTop: "4px" }}
              >
                Executing...
              </div>
            ) : (
              <pre
                style={{
                  margin: "4px 0",
                  background: "rgba(0,0,0,0.2)",
                  padding: "8px",
                  borderRadius: "4px",
                  color: event.success ? "inherit" : "var(--red)",
                }}
              >
                {formatData(event.output)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface ChatAreaProps {
  currentSession: string | null;
  sessionName: string;
  messages: ExtendedChatMessage[];
  isThinking: boolean;
  availableSkills: Skill[];
  onSendMessage: (msg: string, imageUrls?: string[]) => void;
  onCancel: () => void;
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
  onCancel,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
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

  const toPublicAssetUrl = (rawUrl: string): string => {
    if (!rawUrl) return rawUrl;
    if (
      rawUrl.startsWith("data:") ||
      rawUrl.startsWith("http://") ||
      rawUrl.startsWith("https://") ||
      rawUrl.startsWith("/api/sessions/")
    ) {
      return rawUrl;
    }

    const normalized = rawUrl
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\//, "");

    const screenshotsMatch = normalized.match(/^screenshots\/(.+)$/);
    if (screenshotsMatch && currentSession) {
      const filename = screenshotsMatch[1].split("/").pop();
      if (filename) {
        return `/api/sessions/${currentSession}/images/${filename}`;
      }
    }

    const uploadsMatch = normalized.match(/^uploads\/(.+)$/);
    if (uploadsMatch && currentSession) {
      const filename = uploadsMatch[1].split("/").pop();
      if (filename) {
        return `/api/sessions/${currentSession}/uploads/${filename}`;
      }
    }

    return rawUrl;
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;

    // Strip timestamp markers: [[timestamp:...]]
    const cleanText = text.replace(/\[\[timestamp:[^\]]+\]\]\s?/g, "");

    return (
      <div className="chat-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            img: ({ src, alt }) => {
              const url = typeof src === "string" ? toPublicAssetUrl(src) : "";
              if (!url || url.startsWith("data:")) {
                return (
                  <span className="chat-image-placeholder">📷 [画像]</span>
                );
              }
              return (
                <span className="chat-image-wrapper">
                  <img
                    src={url}
                    alt={alt || "Image"}
                    className="chat-image"
                    loading="lazy"
                    onClick={() => window.open(url, "_blank")}
                  />
                </span>
              );
            },
          }}
        >
          {cleanText}
        </ReactMarkdown>
      </div>
    );
  };

  // Render content that may be multi-part (with images)
  const renderContent = (content: string | ContentPart[] | undefined) => {
    if (!content) return null;

    if (typeof content === "string") {
      return renderMarkdown(content);
    }

    // Multi-part content
    return (
      <>
        {content.map((part, i) => {
          if (part.type === "text" && part.text) {
            return <div key={i}>{renderMarkdown(part.text)}</div>;
          }
          if (part.type === "image_url" && part.image_url?.url) {
            const url = toPublicAssetUrl(part.image_url.url);
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
                <ToolEventBlock key={`evt-${idx}-${eidx}`} event={evt} />
              ))}

            {(m.content || m.isStreaming || m.imageUrls || m.reasoning) && (
              <div className={`message ${m.role}`}>
                <div className="bubble">
                  {m.role === "assistant" && <div className="role">AI</div>}
                  {m.role === "assistant" && m.reasoning && (
                    <ReasoningBlock
                      reasoning={m.reasoning}
                      isStreaming={m.isStreaming && !m.content}
                      autoCollapseTriggered={
                        !!(m.isStreaming && m.content && m.reasoning)
                      }
                    />
                  )}
                  {renderContent(
                    m.content as string | ContentPart[] | undefined,
                  )}
                  {/* Show user-attached images */}
                  {m.imageUrls && m.imageUrls.length > 0 && (
                    <div className="chat-images">
                      {m.imageUrls.map((url, i) => (
                        <div key={i} className="chat-image-wrapper">
                          <img
                            src={toPublicAssetUrl(url)}
                            alt={`Attached ${i + 1}`}
                            className="chat-image"
                            onClick={() =>
                              window.open(toPublicAssetUrl(url), "_blank")
                            }
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
                <img src={toPublicAssetUrl(url)} alt={`Pending ${i + 1}`} />
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
            ref={textareaRef}
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
          {isThinking ? (
            <button
              className="send-btn cancel"
              onClick={onCancel}
              title="Stop generation"
            >
              ■
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={
                !currentSession ||
                (!inputValue.trim() && pendingImages.length === 0)
              }
            >
              ➤
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
