import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverMemoryFiles,
  extractIncludes,
  resolveInclude,
  expandIncludes,
  loadMemoryContext,
  stripCode,
  MAX_MEMORY_CHARS,
} from "../memory-files.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// ── 构造目录树 ──
const root = mkdtempSync(path.join(os.tmpdir(), "sa-mem-"));
const home = path.join(root, "home");
const proj = path.join(root, "proj");
const sub = path.join(proj, "sub");

mkdirSync(path.join(home, ".self-agent"), { recursive: true });
writeFileSync(path.join(home, ".self-agent", "AGENTS.md"), "# 用户级指令\n全局约定。\n");

mkdirSync(path.join(proj, ".self-agent", "rules"), { recursive: true });
writeFileSync(path.join(proj, "AGENTS.md"), "# 项目根\n项目约定。\n");
writeFileSync(path.join(proj, ".self-agent", "rules", "a.md"), "# 规则 A\n");
writeFileSync(path.join(proj, ".self-agent", "rules", "b.md"), "# 规则 B\n");

mkdirSync(sub, { recursive: true });
writeFileSync(path.join(sub, "AGENTS.md"), "# 子目录\n子目录约定。\n");
writeFileSync(path.join(sub, "AGENTS.local.md"), "# 本地私有\n");

// ── 1) 发现顺序 ──
const found = discoverMemoryFiles(sub, { home });
const idx = (p) => found.indexOf(p);
t("包含用户级文件", idx(path.join(home, ".self-agent", "AGENTS.md")) >= 0);
t("用户级排在最前", idx(path.join(home, ".self-agent", "AGENTS.md")) === 0);
t("项目根 AGENTS.md 已收集", idx(path.join(proj, "AGENTS.md")) >= 0);
t("子目录 AGENTS.md 已收集", idx(path.join(sub, "AGENTS.md")) >= 0);
t("规则文件 a.md 已收集", idx(path.join(proj, ".self-agent", "rules", "a.md")) >= 0);
t("规则文件排序 a 在 b 前", idx(path.join(proj, ".self-agent", "rules", "a.md")) < idx(path.join(proj, ".self-agent", "rules", "b.md")));
t("子目录在项目根之后（优先级更高）", idx(path.join(sub, "AGENTS.md")) > idx(path.join(proj, "AGENTS.md")));
t("AGENTS.local.md 排在同级最后", idx(path.join(sub, "AGENTS.local.md")) > idx(path.join(sub, "AGENTS.md")));
t("无重复路径", new Set(found).size === found.length);

// ── 2) stripCode / extractIncludes ──
t("代码块内 @ 被忽略", extractIncludes("```\n@a.md\n```").length === 0);
t("行内代码 @ 被忽略", extractIncludes("`@a.md`").length === 0);
t("正文 @include 被提取", JSON.stringify(extractIncludes("见 @./a.md 和 @~/b.md")) === JSON.stringify(["./a.md", "~/b.md"]));
t("stripCode 保留换行", stripCode("```\n@x\n```").split("\n").length === 3);

// ── 3) resolveInclude ──
t("解析 ~/", resolveInclude("~/x.md", "/a/b.md", "/home/u") === path.join("/home/u", "x.md"));
t("解析绝对路径", resolveInclude("/abs/x.md", "/a/b.md", "/home/u") === "/abs/x.md");
t("解析相对路径", resolveInclude("./x.md", "/a/b.md", "/home/u") === path.resolve("/a", "x.md"));

// ── 4) expandIncludes ──
const incDir = path.join(root, "inc");
mkdirSync(incDir, { recursive: true });
writeFileSync(path.join(incDir, "base.md"), "# base\n");
writeFileSync(path.join(incDir, "main.md"), "# main\n@./base.md\n");
writeFileSync(path.join(incDir, "loopA.md"), "# A\n@./loopB.md\n");
writeFileSync(path.join(incDir, "loopB.md"), "# B\n@./loopA.md\n");
writeFileSync(path.join(incDir, "missing.md"), "# missing\n@./nope.md\n");

const ex = expandIncludes([path.join(incDir, "main.md")], { home });
t("被包含文件排在包含者之前", ex.length === 2 && ex[0].path.endsWith("base.md") && ex[1].path.endsWith("main.md"));

const loop = expandIncludes([path.join(incDir, "loopA.md")], { home });
t("循环引用不死循环", loop.length === 2, `→ ${loop.length} 个文件`);

const missing = expandIncludes([path.join(incDir, "missing.md")], { home });
t("缺失文件静默忽略", missing.length === 1 && missing[0].path.endsWith("missing.md"));

// ── 5) loadMemoryContext ──
const ctx = loadMemoryContext(sub, { home });
t("上下文包含用户级内容", ctx.text.includes("全局约定"));
t("上下文包含子目录内容", ctx.text.includes("子目录约定"));
t("用户级在子目录之前", ctx.text.indexOf("全局约定") < ctx.text.indexOf("子目录约定"));
t("本地文件在最后", ctx.text.indexOf("本地私有") > ctx.text.indexOf("子目录约定"));
t("未截断时 truncated=false", ctx.truncated === false);
t("files 列表非空", ctx.files.length > 0);

const small = loadMemoryContext(sub, { home, maxChars: 40 });
t("超限时截断", small.truncated === true);
t("截断提示存在", small.text.includes("已截断"));
t("MAX_MEMORY_CHARS 为 40000", MAX_MEMORY_CHARS === 40000);

// ── 6) 空目录 ──
const empty = loadMemoryContext(path.join(root, "nothing"), { home: path.join(root, "no-home") });
t("无记忆文件时返回空文本", empty.text === "" && empty.files.length === 0);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
