import OpenAI from 'openai';
import type { ChatMessage, ToolDefinition, ProviderConfig, ContentPart, ContentPartText, ContentPartImageUrl } from '../types.js';

// Helper: extract text from potentially multi-part content
function extractText(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is ContentPartText => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

function toInputContentParts(content: string | ContentPart[] | null): Array<Record<string, unknown>> {
  if (!content) {
    return [{ type: 'input_text', text: '' }];
  }

  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text });
    } else if (part.type === 'image_url') {
      const imagePart = part as ContentPartImageUrl;
      parts.push({
        type: 'input_image',
        image_url: imagePart.image_url.url,
        ...(imagePart.image_url.detail && { detail: imagePart.image_url.detail }),
      });
    }
  }

  return parts.length > 0 ? parts : [{ type: 'input_text', text: '' }];
}

function toFunctionCallOutput(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const text = content
    .filter((part): part is ContentPartText => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  const images = content
    .filter((part): part is ContentPartImageUrl => part.type === 'image_url')
    .map((part) => ({
      image_url: part.image_url.url,
      ...(part.image_url.detail && { detail: part.image_url.detail }),
    }));

  if (images.length === 0) {
    return text;
  }

  return JSON.stringify({
    text,
    images,
  });
}

function toResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id ?? message.name ?? `tool_${Date.now()}`,
        output: toFunctionCallOutput(message.content),
      });
      continue;
    }

    input.push({
      role: message.role,
      content: toInputContentParts(message.content),
    });

    if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        });
      }
    }
  }

  return input;
}

function toResponsesTools(tools?: ToolDefinition[]): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function extractResponseText(response: any): string {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }

  const texts: string[] = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
      if (content?.type === 'text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }
  return texts.join('');
}

function extractResponseToolCalls(response: any): ChatMessage['tool_calls'] {
  const toolCalls = (response?.output ?? [])
    .filter((item: any) => item?.type === 'function_call')
    .map((item: any) => ({
      id: item.call_id ?? item.id ?? '',
      type: 'function' as const,
      function: {
        name: item.name ?? '',
        arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
      },
    }))
    .filter((item: { id: string; function: { name: string } }) => item.id && item.function.name);

  return toolCalls.length > 0 ? toolCalls : undefined;
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
    const params = {
      model: this.config.model,
      input: toResponsesInput(messages),
      ...(toResponsesTools(tools) && { tools: toResponsesTools(tools), tool_choice: 'auto' as const }),
    };

    const requestOpts = signal ? { signal } : undefined;

    if (onStream) {
      const stream = this.client.responses.stream(params, requestOpts);

      let fullContent = '';

      try {
        for await (const event of stream) {
          if (signal?.aborted) break;
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            fullContent += event.delta;
            onStream(event.delta);
          }
        }

        const finalResponse = await stream.finalResponse();
        const toolCalls = extractResponseToolCalls(finalResponse);
        const content = fullContent || extractResponseText(finalResponse);

        return {
          role: 'assistant',
          content: content || null,
          ...(toolCalls && { tool_calls: toolCalls }),
        };
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
    } else {
      const response = await this.client.responses.create(params, requestOpts);
      const text = extractResponseText(response);
      const toolCalls = extractResponseToolCalls(response);

      return {
        role: 'assistant',
        content: text || null,
        ...(toolCalls && { tool_calls: toolCalls }),
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

    const response = await this.client.responses.create({
      model: this.config.model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'Summarize the following conversation history concisely, preserving key facts, decisions, and context that would be needed to continue the conversation.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      ],
    });
    return extractResponseText(response);
  }
}
