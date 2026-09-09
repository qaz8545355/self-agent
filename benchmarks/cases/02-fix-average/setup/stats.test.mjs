import test from "node:test";
import assert from "node:assert";
import { average } from "./stats.mjs";

test("正常平均", () => assert.strictEqual(average([2, 4, 6]), 4));
test("空数组返回 0", () => assert.strictEqual(average([]), 0));
