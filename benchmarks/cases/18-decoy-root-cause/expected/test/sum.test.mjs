import test from "node:test";
import assert from "node:assert";
import { parseRows } from "../src/parse.mjs";
import { sumRows } from "../src/sum.mjs";
import { formatAmount } from "../src/format.mjs";

test("合计金额格式化为两位小数", () => {
  const rows = parseRows("apple,1.50\nbanana,2.25\n");
  assert.strictEqual(formatAmount(sumRows(rows)), "3.75");
});

test("空字段按 0 计入", () => {
  const rows = parseRows("apple,1.50\nbanana,\n");
  assert.strictEqual(formatAmount(sumRows(rows)), "1.50");
});
