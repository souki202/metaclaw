import { Tiktoken, encoding_for_model } from 'tiktoken';

// Singleton encoder instance for efficiency
let encoder: Tiktoken | null = null;

/**
 * Get or initialize the tiktoken encoder.
 * Uses cl100k_base encoding which is used by GPT-4, GPT-3.5-turbo, and is a reasonable approximation for Claude models.
 */
function getEncoder(): Tiktoken {
  if (!encoder) {
    // cl100k_base is used by gpt-4, gpt-3.5-turbo, and text-embedding-ada-002
    encoder = encoding_for_model('gpt-4');
  }
  return encoder;
}

/**
 * Count tokens in a text string.
 * @param text The text to count tokens for
 * @returns The number of tokens
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    const enc = getEncoder();
    return enc.encode(text).length;
  } catch (error) {
    // Fallback to character-based estimation if encoding fails
    console.error('Token counting failed, using fallback:', error);
    return Math.ceil(text.length / 2.3);
  }
}

/**
 * Slice text to fit within a token limit.
 * This function ensures the result doesn't exceed maxTokens.
 *
 * @param text The text to slice
 * @param maxTokens Maximum number of tokens
 * @returns Sliced text that fits within the token limit
 */
export function sliceToTokenLimit(text: string, maxTokens: number): string {
  if (!text) return '';

  const tokenCount = countTokens(text);
  if (tokenCount <= maxTokens) {
    return text;
  }

  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);

    // Slice tokens to the limit
    const slicedTokens = tokens.slice(0, maxTokens);

    // Decode back to text
    const result = enc.decode(slicedTokens);

    // Convert Uint8Array to string if needed
    if (result instanceof Uint8Array) {
      return new TextDecoder().decode(result);
    }

    return result;
  } catch (error) {
    // Fallback: use character-based slicing with ~4 chars per token
    console.error('Token slicing failed, using fallback:', error);
    const estimatedChars = maxTokens * 4;
    return text.slice(0, estimatedChars);
  }
}

/**
 * Clean up the encoder when no longer needed.
 * This should be called when the application is shutting down.
 */
export function cleanupEncoder(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}
