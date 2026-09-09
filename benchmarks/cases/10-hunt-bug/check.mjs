import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  let out = "";
  try {
    out = execFileSync("node", ["app.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => /^count:\s*3$/.test(l))) problems.push(`count 行不正确：${out}`);
  if (!lines.some((l) => /^total:\s*150$/.test(l))) problems.push(`total 行不正确：${out}`);

  for (const f of ["app.mjs", path.join("src", "data.mjs")]) {
    const expected = readFileSync(path.join(here, "expected", path.basename(f)), "utf8");
    const actual = existsSync(path.join(cwd, f)) ? readFileSync(path.join(cwd, f), "utf8") : "";
    if (actual !== expected) problems.push(`越界修改了受保护文件：${f}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : `输出正确：${out.replace(/\n/g, " / ")}`,
  };
}
