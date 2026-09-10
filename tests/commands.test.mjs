import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSkills, loadSkill, skillsCatalog, COMMAND_DIRS } from "../skills.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const root = mkdtempSync(path.join(os.tmpdir(), "sa-cmd-"));
const cmdDir = path.join(root, "commands");
mkdirSync(cmdDir, { recursive: true });
writeFileSync(
  path.join(cmdDir, "review.md"),
  `---
description: 代码审查
argument-hint: "[路径]"
arguments: target
---
请审查 $target 的代码质量（参数：$ARGUMENTS）
`
);
writeFileSync(path.join(cmdDir, "daily.md"), `没有 frontmatter 的命令\n`);

const opts = { commandDirs: [cmdDir] };

// ── 发现 ──
const all = listSkills([], opts);
t("命令被列出", all.some((s) => s.name === "review"), `→ ${all.map((s) => s.name).join(",")}`);
t("标记 kind=command", all.find((s) => s.name === "review").kind === "command");
t("解析 description", all.find((s) => s.name === "review").description === "代码审查");
t("解析 argument-hint", all.find((s) => s.name === "review").argumentHint === "[路径]");
t("解析 arguments", JSON.stringify(all.find((s) => s.name === "review").arguments) === JSON.stringify(["target"]));
t("记录文件路径", all.find((s) => s.name === "review").file.endsWith("review.md"));
t("无 frontmatter 也可用", all.some((s) => s.name === "daily"));
t("目录不存在不报错", listSkills([], { commandDirs: [path.join(root, "nope")] }).length === 0);

// ── 加载与参数替换 ──
const loaded = loadSkill("review", { dirs: [], ...opts, args: "src/a.js" });
t("命令可加载", !!loaded);
t("命名参数替换", loaded.content.includes("请审查 src/a.js"));
t("$ARGUMENTS 替换", loaded.content.includes("（参数：src/a.js）"));
t("去掉 frontmatter", !loaded.content.startsWith("---"));
const noArgs = loadSkill("review", { dirs: [], ...opts });
t("不传 args 保留占位符", noArgs.content.includes("$target"));

// ── 清单显示 ──
const catalog = skillsCatalog([], 40, opts);
t("清单标注 [命令]", catalog.includes("[命令] review"));
t("清单含参数提示", catalog.includes("[路径]"));

// ── 与技能区分 ──
t("默认命令目录是用户级", COMMAND_DIRS[0].includes(path.join(".self-agent", "commands")));
t("技能 kind=skill", listSkills().length === 0 || listSkills().every((s) => s.kind === "skill"));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
