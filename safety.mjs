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
 * 检查 bash 命令。
 * @returns {{allow: boolean, reason?: string, level?: string}}
 */
export function checkCommand(command) {
  const cmd = stripHeredocs(String(command ?? ""));
  const pathCheck = checkCommandPaths(cmd);
  if (pathCheck.dangerous) {
    return {
      allow: false,
      level: "deny",
      reason: `路径安全：${pathCheck.hits.map((h) => `${h.path}（${h.reason}）`).join("；")}`,
    };
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
