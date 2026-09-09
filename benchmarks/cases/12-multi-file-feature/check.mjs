import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function check(cwd) {
  const problems = [];

  // 1) 入口脚本输出必须正确
  let out = "";
  try {
    out = execFileSync("node", ["index.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
  if (out !== "Alice <alice@example.com>") {
    problems.push(`index.mjs 输出不符合预期：${out.slice(0, 120)}`);
  }

  // 2) 换一组输入直接调用 formatUser：必须通用，不能硬编码
  try {
    const mod = await import(pathToFileURL(path.join(cwd, "src", "format.mjs")).href);
    const got = mod.formatUser({ name: "Bob", email: "Bob@EXAMPLE.com" });
    if (got !== "Bob <bob@example.com>") {
      problems.push(`formatUser 对第二组输入返回：${JSON.stringify(got)}（应 "Bob <bob@example.com>"）`);
    }
    const got2 = mod.formatUser({ name: "张三", email: "ZHANG@Example.com" });
    if (got2 !== "张三 <zhang@example.com>") {
      problems.push(`formatUser 对中文名返回：${JSON.stringify(got2)}`);
    }
  } catch (e) {
    problems.push(`无法加载 src/format.mjs：${e.message}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "输出正确，且换输入仍正确（非硬编码）",
  };
}
