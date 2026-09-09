import test from "node:test";
import assert from "node:assert";
import { capitalize, reverse } from "../src/str.mjs";

test("capitalize 正确", () => {
  assert.strictEqual(capitalize("abc"), "Abc");
  assert.strictEqual(capitalize(""), "");
});

test("reverse 正确", () => {
  assert.strictEqual(reverse("abc"), "cba");
});
