import test from "node:test";
import assert from "node:assert";
import { formatMoney } from "../src/format.mjs";

test("formatMoney 保留两位小数", () => {
  assert.strictEqual(formatMoney(1234), "$12.34");
  assert.strictEqual(formatMoney(5), "$0.05");
});
