import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  // 1) test/ 不得被改动
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
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 60000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}`);
  }

  // 3) 独立验证 5 处修复（不依赖测试文件）
  const load = (rel) => import(pathToFileURL(path.join(cwd, rel)).href);
  try {
    const math = await load("src/math.mjs");
    if (math.subtract(5, 3) !== 2) problems.push(`subtract(5,3) = ${math.subtract(5, 3)}，应为 2`);
    if (math.subtract(3, 5) !== -2) problems.push(`subtract(3,5) = ${math.subtract(3, 5)}，应为 -2`);

    const str = await load("src/str.mjs");
    if (str.capitalize("") !== "") problems.push(`capitalize("") = ${JSON.stringify(str.capitalize(""))}`);
    if (str.capitalize("abc") !== "Abc") problems.push(`capitalize("abc") = ${JSON.stringify(str.capitalize("abc"))}`);

    const arr = await load("src/array.mjs");
    const u = arr.unique([1, NaN, 2, NaN]);
    if (!Array.isArray(u) || u.length !== 3 || u[0] !== 1 || !Number.isNaN(u[1]) || u[2] !== 2) {
      problems.push(`unique([1,NaN,2,NaN]) = ${JSON.stringify(u)}，应为 [1,NaN,2]`);
    }
    const c = arr.chunk([1, 2, 3, 4, 5], 2);
    if (JSON.stringify(c) !== JSON.stringify([[1, 2], [3, 4], [5]])) {
      problems.push(`chunk([1..5],2) = ${JSON.stringify(c)}`);
    }

    const fmt = await load("src/format.mjs");
    if (fmt.formatMoney(1234) !== "$12.34") problems.push(`formatMoney(1234) = ${JSON.stringify(fmt.formatMoney(1234))}`);
    if (fmt.formatMoney(5) !== "$0.05") problems.push(`formatMoney(5) = ${JSON.stringify(fmt.formatMoney(5))}`);
  } catch (e) {
    problems.push(`无法加载模块：${e.message}`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "5 处 bug 全部修复，且测试文件未被改动",
  };
}
