import { selectToolsForTask, CORE_TOOLS, toolDefs } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) 核心工具始终包含
const base = selectToolsForTask("随便做点什么").map((x) => x.name);
t("核心工具全部包含", CORE_TOOLS.every((c) => base.includes(c)), `（${base.length} 个）`);
t("未知任务不给无关工具", !base.includes("lark_send") && !base.includes("mcp"));

// 2) 关键词命中
const net = selectToolsForTask("帮我抓取这个网页").map((x) => x.name);
t("网页任务带 web_fetch", net.includes("web_fetch"));
t("网页任务带 http_request", net.includes("http_request"));

const nb = selectToolsForTask("编辑这个 jupyter notebook").map((x) => x.name);
t("notebook 任务带 notebook_edit", nb.includes("notebook_edit"));

const lark = selectToolsForTask("用飞书通知我结果").map((x) => x.name);
t("飞书任务带 lark_send", lark.includes("lark_send"));

const sched = selectToolsForTask("每天早上定时执行").map((x) => x.name);
t("定时任务带 schedule", sched.includes("schedule"));

const plan = selectToolsForTask("先设计方案再执行").map((x) => x.name);
t("方案任务带 plan_mode", plan.includes("plan_mode"));

// 3) 工具数控制（显著少于全量）
t("按需工具数 < 全量", base.length < toolDefs.length, `（${base.length} < ${toolDefs.length}）`);

// 4) 多关键词叠加
const multi = selectToolsForTask("抓网页后发飞书并定时").map((x) => x.name);
t("多关键词叠加", multi.includes("web_fetch") && multi.includes("lark_send") && multi.includes("schedule"));

// 5) extra 参数强制包含
const withExtra = selectToolsForTask("简单任务", { extra: ["mcp"] }).map((x) => x.name);
t("extra 可强制包含", withExtra.includes("mcp"));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
