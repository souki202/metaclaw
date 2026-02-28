import OpenAI from 'openai';
import type { ChatMessage, ToolDefinition, ProviderConfig, ContentPart, ContentPartText, ContentPartImageUrl } from '../types.js';

function isInvalidPromptError(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string };
  if (e?.status === 400 && e?.code === 'invalid_prompt') return true;
  const msg = String(e?.message ?? '').toLowerCase();
  return e?.status === 400 && msg.includes('invalid') && msg.includes('prompt');
}

function invalidPromptFallbackMessage(): string {
  return 'The provider rejected this request as an invalid prompt payload. This is usually caused by request formatting or tool-call context, not user safety policy. Please retry once; if it persists, check tool-call IDs and message formatting.';
}

function isToolUseUnsupportedError(error: unknown): boolean {
  const e = error as { status?: number; message?: string };
  const msg = String(e?.message ?? '').toLowerCase();
  return (e?.status === 404 || msg.includes('404'))
    && msg.includes('tool')
    && (msg.includes('support') || msg.includes('endpoint') || msg.includes('routing'));
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

// Convert message content for the responses API.
// Uses a plain string when there are no images (maximum compatibility with all endpoints
// including LM Studio), and falls back to an array of parts only when images are present
// (the only way to pass image data to vision-capable models).
function toMessageContent(content: string | ContentPart[] | null): string | Array<Record<string, unknown>> {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const hasImages = content.some(p => p.type === 'image_url');
  if (!hasImages) {
    // No images → flatten to plain string for maximum endpoint compatibility
    return content
      .filter((p): p is ContentPartText => p.type === 'text')
      .map(p => p.text)
      .join('\n');
  }

  // Has images → must use content-parts array
  const parts: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text });
    } else if (part.type === 'image_url') {
      const imgPart = part as ContentPartImageUrl;
      parts.push({
        type: 'input_image',
        image_url: imgPart.image_url.url,
        ...(imgPart.image_url.detail && { detail: imgPart.image_url.detail }),
      });
    }
  }
  return parts.length > 0 ? parts : '';
}

// function_call_output.output must be a plain string (responses API spec).
// Images embedded in tool results are NOT passed through the output field —
// the tool text already contains the image URL for the model to reference.
function extractToolText(content: string | ContentPart[] | null): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is ContentPartText => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function toResponsesInput(messages: ChatMessage[]): Array<any> {
  const input: Array<any> = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.tool_call_id) {
        // No call_id — surface as plain assistant text
        const text = extractText(message.content);
        if (text) input.push({ role: 'assistant', content: text });
        continue;
      }

      // function_call_output.output must be a plain string per spec.
      // Images in tool results are described via text (imageUrl reference); strip raw bytes.
      input.push({
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: extractToolText(message.content),
      });
      continue;
    }

    const hasToolCalls = message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    const content = toMessageContent(message.content);
    const hasContent = content !== '' && !(Array.isArray(content) && content.length === 0);

    if (!hasToolCalls || hasContent) {
      input.push({ role: message.role, content: content || '' });
    }

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

/** Extract base64 image data from image_generation_call output items in the Responses API response. */
function extractResponseImages(response: any): string[] {
  const images: string[] = [];
  for (const item of response?.output ?? []) {
    if (item?.type === 'image_generation_call' && typeof item.result === 'string' && item.result.length > 0) {
      images.push(item.result);
    }
  }
  return images;
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
    const mappedTools = toResponsesTools(tools);
    const buildParams = (includeTools: boolean) => ({
      model: this.config.model,
      input: toResponsesInput(messages),
      reasoning: {
        effort: 'high',
      },
      ...(includeTools && mappedTools && { tools: mappedTools, tool_choice: 'auto' as const }),
    });

    const requestOpts = signal ? { signal } : undefined;
    const canUseTools = Boolean(mappedTools && mappedTools.length > 0);

    if (onStream) {
      const runStreamRequest = async (includeTools: boolean): Promise<ChatMessage> => {
        let stream: ReturnType<typeof this.client.responses.stream>;
        try {
          stream = this.client.responses.stream(buildParams(includeTools) as any, requestOpts);
        } catch (e) {
          if (isInvalidPromptError(e)) {
            const fallback = invalidPromptFallbackMessage();
            onStream(fallback, 'content');
            console.log(e);
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
          const generatedImages = extractResponseImages(finalResponse);

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
            ...(generatedImages.length > 0 && { generatedImages }),
          };
        } catch (e: any) {
          if (isInvalidPromptError(e)) {
            const fallback = invalidPromptFallbackMessage();
            console.log(e);
            onStream(fallback, 'content');
            return {
              role: 'assistant',
              content: fallback,
            };
          }
          if (signal?.aborted || e?.name === 'AbortError') {
            return {
              role: 'assistant',
              content: fullContent || null,
              ...(fullReasoning && { reasoning: fullReasoning }),
            };
          }
          throw e;
        }
      };

      try {
        return await runStreamRequest(canUseTools);
      } catch (e) {
        if (canUseTools && isToolUseUnsupportedError(e)) {
          return runStreamRequest(false);
        }
        throw e;
      }
    } else {
      let response: Awaited<ReturnType<typeof this.client.responses.create>>;
      try {
        response = await this.client.responses.create(buildParams(canUseTools) as any, requestOpts);
      } catch (e) {
        if (canUseTools && isToolUseUnsupportedError(e)) {
          response = await this.client.responses.create(buildParams(false) as any, requestOpts);
        } else {
          if (isInvalidPromptError(e)) {
            console.log(e);
            return {
              role: 'assistant',
              content: invalidPromptFallbackMessage(),
            };
          }
          throw e;
        }
      }
      const text = extractResponseText(response);
      const toolCalls = extractResponseToolCalls(response);
      const generatedImages = extractResponseImages(response);

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
        ...(generatedImages.length > 0 && { generatedImages }),
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
      reasoning: {
        effort: 'minimal',
      },
      input: [
        {
          role: 'system',
          content: options.systemPrompt || 'Summarize the following content concisely, preserving key facts, decisions, and context.',
        },
        {
          role: 'user',
          content: text,
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
