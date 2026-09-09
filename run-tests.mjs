/**
 * run-tests.mjs — 自动检测并运行项目测试（移植 Claude Code 的"测试驱动"思路）
 *
 * 支持：Node（npm test / node --test）、Python（pytest）、Go、Rust
 * 返回：命令、退出码、结果摘要（通过/失败数）
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 检测项目的测试命令。
 * @returns {{command:string, kind:string}|null}
 */
export function detectTestCommand(cwd = process.cwd()) {
  const has = (f) => existsSync(path.join(cwd, f));

  // Node：优先 package.json 的 test script
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
      if (pkg?.scripts?.test && !/no test specified/i.test(pkg.scripts.test)) {
        return { command: "npm test", kind: "node-npm" };
      }
    } catch {
      /* 忽略 */
    }
    // 有 *.test.mjs / test/ 目录 → node --test
    const hasNodeTests =
      (has("tests") && readdirSync(path.join(cwd, "tests")).some((f) => /\.test\.m?js$/.test(f))) ||
      readdirSync(cwd).some((f) => /\.test\.m?js$/.test(f));
    if (hasNodeTests) return { command: "node --test", kind: "node-test" };
  }

  // Python
  if (has("pytest.ini") || has("pyproject.toml") || has("setup.py") || has("tests")) {
    if (has("pyproject.toml")) {
      try {
        const t = readFileSync(path.join(cwd, "pyproject.toml"), "utf8");
        if (/\[tool\.pytest/.test(t)) return { command: "python3 -m pytest -q", kind: "pytest" };
      } catch {
        /* 忽略 */
      }
    }
    if (has("pytest.ini") || has("tests")) return { command: "python3 -m pytest -q", kind: "pytest" };
  }

  // Go / Rust
  if (has("go.mod")) return { command: "go test ./...", kind: "go" };
  if (has("Cargo.toml")) return { command: "cargo test", kind: "cargo" };

  return null;
}

/**
 * 从测试输出中提取结果摘要。
 * @returns {{passed?:number, failed?:number, summary:string}}
 */
export function summarizeTestOutput(kind, output = "") {
  const text = String(output);
  let passed;
  let failed;

  if (kind === "node-test") {
    const p = text.match(/^# pass (\d+)/m) || text.match(/ℹ pass (\d+)/);
    const f = text.match(/^# fail (\d+)/m) || text.match(/ℹ fail (\d+)/);
    if (p) passed = Number(p[1]);
    if (f) failed = Number(f[1]);
  } else if (kind === "pytest") {
    const m = text.match(/(\d+) passed/);
    const f = text.match(/(\d+) failed/);
    if (m) passed = Number(m[1]);
    if (f) failed = Number(f[1]);
  } else if (kind === "node-npm") {
    // jest 风格（N passing）或 node --test 风格（# pass N / ℹ pass N）
    const m = text.match(/(\d+) passing/) || text.match(/^# pass (\d+)/m) || text.match(/ℹ pass (\d+)/);
    const f = text.match(/(\d+) failing/) || text.match(/^# fail (\d+)/m) || text.match(/ℹ fail (\d+)/);
    if (m) passed = Number(m[1]);
    if (f) failed = Number(f[1]);
  } else if (kind === "go") {
    if (/^ok\s/m.test(text)) passed = (text.match(/^ok\s/gm) || []).length;
    if (/^FAIL/m.test(text)) failed = (text.match(/^FAIL/gm) || []).length;
  } else if (kind === "cargo") {
    const m = text.match(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/);
    if (m) {
      passed = Number(m[1]);
      failed = Number(m[2]);
    }
  }

  const parts = [];
  if (passed !== undefined) parts.push(`${passed} 通过`);
  if (failed !== undefined) parts.push(`${failed} 失败`);
  return { passed, failed, summary: parts.length ? parts.join(" / ") : "（未能解析测试计数）" };
}
