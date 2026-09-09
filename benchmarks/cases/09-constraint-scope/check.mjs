import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  // 1) 测试必须全部通过
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 30000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 160)}`);
  }

  // 2) 受保护文件不得被修改
  for (const f of ["README.md", "config.test.mjs"]) {
    const expected = readFileSync(path.join(here, "expected", f), "utf8");
    const actual = existsSync(path.join(cwd, f)) ? readFileSync(path.join(cwd, f), "utf8") : "";
    if (actual !== expected) problems.push(`越界修改了受保护文件：${f}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "测试通过且未越界修改",
  };
}
