import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import * as lancedb from '@lancedb/lancedb';
import type { MemoryEntry, ChatMessage, ContentPartText, MemoryConfig } from '../types.js';
import type { EmbeddingProvider } from './embedding.js';

const DEFAULT_AUTO_CHUNK_TARGET = 2000;
const DEFAULT_AUTO_CHUNK_MAX = 2500;

const IMPORTANT_HINTS = [
  'important',
  'remember',
  'todo',
  'deadline',
  'urgent',
  'must',
  'required',
  'error',
  'failed',
  'exception',
];

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

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

function calculateSalience(msg: ChatMessage, text: string): number {
  let salience = 0.1;

  if (msg.role === 'tool') salience += 0.25;
  if (msg.role === 'user') salience += 0.2;
  if (msg.role === 'assistant') salience += 0.15;

  const normalized = text.toLowerCase();
  if (IMPORTANT_HINTS.some(keyword => normalized.includes(keyword))) {
    salience += 0.25;
  }

  if (/error|fail|exception|timeout/.test(normalized)) {
    salience += 0.2;
  }

  if (/([a-zA-Z]:\\|\/|\.ts|\.tsx|\.js|\.json|https?:\/\/)/.test(text)) {
    salience += 0.1;
  }

  if (text.length >= 200 && text.length <= 2000) {
    salience += 0.1;
  }

  return clamp01(salience);
}

/** Extract plain text from a ChatMessage, stripping images. */
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

  return parts.join(' | ');
}

