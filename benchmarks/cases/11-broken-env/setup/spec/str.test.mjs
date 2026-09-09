import test from "node:test";
import assert from "node:assert";
import { upper, trim } from "../src/str.mjs";

test("uppercases text", () => {
  assert.strictEqual(upper("abc"), "ABC");
});

test("trims text", () => {
  assert.strictEqual(trim("  hi  "), "hi");
});
