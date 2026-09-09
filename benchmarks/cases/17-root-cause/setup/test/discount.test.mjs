import test from "node:test";
import assert from "node:assert";
import { applyPercentOff, formatDiscounted } from "../src/discount.mjs";

test("不打折时换算成分", () => {
  assert.strictEqual(applyPercentOff(1.239, 0), 124);
});

test("格式化折扣价", () => {
  assert.strictEqual(formatDiscounted(1.239, 0), "$1.24");
});
