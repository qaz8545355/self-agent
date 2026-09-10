import test from "node:test";
import assert from "node:assert";
import { searchItems } from "../src/search.mjs";

const results = ["r1", "r2", "r3", "r4", "r5"];

test("search 第一页", () => {
  assert.deepStrictEqual(searchItems(results, 1, 2), { items: ["r1", "r2"], totalPages: 3 });
});

test("search 末页含剩余项", () => {
  assert.deepStrictEqual(searchItems(results, 3, 2), { items: ["r5"], totalPages: 3 });
});

test("search 空结果", () => {
  assert.deepStrictEqual(searchItems([], 1, 2), { items: [], totalPages: 0 });
});
