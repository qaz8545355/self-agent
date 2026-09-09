import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function check(cwd) {
  const problems = [];

  const expected = readFileSync(path.join(here, "expected", "stats.test.mjs"), "utf8");
  const actual = readFileSync(path.join(cwd, "stats.test.mjs"), "utf8");
  if (actual !== expected) problems.push("测试文件 stats.test.mjs 被改动（任务只允许改 stats.mjs）");

  writeFileSync(path.join(cwd, "stats.test.mjs"), expected);
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 30000 });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 160)}`);
  }

  try {
    const mod = await import(pathToFileURL(path.join(cwd, "stats.mjs")).href);
    if (mod.average([2, 4, 6]) !== 4) problems.push(`average([2,4,6]) = ${mod.average([2, 4, 6])}，应为 4`);
    if (mod.average([]) !== 0) problems.push(`average([]) = ${mod.average([])}，应为 0`);
    if (mod.average([5]) !== 5) problems.push(`average([5]) = ${mod.average([5])}，应为 5`);
  } catch (e) {
    problems.push(`无法加载 stats.mjs：${e.message}`);
  }

  return { passed: problems.length === 0, detail: problems.length ? problems.join("；") : "测试通过且行为正确" };
}
