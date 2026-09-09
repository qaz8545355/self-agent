/**
 * memory-files.mjs — 记忆文件加载（AGENTS.md / CLAUDE.md 约定）
 *
 * 移植自 Claude Code `utils/claudemd.ts`。加载顺序（优先级由低到高，越靠后模型越关注）：
 *
 *   1. 用户级：`~/.self-agent/AGENTS.md`、`~/.claude/CLAUDE.md`
 *   2. 项目级：从**根目录向下**到当前目录，每级查找
 *      `AGENTS.md`、`CLAUDE.md`、`.self-agent/AGENTS.md`、`.self-agent/rules/*.md`
 *   3. 本地级：`AGENTS.local.md`（同级里优先级最高）
 *
 * `@include` 指令（源码注释里的 Memory @include）：
 *   - 语法：`@path`、`@./relative`、`@~/home`、`@/absolute`
 *   - **只在叶子文本节点生效**（代码块/行内代码里的 @ 不展开）
 *   - 被包含文件作为独立条目插在包含者**之前**
 *   - 循环引用防护；不存在的文件静默忽略
 *
 * 总长度上限 `MAX_MEMORY_CHARS`（40000），超出截断并提示。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 记忆文件总字符上限（对齐源码 MAX_MEMORY_CHARACTER_COUNT） */
export const MAX_MEMORY_CHARS = 40000;

/** 从一个目录向上直到根，返回 [根, …, dir]（优先级由低到高） */
function ancestors(dir) {
  const out = [];
  let cur = path.resolve(dir);
  for (;;) {
    out.unshift(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/** 单级目录里要收集的记忆文件（按优先级由低到高） */
function filesInDir(dir) {
  const out = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = path.join(dir, name);
    if (existsSync(p) && statSync(p).isFile()) out.push(p);
  }
  const nested = path.join(dir, ".self-agent", "AGENTS.md");
  if (existsSync(nested) && statSync(nested).isFile()) out.push(nested);

  const rulesDir = path.join(dir, ".self-agent", "rules");
  if (existsSync(rulesDir) && statSync(rulesDir).isDirectory()) {
    for (const f of readdirSync(rulesDir).filter((x) => x.endsWith(".md")).sort()) {
      out.push(path.join(rulesDir, f));
    }
  }

  const local = path.join(dir, "AGENTS.local.md");
  if (existsSync(local) && statSync(local).isFile()) out.push(local);
  return out;
}

/** 发现记忆文件（未展开 @include） */
export function discoverMemoryFiles(cwd = process.cwd(), { home = os.homedir() } = {}) {
  const files = [];
  const push = (p) => {
    if (!files.includes(p)) files.push(p);
  };

  // 1) 用户级
  for (const p of [path.join(home, ".self-agent", "AGENTS.md"), path.join(home, ".claude", "CLAUDE.md")]) {
    if (existsSync(p) && statSync(p).isFile()) push(p);
  }

  // 2) 项目级：从根到当前目录（越近优先级越高）
  for (const dir of ancestors(cwd)) {
    for (const f of filesInDir(dir)) push(f);
  }

  return files;
}

/** 把代码块/行内代码替换成等长空白，保证「只在叶子文本节点」解析 @include */
export function stripCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

const INCLUDE_RE = /(^|\s)@((?:\.\.?\/|~\/|\/)?[^\s`<>]+)/g;

/** 提取 @include 目标（已剔除代码块内的） */
export function extractIncludes(content) {
  const out = [];
  for (const m of stripCode(content).matchAll(INCLUDE_RE)) {
    if (m[2] && m[2] !== "@") out.push(m[2]);
  }
  return out;
}

/** 解析 @include 路径 */
export function resolveInclude(spec, fromFile, home = os.homedir()) {
  if (spec.startsWith("~/")) return path.join(home, spec.slice(2));
  if (path.isAbsolute(spec)) return spec;
  return path.resolve(path.dirname(fromFile), spec);
}

/**
 * 展开 @include：返回 [{path, content}]，被包含文件排在包含者之前。
 * @param {string[]} files
 * @param {{home?:string, maxDepth?:number}} [opts]
 */
export function expandIncludes(files, { home = os.homedir(), maxDepth = 5 } = {}) {
  const result = [];
  const seen = new Set();

  const visit = (file, depth) => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return; // 循环引用防护
    seen.add(abs);
    if (depth > maxDepth) return; // 深度防护
    if (!existsSync(abs) || !statSync(abs).isFile()) return; // 不存在静默忽略

    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      return;
    }

    // 先展开被包含文件（插在包含者之前）
    for (const spec of extractIncludes(text)) {
      visit(resolveInclude(spec, abs, home), depth + 1);
    }
    result.push({ path: abs, content: text });
  };

  for (const f of files) visit(f, 0);
  return result;
}

/**
 * 生成注入 system prompt 的记忆文本。
 * @returns {{text:string, files:string[], truncated:boolean}}
 */
export function loadMemoryContext(cwd = process.cwd(), opts = {}) {
  const home = opts.home ?? os.homedir();
  const maxChars = opts.maxChars ?? MAX_MEMORY_CHARS;
  const files = discoverMemoryFiles(cwd, { home });
  const expanded = expandIncludes(files, { home });
  if (!expanded.length) return { text: "", files: [], truncated: false };

  const display = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const parts = [];
  const included = [];
  let total = 0;
  let truncated = false;

  for (const f of expanded) {
    const block = `### ${display(f.path)}\n${f.content.trim()}`;
    if (total + block.length > maxChars) {
      truncated = true;
      parts.push(`…（记忆文件总长度超过 ${maxChars} 字符，其余已截断）`);
      break;
    }
    parts.push(block);
    included.push(f.path);
    total += block.length;
  }

  return { text: parts.join("\n\n"), files: included, truncated };
}
