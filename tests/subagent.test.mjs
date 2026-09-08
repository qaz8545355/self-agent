import { runTool, toOpenAITools } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log(`✅ ${name}`)) : (fail++, console.log(`❌ ${name}`)); };

// 1) subagent 工具已注册
const names = toOpenAITools().map((x) => x.function.name);
t("subagent 工具已注册", names.includes("subagent"));
t("工具数量 >= 7", names.length >= 7, `（实际 ${names.length}）`);

// 2) 递归防护：depth>0 时拒绝
const r = await runTool("subagent", { task: "再来一个子代理" }, { depth: 1, cwd: "/tmp" });
t("子代理内禁止再派子代理", r.isError && r.text.includes("递归防护"));

// 3) 未知工具
const u = await runTool("nonexistent", {}, {});
t("未知工具返回错误", u.isError);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
