import { runTool, toOpenAITools } from "../tools.mjs";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
for (const n of ["ask_user", "plan_mode", "http_request", "schedule"]) t(`${n} 已注册`, names.includes(n));
t("工具数 >= 22", names.length >= 22, `（${names.length}）`);

// ask_user
const a = await runTool("ask_user", { question: "选 A 还是 B？", options: ["A", "B"] }, {});
t("ask_user 返回问题与选项", !a.isError && a.text.includes("选 A 还是 B") && a.text.includes("1. A"));
t("ask_user 记录待答文件", existsSync(path.join(os.homedir(), ".self-agent", "pending-question.json")));

// plan_mode
const p1 = await runTool("plan_mode", { action: "enter", plan: "先读代码再改" }, {});
t("plan_mode enter", !p1.isError && p1.text.includes("计划模式") && p1.text.includes("先读代码再改"));
const p2 = await runTool("plan_mode", { action: "exit" }, {});
t("plan_mode exit", !p2.isError && p2.text.includes("退出计划模式"));

// http_request
const h = await runTool("http_request", { method: "GET", url: "https://example.com" }, {});
t("http_request GET", !h.isError && h.text.includes("HTTP 200"));
const hBad = await runTool("http_request", { method: "GET", url: "https://nonexistent-xyz-12345.invalid" }, {});
t("http_request 失败报错", hBad.isError);

// schedule
const s1 = await runTool("schedule", { action: "add", name: "test-job", cron: "0 9 * * *", command: "echo hi" }, {});
t("schedule add", !s1.isError && s1.text.includes("crontab"));
const s2 = await runTool("schedule", { action: "list" }, {});
t("schedule list 含任务", !s2.isError && s2.text.includes("test-job"));
const s3 = await runTool("schedule", { action: "remove", name: "test-job" }, {});
t("schedule remove", !s3.isError && s3.text.includes("已移除"));
const s4 = await runTool("schedule", { action: "add", name: "x" }, {});
t("schedule add 缺参数报错", s4.isError);

// 清理测试残留
rmSync(path.join(os.homedir(), ".self-agent", "pending-question.json"), { force: true });
rmSync(path.join(os.homedir(), ".self-agent", "schedules.json"), { force: true });

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
