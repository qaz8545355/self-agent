import { existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function runOnce(cwd) {
  try {
    return {
      ok: true,
      out: execFileSync("node", ["count.mjs"], { cwd, encoding: "utf8", timeout: 20000 }).trim(),
    };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message).slice(0, 160) };
  }
}

function parseCount(out) {
  const m = out.match(/count:\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export async function check(cwd) {
  if (!existsSync(`${cwd}/count.mjs`)) return { passed: false, detail: "未创建 count.mjs" };

  const first = runOnce(cwd);
  if (!first.ok) return { passed: false, detail: `运行失败：${first.out}` };
  const n1 = parseCount(first.out);
  if (n1 === null) return { passed: false, detail: `输出格式不对：${first.out}` };
  if (n1 < 3) return { passed: false, detail: `首次统计结果偏小：${first.out}` };

  // 再放 3 个 .mjs 文件，计数必须同步 +3（防止硬编码固定数字）
  for (let i = 1; i <= 3; i++) {
    writeFileSync(`${cwd}/extra-${i}.mjs`, `export const v${i} = ${i};\n`);
  }

  const second = runOnce(cwd);
  if (!second.ok) return { passed: false, detail: `二次运行失败：${second.out}` };
  const n2 = parseCount(second.out);
  if (n2 === null) return { passed: false, detail: `二次输出格式不对：${second.out}` };

  const ok = n2 === n1 + 3;
  return {
    passed: ok,
    detail: ok ? `统计随文件变化：${n1} → ${n2}` : `新增 3 个 .mjs 后计数未变化（${n1} → ${n2}）`,
  };
}
