import { setTimeout as delay } from 'timers/promises';

export const OPENAI_RATE_LIMIT_MIN_DELAY_MS = 60_000;
export const OPENAI_RATE_LIMIT_MAX_ATTEMPTS = 2;

type RetryableOpenAIError = {
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  headers?: unknown;
  response?: {
    headers?: unknown;
  };
};

type RetryLogger = {
  warn: (...args: unknown[]) => void;
};

export const openAIRetryHooks = {
  wait: async (ms: number, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      throw createAbortError();
    }
    await delay(ms, undefined, signal ? { signal } : undefined);
  },
};

function createAbortError(): Error {
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers) return undefined;

  const maybeHeaders = headers as { get?: (headerName: string) => string | null };
  if (typeof maybeHeaders.get === 'function') {
    return maybeHeaders.get(name) ?? maybeHeaders.get(name.toLowerCase()) ?? undefined;
  }

  if (typeof headers !== 'object') return undefined;

  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : undefined;
    if (value == null) return undefined;
    return String(value);
  }

  return undefined;
}

function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;

  return Math.max(0, dateMs - Date.now());
}

function parseRetryDelayFromMessage(message: string): number | undefined {
  const secondsMatch = message.match(/try again in\s+([\d.]+)s/i);
  if (secondsMatch) {
    return Math.ceil(Number(secondsMatch[1]) * 1000);
  }

  const millisecondsMatch = message.match(/try again in\s+(\d+)ms/i);
  if (millisecondsMatch) {
    return Number(millisecondsMatch[1]);
  }

  return undefined;
}

function extractRetryAfterMs(error: RetryableOpenAIError): number | undefined {
  const headerValue = readHeader(error.headers, 'retry-after')
    ?? readHeader(error.response?.headers, 'retry-after')
    ?? readHeader(error.headers, 'x-ratelimit-reset-requests')
    ?? readHeader(error.response?.headers, 'x-ratelimit-reset-requests');

  return parseRetryAfterMs(headerValue) ?? parseRetryDelayFromMessage(String(error.message ?? ''));
}

function formatDelay(ms: number): string {
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function describeError(error: RetryableOpenAIError): string {
  const parts = [
    error.status != null ? `status=${error.status}` : null,
    error.code ? `code=${error.code}` : null,
    error.type ? `type=${error.type}` : null,
    error.message ? `message=${error.message}` : null,
  ].filter(Boolean);

  return parts.join(' ');
}

export function isRateLimitError(error: unknown): boolean {
  const e = error as RetryableOpenAIError;
  const code = String(e?.code ?? '').toLowerCase();
  const type = String(e?.type ?? '').toLowerCase();
  const message = String(e?.message ?? '').toLowerCase();

  if (e?.status === 429) return true;
  if (code.includes('rate_limit') || code.includes('too_many_requests')) return true;
  if (type.includes('rate_limit') || type.includes('too_many_requests')) return true;

  return message.includes('rate limit')
    || message.includes('too many request')
    || message.includes('too many requests')
    || message.includes('requests per min')
    || message.includes('tokens per min');
}

export function getRateLimitRetryDelayMs(
  error: unknown,
  minDelayMs = OPENAI_RATE_LIMIT_MIN_DELAY_MS,
): number {
  const retryAfterMs = extractRetryAfterMs(error as RetryableOpenAIError);
  return Math.max(minDelayMs, retryAfterMs ?? 0);
}

export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: {
    label: string;
    log: RetryLogger;
    signal?: AbortSignal;
    maxAttempts?: number;
    minDelayMs?: number;
  },
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? OPENAI_RATE_LIMIT_MAX_ATTEMPTS;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = getRateLimitRetryDelayMs(error, options.minDelayMs);
      options.log.warn(
        `OpenAI rate limit detected during ${options.label}. Waiting ${formatDelay(waitMs)} before retry ${attempt + 1}/${maxAttempts}.`,
        describeError(error as RetryableOpenAIError),
      );

      await openAIRetryHooks.wait(waitMs, options.signal);
    }
  }
}