import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MemoryEntry, ChatMessage, ContentPartText } from '../types.js';
import type { EmbeddingProvider } from './embedding.js';

const MAX_AUTO_TEXT = 8000;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Extract plain text from a ChatMessage, stripping images. Truncate to MAX_AUTO_TEXT. */
function extractTextForMemory(msg: ChatMessage): string {
  const parts: string[] = [];

  if (msg.role === 'tool' && msg.name) {
    parts.push(`[tool:${msg.name}]`);
  }

  if (msg.content) {
    if (typeof msg.content === 'string') {
      parts.push(msg.content);
    } else {
      const textParts = msg.content
        .filter((p): p is ContentPartText => p.type === 'text')
        .map(p => p.text);
      parts.push(...textParts);
    }
  }

  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    const toolInfo = msg.tool_calls
      .map(tc => `call:${tc.function.name}(${tc.function.arguments.slice(0, 200)})`)
      .join(', ');
    parts.push(toolInfo);
  }

  return parts.join(' | ').slice(0, MAX_AUTO_TEXT);
}

export interface SmartRecallOptions {
  limit?: number;
  minSimilarity?: number;   // minimum raw cosine similarity (default 0.55)
  decayRate?: number;       // per-day recency decay factor (default 0.05)
  dedupeThreshold?: number; // skip result if similarity to an already-selected result exceeds this (default 0.90)
}

export interface RecalledEntry {
  entry: MemoryEntry;
  similarity: number;
  combinedScore: number;
}

export class VectorMemory {
  private filePath: string;
  private entries: MemoryEntry[] = [];
  private embedder: EmbeddingProvider;
  private sessionId: string;

  constructor(workspace: string, sessionId: string, embedder: EmbeddingProvider) {
    this.filePath = path.join(workspace, 'memory', 'vectors.json');
    this.sessionId = sessionId;
    this.embedder = embedder;
    this.load();
  }

  updateEmbedder(embedder: EmbeddingProvider) {
    this.embedder = embedder;
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      try {
        this.entries = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      } catch {
        this.entries = [];
      }
    }
  }

  private save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
  }

  async add(text: string, metadata?: Partial<MemoryEntry['metadata']>): Promise<string> {
    const embedding = await this.embedder.embed(text);
    const entry: MemoryEntry = {
      id: randomUUID(),
      text,
      embedding,
      metadata: {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        type: 'manual',
        ...metadata,
      },
    };
    this.entries.push(entry);
    this.save();
    return entry.id;
  }

  /** Auto-save a conversation message to vector memory. Skips empty or trivial text. */
  async autoAdd(msg: ChatMessage): Promise<void> {
    const text = extractTextForMemory(msg);
    if (text.trim().length < 10) return;

    const embedding = await this.embedder.embed(text);
    const entry: MemoryEntry = {
      id: randomUUID(),
      text,
      embedding,
      metadata: {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        role: msg.role as 'user' | 'assistant' | 'tool',
        type: 'auto',
      },
    };
    this.entries.push(entry);
    this.save();
  }

  async search(query: string, limit = 10): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    if (this.entries.length === 0) return [];
    const queryEmbedding = await this.embedder.embed(query);
    const scored = this.entries.map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Human-memory-inspired smart recall:
   *
   * 1. Compute raw cosine similarity with all entries.
   * 2. Apply recency decay: combinedScore = similarity * exp(-decayRate * days_ago).
   *    Recent memories score higher even at equal semantic similarity.
   * 3. Filter entries below minSimilarity (prevents recency bias from surfacing unrelated old entries).
   * 4. Deduplicate: skip a candidate if its embedding is too close to an already-selected entry.
   *    This prevents adjacent conversation turns from all being returned.
   * 5. Return top `limit` results sorted by combinedScore.
   */
  async smartRecall(query: string, options: SmartRecallOptions = {}): Promise<RecalledEntry[]> {
    if (this.entries.length === 0) return [];

    const {
      limit = 6,
      minSimilarity = 0.55,
      decayRate = 0.05,
      dedupeThreshold = 0.90,
    } = options;

    const queryEmbedding = await this.embedder.embed(query);
    const now = Date.now();

    // Score all entries
    const scored = this.entries.map(entry => {
      const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
      const daysAgo = (now - new Date(entry.metadata.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-decayRate * daysAgo);
      return {
        entry,
        similarity,
        combinedScore: similarity * recencyWeight,
      };
    });

    // Filter and sort
    const candidates = scored
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.combinedScore - a.combinedScore);

    // Deduplicate: keep selected embeddings to compare against
    const selected: RecalledEntry[] = [];
    const selectedEmbeddings: number[][] = [];

    for (const candidate of candidates) {
      if (selected.length >= limit) break;

      // Check if this candidate is too similar to an already-selected result
      const isDuplicate = selectedEmbeddings.some(
        sel => cosineSimilarity(sel, candidate.entry.embedding) >= dedupeThreshold
      );
      if (isDuplicate) continue;

      selected.push(candidate);
      selectedEmbeddings.push(candidate.entry.embedding);
    }

    return selected;
  }

  async delete(id: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  list(limit = 50): MemoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.metadata.timestamp.localeCompare(a.metadata.timestamp))
      .slice(0, limit);
  }

  count(): number {
    return this.entries.length;
  }
}
