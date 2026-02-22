import OpenAI from 'openai';
import type { ChatMessage, ToolDefinition, ProviderConfig, ContentPart, ContentPartText } from '../types.js';

// Helper: extract text from potentially multi-part content
function extractText(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is ContentPartText => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

export class OpenAIProvider {
  private client: OpenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.endpoint,
    });
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    onStream?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.config.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      ...(tools && tools.length > 0 && { tools: tools as OpenAI.Chat.ChatCompletionTool[], tool_choice: 'auto' }),
      stream: !!onStream,
    };

    const requestOpts = signal ? { signal } : undefined;

    if (onStream) {
      const stream = await this.client.chat.completions.create({
        ...params,
        stream: true,
      }, requestOpts);

      let fullContent = '';
      const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {};

      try {
        for await (const chunk of stream) {
          if (signal?.aborted) break;
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            onStream(delta.content);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCallsMap[tc.index]) {
                toolCallsMap[tc.index] = { id: tc.id ?? '', name: '', arguments: '' };
              }
              if (tc.id) toolCallsMap[tc.index].id = tc.id;
              if (tc.function?.name) toolCallsMap[tc.index].name += tc.function.name;
              if (tc.function?.arguments) toolCallsMap[tc.index].arguments += tc.function.arguments;
            }
          }
        }
      } catch (e: any) {
        // If aborted, return partial content gracefully
        if (signal?.aborted || e?.name === 'AbortError') {
          return {
            role: 'assistant',
            content: fullContent || null,
          };
        }
        throw e;
      }

      const toolCalls = Object.values(toolCallsMap);
      return {
        role: 'assistant',
        content: fullContent || null,
        ...(toolCalls.length > 0 && {
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        }),
      };
    } else {
      const response = await this.client.chat.completions.create({
        ...params,
        stream: false,
      }, requestOpts);
      const choice = response.choices[0];
      return {
        role: 'assistant',
        content: choice.message.content ?? null,
        ...(choice.message.tool_calls && {
          tool_calls: choice.message.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }),
      };
    }
  }

  async embed(text: string): Promise<number[]> {
    const model = this.config.embeddingModel ?? 'text-embedding-3-small';
    const response = await this.client.embeddings.create({
      model,
      input: text,
    });
    return response.data[0].embedding;
  }

  async summarize(messages: ChatMessage[]): Promise<string> {
    const text = messages
      .filter((m) => m.role !== 'system' && m.content)
      .map((m) => `${m.role}: ${extractText(m.content)}`)
      .join('\n');

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages: [
        {
          role: 'system',
          content: 'Summarize the following conversation history concisely, preserving key facts, decisions, and context that would be needed to continue the conversation.',
        },
        { role: 'user', content: text },
      ],
      stream: false,
    });
    return response.choices[0].message.content ?? '';
  }
}
