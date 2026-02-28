import test from 'node:test';
import assert from 'node:assert/strict';
import { webFetch } from './web.js';

test('webFetch should handle a single URL', async () => {
    const result = await webFetch('https://example.com');
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('--- Content from: https://example.com ---'));
});

test('webFetch should handle multiple URLs', async () => {
    const urls = ['https://example.com', 'https://www.google.com'];
    const result = await webFetch(urls);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('--- Content from: https://example.com ---'));
    assert.ok(result.output.includes('--- Content from: https://www.google.com ---'));
});

test('webFetch should report invalid URL in the list but still succeed if others pass', async () => {
    const urls = ['invalid-url', 'https://example.com'];
    const result = await webFetch(urls);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('Invalid URL.'));
    assert.ok(result.output.includes('--- Content from: https://example.com ---'));
});

test('webFetch should fail if all URLs are invalid', async () => {
    const urls = ['invalid-url', 'also-invalid'];
    const result = await webFetch(urls);
    assert.strictEqual(result.success, false);
});
