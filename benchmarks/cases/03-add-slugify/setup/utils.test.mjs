import test from "node:test";
import assert from "node:assert";
import { slugify } from "./utils.mjs";

test("空格转连字符", () => assert.strictEqual(slugify("Hello World"), "hello-world"));
test("去特殊字符", () => assert.strictEqual(slugify("Foo! Bar?"), "foo-bar"));
test("多空格合并", () => assert.strictEqual(slugify("A   B"), "a-b"));
