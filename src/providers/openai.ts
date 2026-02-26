import OpenAI from 'openai';
import type { ChatMessage, ToolDefinition, ProviderConfig, ContentPart, ContentPartText, ContentPartImageUrl } from '../types.js';

function isInvalidPromptError(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string };
  if (e?.status === 400 && e?.code === 'invalid_prompt') return true;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.status === 400 && msg.includes('invalid') && msg.includes('prompt');
}

function invalidPromptFallbackMessage(): string {
  return 'I could not process that request due to provider safety/prompt restrictions. Please rephrase and avoid sensitive or policy-restricted content, then try again.';
}

// Helper: extract text from potentially multi-part content
function extractText(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is ContentPartText => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

function toInputContentParts(content: string | ContentPart[] | null, role: 'user' | 'assistant' | 'system' = 'user'): Array<Record<string, unknown>> {
  const textType = role === 'assistant' ? 'output_text' : 'input_text';

  if (!content) {
    return [{ type: textType, text: '' }];
  }

  if (typeof content === 'string') {
    return [{ type: textType, text: content }];
  }

  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: textType, text: part.text });
    } else if (part.type === 'image_url') {
      const imagePart = part as ContentPartImageUrl;
      parts.push({
        type: 'input_image',
        image_url: imagePart.image_url.url,
        ...(imagePart.image_url.detail && { detail: imagePart.image_url.detail }),
      });
    }
  }

  return parts.length > 0 ? parts : [{ type: textType, text: '' }];
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

function toResponsesInput(messages: ChatMessage[]): Array<any> {
  const input: Array<any> = [];

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
      content: toInputContentParts(message.content, message.role as 'user' | 'assistant' | 'system'),
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

function toResponsesTools(tools?: ToolDefinition[]): Array<any> | undefined {
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
    onStream?: (chunk: string, type?: 'content' | 'reasoning') => void,
    signal?: AbortSignal
  ): Promise<ChatMessage> {
    const params = {
      model: this.config.model,
      input: toResponsesInput(messages),
      ...(toResponsesTools(tools) && { tools: toResponsesTools(tools), tool_choice: 'auto' as const }),
    };

    const requestOpts = signal ? { signal } : undefined;

    if (onStream) {
      let stream: ReturnType<typeof this.client.responses.stream>;
      try {
        stream = this.client.responses.stream(params, requestOpts);
      } catch (e) {
        if (isInvalidPromptError(e)) {
          const fallback = invalidPromptFallbackMessage();
          onStream(fallback, 'content');
          return { role: 'assistant', content: fallback };
        }
        throw e;
      }

      let fullContent = '';
      let fullReasoning = '';

      try {
        for await (const event of stream) {
          if (signal?.aborted) break;
          
          if ((event as any).type === 'response.output_text.delta' && typeof (event as any).delta === 'string') {
            fullContent += (event as any).delta;
            onStream((event as any).delta, 'content');
          } else if ((event as any).type === 'response.reasoning_text.delta' && typeof (event as any).delta === 'string') {
            fullReasoning += (event as any).delta;
            onStream((event as any).delta, 'reasoning');
          } else if ((event as any).type === 'response.content_part.delta' && (event as any).delta?.type === 'text') {
            // Some models might use different event types for reasoning depending on the specific API implementation
            const delta = (event as any).delta;
            if (delta.text) {
              fullContent += delta.text;
              onStream(delta.text, 'content');
            }
          }
        }

        const finalResponse = await stream.finalResponse();
        const toolCalls = extractResponseToolCalls(finalResponse);
        const content = fullContent || extractResponseText(finalResponse);
        
        // Extract reasoning from final response if available
        let reasoning = fullReasoning;
        if (!reasoning && (finalResponse as any).output?.[0]?.content) {
          const reasoningPart = (finalResponse as any).output[0].content.find((p: any) => p.type === 'reasoning_text');
          if (reasoningPart) {
            reasoning = reasoningPart.text;
          }
        }

        return {
          role: 'assistant',
          content: content || null,
          ...(reasoning && { reasoning }),
          ...(toolCalls && { tool_calls: toolCalls }),
        };
      } catch (e: any) {
        if (isInvalidPromptError(e)) {
          const fallback = invalidPromptFallbackMessage();
          onStream(fallback, 'content');
          return {
            role: 'assistant',
            content: fallback,
          };
        }
        // If aborted, return partial content gracefully
        if (signal?.aborted || e?.name === 'AbortError') {
          return {
            role: 'assistant',
            content: fullContent || null,
            ...(fullReasoning && { reasoning: fullReasoning }),
          };
        }
        throw e;
      }
    } else {
      let response: Awaited<ReturnType<typeof this.client.responses.create>>;
      try {
        response = await this.client.responses.create(params, requestOpts);
      } catch (e) {
        if (isInvalidPromptError(e)) {
          return {
            role: 'assistant',
            content: invalidPromptFallbackMessage(),
          };
        }
        throw e;
      }
      const text = extractResponseText(response);
      const toolCalls = extractResponseToolCalls(response);
      
      let reasoning: string | undefined;
      const reasoningPart = (response as any).output?.[0]?.content?.find((p: any) => p.type === 'reasoning_text');
      if (reasoningPart) {
        reasoning = reasoningPart.text;
      }

      return {
        role: 'assistant',
        content: text || null,
        ...(reasoning && { reasoning }),
        ...(toolCalls && { tool_calls: toolCalls }),
      };
    }
  }

  async summarizeMemory(
    text: string,
    options: {
      model?: string;
      systemPrompt?: string;
    } = {},
  ): Promise<string> {
    const response = await this.client.responses.create({
      model: options.model || this.config.model,
      reasoning:  {
        effort: 'none',
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: options.systemPrompt || 'Summarize the following content concisely, preserving key facts, decisions, and context.',
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

  async summarize(
    messages: ChatMessage[],
    options: {
      model?: string;
      systemPrompt?: string;
    } = {},
  ): Promise<string> {
    const text = messages
      .filter((m) => m.role !== 'system' && m.content)
      .map((m) => `${m.role}: ${extractText(m.content)}`)
      .join('\n');

    return this.summarizeMemory(text, {
      model: options.model,
      systemPrompt: options.systemPrompt || 'Summarize the following conversation history concisely, preserving key facts, decisions, and context that would be needed to continue the conversation.',
    });
  }
}
