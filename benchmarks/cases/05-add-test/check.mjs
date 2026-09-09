import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
export async function check(cwd) {
  if (!existsSync(`${cwd}/math.test.mjs`)) return { passed: false, detail: "未创建 math.test.mjs" };
  try {
    execFileSync("node", ["--test", "math.test.mjs"], { cwd, encoding: "utf8", timeout: 30000 });
    return { passed: true, detail: "测试文件存在且通过" };
  } catch (e) {
    return { passed: false, detail: `测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}` };
  }
}
