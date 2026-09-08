/**
 * tools.mjs — 工具注册表（契约式声明，借鉴 Claude Code 的「工具即契约」）
 *
 * 每个工具：{ name, description, parameters, isReadOnly, execute(args, ctx) }
 * execute 返回 { text, isError? }
 */
import "./env.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { checkCommand, checkWritePath } from "./safety.mjs";

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
        max_steps: { type: "number", description: "可选：子代理最大步数（默认 12）" },
      },
      required: ["task"],
    },
    isReadOnly: false,
    async execute({ task, model, max_steps }, ctx = {}) {
      if ((ctx.depth ?? 0) > 0) {
        return { isError: true, text: "递归防护：子代理不能再启动子代理" };
      }
      const { runAgent } = await import("./agent.mjs");
      try {
        const r = await runAgent({
          task,
          cwd: ctx.cwd,
          model: model ?? ctx.model,
          maxSteps: max_steps ?? 12,
          depth: (ctx.depth ?? 0) + 1,
          onEvent: () => {},
        });
        return {
          text: `[子代理完成 steps=${r.steps} tokens≈${r.totalTokens} done=${r.done}]\n${r.content}`,
        };
      } catch (e) {
        return { isError: true, text: `子代理失败：${e.message}` };
      }
    },
  },
  {
    name: "skill",
    description:
      "技能加载：不传 name 时列出所有可用技能；传 name 时返回该技能的 SKILL.md 完整内容（按其中步骤执行）。",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "技能名（省略则列出全部）" } },
    },
    isReadOnly: true,
    async execute({ name }) {
      const { listSkills, loadSkill } = await import("./skills.mjs");
      if (!name) {
        const all = listSkills();
        return { text: all.map((s) => `- ${s.name}: ${s.description.slice(0, 120)}`).join("\n") || "(无技能)" };
      }
      const s = loadSkill(name);
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
