import type { ChatMessage, ContentPart } from '../types.js';

const TIMESTAMP_PREFIX_RE = /^\[\[timestamp:[^\]]+\]\]\s*/;

const USER_MESSAGE_SUFFIX_MARKERS = [
  '\n\nAttached image URLs (these are visible to the user):\n',
  '\n\nAttached media files:\n',
  '\n\n## Attached Files\n',
] as const;

function findSuffixStartIndex(text: string): number {
  const indices = USER_MESSAGE_SUFFIX_MARKERS
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);

  if (indices.length === 0) {
    return -1;
  }

  return Math.min(...indices);
}

export function contentToPlainText(content: string | ContentPart[] | null | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is Extract<ContentPart, { type: 'text'; }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export function splitUserMessageText(text: string): {
  timestampPrefix: string;
  authoredText: string;
  suffix: string;
} {
  const timestampMatch = text.match(TIMESTAMP_PREFIX_RE);
  const timestampPrefix = timestampMatch?.[0] || '';
  const withoutTimestamp = timestampPrefix ? text.slice(timestampPrefix.length) : text;
  const suffixStart = findSuffixStartIndex(withoutTimestamp);

  if (suffixStart < 0) {
    return {
      timestampPrefix,
      authoredText: withoutTimestamp,
      suffix: '',
    };
  }

  return {
    timestampPrefix,
    authoredText: withoutTimestamp.slice(0, suffixStart),
    suffix: withoutTimestamp.slice(suffixStart),
  };
}

export function extractUserAuthoredText(content: string | ContentPart[] | null | undefined): string {
  const { authoredText } = splitUserMessageText(contentToPlainText(content));
  return authoredText.trim();
}

export function replaceUserAuthoredText(
  content: string | ContentPart[] | null,
  nextText: string,
  timestampPrefix: string,
): string | ContentPart[] {
  const trimmedText = nextText.trim();

  if (typeof content === 'string' || content === null) {
    const existing = typeof content === 'string' ? content : '';
    const { suffix } = splitUserMessageText(existing);
    return `${timestampPrefix}${trimmedText}${suffix}`;
  }

  let replaced = false;
  const nextContent = content.map((part) => {
    if (part.type !== 'text' || replaced) {
      return part;
    }

    replaced = true;
    const { suffix } = splitUserMessageText(part.text);
    return {
      ...part,
      text: `${timestampPrefix}${trimmedText}${suffix}`,
    };
  });

  if (replaced) {
    return nextContent;
  }

  return [
    { type: 'text', text: `${timestampPrefix}${trimmedText}` },
    ...content,
  ];
}

export function findLastUserMessageIndex(history: ChatMessage[]): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}
