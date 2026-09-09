import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseArgumentNames,
  parseAllowedTools,
  parsePaths,
  globToRe,
  parseArgs,
  substituteArguments,
  activateConditionalSkillsForPaths,
  loadSkill,
  listSkills,
  skillsCatalog,
  estimateCatalogTokens,
} from "../skills.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// ── 1) frontmatter 字段解析 ──
t("parseArgumentNames 数组", JSON.stringify(parseArgumentNames(["a", "b"])) === JSON.stringify(["a", "b"]));
t("parseArgumentNames 字符串", JSON.stringify(parseArgumentNames("a b")) === JSON.stringify(["a", "b"]));
t("parseArgumentNames 过滤纯数字", JSON.stringify(parseArgumentNames(["a", "1", ""])) === JSON.stringify(["a"]));
t("parseArgumentNames 空值", parseArgumentNames(undefined).length === 0);
t("parseAllowedTools 数组", JSON.stringify(parseAllowedTools(["bash", "read"])) === JSON.stringify(["bash", "read"]));
t("parseAllowedTools 字符串", JSON.stringify(parseAllowedTools("bash, read grep")) === JSON.stringify(["bash", "read", "grep"]));
t("parsePaths 逗号分隔", JSON.stringify(parsePaths("**/*.py, src/*.ts")) === JSON.stringify(["**/*.py", "src/*.ts"]));
t("parsePaths 全 ** 视为无条件", parsePaths("**").length === 0);
t("parsePaths 空值", parsePaths(undefined).length === 0);

// ── 2) glob 匹配 ──
t("glob **/*.py 匹配 src/a.py", globToRe("**/*.py").test("src/a.py"));
t("glob **/*.py 匹配根目录 a.py", globToRe("**/*.py").test("a.py"));
t("glob **/*.py 不匹配 a.js", !globToRe("**/*.py").test("a.js"));
t("glob src/*.ts 匹配 src/x.ts", globToRe("src/*.ts").test("src/x.ts"));
t("glob src/*.ts 不匹配 src/deep/x.ts", !globToRe("src/*.ts").test("src/deep/x.ts"));

// ── 3) 参数分词 ──
t("parseArgs 空格分词", JSON.stringify(parseArgs("a b")) === JSON.stringify(["a", "b"]));
t("parseArgs 引号保留", JSON.stringify(parseArgs(`a "b c"`)) === JSON.stringify(["a", "b c"]));
t("parseArgs 空串", parseArgs("").length === 0);
t("parseArgs 非字符串", parseArgs(undefined).length === 0);

// ── 4) 参数替换 ──
t("$ARGUMENTS 整体替换", substituteArguments("跑 $ARGUMENTS", "a b") === "跑 a b");
t("$0 是第一个参数（对齐源码索引）", substituteArguments("第一个：$0", "x y") === "第一个：x");
t("$1 是第二个参数", substituteArguments("第二个：$1", "x y") === "第二个：y");
t("$ARGUMENTS[1] 替换", substituteArguments("第二个：$ARGUMENTS[1]", "x y") === "第二个：y");
t("命名参数替换", substituteArguments("$file 里", "a.py", { argumentNames: ["file"] }) === "a.py 里");
t("命名参数不匹配前缀", substituteArguments("$files", "a.py", { argumentNames: ["file"], appendIfNoPlaceholder: false }) === "$files");
t("无占位符时追加 ARGUMENTS", substituteArguments("正文", "a b") === "正文\n\nARGUMENTS: a b");
t("appendIfNoPlaceholder=false 不追加", substituteArguments("正文", "a b", { appendIfNoPlaceholder: false }) === "正文");
t("args undefined 原样返回", substituteArguments("$ARGUMENTS", undefined) === "$ARGUMENTS");
t("args 空串替换为空", substituteArguments("跑 $ARGUMENTS", "") === "跑 ");
t("无参数不追加", substituteArguments("正文", "") === "正文");

// ── 5) 条件技能 + 带参加载（临时技能目录） ──
const root = mkdtempSync(path.join(os.tmpdir(), "sa-skill-"));
const skillsDir = path.join(root, "skills");
mkdirSync(path.join(skillsDir, "py-helper"), { recursive: true });
writeFileSync(
  path.join(skillsDir, "py-helper", "SKILL.md"),
  `---
name: py-helper
description: Python 助手
paths: "**/*.py"
argument-hint: "[文件名]"
arguments: file
allowed-tools: bash read_file
---
处理 $file（$ARGUMENTS）
`
);
mkdirSync(path.join(skillsDir, "plain"), { recursive: true });
writeFileSync(
  path.join(skillsDir, "plain", "SKILL.md"),
  `---
name: plain
description: 无条件技能
---
普通内容
`
);

const dirs = [skillsDir];
const meta = listSkills(dirs).find((s) => s.name === "py-helper");
t("解析出 paths", meta.paths.length === 1 && meta.paths[0] === "**/*.py");
t("解析出 argument-hint", meta.argumentHint === "[文件名]");
t("解析出 arguments", JSON.stringify(meta.arguments) === JSON.stringify(["file"]));
t("解析出 allowed-tools", JSON.stringify(meta.allowedTools) === JSON.stringify(["bash", "read_file"]));
t("无条件技能 paths 为空", listSkills(dirs).find((s) => s.name === "plain").paths.length === 0);

t("路径匹配激活条件技能", JSON.stringify(activateConditionalSkillsForPaths(["src/a.py"], root, dirs)) === JSON.stringify(["py-helper"]));
t("绝对路径也能激活", JSON.stringify(activateConditionalSkillsForPaths([path.join(root, "src", "b.py")], root, dirs)) === JSON.stringify(["py-helper"]));
t("不匹配不激活", activateConditionalSkillsForPaths(["src/a.js"], root, dirs).length === 0);
t("cwd 之外不激活", activateConditionalSkillsForPaths(["../outside.py"], root, dirs).length === 0);
t("无条件技能不会出现在激活列表", !activateConditionalSkillsForPaths(["src/a.py"], root, dirs).includes("plain"));

const loaded = loadSkill("py-helper", { dirs, args: "a.py" });
t("带参加载：命名参数替换", loaded.content.includes("处理 a.py"));
t("带参加载：$ARGUMENTS 替换", loaded.content.includes("（a.py）"));
t("带参加载：不含 frontmatter", !loaded.content.startsWith("---"));
t("带参加载：保留 raw", loaded.raw.startsWith("---"));
t("不带 args 时正文含占位符", loadSkill("py-helper", { dirs }).content.includes("$file"));
t("兼容旧签名（传 dirs 数组）", !!loadSkill("plain", dirs));

const catalog = skillsCatalog(dirs);
t("catalog 显示 argument-hint", catalog.includes("[文件名]"));
t("catalog 标注条件技能", catalog.includes("[条件技能"));

t("token 估算返回数字", typeof estimateCatalogTokens(dirs) === "number" && estimateCatalogTokens(dirs) > 0);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
