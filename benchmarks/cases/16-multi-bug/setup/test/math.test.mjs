import test from "node:test";
import assert from "node:assert";
import { add, subtract } from "../src/math.mjs";

test("add 正确", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});

test("subtract 正确", () => {
  assert.strictEqual(subtract(5, 3), 2);
  assert.strictEqual(subtract(3, 5), -2);
});
