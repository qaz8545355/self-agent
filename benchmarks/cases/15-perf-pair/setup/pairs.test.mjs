import test from "node:test";
import assert from "node:assert";
import { findPair } from "./pairs.mjs";

test("finds a pair", () => {
  assert.deepStrictEqual(findPair([2, 7, 11, 15], 9), [0, 1]);
});

test("returns null when no pair exists", () => {
  assert.strictEqual(findPair([1, 2, 3], 100), null);
});

test("large input completes within 1 second", () => {
  const numbers = Array.from({ length: 60000 }, (_, i) => i);
  const started = Date.now();
  const result = findPair(numbers, 119997); // 59998 + 59999
  const elapsed = Date.now() - started;
  assert.deepStrictEqual(result, [59998, 59999]);
  assert.ok(elapsed < 1000, `耗时 ${elapsed}ms，超过 1000ms`);
});
