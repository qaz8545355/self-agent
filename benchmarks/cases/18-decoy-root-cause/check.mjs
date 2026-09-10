import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// 公开 API 契约：导出名集合 + 参数个数
const API = {
  "src/parse.mjs": { exports: ["parseRow", "parseRows"], arity: { parseRow: 1, parseRows: 1 } },
  "src/sum.mjs": { exports: ["sumRows"], arity: { sumRows: 1 } },
  "src/format.mjs": { exports: ["formatAmount"], arity: { formatAmount: 1 } },
};

export async function check(cwd) {
  const problems = [];

  // 1) test/ 必须与 expected/ 逐字节一致（防放水）
  const expectedTestDir = path.join(here, "expected", "test");
  for (const f of readdirSync(expectedTestDir)) {
    const expected = readFileSync(path.join(expectedTestDir, f), "utf8");
    let actual = "";
    try {
      actual = readFileSync(path.join(cwd, "test", f), "utf8");
    } catch {
      /* 缺失按不一致处理 */
    }
    if (actual !== expected) problems.push(`测试文件被改动或丢失：test/${f}`);
  }

  // 2) 全部测试必须通过
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 20000, stdio: "pipe" });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}`);
  }

  const load = (rel) => import(pathToFileURL(path.join(cwd, rel)).href);

  let parse, sum, format;
  try {
    parse = await load("src/parse.mjs");
    sum = await load("src/sum.mjs");
    format = await load("src/format.mjs");
  } catch (e) {
    problems.push(`无法加载模块：${e.message}`);
    return { passed: false, detail: problems.join("；") };
  }

  // 3) 公开 API 未变（导出名集合 + arity）
  const mods = { "src/parse.mjs": parse, "src/sum.mjs": sum, "src/format.mjs": format };
  for (const [rel, spec] of Object.entries(API)) {
    const actual = Object.keys(mods[rel])
      .filter((k) => k !== "default")
      .sort();
    const wanted = [...spec.exports].sort();
    if (actual.join(",") !== wanted.join(",")) {
      problems.push(`${rel} 导出名改变：${actual.join(",")} ≠ ${wanted.join(",")}`);
    }
    for (const [fn, n] of Object.entries(spec.arity)) {
      if (typeof mods[rel][fn] !== "function") problems.push(`${rel} 缺少函数 ${fn}`);
      else if (mods[rel][fn].length !== n) problems.push(`${rel} 的 ${fn} 参数个数 ${mods[rel][fn].length} ≠ ${n}`);
    }
  }

  // 4) novel 输入（与 test/ 数据不同）
  try {
    // 空字段 → 数字 0
    const empty = parse.parseRow("apple,");
    if (empty.amount !== 0) problems.push(`parseRow("apple,").amount = ${JSON.stringify(empty.amount)}，应为数字 0`);

    // 非法字段 → 必须抛错（可见测试未覆盖）
    let threwRow = false;
    try {
      parse.parseRow("apple,abc");
    } catch {
      threwRow = true;
    }
    if (!threwRow) problems.push(`parseRow("apple,abc") 未抛错：非法金额必须抛错`);

    let threwRows = false;
    try {
      parse.parseRows("apple,abc\nbanana,1.00");
    } catch {
      threwRows = true;
    }
    if (!threwRows) problems.push(`parseRows 遇到非法金额时未抛错`);

    // 空字段不得导致整体抛错，且按 0 计入
    const mixed = [parse.parseRow("a,1.25"), parse.parseRow("b,"), parse.parseRow("c,-0.25")];
    const mixedSum = sum.sumRows(mixed);
    if (mixedSum !== 1) problems.push(`空字段+负数混合求和 = ${mixedSum}，应为 1`);

    // 负数
    const neg = parse.parseRow("refund,-2.5");
    if (neg.amount !== -2.5) problems.push(`parseRow("refund,-2.5").amount = ${JSON.stringify(neg.amount)}，应为 -2.5`);

    // 大数组
    const N = 2000;
    const lines = [];
    for (let i = 0; i < N; i++) lines.push(`item${i},${(i % 7) + 1}`);
    const big = parse.parseRows(lines.join("\n"));
    if (big.length !== N) problems.push(`大数组解析出 ${big.length} 行，应为 ${N}`);
    const wantBig = lines.reduce((acc, l) => acc + Number(l.split(",")[1]), 0);
    const gotBig = sum.sumRows(big);
    if (gotBig !== wantBig) problems.push(`大数组求和 = ${gotBig}，应为 ${wantBig}`);

    // 格式化
    if (format.formatAmount(12.3) !== "12.30") problems.push(`formatAmount(12.3) = ${JSON.stringify(format.formatAmount(12.3))}，应为 "12.30"`);
    if (format.formatAmount(0) !== "0.00") problems.push(`formatAmount(0) = ${JSON.stringify(format.formatAmount(0))}，应为 "0.00"`);
    if (format.formatAmount(mixedSum) !== "1.00") problems.push(`合计格式化 = ${JSON.stringify(format.formatAmount(mixedSum))}，应为 "1.00"`);
  } catch (e) {
    problems.push(`novel 输入校验异常：${e.message}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "根因（parse 归一化 + 非法金额抛错）已修复，全部测试通过",
  };
}
