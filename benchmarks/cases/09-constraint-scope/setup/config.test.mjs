import test from "node:test";
import assert from "node:assert";
import { loadConfig, DEFAULT_PORT } from "./config.mjs";

test("默认端口是 3000", () => {
  assert.strictEqual(DEFAULT_PORT, 3000);
  assert.strictEqual(loadConfig().port, 3000);
});

test("环境变量可覆盖端口", () => {
  assert.strictEqual(loadConfig({ PORT: "9090" }).port, 9090);
});

test("默认主机是 127.0.0.1", () => {
  assert.strictEqual(loadConfig().host, "127.0.0.1");
});
