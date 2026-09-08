/**
 * path-safety.mjs — 危险路径与命令校验（移植自 Claude Code 的 pathValidation 设计）
 *
 * 用途：在 bash 执行前做代码级校验，弥补纯正则的不足：
 *   1. 危险删除路径（/、/*、家目录、系统目录、盘符根）
 *   2. 未展开/可疑路径（UNC、~user 变体、shell 展开符）
 *   3. 危险删除命令识别（rm -rf、find -delete 等）
 *
 * 设计原则：只做「更严」的拦截，不放松现有策略；纯函数，便于测试。
 */

import { homedir } from "node:os";
import path from "node:path";

/** 系统关键目录（删除即灾难） */
const SYSTEM_DIRS = [
  "/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc",
  "/root", "/sbin", "/sys", "/usr", "/var", "/home", "/opt", "/srv",
];

/** 家目录下的关键子目录（删除会丢配置/凭据） */
const HOME_CRITICAL = [".ssh", ".dsh", ".config", ".gnupg", ".aws", ".kube"];

/**
 * 判断路径是否属于「危险删除路径」。
 * @param {string} p 原始路径字符串（可能未展开）
 * @returns {{dangerous: boolean, reason?: string}}
 */
export function isDangerousRemovalPath(p) {
  if (typeof p !== "string") return { dangerous: false };
  const raw = p.trim();
  if (!raw) return { dangerous: false };

  // 1) UNC 路径（Windows 网络共享，删除行为不可控）
  if (/^\\\\/.test(raw) || /^\/\/[^/]/.test(raw)) {
    return { dangerous: true, reason: "UNC/网络共享路径" };
  }

  // 2) 家目录本身（~）或未展开的 ~user 变体（~root、~+、~-）
  if (raw === "~" || raw === "~/") {
    return { dangerous: true, reason: "用户家目录本身" };
  }
  if (/^~[^/\s]*/.test(raw)) {
    const rest = raw.slice(1).split("/")[0];
    if (rest && rest !== "") {
      return { dangerous: true, reason: `未展开的用户家目录变体（~${rest}）` };
    }
  }

  // 3) shell 展开符（$VAR、%VAR%、反引号、$(...)）——实际路径不可预知
  if (/[$%`]|\$\(/.test(raw)) {
    return { dangerous: true, reason: "含 shell 展开符，实际路径不可预知" };
  }

  // 4) 规范化后比较
  const normalized = path.posix.normalize(raw);
  const home = homedir();

  // 根目录及其直接子项
  if (normalized === "/" || normalized === "/*") {
    return { dangerous: true, reason: "根目录或其全部子项" };
  }
  // 系统目录本身
  if (SYSTEM_DIRS.includes(normalized)) {
    return { dangerous: true, reason: `系统关键目录：${normalized}` };
  }
  // 系统目录的通配删除
  for (const d of SYSTEM_DIRS) {
    if (d !== "/" && (normalized === `${d}/*` || normalized === `${d}/`)) {
      return { dangerous: true, reason: `系统目录通配删除：${d}` };
    }
  }
  // 家目录本身 / 家目录通配 / 家目录关键子目录
  if (normalized === home || normalized === `${home}/*`) {
    return { dangerous: true, reason: "用户家目录或其全部内容" };
  }
  for (const sub of HOME_CRITICAL) {
    const target = path.posix.join(home, sub);
    if (normalized === target || normalized === `${target}/*`) {
      return { dangerous: true, reason: `关键配置目录：${sub}` };
    }
  }
  return { dangerous: false };
}

/**
 * 从一条 shell 命令中提取「可能被删除的路径」，并做危险判定。
 * 覆盖 rm -rf <path>、rm -r -f <path>、find <path> -delete 等常见形态。
 * @param {string} command
 * @returns {{dangerous: boolean, hits: Array<{path: string, reason: string}>}}
 */
export function checkCommandPaths(command) {
  const hits = [];
  if (typeof command !== "string" || !command.trim()) return { dangerous: false, hits };

  // rm 的删除目标：取 rm 到下一个选项/管道之间的非选项参数
  const rmRe = /\brm\s+((?:-[a-zA-Z]+\s+)*)([^|;&><\n]+)/g;
  let m;
  while ((m = rmRe.exec(command)) !== null) {
    const flags = m[1] || "";
    const isRecursive = /r/i.test(flags) || /R/.test(flags);
    const targets = m[2].split(/\s+/).filter((t) => t && !t.startsWith("-"));
    for (const t of targets) {
      const r = isDangerousRemovalPath(t);
      if (r.dangerous) hits.push({ path: t, reason: r.reason });
    }
  }

  // find <path> ... -delete / -exec rm
  const findRe = /\bfind\s+([^\s|;&><]+)[^|;&><\n]*?(-delete|-exec\s+rm)/g;
  while ((m = findRe.exec(command)) !== null) {
    const r = isDangerousRemovalPath(m[1]);
    if (r.dangerous) hits.push({ path: m[1], reason: r.reason });
  }

  return { dangerous: hits.length > 0, hits };
}

export const __internal = { SYSTEM_DIRS, HOME_CRITICAL };
