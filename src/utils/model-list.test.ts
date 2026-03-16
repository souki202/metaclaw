import assert from "node:assert/strict";
import test from "node:test";

import { normalizeModelList } from "./model-list";

test("normalizeModelList trims, deduplicates, and sorts model names", () => {
  const models = normalizeModelList([
    " gpt-4o ",
    "gpt-4o",
    "claude-3-5-sonnet",
    "",
    "   ",
    undefined,
    null,
    "claude-3-5-sonnet",
    "Gemini-2.5-Pro",
  ]);

  assert.deepEqual(models, [
    "claude-3-5-sonnet",
    "Gemini-2.5-Pro",
    "gpt-4o",
  ]);
});