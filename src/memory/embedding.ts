import OpenAI from 'openai';
import type { EmbeddingConfig } from '../types.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
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
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
      });

      if (!response.data || response.data.length === 0 || !response.data[0].embedding) {
        throw new Error(`Invalid embedding response: ${JSON.stringify(response)}`);
      }

      return response.data[0].embedding;
    } catch (e) {
      console.error('Embedding failed:', e);
      // Return a zero vector of appropriate size or throw?
      // For now, re-throw with context so callers (like autoAdd) can handle it.
      throw e;
    }
  }
}
