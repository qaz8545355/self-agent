import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 90000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}`);
  }

  const expected = readFileSync(path.join(here, "expected", "pairs.test.mjs"), "utf8");
  const actual = existsSync(path.join(cwd, "pairs.test.mjs"))
    ? readFileSync(path.join(cwd, "pairs.test.mjs"), "utf8")
    : "";
  if (actual !== expected) problems.push("测试文件 pairs.test.mjs 被改动");

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "功能正确且 6 万输入在 1 秒内完成",
  };
}
