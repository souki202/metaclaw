import OpenAI from 'openai';
import type { EmbeddingConfig } from '../types.js';
import { createLogger } from '../logger.js';
import { withRateLimitRetry } from '../providers/openai-retry.js';

const log = createLogger('embedding');

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

export class EmbeddingClient implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: EmbeddingConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.endpoint,
    });
    this.model = config.model;
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedMany([text]);
    return embedding;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const response = await withRateLimitRetry(
        () => this.client.embeddings.create({
          model: this.model,
          input: texts.length === 1 ? texts[0] : texts,
        }),
        {
          label: texts.length === 1 ? 'embedding request' : `embedding batch request (${texts.length})`,
          log,
        },
      );

      if (!response.data || response.data.length !== texts.length) {
        throw new Error(`Invalid embedding response: ${JSON.stringify(response)}`);
      }

      const ordered = [...response.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (ordered.some(item => !item.embedding)) {
        throw new Error(`Invalid embedding response: ${JSON.stringify(response)}`);
      }

      return ordered.map(item => item.embedding);
    } catch (e) {
      log.error('Embedding failed:', e);
      // Return a zero vector of appropriate size or throw?
      // For now, re-throw with context so callers (like autoAdd) can handle it.
      throw e;
    }
  }
}
