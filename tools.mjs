/**
 * tools.mjs — 工具注册表（契约式声明，借鉴 Claude Code 的「工具即契约」）
 *
 * 每个工具：{ name, description, parameters, isReadOnly, execute(args, ctx) }
 * execute 返回 { text, isError? }
 */
import "./env.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCommand, checkWritePath } from "./safety.mjs";
import { isReadOnlyCommand } from "./readonly-commands.mjs";
import { trackEdit, listVersions, rewind, diffStats, historyRoot } from "./file-history.mjs";

const MAX_OUTPUT = 8000;
/** 会话级状态（任务清单等） */
const state = { todos: [] };
const truncate = (s, n = MAX_OUTPUT) =>
  s.length > n ? s.slice(0, n) + `\n…[截断，共 ${s.length} 字符]` : s;

/** 简单 glob 匹配（支持 **、*、?） */
function globToRe(pat) {
  const esc = pat.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "^" + esc.replace(/\*\*\//g, "(?:.*/)?").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"
  );
}

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
  return out;
}


/** 检查目录内是否有未提交改动（用于决定是否清理 worktree） */
function worktreeHasChanges(dir) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8", timeout: 10_000 });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export const toolDefs = [
  {
    name: "bash",
    description: "在工作目录执行 shell 命令。危险命令会被安全层拦截。",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "要执行的命令" } },
      required: ["command"],
    },
    isReadOnly: false,
    async execute({ command }, ctx = {}) {
      const check = checkCommand(command);
      if (!check.allow) return { isError: true, text: `⛔ 已拦截（${check.level}）：${check.reason}` };
      try {
        const out = execFileSync("/bin/bash", ["-c", command], {
          cwd: ctx.cwd ?? process.cwd(),
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        return { text: truncate(out || "(无输出)") };
      } catch (e) {
        return { isError: true, text: truncate(`exit=${e.status ?? "?"}\n${e.stdout ?? ""}${e.stderr ?? e.message}`) };
      }
    },
  },
  {
    name: "read_file",
    description: "读取文件内容（带行号）。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    isReadOnly: true,
    async execute({ path: p }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);
      if (!existsSync(full)) return { isError: true, text: `文件不存在：${p}` };
      const lines = readFileSync(full, "utf8").split("\n");
      return { text: truncate(lines.map((l, i) => `${i + 1}\t${l}`).join("\n")) };
    },
  },
  {
    name: "write_file",
    description: "创建或覆盖写入文件（会先做路径安全校验）。",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    isReadOnly: false,
    async execute({ path: p, content }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);
      const check = checkWritePath(full);
      if (!check.allow) return { isError: true, text: `⛔ 已拦截：${check.reason}` };
      mkdirSync(path.dirname(full), { recursive: true });
      trackEdit(full);
      writeFileSync(full, content, "utf8");
      return { text: `已写入 ${full}（${content.length} 字符）` };
    },
  },
  {
    name: "edit_file",
    description: "在文件中精确替换文本：old_string 必须唯一出现。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
    isReadOnly: false,
    async execute({ path: p, old_string, new_string }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);
      if (!existsSync(full)) return { isError: true, text: `文件不存在：${p}` };
      const src = readFileSync(full, "utf8");
      const count = src.split(old_string).length - 1;
      if (count === 0) return { isError: true, text: "old_string 未找到" };
      if (count > 1) return { isError: true, text: `old_string 出现 ${count} 次，不唯一` };
      trackEdit(full);
      writeFileSync(full, src.replace(old_string, new_string), "utf8");
      return { text: `已编辑 ${full}` };
    },
  },
  {
    name: "glob",
    description: "按 glob 模式查找文件（如 **/*.mjs）。",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" }, dir: { type: "string" } },
      required: ["pattern"],
    },
    isReadOnly: true,
    async execute({ pattern, dir }, ctx = {}) {
      const root = path.resolve(ctx.cwd ?? process.cwd(), dir ?? ".");
      const re = globToRe(pattern);
      const files = walk(root).filter((f) => re.test(path.relative(root, f)));
      return { text: files.length ? truncate(files.slice(0, 200).join("\n")) : "无匹配" };
    },
  },
  {
    name: "grep",
    description: "在目录中按正则搜索文件内容，返回 文件:行号:内容。",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" }, dir: { type: "string" }, include: { type: "string" } },
      required: ["pattern"],
    },
    isReadOnly: true,
    async execute({ pattern, dir, include }, ctx = {}) {
      const root = path.resolve(ctx.cwd ?? process.cwd(), dir ?? ".");
      const re = new RegExp(pattern);
      const files = walk(root).filter((f) => !include || globToRe(include).test(path.basename(f)));
      const hits = [];
      for (const f of files) {
        let text;
        try {
          if (statSync(f).size > 2 * 1024 * 1024) continue;
          text = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        text.split("\n").forEach((line, i) => {
          if (re.test(line) && hits.length < 200) hits.push(`${path.relative(root, f)}:${i + 1}:${line.slice(0, 200)}`);
        });
        if (hits.length >= 200) break;
      }
      return { text: hits.length ? hits.join("\n") : "无匹配" };
    },
  },
  {
    name: "subagent",
    description:
      "启动一个独立上下文的子代理执行子任务（适合独立调研、多文件分析、并行探索）。" +
      "子代理看不到当前对话，因此 task 必须自包含。子代理不能再启动子代理。",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "自包含的子任务描述" },
        model: { type: "string", description: "可选：指定子代理使用的模型" },
        max_steps: { type: "number", description: "可选：子代理最大步数（默认 100）" },
        isolation: {
          type: "string",
          enum: ["none", "worktree"],
          description: "可选：worktree 表示在独立 git 工作副本中执行（有改动会保留并告知路径）",
        },
      },
      required: ["task"],
    },
    isReadOnly: false,
    async execute({ task, model, max_steps, isolation }, ctx = {}) {
      if ((ctx.depth ?? 0) > 0) {
        return { isError: true, text: "递归防护：子代理不能再启动子代理" };
      }
      const { runAgent } = await import("./agent.mjs");
      let workDir = ctx.cwd;
      let wt = null;

      if (isolation === "worktree") {
        const { createWorktree } = await import("./worktree.mjs");
        wt = createWorktree(ctx.cwd, { name: "subagent" });
        if (wt.created) workDir = wt.dir;
      }

      try {
        const r = await runAgent({
          task,
          cwd: workDir,
          model: model ?? ctx.model,
          maxSteps: Math.max(100, Number(max_steps) || 100),
          depth: (ctx.depth ?? 0) + 1,
          onEvent: () => {},
        });

        let suffix = "";
        if (wt?.created) {
          if (worktreeHasChanges(wt.dir)) {
            suffix = `\n[隔离副本保留：${wt.dir}（有改动，请检查后合并或删除）]`;
          } else {
            const { removeWorktree } = await import("./worktree.mjs");
            removeWorktree(wt);
            suffix = "\n[隔离副本已清理（无改动）]";
          }
        } else if (wt?.error) {
          suffix = `\n[${wt.error}]`;
        }
        return {
          text: `[子代理完成 steps=${r.steps} tokens≈${r.totalTokens} done=${r.done}]${suffix}\n${r.content}`,
        };
      } catch (e) {
        if (wt?.created) {
          const { removeWorktree } = await import("./worktree.mjs");
          removeWorktree(wt);
        }
        return { isError: true, text: `子代理失败：${e.message}` };
      }
    },
  },
  {
    name: "skill",
    description:
      "技能加载：不传 name 时列出所有可用技能；传 name 时返回该技能的 SKILL.md 内容（按其中步骤执行）。" +
      "可用 args 传参：技能正文里可用 $ARGUMENTS / $1 / $ARGUMENTS[0] / 命名参数引用。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名（省略则列出全部）" },
        args: { type: "string", description: "可选：技能参数（供 $ARGUMENTS / $1 等占位符替换）" },
      },
    },
    isReadOnly: true,
    async execute({ name, args }) {
      const { listSkills, loadSkill } = await import("./skills.mjs");
      if (!name) {
        const all = listSkills();
        return {
          text:
            all
              .map((s) => `- ${s.name}${s.argumentHint ? ` ${s.argumentHint}` : ""}: ${s.description.slice(0, 120)}`)
              .join("\n") || "(无技能)",
        };
      }
      const s = loadSkill(name, { args });
      if (!s) return { isError: true, text: `技能不存在：${name}` };
      return { text: `# 技能：${s.name}\n\n${s.content.slice(0, 30_000)}` };
    },
  },
  {
    name: "web_fetch",
    description: "抓取网页并返回纯文本（自动去除 script/style/HTML 标签）。",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "要抓取的 URL" },
        max_chars: { type: "number", description: "返回的最大字符数（默认 20000）" },
      },
      required: ["url"],
    },
    isReadOnly: true,
    async execute({ url, max_chars = 20_000 }) {
      try {
        const res = await fetch(url, {
          headers: { "user-agent": "self-agent/0.1 (+https://example.invalid)" },
          signal: AbortSignal.timeout(30_000),
        });
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim();
        return { text: `[HTTP ${res.status}] ${truncate(text, max_chars)}` };
      } catch (e) {
        return { isError: true, text: `抓取失败：${e.message}` };
      }
    },
  },
  {
    name: "todo_write",
    description:
      "维护当前会话的任务清单（全量替换）。用于多步任务的进度跟踪；status 取值 pending / in_progress / completed。",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "完整任务列表",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    isReadOnly: true,
    async execute({ todos: list }) {
      if (!Array.isArray(list)) return { isError: true, text: "todos 必须是数组" };
      state.todos = list;
      return {
        text: list.length
          ? list.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")
          : "(空清单)",
      };
    },
  },
  {
    name: "git",
    description:
      "只读 git 操作：status / log / diff / branch / show / blame。写操作（commit/push/checkout 等）请用 bash 并遵守安全策略。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "log", "diff", "branch", "show", "blame"] },
        args: { type: "string", description: "附加参数（如文件名、-n 5）" },
      },
      required: ["action"],
    },
    isReadOnly: true,
    async execute({ action, args }, ctx = {}) {
      const allowed = new Set(["status", "log", "diff", "branch", "show", "blame"]);
      if (!allowed.has(action)) return { isError: true, text: `不支持的 git 操作：${action}` };
      const extra = String(args ?? "").trim();
      if (/[;&|`$><]/.test(extra)) return { isError: true, text: "参数包含不允许的字符" };
      const argv = ["git", action, ...(extra ? extra.split(/\s+/) : [])];
      if (action === "log" && !extra) argv.push("-n", "20");
      try {
        const out = execFileSync(argv[0], argv.slice(1), {
          cwd: ctx.cwd ?? process.cwd(),
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        return { text: truncate(out || "(无输出)") };
      } catch (e) {
        return { isError: true, text: truncate(`git ${action} 失败：${e.stderr || e.message}`) };
      }
    },
  },
  {
    name: "memory",
    description:
      "读取长期记忆（画像/偏好/事件），返回带时效标注的内容——旧记忆会自动标注「可能已过时」，避免被过时信息误导。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "可选：关键词过滤" },
        limit: { type: "number", description: "最多返回条数（默认 8）" },
      },
    },
    isReadOnly: true,
    async execute({ query, limit = 8 }) {
      const { annotateMemory } = await import("./memory-age.mjs");
      const dir = process.env.SELF_AGENT_MEMORY_DIR ?? path.join(os.homedir(), ".memory-tencentdb", "memory-tdai");
      if (!existsSync(dir)) return { text: "(未找到记忆目录)" };
      const files = [];
      const walkMem = (d) => {
        let entries;
        try {
          entries = readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(d, e.name);
          // conversations/ 是原始对话流水（噪音大），不是提炼后的记忆
          if (e.isDirectory()) {
            if (e.name === "conversations" || e.name === "logs") continue;
            walkMem(full);
          } else if (/\.(md|jsonl)$/.test(e.name)) files.push(full);
        }
      };
      walkMem(dir);

      const items = [];
      for (const f of files) {
        try {
          const st = statSync(f);
          let content = readFileSync(f, "utf8").trim();
          if (!content) continue;
          if (content.length > 4000) content = content.slice(0, 4000) + "…";
          if (query && !content.toLowerCase().includes(String(query).toLowerCase())) continue;
          items.push({ file: path.relative(dir, f), content, mtimeMs: st.mtimeMs });
        } catch {
          /* 跳过不可读文件 */
        }
      }
      items.sort((a, b) => {
        const pa = a.file === "persona.md" ? 1 : 0;
        const pb = b.file === "persona.md" ? 1 : 0;
        return pb - pa || b.mtimeMs - a.mtimeMs;
      });
      const picked = items.slice(0, limit);
      if (!picked.length) return { text: query ? `未找到与「${query}」相关的记忆` : "(无记忆)" };
      return {
        text: picked.map((it) => `【${it.file}】\n${annotateMemory(it.content, it.mtimeMs)}`).join("\n\n"),
      };
    },
  },
  {
    name: "check_binary",
    description:
      "检测外部命令是否可用（带缓存）。依赖外部命令（rg/jq/ffmpeg 等）前先确认，避免「命令不存在」失败；不传 command 时返回常见命令的环境清单。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要检测的命令名（省略则返回常见命令清单）" },
      },
    },
    isReadOnly: true,
    async execute({ command }) {
      const { isBinaryInstalled, COMMON_BINARIES } = await import("./binary-check.mjs");
      if (!command) {
        const list = COMMON_BINARIES.map((c) => `${isBinaryInstalled(c) ? "✓" : "✗"} ${c}`);
        return { text: `常见命令可用性：\n${list.join("\n")}` };
      }
      const ok = isBinaryInstalled(command);
      return { text: ok ? `✓ ${command} 可用` : `✗ ${command} 不可用（请改用内置工具或替代方案）` };
    },
  },
  {
    name: "apply_patch",
    description:
      "批量编辑多个文件（原子操作）：先全部校验（路径安全 + old_string 唯一），再统一写入；任一失败则全部回滚，不留半成品。适合跨文件重构。",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          description: "编辑列表；每项替换一个文件中的一段文本（同一文件可多项，按顺序应用）",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
            },
            required: ["path", "old_string", "new_string"],
          },
        },
      },
      required: ["edits"],
    },
    isReadOnly: false,
    async execute({ edits }, ctx = {}) {
      if (!Array.isArray(edits) || edits.length === 0) {
        return { isError: true, text: "edits 必须是非空数组" };
      }
      const cwd = ctx.cwd ?? process.cwd();
      const staged = [];

      // 1) 全量校验 + 计算（不落盘）
      for (const [i, e] of edits.entries()) {
        if (!e || typeof e.path !== "string" || typeof e.old_string !== "string" || typeof e.new_string !== "string") {
          return { isError: true, text: `第 ${i + 1} 项格式错误（需要 path/old_string/new_string）` };
        }
        const full = path.resolve(cwd, e.path);
        const safe = checkWritePath(full);
        if (!safe.allow) return { isError: true, text: `第 ${i + 1} 项被安全层拒绝：${safe.reason}` };

        let entry = staged.find((x) => x.full === full);
        if (!entry) {
          if (!existsSync(full)) return { isError: true, text: `第 ${i + 1} 项文件不存在：${e.path}` };
          const original = readFileSync(full, "utf8");
          entry = { full, original, updated: original };
          staged.push(entry);
        }
        const count = entry.updated.split(e.old_string).length - 1;
        if (count === 0) return { isError: true, text: `第 ${i + 1} 项 old_string 未找到（${e.path}）` };
        if (count > 1) return { isError: true, text: `第 ${i + 1} 项 old_string 出现 ${count} 次，不唯一（${e.path}）` };
        entry.updated = entry.updated.replace(e.old_string, e.new_string);
      }

      // 2) 原子写入；任一失败则回滚已写文件
      const written = [];
      try {
        for (const x of staged) {
          trackEdit(x.full);
          writeFileSync(x.full, x.updated, "utf8");
          written.push(x);
        }
      } catch (err) {
        for (const x of written) {
          try {
            writeFileSync(x.full, x.original, "utf8");
          } catch {
            /* 回滚失败也只能继续 */
          }
        }
        return { isError: true, text: `写入失败，已回滚 ${written.length} 个文件：${err.message}` };
      }

      return {
        text: `已原子应用 ${edits.length} 处编辑，涉及 ${staged.length} 个文件：\n${staged
          .map((x) => `- ${path.relative(cwd, x.full)}`)
          .join("\n")}`,
      };
    },
  },
  {
    name: "file_history",
    description:
      "查看/回滚文件改动历史。每次 write_file / edit_file / apply_patch 之前会自动备份原内容（存于 ~/.self-agent/file-history）。" +
      "action：list 列出版本、diff 对比某版本与当前、rewind 回滚到某版本。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标文件路径" },
        action: { type: "string", enum: ["list", "diff", "rewind"], description: "操作类型" },
        version: { type: "number", description: "diff / rewind 需要的版本号" },
      },
      required: ["path", "action"],
    },
    isReadOnly: false,
    async execute({ path: p, action, version }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);

      if (action === "list") {
        const vs = listVersions(full);
        if (!vs.length) return { text: `${p} 没有历史版本（历史目录：${historyRoot()}）` };
        return {
          text: vs
            .map((v) => `v${v.version}  ${v.time}  ${v.existed ? `${v.size} 字节` : "（当时不存在）"}`)
            .join("\n"),
        };
      }

      if (action === "diff") {
        const d = diffStats(full, version);
        if (!d.ok) return { isError: true, text: d.error };
        return {
          text: `v${d.version}：备份 ${d.backupLines} 行 → 当前 ${d.currentLines} 行${d.changed ? "（已变化）" : "（内容相同）"}`,
        };
      }

      if (action === "rewind") {
        const r = rewind(full, version);
        return r.ok ? { text: r.detail } : { isError: true, text: r.error };
      }

      return { isError: true, text: `未知 action：${action}（可选 list / diff / rewind）` };
    },
  },
  {
    name: "run_tests",
    description:
      "自动检测并运行项目测试（npm test / node --test / pytest / go test / cargo test），返回通过/失败摘要；可传 command 覆盖检测。",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "可选：自定义测试命令（覆盖自动检测）" },
        timeout_ms: { type: "number", description: "超时毫秒数（默认 180000）" },
      },
    },
    isReadOnly: false,
    async execute({ command, timeout_ms }, ctx = {}) {
      const cwd = ctx.cwd ?? process.cwd();
      const { detectTestCommand, summarizeTestOutput } = await import("./run-tests.mjs");
      const detected = command ? { command, kind: "custom" } : detectTestCommand(cwd);
      if (!detected) {
        return {
          isError: true,
          text: "未检测到测试配置（package.json / pytest / go.mod / Cargo.toml）；可传 command 指定测试命令",
        };
      }
      const timeout = Number(timeout_ms) || 180_000;
      try {
        const out = execFileSync("/bin/bash", ["-c", detected.command], {
          cwd,
          encoding: "utf8",
          timeout,
          maxBuffer: 8 * 1024 * 1024,
        });
        const sum = summarizeTestOutput(detected.kind, out);
        return { text: `测试通过 ✅（${detected.command}）\n${sum.summary}\n\n${truncate(out, 3000)}` };
      } catch (e) {
        const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
        const sum = summarizeTestOutput(detected.kind, out);
        return {
          isError: true,
          text: `测试失败 ❌（${detected.command}，exit=${e.status ?? "?"}）\n${sum.summary}\n\n${truncate(out, 3000)}`,
        };
      }
    },
  },
  {
    name: "env_info",
    description:
      "返回运行环境信息（操作系统 / Node 版本 / 工作目录 / git 状态 / 常用命令可用性），用于快速了解环境，避免盲目假设。",
    parameters: { type: "object", properties: {} },
    isReadOnly: true,
    async execute(_args, ctx = {}) {
      const cwd = ctx.cwd ?? process.cwd();
      const lines = [
        `平台: ${os.platform()} ${os.release()} (${os.arch()})`,
        `Node: ${process.version}`,
        `工作目录: ${cwd}`,
        `目录存在: ${existsSync(cwd) ? "是" : "否"}`,
      ];
      try {
        const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd,
          encoding: "utf8",
          timeout: 5000,
        }).trim();
        const status = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8", timeout: 5000 }).trim();
        lines.push(`Git: 分支 ${branch}${status ? `（${status.split("\n").length} 个未提交改动）` : "（工作区干净）"}`);
      } catch {
        lines.push("Git: 非仓库或不可用");
      }
      const { isBinaryInstalled, COMMON_BINARIES } = await import("./binary-check.mjs");
      const available = COMMON_BINARIES.filter((c) => isBinaryInstalled(c));
      lines.push(`可用命令: ${available.join(", ") || "（无）"}`);
      return { text: lines.join("\n") };
    },
  },
  {
    name: "diff",
    description: "比较两个文件的差异，输出 unified diff（适合改动前后对比、跨版本比对）。",
    parameters: {
      type: "object",
      properties: {
        file_a: { type: "string", description: "旧文件路径" },
        file_b: { type: "string", description: "新文件路径" },
      },
      required: ["file_a", "file_b"],
    },
    isReadOnly: true,
    async execute({ file_a, file_b }, ctx = {}) {
      const cwd = ctx.cwd ?? process.cwd();
      const a = path.resolve(cwd, file_a);
      const b = path.resolve(cwd, file_b);
      if (!existsSync(a)) return { isError: true, text: `文件不存在：${file_a}` };
      if (!existsSync(b)) return { isError: true, text: `文件不存在：${file_b}` };
      try {
        const out = execFileSync("diff", ["-u", a, b], { encoding: "utf8", timeout: 20_000 });
        return { text: out.trim() || "（无差异）" };
      } catch (e) {
        // diff 发现差异时退出码为 1，属正常
        const out = String(e.stdout ?? "");
        if (e.status === 1 && out) return { text: truncate(out) };
        return { isError: true, text: `diff 失败：${e.message}` };
      }
    },
  },
  {
    name: "ask_user",
    description:
      "需要用户做决策时提问（可给候选项）。非交互环境下会记录问题并提示停止等待，不要凭空替用户决定。",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "要问用户的问题" },
        options: { type: "array", items: { type: "string" }, description: "可选：候选项" },
      },
      required: ["question"],
    },
    isReadOnly: true,
    async execute({ question, options }) {
      const file = path.join(os.homedir(), ".self-agent", "pending-question.json");
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(
          file,
          JSON.stringify({ question, options: options ?? [], askedAt: new Date().toISOString() }, null, 2),
          "utf8"
        );
      } catch {
        /* 记录失败不影响返回 */
      }
      const optText =
        Array.isArray(options) && options.length
          ? `\n选项：\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
          : "";
      return { text: `❓ 需要用户确认：${question}${optText}\n（已记录到 ${file}；请停止并等待用户回答）` };
    },
  },
  {
    name: "plan_mode",
    description: "计划模式：enter 后只做规划、不修改文件；exit 恢复执行。用于高风险改动前的方案评审。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["enter", "exit"] },
        plan: { type: "string", description: "enter 时可附上计划要点" },
      },
      required: ["action"],
    },
    isReadOnly: true,
    async execute({ action, plan }) {
      if (action === "enter") {
        return {
          text: `📋 已进入计划模式：只输出方案与步骤，不要修改文件或执行破坏性命令。${
            plan ? `\n\n计划：\n${plan}` : ""
          }`,
        };
      }
      return { text: "✅ 已退出计划模式：可以开始执行。" };
    },
  },
  {
    name: "http_request",
    description: "通用 HTTP 请求（GET/POST/PUT/PATCH/DELETE），返回状态码与响应体（截断）。",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        url: { type: "string" },
        headers: { type: "object", description: "可选：附加请求头" },
        body: { type: "string", description: "可选：请求体（字符串）" },
        max_chars: { type: "number", description: "响应体最大字符数（默认 20000）" },
      },
      required: ["method", "url"],
    },
    isReadOnly: false,
    async execute({ method, url, headers, body, max_chars = 20_000 }) {
      try {
        const res = await fetch(url, {
          method,
          headers: { "content-type": "application/json", ...(headers ?? {}) },
          body: ["GET", "DELETE"].includes(method) ? undefined : body,
          signal: AbortSignal.timeout(30_000),
        });
        const text = await res.text();
        return { text: `HTTP ${res.status}\n${truncate(text, max_chars)}` };
      } catch (e) {
        return { isError: true, text: `请求失败：${e.message}` };
      }
    },
  },
  {
    name: "schedule",
    description:
      "管理定时任务记录（add/list/remove），返回可直接安装的 crontab 行；不会直接修改系统 crontab（避免误伤）。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "remove"] },
        name: { type: "string", description: "任务名（唯一）" },
        cron: { type: "string", description: "cron 表达式，如 '0 9 * * *'" },
        command: { type: "string", description: "要执行的命令" },
      },
      required: ["action"],
    },
    isReadOnly: false,
    async execute({ action, name, cron, command }) {
      const file = path.join(os.homedir(), ".self-agent", "schedules.json");
      let list = [];
      try {
        list = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        list = [];
      }
      if (!Array.isArray(list)) list = [];

      if (action === "list") {
        if (!list.length) return { text: "（无定时任务）" };
        return { text: list.map((x) => `- ${x.name}: ${x.cron} → ${x.command}`).join("\n") };
      }
      if (action === "add") {
        if (!name || !cron || !command) return { isError: true, text: "add 需要 name / cron / command" };
        list = list.filter((x) => x.name !== name);
        list.push({ name, cron, command, addedAt: new Date().toISOString() });
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
        return { text: `已记录定时任务「${name}」。安装到 crontab：\n${cron} ${command}` };
      }
      if (action === "remove") {
        const before = list.length;
        list = list.filter((x) => x.name !== name);
        writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
        return { text: before === list.length ? `未找到任务「${name}」` : `已移除「${name}」` };
      }
      return { isError: true, text: `不支持的操作：${action}` };
    },
  },
  {
    name: "sleep",
    description: "等待指定秒数（用于轮询外部状态、避免忙等），上限 300 秒。",
    parameters: {
      type: "object",
      properties: { seconds: { type: "number", description: "等待秒数" } },
      required: ["seconds"],
    },
    isReadOnly: true,
    async execute({ seconds }) {
      const n = Math.min(Math.max(Number(seconds) || 1, 0.1), 300);
      await new Promise((r) => setTimeout(r, n * 1000));
      return { text: `已等待 ${n} 秒` };
    },
  },
  {
    name: "config",
    description: "读写本地配置（~/.self-agent/config.json，可用 SELF_AGENT_CONFIG 覆盖路径）：get / set / list / delete。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "list", "delete"] },
        key: { type: "string" },
        value: { type: "string" },
      },
      required: ["action"],
    },
    isReadOnly: false,
    async execute({ action, key, value }) {
      const file = process.env.SELF_AGENT_CONFIG ?? path.join(os.homedir(), ".self-agent", "config.json");
      let cfg = {};
      try {
        cfg = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        cfg = {};
      }
      if (typeof cfg !== "object" || cfg === null) cfg = {};

      if (action === "list") {
        const keys = Object.keys(cfg);
        return { text: keys.length ? keys.map((k) => `${k} = ${JSON.stringify(cfg[k])}`).join("\n") : "（空配置）" };
      }
      if (action === "get") {
        if (!key) return { isError: true, text: "get 需要 key" };
        return { text: `${key} = ${JSON.stringify(cfg[key])}` };
      }
      if (action === "set") {
        if (!key) return { isError: true, text: "set 需要 key" };
        cfg[key] = value;
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
        return { text: `已设置 ${key}` };
      }
      if (action === "delete") {
        if (!key) return { isError: true, text: "delete 需要 key" };
        delete cfg[key];
        writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
        return { text: `已删除 ${key}` };
      }
      return { isError: true, text: `不支持的操作：${action}` };
    },
  },
  {
    name: "tool_search",
    description: "按关键词搜索可用工具（匹配名称与描述），工具较多时用于发现能力。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "搜索关键词" } },
      required: ["query"],
    },
    isReadOnly: true,
    async execute({ query }) {
      const q = String(query ?? "").toLowerCase();
      const hits = toolDefs.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
      if (!hits.length) return { text: `未找到与「${query}」相关的工具` };
      return { text: hits.map((t) => `- ${t.name}: ${t.description.slice(0, 90)}`).join("\n") };
    },
  },
  {
    name: "notebook_edit",
    description:
      "编辑 Jupyter Notebook（.ipynb）：list_cells 列出单元格 / read_cell 读取 / replace_cell 替换 / add_cell 追加。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_cells", "read_cell", "replace_cell", "add_cell"] },
        path: { type: "string", description: "notebook 文件路径" },
        index: { type: "number", description: "单元格索引（read/replace 用）" },
        content: { type: "string", description: "单元格内容（replace/add 用）" },
        cell_type: { type: "string", enum: ["code", "markdown"], description: "单元格类型（默认 code）" },
      },
      required: ["action", "path"],
    },
    isReadOnly: false,
    async execute({ action, path: p, index, content, cell_type = "code" }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);
      if (!existsSync(full)) return { isError: true, text: `文件不存在：${p}` };
      let nb;
      try {
        nb = JSON.parse(readFileSync(full, "utf8"));
      } catch (e) {
        return { isError: true, text: `notebook 解析失败：${e.message}` };
      }
      const cells = nb.cells ?? [];
      const cellText = (c) => (Array.isArray(c.source) ? c.source.join("") : String(c.source ?? ""));

      if (action === "list_cells") {
        return {
          text: cells.length
            ? cells.map((c, i) => `[${i}] ${c.cell_type} (${cellText(c).length} 字符) ${cellText(c).slice(0, 60).replace(/\n/g, " ")}`).join("\n")
            : "（空 notebook）",
        };
      }
      if (action === "read_cell") {
        if (!Number.isInteger(index) || !cells[index]) return { isError: true, text: "index 无效" };
        return { text: cellText(cells[index]) };
      }
      if (action === "replace_cell") {
        if (!Number.isInteger(index) || !cells[index]) return { isError: true, text: "index 无效" };
        if (typeof content !== "string") return { isError: true, text: "replace_cell 需要 content" };
        cells[index].source = content.split("\n").map((l, i, a) => (i < a.length - 1 ? l + "\n" : l));
        writeFileSync(full, JSON.stringify(nb, null, 1), "utf8");
        return { text: `已替换单元格 [${index}]` };
      }
      if (action === "add_cell") {
        if (typeof content !== "string") return { isError: true, text: "add_cell 需要 content" };
        cells.push({
          cell_type,
          metadata: {},
          source: content.split("\n").map((l, i, a) => (i < a.length - 1 ? l + "\n" : l)),
          ...(cell_type === "code" ? { outputs: [], execution_count: null } : {}),
        });
        nb.cells = cells;
        writeFileSync(full, JSON.stringify(nb, null, 1), "utf8");
        return { text: `已追加 ${cell_type} 单元格（共 ${cells.length} 个）` };
      }
      return { isError: true, text: `不支持的操作：${action}` };
    },
  },
  {
    name: "task",
    description:
      "持久化任务管理（存 ~/.self-agent/tasks.json，跨会话保留）：create / list / update / complete / delete。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "update", "complete", "delete"] },
        id: { type: "string", description: "任务 ID（update/complete/delete 用）" },
        title: { type: "string", description: "任务标题（create 用）" },
        status: { type: "string", enum: ["pending", "in_progress", "completed"], description: "状态（update 用）" },
        note: { type: "string", description: "备注" },
      },
      required: ["action"],
    },
    isReadOnly: false,
    async execute({ action, id, title, status, note }) {
      const file = process.env.SELF_AGENT_TASKS ?? path.join(os.homedir(), ".self-agent", "tasks.json");
      let list = [];
      try {
        list = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        list = [];
      }
      if (!Array.isArray(list)) list = [];
      const save = () => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
      };

      if (action === "list") {
        if (!list.length) return { text: "（无任务）" };
        return {
          text: list
            .map((x) => `- [${x.status}] ${x.id} ${x.title}${x.note ? `（${x.note}）` : ""}`)
            .join("\n"),
        };
      }
      if (action === "create") {
        if (!title) return { isError: true, text: "create 需要 title" };
        const tid = `t${Date.now().toString(36)}`;
        list.push({ id: tid, title, status: "pending", note: note ?? "", createdAt: new Date().toISOString() });
        save();
        return { text: `已创建任务 ${tid}：${title}` };
      }
      const found = list.find((x) => x.id === id);
      if (!found) return { isError: true, text: `未找到任务：${id}` };
      if (action === "update") {
        if (status) found.status = status;
        if (note !== undefined) found.note = note;
        save();
        return { text: `已更新 ${id}（status=${found.status}）` };
      }
      if (action === "complete") {
        found.status = "completed";
        save();
        return { text: `已完成 ${id}：${found.title}` };
      }
      if (action === "delete") {
        list = list.filter((x) => x.id !== id);
        save();
        return { text: `已删除 ${id}` };
      }
      return { isError: true, text: `不支持的操作：${action}` };
    },
  },
  {
    name: "team",
    description:
      "团队模式：定义/列出/移除团队成员（名称 + 角色 + 专长）。配合 subagent 可按成员专长派发任务。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "remove"] },
        name: { type: "string", description: "成员名（唯一）" },
        role: { type: "string", description: "角色（如 架构师 / 执行者 / 审查者）" },
        description: { type: "string", description: "专长描述" },
      },
      required: ["action"],
    },
    isReadOnly: false,
    async execute({ action, name, role, description }) {
      const file = process.env.SELF_AGENT_TEAM ?? path.join(os.homedir(), ".self-agent", "team.json");
      let list = [];
      try {
        list = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        list = [];
      }
      if (!Array.isArray(list)) list = [];
      const save = () => {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
      };

      if (action === "list") {
        if (!list.length) return { text: "（团队为空）" };
        return {
          text: list.map((m) => `- ${m.name}｜${m.role ?? "未指定"}｜${m.description ?? ""}`).join("\n"),
        };
      }
      if (action === "add") {
        if (!name) return { isError: true, text: "add 需要 name" };
        list = list.filter((m) => m.name !== name);
        list.push({ name, role: role ?? "", description: description ?? "", addedAt: new Date().toISOString() });
        save();
        return { text: `已添加成员「${name}」（${role ?? "未指定角色"}）` };
      }
      if (action === "remove") {
        const before = list.length;
        list = list.filter((m) => m.name !== name);
        save();
        return { text: before === list.length ? `未找到成员「${name}」` : `已移除「${name}」` };
      }
      return { isError: true, text: `不支持的操作：${action}` };
    },
  },
  {
    name: "code_outline",
    description:
      "提取文件的代码结构（函数/类/方法/导出），比通读全文更省 token。支持 JS/TS/Python/Go/Rust。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        max: { type: "number", description: "最多显示符号数（默认 100）" },
      },
      required: ["path"],
    },
    isReadOnly: true,
    async execute({ path: p, max = 100 }, ctx = {}) {
      const full = path.resolve(ctx.cwd ?? process.cwd(), p);
      if (!existsSync(full)) return { isError: true, text: `文件不存在：${p}` };
      try {
        const content = readFileSync(full, "utf8");
        const { extractSymbols, renderOutline } = await import("./code-outline.mjs");
        const symbols = extractSymbols(content, full);
        return {
          text: `${p}（${symbols.length} 个符号 / ${content.split("\n").length} 行）\n${renderOutline(symbols, { max })}`,
        };
      } catch (e) {
        return { isError: true, text: `提取失败：${e.message}` };
      }
    },
  },
  {
    name: "mcp",
    description:
      "调用 MCP（Model Context Protocol）server：list_servers 列出已配置 server / list_tools 列出某 server 工具 / call 调用工具。配置：~/.self-agent/mcp.json。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_servers", "list_tools", "call"] },
        server: { type: "string", description: "server 名（list_tools/call 用）" },
        tool: { type: "string", description: "工具名（call 用）" },
        args: { type: "object", description: "工具参数（call 用）" },
      },
      required: ["action"],
    },
    isReadOnly: false,
    async execute({ action, server, tool, args }) {
      const { loadMcpConfig, getClient } = await import("./mcp.mjs");
      const { file, servers } = loadMcpConfig();
      if (action === "list_servers") {
        const names = Object.keys(servers);
        return {
          text: names.length
            ? names.map((n) => `- ${n}: ${servers[n].command} ${(servers[n].args ?? []).join(" ")}`).join("\n")
            : `（未配置 MCP server；配置文件：${file}）`,
        };
      }
      if (!server) return { isError: true, text: `${action} 需要 server 参数` };
      const conf = servers[server];
      if (!conf) return { isError: true, text: `未配置 server：${server}` };
      try {
        const client = await getClient(server, conf);
        if (action === "list_tools") {
          const list = await client.listTools();
          return {
            text: list.length
              ? list.map((x) => `- ${x.name}: ${String(x.description ?? "").slice(0, 90)}`).join("\n")
              : "（该 server 无工具）",
          };
        }
        if (action === "call") {
          if (!tool) return { isError: true, text: "call 需要 tool 参数" };
          const r = await client.callTool(tool, args ?? {});
          return { isError: r.isError, text: r.text };
        }
        return { isError: true, text: `不支持的操作：${action}` };
      } catch (e) {
        return { isError: true, text: `MCP 调用失败：${e.message}` };
      }
    },
  },
  {
    name: "lark_send",
    description:
      "通过飞书 bot 发送文本消息（默认发给用户私聊，可用 chat_id 指定群）。适合把长任务的结果推送给用户。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "消息内容（Markdown）" },
        chat_id: { type: "string", description: "可选：目标会话 ID（oc_xxx），默认用户私聊" },
      },
      required: ["text"],
    },
    isReadOnly: false,
    async execute({ text, chat_id }) {
      const target = chat_id ?? process.env.SELF_AGENT_CHAT_ID;
      if (!target) {
        return { isError: true, text: "未配置飞书会话：请设置环境变量 SELF_AGENT_CHAT_ID 或传 chat_id 参数" };
      }
      try {
        const out = execFileSync(
          "/usr/bin/lark-cli",
          ["im", "+messages-send", "--chat-id", target, "--text", String(text).slice(0, 8000), "--as", "bot"],
          { env: { ...process.env, HOME: "/root" }, encoding: "utf8", timeout: 30_000 }
        );
        return { text: `已发送到 ${target}\n${String(out).slice(0, 200)}` };
      } catch (e) {
        return { isError: true, text: `发送失败：${e.message}` };
      }
    },
  },
];

