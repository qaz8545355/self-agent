import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export async function check(cwd) {
  const problems = [];
  const src = readFileSync(path.join(cwd, "report.mjs"), "utf8");

  if (!/function\s+formatRow\s*\(/.test(src)) problems.push("未定义 formatRow 函数");

  const calls = (src.match(/formatRow\s*\(/g) ?? []).length;
  if (calls < 2) problems.push(`formatRow 出现 ${calls} 次（需定义 + 至少一处调用）`);

  const templates = (src.match(/padEnd\s*\(\s*10\s*\)/g) ?? []).length;
  if (templates > 1) problems.push(`重复的格式化模板仍出现 ${templates} 次（应提取进 formatRow）`);

  // 输出必须正确
  let out = "";
  try {
    out = execFileSync("node", ["report.mjs"], { cwd, encoding: "utf8", timeout: 20000 });
  } catch (e) {
    return { passed: false, detail: `运行失败：${String(e.stderr ?? e.message).slice(0, 200)}` };
  }
  const lines = out.trim().split("\n");
  if (lines.length !== 4 || !lines.every((l) => l.includes("|"))) {
    problems.push(`输出应为 4 行含 | 的内容，实际 ${lines.length} 行`);
  }

  // 换一组数据：输出必须跟着变（防止硬编码输出）
  const altSrc = src.replace(
    /const users = \[[\s\S]*?\];/,
    `const users = [\n  { name: "Carol", score: 100 },\n];`
  );
  if (altSrc === src) {
    problems.push("无法替换 users 数据（源码结构与预期不符）");
  } else {
    const mutant = mkdtempSync(path.join(os.tmpdir(), "c7-alt-"));
    try {
      writeFileSync(path.join(mutant, "report.mjs"), altSrc);
      const altOut = execFileSync("node", ["report.mjs"], { cwd: mutant, encoding: "utf8", timeout: 20000 }).trim();
      const altLines = altOut.split("\n");
      if (altLines.length !== 2 || !altLines[0].includes("Carol")) {
        problems.push(`换数据后输出不符：${altOut.slice(0, 120)}`);
      }
    } catch (e) {
      problems.push(`换数据后运行失败：${String(e.stderr ?? e.message).slice(0, 160)}`);
    } finally {
      rmSync(mutant, { recursive: true, force: true });
    }
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "formatRow 已提取复用，输出正确且换数据仍正确",
  };
}
