import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  const expected = readFileSync(path.join(here, "expected", "calc.test.mjs"), "utf8");
  const actual = readFileSync(path.join(cwd, "calc.test.mjs"), "utf8");
  if (actual !== expected) problems.push("测试文件 calc.test.mjs 被改动（任务只允许改 calc.mjs）");

  // 用权威测试覆盖后再跑，避免「改测试让它通过」
  writeFileSync(path.join(cwd, "calc.test.mjs"), expected);
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 30000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 160)}`);
  }

  // 独立验证行为（不依赖测试文件）
  try {
    const mod = await import(pathToFileURL(path.join(cwd, "calc.mjs")).href);
    if (mod.divide(10, 2) !== 5) problems.push(`divide(10,2) = ${mod.divide(10, 2)}，应为 5`);
    let threw = false;
    try {
      mod.divide(1, 0);
    } catch {
      threw = true;
    }
    if (!threw) problems.push("divide(1,0) 应抛错");
  } catch (e) {
    problems.push(`无法加载 calc.mjs：${e.message}`);
  }

  return { passed: problems.length === 0, detail: problems.length ? problems.join("；") : "测试通过且行为正确" };
}