/** 转成 OpenAI 兼容的 tools 定义 */
export function toOpenAITools(defs = toolDefs) {
  return defs.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** 按名字执行工具 */
export async function runTool(name, args, ctx) {
  const def = toolDefs.find((t) => t.name === name);
  if (!def) return { isError: true, text: `未知工具：${name}` };
  try {
    return await def.execute(args ?? {}, ctx);
  } catch (e) {
    return { isError: true, text: `工具异常：${e.message}` };
  }
}

/**
 * 工具调用是否并发安全（只读工具可并行；写工具必须串行）。
 * - 工具级：isReadOnly === true 直接放行
 * - bash：命令级判定（移植 Claude Code readOnlyCommandValidation），只有只读命令才可并行
 * 兼容旧签名：传字符串（工具名）时按工具级判定。
 */
export function isConcurrencySafe(tc) {
  const name = typeof tc === "string" ? tc : tc?.function?.name;
  const def = toolDefs.find((t) => t.name === name);
  if (!def) return false;
  if (def.isReadOnly === true) return true;

  if (name === "bash") {
    try {
      const raw = tc?.function?.arguments;
      const args = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (args && typeof args.command === "string") return isReadOnlyCommand(args.command);
    } catch {
      /* 解析失败 → 视为不安全 */
    }
  }
  return false;
}

/**
 * 把工具调用分批（移植 Claude Code toolOrchestration 的 partitionToolCalls）：
 *   连续的只读调用合并为一个并行批；写调用独占一批（顺序屏障）。
 * @returns {Array<{parallel:boolean, calls:Array}>}
 */
export function partitionToolCalls(calls = [], isSafe = isConcurrencySafe) {
  const batches = [];
  let parallel = [];
  for (const tc of calls) {
    if (isSafe(tc)) {
      parallel.push(tc);
    } else {
      if (parallel.length) {
        batches.push({ parallel: true, calls: parallel });
        parallel = [];
      }
      batches.push({ parallel: false, calls: [tc] });
    }
  }
  if (parallel.length) batches.push({ parallel: true, calls: parallel });
  return batches;
}

/** 核心工具：始终提供（日常编码刚需） */
export const CORE_TOOLS = [
  "bash", "read_file", "write_file", "edit_file", "glob", "grep", "apply_patch",
  "subagent", "todo_write", "skill", "env_info", "tool_search", "check_binary",
  "code_outline", "run_tests", "diff", "git",
];

/** 任务关键词 → 附加工具（借鉴 Claude Code ToolSearch 的按需发现思路） */
const TOOL_RULES = [
  { re: /网页|抓取|爬|http|接口|api|搜索|下载/i, tools: ["web_fetch", "http_request"] },
  { re: /记忆|之前|上次|历史|偏好/i, tools: ["memory"] },
  { re: /计划|方案|设计|规划|评审/i, tools: ["plan_mode"] },
  { re: /确认|问我|选择|决定|要不要/i, tools: ["ask_user"] },
  { re: /飞书|通知|发消息|推送/i, tools: ["lark_send"] },
  { re: /notebook|jupyter|ipynb|单元格/i, tools: ["notebook_edit"] },
  { re: /定时|每天|每周|cron|周期|提醒/i, tools: ["schedule"] },
  { re: /配置|config|设置/i, tools: ["config"] },
  { re: /等待|轮询|sleep|稍等/i, tools: ["sleep"] },
  { re: /待办|任务清单|task/i, tools: ["task"] },
  { re: /团队|成员|分工/i, tools: ["team"] },
  { re: /mcp|协议|外部工具/i, tools: ["mcp"] },
];

/**
 * 按任务挑选工具集：核心工具 + 关键词命中的附加工具。
 * 目的：减少每步 schema 的 token 开销（30 个全量约占 3300 tokens/步）。
 * @param {string} task 任务描述
 * @param {{extra?:string[]}} [opts]
 * @returns {Array} 工具定义数组
 */
export function selectToolsForTask(task = "", { extra = [] } = {}) {
  const text = String(task ?? "");
  const selected = new Set(CORE_TOOLS);
  for (const r of TOOL_RULES) {
    if (r.re.test(text)) for (const t of r.tools) selected.add(t);
  }
  for (const t of extra) selected.add(t);
  const defs = toolDefs.filter((t) => selected.has(t.name));
  // 兜底：至少给核心工具
  return defs.length ? defs : toolDefs;
}
