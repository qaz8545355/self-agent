/**
 * file-history.mjs — 文件改动历史与回滚
 *
 * 移植自 Claude Code `utils/fileHistory.ts`：
 * - **写之前先备份**（fileHistoryTrackEdit）：每次改动生成一个版本，备份的是「改动前的内容」
 * - 版本记录里 `existed=false` 表示当时文件不存在（回滚 = 删除该文件）
 * - 支持列出历史 / 回滚到某版本 / 与当前对比
 *
 * 与源码的差异：
 * - 源码按 messageId 做快照分组、支持 transcript 恢复；我们只做「按文件 + 版本号」的简化版
 * - 存储用 `~/.self-agent/file-history/<sha1(file)>/vN`，可用 SELF_AGENT_FILE_HISTORY 覆盖
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_ROOT =
  process.env.SELF_AGENT_FILE_HISTORY ?? path.join(os.homedir(), ".self-agent", "file-history");

/** 每个文件最多保留的版本数（超出后裁剪最旧的） */
const MAX_VERSIONS = 50;

function keyFor(absPath) {
  return createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

function dirFor(absPath, root) {
  return path.join(root, keyFor(absPath));
}

function metaPath(absPath, root) {
  return path.join(dirFor(absPath, root), "meta.json");
}

function loadMeta(absPath, root) {
  const p = metaPath(absPath, root);
  if (!existsSync(p)) return { file: absPath, versions: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(parsed.versions)) return { file: absPath, versions: [] };
    return parsed;
  } catch {
    return { file: absPath, versions: [] };
  }
}

function saveMeta(absPath, root, meta) {
  mkdirSync(dirFor(absPath, root), { recursive: true });
  writeFileSync(metaPath(absPath, root), JSON.stringify(meta, null, 2));
}

/**
 * 在写入前记录一次版本（备份「当前内容」）。
 * @returns {{version:number, existed:boolean, backupFile:string|null}}
 */
export function trackEdit(filePath, options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const abs = path.resolve(filePath);

  // 非普通文件（目录、设备等）不记录版本
  const stat = existsSync(abs) ? statSync(abs) : null;
  if (stat && !stat.isFile()) {
    return { version: 0, existed: false, backupFile: null, skipped: true };
  }

  const meta = loadMeta(abs, root);

  const nextVersion = (meta.versions.at(-1)?.version ?? 0) + 1;
  const existed = existsSync(abs);
  const dir = dirFor(abs, root);
  mkdirSync(dir, { recursive: true });

  let backupFile = null;
  if (existed) {
    backupFile = `v${nextVersion}`;
    writeFileSync(path.join(dir, backupFile), readFileSync(abs));
  }

  meta.file = abs;
  meta.versions.push({
    version: nextVersion,
    backupFile,
    existed,
    size: existed ? statSync(abs).size : 0,
    time: new Date().toISOString(),
  });

  // 裁剪最旧版本（连同备份文件）
  while (meta.versions.length > MAX_VERSIONS) {
    const dropped = meta.versions.shift();
    if (dropped.backupFile) {
      try {
        rmSync(path.join(dir, dropped.backupFile), { force: true });
      } catch {
        /* 忽略 */
      }
    }
  }

  saveMeta(abs, root, meta);
  return { version: nextVersion, existed, backupFile };
}

/** 列出某文件的历史版本（从旧到新） */
export function listVersions(filePath, options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const abs = path.resolve(filePath);
  return loadMeta(abs, root).versions.map((v) => ({ ...v }));
}

/**
 * 回滚到指定版本。
 * 该版本 `existed=false` 时表示当时文件不存在 → 回滚即删除文件。
 */
export function rewind(filePath, version, options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const abs = path.resolve(filePath);
  const meta = loadMeta(abs, root);
  const rec = meta.versions.find((v) => v.version === Number(version));

  if (!rec) return { ok: false, error: `版本 ${version} 不存在` };

  if (!rec.existed) {
    if (existsSync(abs)) rmSync(abs, { force: true });
    return { ok: true, detail: `已删除 ${abs}（v${version} 时该文件不存在）` };
  }

  const backup = path.join(dirFor(abs, root), rec.backupFile);
  if (!existsSync(backup)) return { ok: false, error: `备份文件丢失：${rec.backupFile}` };

  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, readFileSync(backup));
  return { ok: true, detail: `已回滚到 v${version}（备份时间 ${rec.time}）` };
}

/** 某版本备份与当前文件的行数差异 */
export function diffStats(filePath, version, options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  const abs = path.resolve(filePath);
  const meta = loadMeta(abs, root);
  const rec = meta.versions.find((v) => v.version === Number(version));
  if (!rec) return { ok: false, error: `版本 ${version} 不存在` };

  const countLines = (text) => (text === null ? 0 : text.split("\n").length);
  let backupText = null;
  if (rec.existed) {
    const backup = path.join(dirFor(abs, root), rec.backupFile);
    backupText = existsSync(backup) ? readFileSync(backup, "utf8") : null;
  }
  const currentText = existsSync(abs) ? readFileSync(abs, "utf8") : null;

  return {
    ok: true,
    version: Number(version),
    backupLines: countLines(backupText),
    currentLines: countLines(currentText),
    changed: backupText !== currentText,
  };
}

/** 清理某文件（或全部）的历史 */
export function clearHistory(filePath, options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  if (filePath) {
    const abs = path.resolve(filePath);
    rmSync(dirFor(abs, root), { recursive: true, force: true });
    return { ok: true, detail: `已清理 ${abs} 的历史` };
  }
  rmSync(root, { recursive: true, force: true });
  return { ok: true, detail: `已清理全部文件历史（${root}）` };
}

/** 历史根目录（供工具展示） */
export function historyRoot() {
  return DEFAULT_ROOT;
}

/** 已记录历史的文件数 */
export function historyFileCount(options = {}) {
  const root = options.root ?? DEFAULT_ROOT;
  if (!existsSync(root)) return 0;
  return readdirSync(root).filter((d) => existsSync(path.join(root, d, "meta.json"))).length;
}
