import test from "node:test";
import assert from "node:assert";
import { add, multiply } from "../src/math.mjs";

test("adds numbers", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});

test("multiplies numbers", () => {
  assert.strictEqual(multiply(4, 5), 20);
});
