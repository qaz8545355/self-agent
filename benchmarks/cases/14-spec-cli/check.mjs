import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

function run(cwd, args) {
  try {
    const stdout = execFileSync("node", ["wc-lite.mjs", ...args], {
      cwd,
      encoding: "utf8",
      timeout: 20000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function expectOut(problems, label, got, want) {
  if (got.trim() !== want) {
    problems.push(`${label} 应为「${want}」，实际：${JSON.stringify(got.slice(0, 80))}`);
  }
}

export async function check(cwd) {
  const problems = [];

  // setup 自带的两个场景
  const r1 = run(cwd, ["sample.txt"]);
  if (r1.code !== 0) problems.push(`sample.txt 退出码 ${r1.code}`);
  else expectOut(problems, "默认输出", r1.stdout, "2 5 24");

  const r2 = run(cwd, ["sample.txt", "--lines"]);
  if (r2.code !== 0) problems.push(`--lines 退出码 ${r2.code}`);
  else expectOut(problems, "--lines 输出", r2.stdout, "2");

  const r3 = run(cwd, ["empty.txt"]);
  if (r3.code !== 0) problems.push(`empty.txt 退出码 ${r3.code}`);
  else expectOut(problems, "空文件输出", r3.stdout, "0 0 0");

  const r4 = run(cwd, ["nope.txt"]);
  if (r4.code !== 1) problems.push(`文件不存在时退出码应为 1，实际 ${r4.code}`);
  if (!r4.stderr.includes("error: nope.txt not found")) {
    problems.push(`stderr 应含「error: nope.txt not found」，实际：${JSON.stringify(r4.stderr.slice(0, 80))}`);
  }
  if (r4.stdout.trim() !== "") problems.push(`文件不存在时 stdout 应为空，实际：${JSON.stringify(r4.stdout.slice(0, 80))}`);

  // 额外场景（check 现场生成，防止只针对样例硬编码）
  writeFileSync(`${cwd}/no-newline.txt`, "a b");
  const r5 = run(cwd, ["no-newline.txt"]);
  if (r5.code !== 0) problems.push(`no-newline.txt 退出码 ${r5.code}`);
  else expectOut(problems, "无结尾换行的文件", r5.stdout, "0 2 3");

  writeFileSync(`${cwd}/multispace.txt`, "a\t\tb\n\nc");
  const r6 = run(cwd, ["multispace.txt"]);
  if (r6.code !== 0) problems.push(`multispace.txt 退出码 ${r6.code}`);
  else expectOut(problems, "多空白/多换行的文件", r6.stdout, "2 3 7");

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "6 个场景全部符合规格",
  };
}
