import test from "node:test";
import assert from "node:assert";
import { unique, chunk } from "../src/array.mjs";

test("unique 去重（含 NaN）", () => {
  assert.deepStrictEqual(unique([1, NaN, 2, NaN]), [1, NaN, 2]);
  assert.deepStrictEqual(unique(["a", "b", "a"]), ["a", "b"]);
});

test("chunk 正确", () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunk([1, 2], 5), [[1, 2]]);
});
