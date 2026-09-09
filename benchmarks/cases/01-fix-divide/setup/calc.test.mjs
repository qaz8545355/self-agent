import test from "node:test";
import assert from "node:assert";
import { divide } from "./calc.mjs";

test("正常相除", () => assert.strictEqual(divide(10, 2), 5));
test("除零抛错", () => assert.throws(() => divide(1, 0)));