function splitByWordBoundary(text: string, maxLength: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if ((current.length + 1 + word.length) <= maxLength) {
      current += ` ${word}`;
      continue;
    }

    chunks.push(current);
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitTextForAutoMemory(text: string, targetLength: number, maxLength: number): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  if (normalized.length <= targetLength) {
    return [normalized];
  }

  const sentenceLikeUnits = normalized
    .split(/(?<=[。．.!?！？]|\n)\s*/u)
    .map(unit => unit.trim())
    .filter(Boolean);

  const units: string[] = [];
  for (const unit of sentenceLikeUnits) {
    if (unit.length <= maxLength) {
      units.push(unit);
      continue;
    }
    units.push(...splitByWordBoundary(unit, maxLength));
  }

  if (units.length === 0) {
    return splitByWordBoundary(normalized, maxLength);
  }

  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (!current) {
      current = unit;
      continue;
    }

    if (current.length >= targetLength) {
      chunks.push(current);
      current = unit;
      continue;
    }

    if ((current.length + 1 + unit.length) <= maxLength) {
      current += ` ${unit}`;
    } else {
      chunks.push(current);
      current = unit;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

// LanceDB row shape — metadata fields are flattened with defaults
interface LanceRow extends Record<string, unknown> {
  id: string;
  text: string;
  vector: number[];
  timestamp: string;
  category: string;
  source: string;
  sessionId: string;
  role: string;
  entryType: string;
  salience: number;
  recallCount: number;
  lastRecalledAt: string;
}

function entryToRow(entry: MemoryEntry): LanceRow {
  return {
    id: entry.id,
    text: entry.text,
    vector: entry.embedding,
    timestamp: entry.metadata.timestamp,
    category: entry.metadata.category ?? '',
    source: entry.metadata.source ?? '',
    sessionId: entry.metadata.sessionId ?? '',
    role: entry.metadata.role ?? '',
    entryType: entry.metadata.type ?? '',
    salience: entry.metadata.salience ?? 0,
    recallCount: entry.metadata.recallCount ?? 0,
    lastRecalledAt: entry.metadata.lastRecalledAt ?? '',
  };
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  const vector = row['vector'] as number[] | Float32Array | Float64Array;
  return {
    id: row['id'] as string,
    text: row['text'] as string,
    embedding: Array.isArray(vector) ? vector : Array.from(vector as Float32Array),
    metadata: {
      timestamp: row['timestamp'] as string,
      ...(row['category'] ? { category: row['category'] as string } : {}),
      ...(row['source'] ? { source: row['source'] as string } : {}),
      ...(row['sessionId'] ? { sessionId: row['sessionId'] as string } : {}),
      ...(row['role'] ? { role: row['role'] as 'user' | 'assistant' | 'tool' } : {}),
      ...(row['entryType'] ? { type: row['entryType'] as 'auto' | 'manual' } : {}),
      ...((row['salience'] as number) > 0 ? { salience: row['salience'] as number } : {}),
      ...((row['recallCount'] as number) > 0 ? { recallCount: row['recallCount'] as number } : {}),
      ...(row['lastRecalledAt'] ? { lastRecalledAt: row['lastRecalledAt'] as string } : {}),
    },
  };
}

export interface SmartRecallOptions {
  limit?: number;
  minSimilarity?: number;   // minimum raw cosine similarity (default 0.55)
  decayRate?: number;       // per-day recency decay factor (default 0.05)
  dedupeThreshold?: number; // skip result if similarity to an already-selected result exceeds this (default 0.90)
  salienceWeight?: number;  // weight for salience boost (default 0.25)
  recallWeight?: number;    // weight for recall-strength boost (default 0.08)
  markAsRecalled?: boolean; // update recallCount/lastRecalledAt (default true)
}

export interface RecalledEntry {
  entry: MemoryEntry;
  similarity: number;
  combinedScore: number;
}

export class VectorMemory {
  private dbPath: string;
  private legacyJsonPath: string;
  private entries: MemoryEntry[] = [];
  private embedder: EmbeddingProvider;
  private sessionId: string;
  private memoryConfig?: MemoryConfig;
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(workspace: string, sessionId: string, embedder: EmbeddingProvider, memoryConfig?: MemoryConfig) {
    this.dbPath = path.join(workspace, 'memory', 'lancedb');
    this.legacyJsonPath = path.join(workspace, 'memory', 'vectors.json');
    this.sessionId = sessionId;
    this.embedder = embedder;
    this.memoryConfig = memoryConfig;
  }

  updateEmbedder(embedder: EmbeddingProvider) {
    this.embedder = embedder;
  }

  updateMemoryConfig(memoryConfig: MemoryConfig) {
    this.memoryConfig = memoryConfig;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._init();
    }
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    fs.mkdirSync(this.dbPath, { recursive: true });
    this.db = await lancedb.connect(this.dbPath);
    const tableNames = await this.db.tableNames();

    if (tableNames.includes('vectors')) {
      this.table = await this.db.openTable('vectors');
      const rows = await this.table.query().toArray();
      this.entries = rows.map(row => rowToEntry(row as Record<string, unknown>));
    } else if (fs.existsSync(this.legacyJsonPath)) {
      // Migrate from vectors.json
      try {
        const legacy: MemoryEntry[] = JSON.parse(fs.readFileSync(this.legacyJsonPath, 'utf-8'));
        if (legacy.length > 0) {
          const rows = legacy.map(entryToRow);
          this.table = await this.db.createTable('vectors', rows);
          this.entries = legacy;
          fs.unlinkSync(this.legacyJsonPath);
        }
      } catch {
        this.entries = [];
      }
    }
    // If no table and no legacy file, table will be created on first insert
  }

  private async getOrCreateTable(firstRow: LanceRow): Promise<{ table: lancedb.Table; created: boolean; }> {
    if (this.table) return { table: this.table, created: false };
    if (!this.db) throw new Error('DB not initialized');
    this.table = await this.db.createTable('vectors', [firstRow]);
    return { table: this.table, created: true };
  }

  async add(text: string, metadata?: Partial<MemoryEntry['metadata']>): Promise<string> {
    await this.ensureInit();
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

    const row = entryToRow(entry);
    const { table, created } = await this.getOrCreateTable(row);
    if (!created) {
      await table.add([row]);
    }
    return entry.id;
  }

  /** Auto-save a conversation message to vector memory. Skips empty or trivial text. */
  async autoAdd(msg: ChatMessage): Promise<void> {
    await this.ensureInit();
    const text = extractTextForMemory(msg);
    if (text.trim().length < 10) return;

    const targetLength = this.memoryConfig?.autoChunkTargetLength ?? DEFAULT_AUTO_CHUNK_TARGET;
    const maxLength = this.memoryConfig?.autoChunkMaxLength ?? DEFAULT_AUTO_CHUNK_MAX;
    const chunks = splitTextForAutoMemory(text, targetLength, maxLength);
    if (chunks.length === 0) return;

    const timestamp = new Date().toISOString();
    const newEntries: MemoryEntry[] = [];
    for (const chunk of chunks) {
      const embedding = await this.embedder.embed(chunk);
      const entry: MemoryEntry = {
        id: randomUUID(),
        text: chunk,
        embedding,
        metadata: {
          timestamp,
          sessionId: this.sessionId,
          role: msg.role as 'user' | 'assistant' | 'tool',
          type: 'auto',
          salience: calculateSalience(msg, chunk),
        },
      };
      this.entries.push(entry);
      newEntries.push(entry);
    }

    if (newEntries.length === 0) return;
    const rows = newEntries.map(entryToRow);
    const { table, created } = await this.getOrCreateTable(rows[0]);
    if (!created) {
      await table.add(rows);
    } else if (rows.length > 1) {
      await table.add(rows.slice(1));
    }
  }

  async search(query: string, limit = 10): Promise<Array<{ entry: MemoryEntry; score: number; }>> {
    await this.ensureInit();
    if (this.entries.length === 0) return [];
    const queryEmbedding = await this.embedder.embed(query);
    const scored = this.entries.map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async keywordSearch(query: string, limit = 10, exact = false): Promise<MemoryEntry[]> {
    await this.ensureInit();
    if (this.entries.length === 0) return [];

    let filtered: MemoryEntry[];
    if (exact) {
      filtered = this.entries.filter(e => e.text.includes(query));
    } else {
      const lowerQuery = query.toLowerCase();
      filtered = this.entries.filter(e => e.text.toLowerCase().includes(lowerQuery));
    }

    return filtered
      .sort((a, b) => b.metadata.timestamp.localeCompare(a.metadata.timestamp))
      .slice(0, limit);
  }

  /**
   * Human-like recall with multiple cues:
   *
   * - Cue-driven retrieval: use multiple cues (current user goal + recent autonomous actions).
   * - Accessibility boost: memories recalled often become easier to retrieve.
   * - Salience boost: errors/todos/important events are easier to recall.
   * - Recency decay and deduplication keep results relevant and diverse.
   */
  async humanLikeRecall(cues: string[], options: SmartRecallOptions = {}): Promise<RecalledEntry[]> {
    await this.ensureInit();
    if (this.entries.length === 0) return [];

    const normalizedCues = cues
      .map(cue => cue.trim())
      .filter(cue => cue.length > 0)
      .slice(0, 6);
    if (normalizedCues.length === 0) return [];

    const {
      limit = 6,
      minSimilarity = 0.55,
      decayRate = 0.05,
      dedupeThreshold = 0.90,
      salienceWeight = 0.25,
      recallWeight = 0.08,
      markAsRecalled = true,
    } = options;

    const cueEmbeddings = await Promise.all(normalizedCues.map(cue => this.embedder.embed(cue)));
    const now = Date.now();

    // Score all entries
    const scored = this.entries.map(entry => {
      const similarities = cueEmbeddings.map(embedding => cosineSimilarity(embedding, entry.embedding));
      const maxSimilarity = Math.max(...similarities);
      const avgSimilarity = similarities.reduce((sum, value) => sum + value, 0) / similarities.length;
      const similarity = maxSimilarity * 0.7 + avgSimilarity * 0.3;

      const daysAgo = (now - new Date(entry.metadata.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = Math.exp(-decayRate * daysAgo);
      const salienceBoost = 1 + salienceWeight * (entry.metadata.salience || 0);
      const recallStrength = Math.log2((entry.metadata.recallCount || 0) + 1);
      const recallBoost = 1 + recallWeight * recallStrength;

      let recentRecallPenalty = 1;
      if (entry.metadata.lastRecalledAt) {
        const secondsSinceRecall = (now - new Date(entry.metadata.lastRecalledAt).getTime()) / 1000;
        if (secondsSinceRecall < 30) {
          recentRecallPenalty = 0.85;
        }
      }

      return {
        entry,
        similarity,
        combinedScore: similarity * recencyWeight * salienceBoost * recallBoost * recentRecallPenalty,
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

    if (markAsRecalled) {
      await this.touchRecalled(selected.map(item => item.entry));
    }

    return selected;
  }

  async smartRecall(query: string, options: SmartRecallOptions = {}): Promise<RecalledEntry[]> {
    return this.humanLikeRecall([query], options);
  }

  private async touchRecalled(entries: MemoryEntry[]) {
    if (entries.length === 0) return;

    const now = new Date().toISOString();
    const touched = new Set(entries.map(entry => entry.id));
    let updated = false;

    this.entries = this.entries.map(entry => {
      if (!touched.has(entry.id)) return entry;
      updated = true;
      return {
        ...entry,
        metadata: {
          ...entry.metadata,
          recallCount: (entry.metadata.recallCount || 0) + 1,
          lastRecalledAt: now,
        },
      };
    });

    if (!updated || !this.table) return;

    // Upsert updated rows by id
    const updatedEntries = this.entries.filter(e => touched.has(e.id));
    const rows = updatedEntries.map(entryToRow);
    await this.table.mergeInsert('id')
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(rows);
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInit();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) {
      if (this.table) {
        await this.table.delete(`id = '${id}'`);
      }
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

  async clear(): Promise<void> {
    await this.ensureInit();
    this.entries = [];
    if (this.table && this.db) {
      try {
        await this.db.dropTable('vectors');
      } catch {
        // ignore
      }
      this.table = null;
    }
    // Reset init so table can be recreated on next use
    this.initPromise = null;
    this.initPromise = Promise.resolve();
  }
}
