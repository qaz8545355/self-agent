import { execFileSync } from "node:child_process";
export async function check(cwd) {
  try {
    const out = execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 30000 });
    return { passed: true, detail: "测试全部通过" };
  } catch (e) {
    return { passed: false, detail: `测试失败：${String(e.stdout ?? e.message).slice(0, 200)}` };
  }
}
