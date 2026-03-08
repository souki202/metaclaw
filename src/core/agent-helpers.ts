import path from 'path';
import { fileURLToPath } from 'url';
import type { ContentPart, SessionConfig } from '../types.js';
import { buildSkillsPromptText } from './skills.js';

type AssistantContent = string | ContentPart[] | null;

type McpServerState = {
  id: string;
  status: string;
  toolCount?: number;
};

type BuildSystemPromptInput = {
  sessionId: string;
  workspace: string;
  config: SessionConfig;
  identity: string;
  soul: string;
  user: string;
  memory: string;
  tmpMemory: string;
  recalledMemories?: string | null;
  mcpStates: McpServerState[];
};

export function buildAgentSystemPrompt({
  sessionId,
  workspace,
  config,
  identity,
  soul,
  user,
  memory,
  tmpMemory,
  recalledMemories,
  mcpStates,
}: BuildSystemPromptInput): string {
  const parts = [
    `You are an AI personal agent running in the meta-claw system.`,
    `Session ID: ${sessionId}`,
    ``,
  ];

  if (identity) {
    parts.push(`## Your Identity\n${identity}`);
  }
  if (soul) {
    parts.push(`## Your Soul\n${soul}`);
  }
  if (user) {
    parts.push(`## About the User\n${user}`);
  }
  if (memory) {
    parts.push(`## Quick Memory (MEMORY.md)\n${memory}`);
  }
  if (tmpMemory) {
    parts.push(`## Temporary Memory (TMP_MEMORY.md)\n${tmpMemory}`);
  }
  if (recalledMemories) {
    parts.push(`## Recalled Conversation History\nThe following past conversation snippets were recalled as semantically relevant to the current message. They are from earlier sessions or earlier in this session and may not be in the active context window:\n\n${recalledMemories}`);
  }

  const skillsPrompt = buildSkillsPromptText([process.cwd(), workspace]);
  if (skillsPrompt) {
    parts.push(skillsPrompt);
  }

  parts.push(
    ``,
    `## Workspace`,
    `Your workspace is: ${workspace}`,
    `Workspace restriction: ${config.restrictToWorkspace ? 'ENABLED (files/exec limited to workspace)' : 'DISABLED'}`,
    `Self-modification: ${config.allowSelfModify ? 'ENABLED' : 'DISABLED'}`,
  );

  const connectedServers = mcpStates.filter(s => s.status === 'connected');
  const activeServersInfo = [];
  for (const server of connectedServers) {
    if (!server.toolCount || server.toolCount === 0) continue;
    activeServersInfo.push({
      id: server.id,
      count: server.toolCount,
    });
  }

  if (activeServersInfo.length > 0) {
    parts.push(``, `## Available Tools`);
    parts.push(`You have access to a variety of tools. ONLY EXPECT THE TOOLS PROVIDED IN THE FUNCTION CALLING SCHEMA TO ACTUALLY WORK. Do not attempt to use tools if they are not defined in your tool_calls schema (some may be disabled by the user).`);
    parts.push(`You also have access to external MCP (Model Context Protocol) tools from the following servers:`);
    for (const info of activeServersInfo) {
      parts.push(`- **${info.id}** — Tool names are prefixed with \`mcp_${info.id}_\``);
    }
    parts.push(`When the user asks about functionality that matches an MCP server's capabilities, ALWAYS use the corresponding MCP tool instead of explaining how to do it manually.`);
  }

  parts.push(
    ``,
    `Use the provided tools to help the user. When you learn important facts, save them to memory.`,
    `When you need to show an image to the user, prefer standard Markdown image syntax: ![alt text](image_url).`
  );

  return parts.join('\n');
}

type ArtifactUrlContext = {
  sessionId: string;
  sessionDir: string;
};

export function toPublicImageUrl(rawUrl: string, { sessionId, sessionDir }: ArtifactUrlContext): string | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('/api/sessions/')) return rawUrl;
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('data:') || rawUrl.startsWith('mailto:')) return rawUrl;

  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const toSessionRelative = (candidate: string): string | null => {
    const normalizedCandidate = path.normalize(candidate);
    const normalizedSessionDir = path.normalize(sessionDir);

    const rel = path.relative(normalizedSessionDir, normalizedCandidate);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.replace(/\\/g, '/');
    }
    if (!rel) return '';
    return null;
  };

  const toArtifactUrl = (relPath: string): string | null => {
    const cleaned = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
    if (!cleaned || cleaned.startsWith('..')) return null;
    const encoded = cleaned
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
    if (!encoded) return null;
    return `/api/sessions/${sessionId}/artifacts/${encoded}`;
  };

  const trimmed = rawUrl.trim();
  let localPathCandidate: string | null = null;

  if (trimmed.startsWith('file://')) {
    try {
      localPathCandidate = fileURLToPath(trimmed);
    } catch {
      localPathCandidate = decode(trimmed.replace(/^file:\/\//i, '').replace(/^\/+([A-Za-z]:)/, '$1'));
    }
  } else if (path.isAbsolute(trimmed)) {
    localPathCandidate = trimmed;
  }

  if (localPathCandidate) {
    const sessionRelative = toSessionRelative(localPathCandidate);
    if (sessionRelative !== null) {
      return toArtifactUrl(sessionRelative);
    }

    const slashPath = decode(localPathCandidate).replace(/\\/g, '/');
    const marker = `/sessions/${sessionId}/`;
    const markerIndex = slashPath.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const rel = slashPath.slice(markerIndex + marker.length);
      return toArtifactUrl(rel);
    }
  }

  const normalized = decode(trimmed).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!normalized || normalized.startsWith('..')) return null;

  if (normalized.startsWith(`sessions/${sessionId}/`)) {
    return toArtifactUrl(normalized.slice(`sessions/${sessionId}/`.length));
  }

  return toArtifactUrl(normalized);
}

export function rewriteImageUrlsForUser(text: string, context: ArtifactUrlContext): string {
  if (!text) return text;

  const rewrite = (url: string): string => toPublicImageUrl(url, context) ?? url;

  let updated = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
    return `![${alt}](${rewrite(url)})`;
  });

  updated = updated.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    return `[${label}](${rewrite(url)})`;
  });

  updated = updated.replace(/(^|\s)(\.?\/?(?:screenshots|uploads)\/[\w\-.\/]+(?:\?[\w=&.-]+)?)/g, (_m, lead: string, rawPath: string) => {
    const mapped = toPublicImageUrl(rawPath, context);
    return `${lead}${mapped ?? rawPath}`;
  });

  return updated;
}

export function normalizeAssistantContent(content: AssistantContent, context: ArtifactUrlContext): AssistantContent {
  if (!content) return content;
  if (typeof content === 'string') return rewriteImageUrlsForUser(content, context);

  return content.map((part) => {
    if (part.type === 'text') {
      return { ...part, text: rewriteImageUrlsForUser(part.text, context) };
    }
    if (part.type === 'image_url') {
      const resolved = toPublicImageUrl(part.image_url.url, context) ?? part.image_url.url;
      return {
        ...part,
        image_url: {
          ...part.image_url,
          url: resolved,
        },
      };
    }
    return part;
  });
}
