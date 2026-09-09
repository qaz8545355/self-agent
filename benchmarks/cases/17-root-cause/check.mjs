import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  // 1) test/ 不得被改动
  const expectedTestDir = path.join(here, "expected", "test");
  for (const f of readdirSync(expectedTestDir)) {
    const expected = readFileSync(path.join(expectedTestDir, f), "utf8");
    let actual = "";
    try {
      actual = readFileSync(path.join(cwd, "test", f), "utf8");
    } catch {
      /* 缺失按不一致处理 */
    }
    if (actual !== expected) problems.push(`测试文件被改动或丢失：test/${f}`);
  }

  // 2) 全部测试必须通过
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 60000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}`);
  }

  // 3) 根因函数本身必须被修好（业务层打补丁不算）
  try {
    const money = await import(pathToFileURL(path.join(cwd, "src", "util", "money.mjs")).href);
    const cases = [
      [1.239, 124],
      [0.996, 100],
      [12.346, 1235],
      [0.05, 5],
      [2.5, 250],
    ];
    for (const [input, want] of cases) {
      const got = money.toCents(input);
      if (got !== want) problems.push(`toCents(${input}) = ${got}，应为 ${want}`);
    }
  } catch (e) {
    problems.push(`无法加载 src/util/money.mjs：${e.message}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "根因（toCents 舍入）已修复，全部测试通过",
  };
}
