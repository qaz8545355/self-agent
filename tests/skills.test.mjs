import { listSkills, loadSkill, skillsCatalog } from "../skills.mjs";
import { runTool, toOpenAITools } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const all = listSkills();
if (all.length === 0) {
  console.log("⚠️ 未找到技能目录（~/.dsh/skills），跳过技能内容测试");
  console.log("\n结果: 0 通过 / 0 失败（已跳过）");
  process.exit(0);
}

t("技能列表非空", all.length > 0, `（${all.length} 个）`);
t("包含 kimi-search", all.some((s) => s.name === "kimi-search"));
t("包含 dsh-ops", all.some((s) => s.name === "dsh-ops"));
t("描述非空", all.every((s) => s.description.length > 0));

const s = loadSkill("kimi-search");
t("加载 kimi-search 成功", !!s && s.content.includes("kimi-search.mjs"));
t("不存在的技能返回 null", loadSkill("no-such-skill-xyz") === null);
t("catalog 含条目", skillsCatalog().includes("kimi-search"));

// 工具层
const names = toOpenAITools().map((x) => x.function.name);
t("skill 工具已注册", names.includes("skill"));
t("工具数量 >= 8", names.length >= 8, `（实际 ${names.length}）`);

const listed = await runTool("skill", {}, {});
t("skill 工具列出技能", !listed.isError && listed.text.includes("kimi-search"));

const loaded = await runTool("skill", { name: "dsh-ops" }, {});
t("skill 工具加载技能", !loaded.isError && loaded.text.includes("安全重启"));

const missing = await runTool("skill", { name: "nope-xyz" }, {});
t("加载不存在技能报错", missing.isError);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
