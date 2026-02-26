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
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }
}
