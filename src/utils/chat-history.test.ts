import test from 'node:test';
import assert from 'node:assert/strict';

import type { ContentPart } from '../types.js';
import {
  contentToPlainText,
  extractUserAuthoredText,
  findLastUserMessageIndex,
  replaceUserAuthoredText,
  splitUserMessageText,
} from './chat-history.js';

test('splitUserMessageText separates timestamp, authored text, and generated suffix', () => {
  const source = '[[timestamp:3/13/2026, 10:00:00 AM (Asia/Tokyo)]] Revise this\n\n## Attached Files\n### note.md\n```md\nhello\n```';
  const split = splitUserMessageText(source);

  assert.match(split.timestampPrefix, /^\[\[timestamp:/);
  assert.equal(split.authoredText, 'Revise this');
  assert.ok(split.suffix.startsWith('\n\n## Attached Files\n'));
});

test('extractUserAuthoredText reads text from multipart user content', () => {
  const content: ContentPart[] = [
    {
      type: 'text',
      text: '[[timestamp:3/13/2026, 10:00:00 AM (Asia/Tokyo)]] Explain this image\n\nAttached image URLs (these are visible to the user):\n- /api/sessions/a/uploads/image.png',
    },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,abc', detail: 'high' },
    },
  ];

  assert.equal(contentToPlainText(content).includes('Explain this image'), true);
  assert.equal(extractUserAuthoredText(content), 'Explain this image');
});

test('replaceUserAuthoredText preserves generated suffix and non-text parts', () => {
  const content: ContentPart[] = [
    {
      type: 'text',
      text: '[[timestamp:old]] Original request\n\nAttached media files:\n- clip.mp3 (audio/mpeg)',
    },
    {
      type: 'audio_url',
      audio_url: { url: 'data:audio/mpeg;base64,abc', format: 'mp3' },
    },
  ];

  const updated = replaceUserAuthoredText(
    content,
    'Updated request',
    '[[timestamp:new]] ',
  ) as ContentPart[];

  assert.equal(updated[0].type, 'text');
  assert.equal(
    (updated[0] as Extract<ContentPart, { type: 'text'; }>).text,
    '[[timestamp:new]] Updated request\n\nAttached media files:\n- clip.mp3 (audio/mpeg)',
  );
  assert.equal(updated[1].type, 'audio_url');
});

test('findLastUserMessageIndex returns the most recent user entry', () => {
  assert.equal(
    findLastUserMessageIndex([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
      { role: 'tool', content: 'tool output', tool_call_id: 'call-1', name: 'x' },
    ]),
    2,
  );
});
