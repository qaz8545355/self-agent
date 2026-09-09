import { existsSync, readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];
  const testPath = path.join(cwd, "math.test.mjs");
  if (!existsSync(testPath)) return { passed: false, detail: "未创建 math.test.mjs" };

  const src = readFileSync(testPath, "utf8");
  const testCount = (src.match(/\btest\s*\(/g) ?? []).length;
  const assertCount = (src.match(/\bassert\.\w+/g) ?? []).length;
  if (testCount < 3) problems.push(`测试用例过少：${testCount} 个（至少 3 个）`);
  if (assertCount < 3) problems.push(`断言过少：${assertCount} 个`);
  if (!/from\s+["']\.\/math\.mjs["']/.test(src)) problems.push("测试未 import ./math.mjs");
  if (!/\badd\b/.test(src)) problems.push("测试未覆盖 add");
  if (!/\bmultiply\b/.test(src)) problems.push("测试未覆盖 multiply");

  // math.mjs 不应被改（任务只要求写测试）
  const mathPath = path.join(cwd, "math.mjs");
  const expectedMath = readFileSync(path.join(here, "expected", "math.mjs"), "utf8");
  if (!existsSync(mathPath) || readFileSync(mathPath, "utf8") !== expectedMath) {
    problems.push("math.mjs 被改动（任务只要求写测试）");
  }

  // 测试必须能通过
  try {
    execFileSync("node", ["--test", "math.test.mjs"], { cwd, encoding: "utf8", timeout: 30000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 160)}`);
  }

  // 变异测试：把 add 改坏，测试必须失败（证明断言真的有效）
  const mutant = mkdtempSync(path.join(os.tmpdir(), "c5-mutant-"));
  try {
    cpSync(cwd, mutant, { recursive: true });
    writeFileSync(
      path.join(mutant, "math.mjs"),
      `export function add(a, b) {\n  return a - b;\n}\nexport function multiply(a, b) {\n  return a * b;\n}\n`
    );
    let detected = false;
    try {
      execFileSync("node", ["--test", "math.test.mjs"], { cwd: mutant, encoding: "utf8", timeout: 30000 });
    } catch {
      detected = true;
    }
    if (!detected) problems.push("测试无法发现 add 的实现错误（断言无效）");
  } finally {
    rmSync(mutant, { recursive: true, force: true });
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : `测试有效：${testCount} 个用例 / ${assertCount} 个断言，且能发现实现错误`,
  };
}
