/**
 * permission-audit.mjs — 权限决策分类与审计
 *
 * 移植自 Claude Code `utils/permissions/yoloClassifier.ts`（1495 行）的设计思路：
 * 源码用 LLM 判定「这个动作是否需要人工确认」（`classifyYoloAction`），并配套
 * `formatActionForClassifier` 把动作转成可判定的文本、记录决策与理由。
 *
 * 我们做**规则版**：复用已有安全层（execpolicy 正则 + 路径安全 + 只读命令判定），
 * 输出统一的三态决策 `allow | ask | deny` + 可解释理由，并累计审计统计。
 *
 * 用途：
 * - 给每个工具调用一个可解释的风险等级（日志 / 审计 / 排查误拦）
 * - 发现「总是 ask」的噪声，反过来指导安全策略收敛
 * - `classifyAction` 的返回结构可直接喂给未来的 LLM 兜底判定
 */
import { checkCommand, checkWritePath } from "./safety.mjs";
import { isReadOnlyCommand } from "./readonly-commands.mjs";
import path from "node:path";

export const DECISION = { ALLOW: "allow", ASK: "ask", DENY: "deny" };

/** 写类工具 */
const WRITE_TOOLS = new Set(["write_file", "edit_file", "apply_patch", "notebook_edit"]);

/** 只读工具（工具级 isReadOnly 的兜底名单） */
const READONLY_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  "web_fetch",
  "skill",
  "memory",
  "code_outline",
  "env_info",
  "diff",
  "tool_search",
  "check_binary",
  "file_history",
]);

/** 把动作转成一行可读文本（对齐 formatActionForClassifier） */
export function formatAction(toolName, args = {}) {
  switch (toolName) {
    case "bash":
      return `bash: ${String(args.command ?? "").slice(0, 200)}`;
    case "write_file":
      return `write_file: ${args.path ?? "?"}（${String(args.content ?? "").length} 字符）`;
    case "edit_file":
      return `edit_file: ${args.path ?? "?"}`;
    case "apply_patch":
      return `apply_patch: ${Array.isArray(args.edits) ? args.edits.length : 0} 处编辑`;
    default:
      return `${toolName}: ${JSON.stringify(args ?? {}).slice(0, 160)}`;
  }
}

/**
 * 分类单个动作。
 * @returns {{decision:'allow'|'ask'|'deny', reason:string, source:string, action:string}}
 */
export function classifyAction(toolName, args = {}, ctx = {}) {
  const cwd = ctx.cwd ?? process.cwd();
  const action = formatAction(toolName, args);

  if (toolName === "bash") {
    const cmd = String(args.command ?? "");
    const check = checkCommand(cmd, { cwd });
    if (!check.allow) {
      return { decision: DECISION.DENY, reason: check.reason, source: "execpolicy", action };
    }
    if (isReadOnlyCommand(cmd)) {
      return { decision: DECISION.ALLOW, reason: "只读命令（命令配置表判定）", source: "readonly", action };
    }
    return { decision: DECISION.ASK, reason: "可能改变系统状态", source: "bash", action };
  }

  if (WRITE_TOOLS.has(toolName)) {
    const targets =
      toolName === "apply_patch"
        ? (Array.isArray(args.edits) ? args.edits : []).map((e) => e?.path).filter(Boolean)
        : [args.path].filter(Boolean);

    if (!targets.length) {
      return { decision: DECISION.ASK, reason: "写操作但未提供目标路径", source: "path", action };
    }
    for (const p of targets) {
      const abs = path.resolve(cwd, p);
      const check = checkWritePath(abs);
      if (!check.allow) {
        return { decision: DECISION.DENY, reason: `${check.reason}（${abs}）`, source: "path-safety", action };
      }
    }
    return { decision: DECISION.ALLOW, reason: "写入工作区内的普通路径", source: "path", action };
  }

  if (READONLY_TOOLS.has(toolName)) {
    return { decision: DECISION.ALLOW, reason: "只读工具", source: "tool", action };
  }

  return { decision: DECISION.ASK, reason: "未分类工具，保守起见需确认", source: "unknown", action };
}

/**
 * 审计日志：累计决策分布，便于发现误拦与噪声。
 */
export function createAuditLog({ limit = 200 } = {}) {
  const entries = [];
  const counts = { allow: 0, ask: 0, deny: 0 };

  return {
    /** 分类并记录，返回分类结果 */
    record(toolName, args, ctx) {
      const result = classifyAction(toolName, args, ctx);
      counts[result.decision] = (counts[result.decision] ?? 0) + 1;
      entries.push({ at: Date.now(), tool: toolName, ...result });
      if (entries.length > limit) entries.shift();
      return result;
    },
    summary() {
      const total = counts.allow + counts.ask + counts.deny;
      return {
        total,
        counts: { ...counts },
        askRatio: total ? Number((counts.ask / total).toFixed(3)) : 0,
        denyRatio: total ? Number((counts.deny / total).toFixed(3)) : 0,
      };
    },
    entries() {
      return [...entries];
    },
    reset() {
      entries.length = 0;
      counts.allow = counts.ask = counts.deny = 0;
    },
  };
}
