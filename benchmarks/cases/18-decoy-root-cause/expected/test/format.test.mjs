import test from "node:test";
import assert from "node:assert";
import { formatAmount } from "../src/format.mjs";

test("金额保留两位小数", () => {
  assert.strictEqual(formatAmount(12.3), "12.30");
});

test("不足一元也保留两位", () => {
  assert.strictEqual(formatAmount(0.05), "0.05");
});

test("整数金额补齐两位", () => {
  assert.strictEqual(formatAmount(1), "1.00");
});
