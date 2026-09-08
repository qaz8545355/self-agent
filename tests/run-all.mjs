#!/usr/bin/env node
/**
 * tests/run-all.mjs — 依次执行 tests/ 下所有 *.test.mjs
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) {
    failed += 1;
    console.log(`❌ ${f} 失败（exit=${r.status}）`);
  }
}

console.log(`\n${failed === 0 ? "✅ 全部测试通过" : `❌ ${failed} 个测试文件失败`}`);
process.exit(failed ? 1 : 0);
