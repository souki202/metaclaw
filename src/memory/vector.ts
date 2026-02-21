import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MemoryEntry } from '../types.js';
import type { OpenAIProvider } from '../providers/openai.js';

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

export class VectorMemory {
  private filePath: string;
  private entries: MemoryEntry[] = [];
  private provider: OpenAIProvider;
  private sessionId: string;

  constructor(workspace: string, sessionId: string, provider: OpenAIProvider) {
    this.filePath = path.join(workspace, 'memory', 'vectors.json');
    this.sessionId = sessionId;
    this.provider = provider;
    this.load();
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
    const embedding = await this.provider.embed(text);
    const entry: MemoryEntry = {
      id: randomUUID(),
      text,
      embedding,
      metadata: {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        ...metadata,
      },
    };
    this.entries.push(entry);
    this.save();
    return entry.id;
  }

  async search(query: string, limit = 10): Promise<Array<{ entry: MemoryEntry; score: number }>> {
    if (this.entries.length === 0) return [];
    const queryEmbedding = await this.provider.embed(query);
    const scored = this.entries.map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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
