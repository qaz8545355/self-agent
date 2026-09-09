import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
export async function check(cwd) {
  const src = readFileSync(`${cwd}/report.mjs`, "utf8");
  if (!/function\s+formatRow/.test(src)) return { passed: false, detail: "未定义 formatRow 函数" };
  try {
    const out = execFileSync("node", ["report.mjs"], { cwd, encoding: "utf8", timeout: 20000 });
    const lines = out.trim().split("\n");
    return { passed: lines.length === 4 && lines.every((l) => l.includes("|")), detail: `输出 ${lines.length} 行` };
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
}
