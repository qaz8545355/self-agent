import { execFileSync } from "node:child_process";
export async function check(cwd) {
  try {
    const out = execFileSync("node", ["main.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
    return { passed: out.includes("hello world"), detail: `输出：${out}` };
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
}
