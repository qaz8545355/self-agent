/**
 * session.mjs — 会话持久化（JSON 落盘，支持 resume）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = process.env.SELF_AGENT_SESSION_DIR ?? path.join(os.homedir(), ".self-agent", "sessions");

export function saveSession(id, messages, meta = {}) {
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.json`);
  writeFileSync(file, JSON.stringify({ id, updatedAt: new Date().toISOString(), meta, messages }, null, 2), "utf8");
  return file;
}

export function loadSession(id) {
  const file = path.join(DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function listSessions() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const d = JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
        return { id: d.id, updatedAt: d.updatedAt, messages: d.messages?.length ?? 0 };
      } catch {
        return { id: f.replace(/\.json$/, ""), updatedAt: null, messages: 0 };
      }
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function newSessionId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `sa-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 清理旧会话（移植 Claude Code 后台清理思路）：
 * 保留最近 keep 个，且删除超过 maxAgeDays 的。
 * @returns {{deleted:number, kept:number}}
 */
export function pruneSessions({ keep = 50, maxAgeDays = 30, dir = DIR } = {}) {
  if (!existsSync(dir)) return { deleted: 0, kept: 0 };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const entries = [];
  for (const f of files) {
    const full = path.join(dir, f);
    let updatedAt = 0;
    try {
      const d = JSON.parse(readFileSync(full, "utf8"));
      updatedAt = Date.parse(d.updatedAt ?? "") || statSync(full).mtimeMs;
    } catch {
      try {
        updatedAt = statSync(full).mtimeMs;
      } catch {
        continue;
      }
    }
    entries.push({ full, updatedAt });
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let deleted = 0;
  entries.forEach((e, i) => {
    if (i >= keep || e.updatedAt < cutoff) {
      try {
        rmSync(e.full, { force: true });
        deleted += 1;
      } catch {
        /* 忽略单个删除失败 */
      }
    }
  });
  return { deleted, kept: entries.length - deleted };
}
