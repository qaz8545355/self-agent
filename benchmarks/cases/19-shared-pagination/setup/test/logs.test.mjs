import test from "node:test";
import assert from "node:assert";
import { listLogs } from "../src/logs.mjs";

const logs = ["l1", "l2", "l3", "l4", "l5"];

test("logs 第一页", () => {
  assert.deepStrictEqual(listLogs(logs, 1, 2), { items: ["l1", "l2"], totalPages: 3 });
});

test("logs 末尾页含剩余项", () => {
  assert.deepStrictEqual(listLogs(logs, 3, 2), { items: ["l5"], totalPages: 3 });
});

test("logs 空数组", () => {
  assert.deepStrictEqual(listLogs([], 1, 2), { items: [], totalPages: 0 });
});
