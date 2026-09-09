import { runTool, toOpenAITools } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
t("工具数量 >= 10", names.length >= 10, `（实际 ${names.length}: ${names.join(",")}）`);
t("web_fetch 已注册", names.includes("web_fetch"));
t("todo_write 已注册", names.includes("todo_write"));

// web_fetch
let wf = await runTool("web_fetch", { url: "https://example.com" }, {});
if (wf.isError) wf = await runTool("web_fetch", { url: "https://example.com" }, {}); // 网络波动重试一次
t("web_fetch 抓取成功", !wf.isError && wf.text.includes("Example Domain"), `→ ${String(wf.text).slice(0, 80)}`);
const wfBad = await runTool("web_fetch", { url: "https://nonexistent-domain-xyz-12345.invalid" }, {});
t("web_fetch 失败返回错误", wfBad.isError);

// todo_write
const todo = await runTool("todo_write", {
  todos: [
    { content: "任务 A", status: "completed" },
    { content: "任务 B", status: "in_progress" },
  ],
}, {});
t("todo_write 写入成功", !todo.isError && todo.text.includes("任务 A") && todo.text.includes("in_progress"));
const empty = await runTool("todo_write", { todos: [] }, {});
t("todo_write 空清单", empty.text === "(空清单)");
const bad = await runTool("todo_write", { todos: "not-array" }, {});
t("todo_write 类型校验", bad.isError);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
