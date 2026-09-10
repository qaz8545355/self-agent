/**
 * safety.mjs — self-agent 安全层
 * 内置 path-safety 的路径校验，并叠加命令策略匹配（execpolicy.json，可用 SELF_AGENT_POLICY 覆盖）。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import os from "node:os";
import { isDangerousRemovalPath, checkCommandPaths } from "./path-safety.mjs";

const POLICY = process.env.SELF_AGENT_POLICY ?? path.join(path.dirname(new URL(import.meta.url).pathname), "execpolicy.json");
let rules = [];
try {
  if (existsSync(POLICY)) {
    const doc = parse(readFileSync(POLICY, "utf8"));
    rules = (doc?.rules ?? []).map((r) => ({ ...r, re: new RegExp(r.pattern) }));
  }
} catch (e) {
  console.error(`safety: 策略加载失败（降级为路径校验）: ${e.message}`);
}

/** 剥离 heredoc 正文，避免文档内容里的敏感词误判 */
function stripHeredocs(cmd) {
  if (/\b(bash|sh|zsh|dash)\s+<<-?\s*['"]?[A-Za-z_]/.test(cmd)) return cmd;
  return cmd.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?\n\s*\2\b/g, " ");
}

/**
 * 提取命令里的重定向目标路径（`>`、`>>`、`2>`、`&>` 等），跳过 /dev/null 与 fd 复制。
 * 动机：`echo x > /etc/passwd` 这类命令本身不匹配危险策略，但**目标路径**是危险的。
 */
export function extractRedirectTargets(command) {
  const out = [];
  const src = stripHeredocs(String(command ?? ""));
  const re = /(?:\d?&?>>?|&>)\s*("[^"]*"|'[^']*'|[^\s;&|<>]+)/g;
  for (const m of src.matchAll(re)) {
    let target = m[1] ?? "";
    if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
      target = target.slice(1, -1);
    }
    if (!target) continue;
    if (target === "/dev/null" || target === "/dev/stderr" || target === "/dev/stdout") continue;
    if (/^&\d+$/.test(target)) continue; // fd 复制，如 2>&1
    out.push(target);
  }
  return out;
}

/**
 * 检查 bash 命令。
 * @param {string} command
 * @param {{cwd?:string}} [options] cwd 用于解析重定向目标的相对路径
 * @returns {{allow: boolean, reason?: string, level?: string}}
 */
export function checkCommand(command, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const cmd = stripHeredocs(String(command ?? ""));
  const pathCheck = checkCommandPaths(cmd);
  if (pathCheck.dangerous) {
    return {
      allow: false,
      level: "deny",
      reason: `路径安全：${pathCheck.hits.map((h) => `${h.path}（${h.reason}）`).join("；")}`,
    };
  }
  // 重定向目标：写入系统目录同样拦截
  for (const target of extractRedirectTargets(cmd)) {
    const abs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
    const w = checkWritePath(abs);
    if (!w.allow) {
      return { allow: false, level: "deny", reason: `重定向目标不可写：${w.reason}（${abs}）` };
    }
  }
  for (const rule of rules) {
    if (!rule.re.test(cmd)) continue;
    return {
      allow: false,
      level: rule.level,
      reason: `${rule.reason}（规则 ${rule.id}）`,
    };
  }
  return { allow: true };
}

/** 系统目录前缀：这些目录下的任何文件都禁止写入 */
const SYSTEM_WRITE_PREFIXES = [
  "/etc/", "/usr/", "/bin/", "/sbin/", "/boot/", "/lib/", "/lib64/",
  "/sys/", "/proc/", "/dev/", "/var/lib/", "/opt/",
];

/**
 * 检查文件写入路径。
 * @returns {{allow: boolean, reason?: string}}
 */
export function checkWritePath(p) {
  const r = isDangerousRemovalPath(p);
  if (r.dangerous) return { allow: false, reason: `路径安全：${r.reason}` };
  const norm = path.posix.normalize(String(p));
  for (const pre of SYSTEM_WRITE_PREFIXES) {
    if (norm.startsWith(pre)) return { allow: false, reason: `系统目录不可写：${pre}` };
  }
  return { allow: true };
}
