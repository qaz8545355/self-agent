/**
 * binary-check.mjs — 外部命令依赖检测（移植 Claude Code utils/binaryCheck.ts）
 *
 * 用途：agent 在依赖外部命令（rg、jq、ffmpeg 等）前，先确认它存在，
 * 避免"假设命令存在"导致失败（我们在实战中踩过 rg 的坑）。
 * 结果带缓存，避免重复探测。
 */
import { execFileSync } from "node:child_process";

const cache = new Map();

/**
 * 检测命令是否可用（Unix 用 which，Windows 用 where），结果缓存。
 * @param {string} command 命令名（可带参数，只取第一段）
 * @returns {boolean}
 */
export function isBinaryInstalled(command, { useCache = true } = {}) {
  const cmd = String(command ?? "").trim().split(/\s+/)[0];
  if (!cmd) return false;
  if (useCache && cache.has(cmd)) return cache.get(cmd);

  const probe = process.platform === "win32" ? "where" : "which";
  let found = false;
  try {
    execFileSync(probe, [cmd], { stdio: "ignore", timeout: 3000 });
    found = true;
  } catch {
    found = false;
  }
  cache.set(cmd, found);
  return found;
}

/** 清空缓存（测试或环境变化后使用） */
export function clearBinaryCache() {
  cache.clear();
}

/** 返回其中已安装的命令 */
export function availableBinaries(list = []) {
  return list.filter((c) => isBinaryInstalled(c));
}

/** 返回其中缺失的命令 */
export function missingBinaries(list = []) {
  return list.filter((c) => !isBinaryInstalled(c));
}

/** 常见命令的探测清单（供 agent 快速了解环境） */
export const COMMON_BINARIES = ["git", "rg", "jq", "curl", "python3", "node", "docker", "ffmpeg"];
