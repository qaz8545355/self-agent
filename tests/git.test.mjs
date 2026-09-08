import { runTool, toOpenAITools } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };
const ctx = { cwd: new URL("..", import.meta.url).pathname };

const names = toOpenAITools().map((x) => x.function.name);
t("工具数量 >= 12", names.length >= 12, `（${names.length}）`);
t("git 工具已注册", names.includes("git"));

const st = await runTool("git", { action: "status" }, ctx);
t("git status 正常", !st.isError, `→ ${String(st.text).slice(0, 60)}`);

const lg = await runTool("git", { action: "log" }, ctx);
t("git log 正常", !lg.isError && lg.text.includes("commit"), `→ ${String(lg.text).slice(0, 60)}`);

const br = await runTool("git", { action: "branch" }, ctx);
t("git branch 正常", !br.isError, `→ ${String(br.text).trim().slice(0, 40)}`);

const bad = await runTool("git", { action: "push" }, ctx);
t("非白名单操作被拒", bad.isError);

const inj = await runTool("git", { action: "status", args: "; rm -rf /" }, ctx);
t("参数注入被拒", inj.isError, `→ ${inj.text}`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
