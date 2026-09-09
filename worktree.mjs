/**
 * worktree.mjs — git worktree 隔离（移植 Claude Code 的 isolation: 'worktree' 设计）
 *
 * 用途：让子代理在独立的 git 工作副本里修改文件，避免：
 *   - 与主工作区/其他子代理并发写冲突
 *   - 未验证的改动污染主分支工作区
 *
 * 约定：只在 git 仓库内可用；每个 worktree 以 detached HEAD 创建在系统临时目录。
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 判断目录是否在 git 仓库内 */
export function isGitRepo(cwd = process.cwd()) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 创建一个隔离工作副本。
 * @param {string} baseCwd 主工作区（必须是 git 仓库）
 * @param {{name?:string}} [opts]
 * @returns {{dir:string, baseCwd:string, created:boolean, error?:string}}
 */

/**
 * 清理陈旧的临时 worktree（异常退出/超时可能残留）。
 * @returns {number} 清理数量
 */
export function cleanupStaleWorktrees(cwd = process.cwd(), { maxAgeMs = 3_600_000 } = {}) {
  const prefix = path.join(os.tmpdir(), "sa-worktree-");
  let cleaned = 0;
  for (const dir of listWorktrees(cwd)) {
    if (!dir.startsWith(prefix)) continue;
    try {
      const st = statSync(dir);
      if (Date.now() - st.mtimeMs > maxAgeMs) {
        const r = removeWorktree({ created: true, dir, baseCwd: cwd });
        if (r.removed) cleaned += 1;
      }
    } catch {
      try {
        execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore", timeout: 10_000 });
        cleaned += 1;
      } catch {
        /* 忽略 */
      }
    }
  }
  return cleaned;
}

export function createWorktree(baseCwd = process.cwd(), { name } = {}) {
  if (!isGitRepo(baseCwd)) {
    return { dir: baseCwd, baseCwd, created: false, error: "不是 git 仓库，无法创建 worktree（降级为原目录）" };
  }
  // 先清理陈旧副本（避免残留堆积）
  try {
    cleanupStaleWorktrees(baseCwd);
  } catch {
    /* 清理失败不影响创建 */
  }
  const safe = String(name ?? "agent").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 24);
  const dir = path.join(os.tmpdir(), `sa-worktree-${safe}-${process.pid}-${Date.now()}`);
  try {
    execFileSync("git", ["worktree", "add", "--detach", dir, "HEAD"], {
      cwd: baseCwd,
      stdio: "ignore",
      timeout: 30_000,
    });
    return { dir, baseCwd, created: true };
  } catch (e) {
    return { dir: baseCwd, baseCwd, created: false, error: `worktree 创建失败：${e.message}` };
  }
}

/**
 * 移除隔离工作副本。
 * @param {{dir:string, baseCwd:string}} wt
 * @param {{force?:boolean}} [opts]
 */
export function removeWorktree(wt, { force = true } = {}) {
  if (!wt?.created || !wt.dir) return { removed: false };
  if (!existsSync(wt.dir)) {
    // 目录已不在：仅确保 git 元数据清理，幂等返回
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: wt.baseCwd, stdio: "ignore", timeout: 10_000 });
    } catch {
      /* 忽略 */
    }
    return { removed: false, alreadyGone: true };
  }
  const args = ["worktree", "remove", wt.dir];
  if (force) args.push("--force");
  try {
    execFileSync("git", args, { cwd: wt.baseCwd, stdio: "ignore", timeout: 30_000 });
    return { removed: true };
  } catch {
    // 兜底：直接删目录 + prune
    try {
      rmSync(wt.dir, { recursive: true, force: true });
      execFileSync("git", ["worktree", "prune"], { cwd: wt.baseCwd, stdio: "ignore", timeout: 10_000 });
      return { removed: true, viaPrune: true };
    } catch {
      return { removed: false };
    }
  }
}

/** 列出当前仓库的 worktree 路径 */
export function listWorktrees(cwd = process.cwd()) {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    return out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length));
  } catch {
    return [];
  }
}

/** 清理遗留的临时 worktree（进程异常退出时可能残留） */
export function pruneStaleWorktrees(cwd = process.cwd()) {
  const prefix = path.join(os.tmpdir(), "sa-worktree-");
  let cleaned = 0;
  for (const dir of listWorktrees(cwd)) {
    if (dir.startsWith(prefix) && !existsSync(dir)) {
      try {
        execFileSync("git", ["worktree", "prune"], { cwd, stdio: "ignore", timeout: 10_000 });
        cleaned += 1;
      } catch {
        /* 忽略 */
      }
    }
  }
  return cleaned;
}
