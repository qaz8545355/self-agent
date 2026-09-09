import { execFileSync } from "node:child_process";

export async function check(cwd) {
  let out = "";
  try {
    out = execFileSync("node", ["index.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
  const ok = out === "Alice <alice@example.com>";
  return {
    passed: ok,
    detail: ok ? `输出正确：${out}` : `输出不符合预期：${out.slice(0, 120)}`,
  };
}
