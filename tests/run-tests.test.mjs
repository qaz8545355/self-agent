import { runTool, toOpenAITools } from "../tools.mjs";
import { detectTestCommand, summarizeTestOutput } from "../run-tests.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) 注册
const names = toOpenAITools().map((x) => x.function.name);
t("run_tests 已注册", names.includes("run_tests"));
t("工具数 >= 16", names.length >= 16, `（${names.length}）`);

// 2) 检测逻辑
const projDir = path.join(os.tmpdir(), `sa-runtests-${Date.now()}`);
mkdirSync(projDir, { recursive: true });
writeFileSync(path.join(projDir, "package.json"), JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test" } }));
writeFileSync(
  path.join(projDir, "calc.test.mjs"),
  'import test from "node:test";\nimport assert from "node:assert";\ntest("ok", () => assert.strictEqual(1 + 1, 2));\n'
);
const d = detectTestCommand(projDir);
t("检测 Node 项目", d && d.kind.startsWith("node"), `→ ${JSON.stringify(d)}`);
t("无项目返回 null", detectTestCommand(os.tmpdir()) === null);

// 3) 摘要解析
const s1 = summarizeTestOutput("node-test", "# pass 5\n# fail 1");
t("解析 node-test", s1.passed === 5 && s1.failed === 1);
const s2 = summarizeTestOutput("pytest", "10 passed, 2 failed");
t("解析 pytest", s2.passed === 10 && s2.failed === 2);
const s3 = summarizeTestOutput("node-npm", "ℹ pass 3\nℹ fail 0");
t("解析 node --test 风格", s3.passed === 3 && s3.failed === 0);
const s4 = summarizeTestOutput("cargo", "test result: ok. 7 passed; 0 failed");
t("解析 cargo", s4.passed === 7 && s4.failed === 0);

// 4) 实际运行（临时项目）
const r = await runTool("run_tests", {}, { cwd: projDir });
t("实际跑测试成功", !r.isError && r.text.includes("1 通过"), `→ ${String(r.text).split("\n")[1] ?? ""}`);

// 5) 自定义命令
const r2 = await runTool("run_tests", { command: "echo custom-ok && exit 0" }, { cwd: projDir });
t("自定义命令", !r2.isError && r2.text.includes("custom-ok"));

// 6) 无测试配置时报错
const emptyDir = path.join(os.tmpdir(), `sa-empty-${Date.now()}`);
mkdirSync(emptyDir, { recursive: true });
const r3 = await runTool("run_tests", {}, { cwd: emptyDir });
t("无配置时提示", r3.isError && r3.text.includes("未检测到"));

rmSync(projDir, { recursive: true, force: true });
rmSync(emptyDir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
