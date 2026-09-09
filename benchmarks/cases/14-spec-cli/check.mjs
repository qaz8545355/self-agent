import { execFileSync } from "node:child_process";

export async function check(cwd) {
  const problems = [];

  const run = (args) => {
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
  };

  // 1) 默认输出：行数 单词数 字节数
  const r1 = run(["sample.txt"]);
  if (r1.code !== 0 || r1.stdout.trim() !== "2 5 24") {
    problems.push(`默认输出应为「2 5 24」，实际：code=${r1.code} stdout=${JSON.stringify(r1.stdout.slice(0, 80))}`);
  }

  // 2) --lines
  const r2 = run(["sample.txt", "--lines"]);
  if (r2.code !== 0 || r2.stdout.trim() !== "2") {
    problems.push(`--lines 应输出「2」，实际：code=${r2.code} stdout=${JSON.stringify(r2.stdout.slice(0, 80))}`);
  }

  // 3) 空文件
  const r3 = run(["empty.txt"]);
  if (r3.code !== 0 || r3.stdout.trim() !== "0 0 0") {
    problems.push(`空文件应输出「0 0 0」，实际：code=${r3.code} stdout=${JSON.stringify(r3.stdout.slice(0, 80))}`);
  }

  // 4) 文件不存在
  const r4 = run(["nope.txt"]);
  if (r4.code !== 1) problems.push(`文件不存在时退出码应为 1，实际 ${r4.code}`);
  if (!r4.stderr.includes("error: nope.txt not found")) {
    problems.push(`stderr 应包含「error: nope.txt not found」，实际：${JSON.stringify(r4.stderr.slice(0, 80))}`);
  }
  if (r4.stdout.trim() !== "") problems.push(`文件不存在时 stdout 应为空，实际：${JSON.stringify(r4.stdout.slice(0, 80))}`);

  return {
    passed: problems.length === 0,
    detail: problems.length ? problems.join("；") : "4 个场景全部符合规格",
  };
}
