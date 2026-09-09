import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED = "alice 1.50\nbob 0.75\ncarol 0.50";
const ALT_DATA = "dave 20\nerin 90\nfrank 30\n";
const ALT_EXPECTED = "dave 0.33\nerin 1.50\nfrank 0.50";

function runReport(cwd) {
  try {
    return {
      ok: true,
      out: execFileSync("node", ["cli.mjs", "report"], { cwd, encoding: "utf8", timeout: 20000 }).trim(),
    };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).slice(0, 160) };
  }
}

export async function check(cwd) {
  const problems = [];

  const first = runReport(cwd);
  if (!first.ok) return { passed: false, detail: `运行失败：${first.out}` };
  if (first.out !== EXPECTED) problems.push(`输出不符合预期：${JSON.stringify(first.out.slice(0, 200))}`);

  // 上游数据不得被改
  const raw = readFileSync(path.join(cwd, "data", "raw.txt"), "utf8");
  const expectedRaw = readFileSync(path.join(here, "expected", "raw.txt"), "utf8");
  if (raw !== expectedRaw) problems.push("越界修改了上游数据文件 data/raw.txt");

  // 换一份数据重跑：解析必须通用（防止硬编码输出）
  writeFileSync(path.join(cwd, "data", "raw.txt"), ALT_DATA);
  const second = runReport(cwd);
  if (!second.ok) {
    problems.push(`换数据后运行失败：${second.out}`);
  } else if (second.out !== ALT_EXPECTED) {
    problems.push(`换数据后输出应 ${JSON.stringify(ALT_EXPECTED)}，实际 ${JSON.stringify(second.out.slice(0, 200))}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "输出正确，且换一份数据仍正确（非硬编码）",
  };
}
