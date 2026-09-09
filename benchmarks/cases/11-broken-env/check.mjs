import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  let out = "";
  try {
    out = execFileSync("npm", ["test"], { cwd, encoding: "utf8", timeout: 60000 });
  } catch (e) {
    return { passed: false, detail: `npm test 失败：${String(e.stdout ?? e.stderr ?? e.message).slice(0, 200)}` };
  }

  // 必须真的执行了测试（而不是把脚本改成空操作）
  for (const name of ["adds numbers", "multiplies numbers", "uppercases text", "trims text"]) {
    if (!out.includes(name)) problems.push(`输出中未见测试用例：${name}`);
  }

  // 测试文件不得被改动
  for (const f of ["spec/math.test.mjs", "spec/str.test.mjs"]) {
    const expected = readFileSync(path.join(here, "expected", path.basename(f)), "utf8");
    const actual = existsSync(path.join(cwd, f)) ? readFileSync(path.join(cwd, f), "utf8") : "";
    if (actual !== expected) problems.push(`测试文件被改动：${f}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "npm test 通过且 4 个用例均执行",
  };
}
