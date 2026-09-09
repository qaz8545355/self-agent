import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
export async function check(cwd) {
  if (!existsSync(`${cwd}/count.mjs`)) return { passed: false, detail: "未创建 count.mjs" };
  try {
    const out = execFileSync("node", ["count.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
    const m = out.match(/count:\s*(\d+)/i);
    return { passed: !!m && Number(m[1]) >= 3, detail: `输出：${out}` };
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
}
