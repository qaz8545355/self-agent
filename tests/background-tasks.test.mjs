import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// OUT_DIR 在模块加载时读取环境变量，所以先设再动态 import
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "sa-bg-"));
process.env.SELF_AGENT_BG_DIR = tmpDir;

const {
  startShellTask,
  waitForTask,
  readTaskOutput,
  listTasks,
  stopTask,
  removeTask,
  drainNotifications,
  runningCount,
  outputDir,
  FOREGROUND_MS,
  _reset,
} = await import("../background-tasks.mjs");

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1) 启动与完成 ──
const t1 = startShellTask("echo hello", { cwd: tmpDir });
t("返回 bg 前缀 id", typeof t1.id === "string" && t1.id.startsWith("bg"));
t("初始状态 running", t1.status === "running");
t("输出目录来自环境变量", outputDir() === tmpDir);
await waitForTask(t1.id, 5000);
t("完成后 status=completed", listTasks().find((x) => x.id === t1.id).status === "completed");
t("输出含 hello", readTaskOutput(t1.id).text.includes("hello"));

// ── 2) 失败命令 ──
const t2 = startShellTask("exit 3", { cwd: tmpDir });
await waitForTask(t2.id, 5000);
const info2 = listTasks().find((x) => x.id === t2.id);
t("失败 status=failed", info2.status === "failed");
t("exitCode=3", info2.exitCode === 3);
t("记录了 finishedAt", typeof info2.finishedAt === "number");

// ── 3) 增量读 ──
const t3 = startShellTask("printf 'abcdefghij'", { cwd: tmpDir });
await waitForTask(t3.id, 5000);
const r1 = readTaskOutput(t3.id, { offset: 0, maxBytes: 4 });
t("首次增量读 4 字节", r1.text === "abcd" && r1.offset === 4, `→ ${JSON.stringify(r1.text)}`);
const r2 = readTaskOutput(t3.id, { offset: r1.offset, maxBytes: 100 });
t("续读剩余内容", r2.text === "efghij");
t("eof 标记为 true", r2.eof === true);
t("totalBytes 正确", r2.totalBytes === 10);

// ── 4) 完成通知（防重）──
const t4 = startShellTask("echo notify", { cwd: tmpDir });
await waitForTask(t4.id, 5000);
const notes = drainNotifications();
t("通知含已完成任务", notes.some((n) => n.id === t4.id));
t("通知取走后为空", drainNotifications().length === 0);

// ── 5) 停止长任务 ──
const t5 = startShellTask("sleep 30", { cwd: tmpDir });
await sleep(300);
t("停止返回成功", stopTask(t5.id).ok === true);
await sleep(500);
t("停止后不再 running", listTasks().find((x) => x.id === t5.id).status !== "running");

// ── 6) 前台超时 ──
const t6 = startShellTask("sleep 5", { cwd: tmpDir });
const finished = await waitForTask(t6.id, 300);
t("超时未结束返回 false", finished === false);
stopTask(t6.id);

// ── 7) 运行计数 ──
t("runningCount 是数字", typeof runningCount() === "number");

// ── 8) 清理 ──
const rm1 = removeTask(t1.id);
t("清理已结束任务成功", rm1.ok === true);
t("清理后不在列表", !listTasks().some((x) => x.id === t1.id));

const t7 = startShellTask("sleep 5", { cwd: tmpDir });
await sleep(200);
const rm2 = removeTask(t7.id);
t("清理运行中任务被拒绝", rm2.ok === false);
stopTask(t7.id);

// ── 9) 不存在的任务 ──
t("读取不存在任务报错", readTaskOutput("nope").ok === false);
t("停止不存在任务报错", stopTask("nope").ok === false);
t("清理不存在任务报错", removeTask("nope").ok === false);

// ── 10) 常量 ──
t("FOREGROUND_MS=15000", FOREGROUND_MS === 15000);

// ── 11) 工具层（bg_task / bash 转后台）──
const { runTool, toOpenAITools } = await import("../tools.mjs");
const toolNames = toOpenAITools().map((x) => x.function.name);
t("bg_task 工具已注册", toolNames.includes("bg_task"));
const bashProps = toOpenAITools().find((x) => x.function.name === "bash").function.parameters.properties;
t("bash 支持 run_in_background", "run_in_background" in bashProps);

const started = await runTool("bg_task", { action: "start", command: "echo tool-layer" }, { cwd: tmpDir });
t("工具 start 返回任务 id", !started.isError && /bg\w+/.test(started.text));
const toolId = started.text.match(/(bg\w+)/)?.[1];
await waitForTask(toolId, 5000);
const outRes = await runTool("bg_task", { action: "output", id: toolId }, { cwd: tmpDir });
t("工具 output 读到内容", !outRes.isError && outRes.text.includes("tool-layer"));
const listRes = await runTool("bg_task", { action: "list" }, {});
t("工具 list 含任务", !listRes.isError && listRes.text.includes(toolId));
const badStart = await runTool("bg_task", { action: "start", command: "rm -rf /" }, { cwd: tmpDir });
t("bg_task 危险命令被拦截", badStart.isError === true);
t("bg_task 缺 command 报错", (await runTool("bg_task", { action: "start" }, {})).isError === true);
t("bg_task 未知 action 报错", (await runTool("bg_task", { action: "nope" }, {})).isError === true);

const fg = await runTool("bash", { command: "echo foreground-ok" }, { cwd: tmpDir });
t("bash 前台执行正常", !fg.isError && fg.text.includes("foreground-ok"));
const fgErr = await runTool("bash", { command: "exit 7" }, { cwd: tmpDir });
t("bash 非零退出标记错误", fgErr.isError === true && fgErr.text.includes("exit=7"));
const bgBash = await runTool("bash", { command: "sleep 1", run_in_background: true }, { cwd: tmpDir });
t("bash 后台执行返回任务 id", !bgBash.isError && bgBash.text.includes("已转后台"));

_reset();
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
