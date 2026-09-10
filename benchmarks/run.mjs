#!/usr/bin/env node
/**
 * benchmarks/run.mjs — 小基准集评测运行器
 *
 * 用法：
 *   node benchmarks/run.mjs                 # 跑全部用例
 *   node benchmarks/run.mjs fix-divide      # 只跑指定用例
 *   node benchmarks/run.mjs --list          # 列出用例
 *
 * 每个用例目录结构：
 *   cases/<name>/task.md        任务描述（喂给 agent）
 *   cases/<name>/setup/         初始文件（复制到临时工作目录）
 *   cases/<name>/check.mjs      验证脚本，导出 check(cwd) => {passed, detail}
 */
import { readdirSync, readFileSync, mkdirSync, cpSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "../agent.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(here, "cases");
const RESULTS_DIR = path.join(here, "results");

function listCases() {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((d) => existsSync(path.join(CASES_DIR, d, "task.md")))
    .sort();
}

async function runCase(name, { model, maxSteps = 100 } = {}) {
  const dir = path.join(CASES_DIR, name);
  const task = readFileSync(path.join(dir, "task.md"), "utf8").trim();
  const work = mkdtempSync(path.join(os.tmpdir(), `sa-bench-${name}-`));
  const setupDir = path.join(dir, "setup");
  if (existsSync(setupDir)) cpSync(setupDir, work, { recursive: true });

  const started = Date.now();
  let result;
  let error;
  try {
    result = await runAgent({
      task,
      cwd: work,
      model,
      maxSteps,
      onEvent: () => {},
    });
  } catch (e) {
    error = e.message;
  }
  const durationMs = Date.now() - started;

  // 运行验证
  let check = { passed: false, detail: "未执行验证" };
  const checkFile = path.join(dir, "check.mjs");
  if (existsSync(checkFile)) {
    try {
      const mod = await import(`file://${checkFile}`);
      check = await mod.check(work);
    } catch (e) {
      check = { passed: false, detail: `验证脚本异常：${e.message}` };
    }
  }

  const record = {
    case: name,
    passed: !!check.passed,
    detail: check.detail ?? "",
    steps: result?.steps ?? null,
    tokens: result?.totalTokens ?? null,
    durationMs,
    error: error ?? null,
  };
  rmSync(work, { recursive: true, force: true });
  return record;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const c of listCases()) console.log(c);
    return;
  }

  const only = args.find((a) => !a.startsWith("-"));
  const cases = only ? [only] : listCases();
  if (!cases.length) {
    console.error("未找到用例（benchmarks/cases/*/task.md）");
    process.exit(1);
  }

  console.log(`开始评测 ${cases.length} 个用例${only ? `（${only}）` : ""}\n`);
  const records = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c} … `);
    const r = await runCase(c);
    records.push(r);
    console.log(
      r.passed
        ? `✅ 通过（${r.steps} 步 / ${r.tokens ?? "?"} tokens）`
        : `❌ 失败${r.error ? `【模型错误】${r.error}` : ""}：${String(r.detail).slice(0, 160)}`
    );
  }

  const passed = records.filter((r) => r.passed).length;
  const totalTokens = records.reduce((s, r) => s + (r.tokens ?? 0), 0);
  const avgSteps = (records.reduce((s, r) => s + (r.steps ?? 0), 0) / records.length).toFixed(1);

  console.log(`\n结果：${passed}/${records.length} 通过 ｜ 平均 ${avgSteps} 步 ｜ 总 ${totalTokens} tokens`);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), passed, total: records.length, records }, null, 2));
  console.log(`报告：${out}`);
  process.exit(passed === records.length ? 0 : 1);
}

main().catch((e) => {
  console.error(`评测异常：${e.message}`);
  process.exit(2);
});
