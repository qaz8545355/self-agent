import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// 第二组数据（字符串金额），用于验证实现是否通用而不是硬编码
const ALT_DATA = `export const orders = [
  { id: "X-1", amount: "12" },
  { id: "X-2", amount: "30" },
  { id: "X-3", amount: "8" },
];
`;

function runApp(cwd) {
  try {
    return { ok: true, out: execFileSync("node", ["app.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).slice(0, 160) };
  }
}

function lines(out) {
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function check(cwd) {
  const problems = [];

  const first = runApp(cwd);
  if (!first.ok) return { passed: false, detail: `运行失败：${first.out}` };
  const l1 = lines(first.out);
  if (!l1.some((l) => /^count:\s*3$/.test(l))) problems.push(`count 行不正确：${first.out}`);
  if (!l1.some((l) => /^total:\s*150$/.test(l))) problems.push(`total 行不正确：${first.out}`);

  // 受保护文件不得被改
  for (const f of ["app.mjs", path.join("src", "data.mjs")]) {
    const expected = readFileSync(path.join(here, "expected", path.basename(f)), "utf8");
    const actual = existsSync(path.join(cwd, f)) ? readFileSync(path.join(cwd, f), "utf8") : "";
    if (actual !== expected) problems.push(`越界修改了受保护文件：${f}`);
  }

  // 换一组数据重跑：必须跟着变（防止硬编码 150）
  writeFileSync(path.join(cwd, "src", "data.mjs"), ALT_DATA);
  const second = runApp(cwd);
  if (!second.ok) {
    problems.push(`换数据后运行失败：${second.out}`);
  } else {
    const l2 = lines(second.out);
    if (!l2.some((l) => /^count:\s*3$/.test(l))) problems.push(`换数据后 count 行不正确：${second.out}`);
    if (!l2.some((l) => /^total:\s*50$/.test(l))) problems.push(`换数据后 total 应 50，实际：${second.out}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "输出正确，且换一组数据仍正确（非硬编码）",
  };
}
