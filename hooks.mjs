/**
 * hooks.mjs — 生命周期钩子（移植 Claude Code hooks 设计）
 *
 * 事件：PreToolUse / PostToolUse / UserPromptSubmit / Stop
 * 配置：项目或用户目录下的 hooks.json
 *   {
 *     "PreToolUse": [{ "matcher": "bash", "command": "..." }],
 *     "PostToolUse": [...],
 *     "UserPromptSubmit": [...],
 *     "Stop": [...]
 *   }
 *
 * 契约（与 Claude Code 一致）：
 *   - 命令通过 stdin 收到 JSON payload
 *   - 退出码 0：继续；stdout 作为附加信息注入
 *   - 退出码 2：阻止（blocked）；stdout 作为阻止原因
 *   - 其他退出码：视为 hook 失败，记录但不阻断
 */
import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { checkCommand } from "./safety.mjs";

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];

const ERROR_LOG = process.env.SELF_AGENT_HOOK_LOG ?? path.join(os.homedir(), ".self-agent", "hook-errors.log");

function logError(msg) {
  try {
    mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/**
 * 解析 hook 的 JSON 输出（优先级高于退出码）。
 * 支持：{ decision: "allow"|"block"|"deny", reason?, additionalContext? }
 */
export function parseHookOutput(stdout) {
  const t = String(stdout ?? "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const j = JSON.parse(t);
    if (j && typeof j === "object" && (j.decision || j.additionalContext || j.reason)) return j;
  } catch {
    /* 非 JSON 则退回退出码语义 */
  }
  return null;
}

/** 配置查找顺序：环境变量 → 项目 .self-agent/hooks.json → 用户目录 */
export function resolveHooksFile(cwd = process.cwd()) {
  if (process.env.SELF_AGENT_HOOKS) return process.env.SELF_AGENT_HOOKS;
  const project = path.join(cwd, ".self-agent", "hooks.json");
  if (existsSync(project)) return project;
  return path.join(os.homedir(), ".self-agent", "hooks.json");
}

export function loadHooks(file) {
  if (!file || !existsSync(file)) return { file: null, config: {} };
  try {
    const config = JSON.parse(readFileSync(file, "utf8"));
    return { file, config: config && typeof config === "object" ? config : {} };
  } catch {
    return { file, config: {}, error: "hooks.json 解析失败" };
  }
}

/** 过滤出匹配该事件（及工具名）的 hook */
export function matchHooks(config, event, toolName) {
  const list = Array.isArray(config?.[event]) ? config[event] : [];
  return list.filter((h) => {
    if (!h || typeof h.command !== "string" || !h.command.trim()) return false;
    if (!h.matcher) return true;
    if (!toolName) return false;
    try {
      return new RegExp(h.matcher).test(toolName);
    } catch {
      return false;
    }
  });
}

/**
 * 执行某个事件的所有匹配 hook。
 * @returns {{blocked: boolean, outputs: string[], errors: string[], ran: number}}
 */
export function runHooks(config, event, payload, { cwd = process.cwd(), timeout = 15_000 } = {}) {
  const hooks = matchHooks(config, event, payload?.tool_name);
  const outputs = [];
  const errors = [];
  let blocked = false;

  for (const h of hooks) {
    // 安全层：hook 命令同样要过策略检查（防止 hooks.json 被写入危险命令）
    const check = checkCommand(h.command);
    if (!check.allow) {
      const msg = `hook 被安全层拒绝（${check.reason}）：${h.command}`;
      errors.push(msg);
      logError(msg);
      continue;
    }

    let stdout = "";
    try {
      stdout = execFileSync("/bin/bash", ["-c", h.command], {
        input: JSON.stringify(payload ?? {}),
        cwd,
        encoding: "utf8",
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      }).trim();
    } catch (e) {
      stdout = String(e.stdout ?? "").trim();
      const status = e.status ?? "?";
      // JSON 输出优先于退出码
      const parsed = parseHookOutput(stdout);
      if (parsed) {
        if (parsed.decision === "block" || parsed.decision === "deny") {
          blocked = true;
          outputs.push(parsed.reason ?? `hook 阻止：${h.command}`);
        }
        if (parsed.additionalContext) outputs.push(String(parsed.additionalContext));
        continue;
      }
      if (status === 2) {
        blocked = true;
        outputs.push(stdout || `hook 阻止：${h.command}`);
      } else {
        const msg = `hook 失败(${status}): ${h.command}${stdout ? ` → ${stdout}` : ""}`;
        errors.push(msg);
        logError(msg);
      }
      continue;
    }

    // 成功退出：优先解析 JSON 输出
    const parsed = parseHookOutput(stdout);
    if (parsed) {
      if (parsed.decision === "block" || parsed.decision === "deny") {
        blocked = true;
        outputs.push(parsed.reason ?? `hook 阻止：${h.command}`);
      }
      if (parsed.additionalContext) outputs.push(String(parsed.additionalContext));
      else if (parsed.decision === "allow" && !parsed.additionalContext && !parsed.reason) {
        /* 显式放行，无注入 */
      }
      continue;
    }
    if (stdout) outputs.push(stdout);
  }
  return { blocked, outputs, errors, ran: hooks.length };
}
