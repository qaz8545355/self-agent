#!/usr/bin/env node
/**
 * benchmarks/compare.mjs — 对比两次评测报告（回归门禁）
 *
 * 用法：
 *   node benchmarks/compare.mjs                  # 最新一份 vs 上一份
 *   node benchmarks/compare.mjs a.json b.json    # 指定两份
 *
 * 关注点：通过率是否下降、token/步数是否上涨（优化后应持平或更好）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(here, "results");

const load = (file) => JSON.parse(readFileSync(file, "utf8"));

function pickReports(args) {
  if (args.length >= 2) return args;
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length < 2) {
    console.error(`至少需要两份报告才能对比（当前 ${files.length} 份）`);
    process.exit(1);
  }
  return [path.join(RESULTS_DIR, files[files.length - 2]), path.join(RESULTS_DIR, files[files.length - 1])];
}

const [fileA, fileB] = pickReports(process.argv.slice(2));
const a = load(fileA);
const b = load(fileB);

const mapA = new Map(a.records.map((r) => [r.case, r]));
const mapB = new Map(b.records.map((r) => [r.case, r]));
const names = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();

const sign = (x, y) => {
  if (typeof x !== "number" || typeof y !== "number") return "";
  const d = y - x;
  if (d === 0) return "=";
  return d > 0 ? `+${d}` : `${d}`;
};

console.log(`A = ${path.basename(fileA)}  (${a.passed}/${a.total})`);
console.log(`B = ${path.basename(fileB)}  (${b.passed}/${b.total})\n`);

const rows = [];
let regressions = 0;
let improvements = 0;
const common = [];

for (const name of names) {
  const ra = mapA.get(name);
  const rb = mapB.get(name);
  const fmt = (r) => (r ? `${r.passed ? "✅" : "❌"} ${r.steps ?? "-"}步/${r.tokens ?? "-"}t` : "—");
  rows.push(`${name.padEnd(22)} ${fmt(ra).padEnd(20)} → ${fmt(rb)}`);
  if (ra && rb) {
    common.push([ra, rb]);
    if (ra.passed && !rb.passed) regressions++;
    if (!ra.passed && rb.passed) improvements++;
  }
}

console.log(rows.join("\n"));

const sum = (arr, pick) => arr.reduce((s, r) => s + (pick(r) ?? 0), 0);
const avgStepsA = common.length ? sum(common.map(([x]) => x), (r) => r.steps) / common.length : 0;
const avgStepsB = common.length ? sum(common.map(([, y]) => y), (r) => r.steps) / common.length : 0;
const tokA = sum(common.map(([x]) => x), (r) => r.tokens);
const tokB = sum(common.map(([, y]) => y), (r) => r.tokens);

console.log(`\n共有用例 ${common.length} 个`);
console.log(`通过：${a.passed}/${a.total} → ${b.passed}/${b.total}（回归 ${regressions}，转好 ${improvements}）`);
console.log(`平均步数：${avgStepsA.toFixed(1)} → ${avgStepsB.toFixed(1)}（${sign(Math.round(avgStepsA * 10), Math.round(avgStepsB * 10))}）`);
console.log(`总 tokens：${tokA} → ${tokB}（${sign(tokA, tokB)}）`);

if (regressions > 0) {
  console.log("\n⚠️ 存在回归用例：");
  for (const [x, y] of common) if (x.passed && !y.passed) console.log(`  - ${y.case}：${y.detail.slice(0, 100)}`);
  process.exit(1);
}
