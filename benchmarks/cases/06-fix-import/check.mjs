import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  // 1) 运行输出必须正确
  let out = "";
  try {
    out = execFileSync("node", ["main.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim();
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
  if (out !== "hello world") problems.push(`输出应为 "hello world"，实际：${out.slice(0, 120)}`);

  // 2) main.mjs 必须真的从 helper.mjs 导入 greet（不能硬编码输出）
  const main = readFileSync(path.join(cwd, "main.mjs"), "utf8");
  if (!/import\s+\{[^}]*\bgreet\b[^}]*\}\s+from\s+["'][^"']*helper\.mjs["']/.test(main)) {
    problems.push("main.mjs 未从 helper.mjs 导入 greet（疑似硬编码输出）");
  }

  // 3) helper.mjs 不得被改动
  const helperPath = path.join(cwd, "lib", "helper.mjs");
  const expectedHelper = readFileSync(path.join(here, "expected", "helper.mjs"), "utf8");
  if (!existsSync(helperPath) || readFileSync(helperPath, "utf8") !== expectedHelper) {
    problems.push("lib/helper.mjs 被改动或丢失");
  }

  // 4) 独立验证 greet 行为
  try {
    const mod = await import(pathToFileURL(helperPath).href);
    if (mod.greet("world") !== "hello world") problems.push(`greet("world") = ${JSON.stringify(mod.greet("world"))}`);
    if (mod.greet("Bob") !== "hello Bob") problems.push(`greet("Bob") = ${JSON.stringify(mod.greet("Bob"))}`);
  } catch (e) {
    problems.push(`无法加载 helper.mjs：${e.message}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "import 修复正确，且确实调用了 helper.greet",
  };
}
