/**
 * memory-age.mjs — 记忆时效性标注（移植 Claude Code memdir/memoryAge.ts 的设计）
 *
 * 核心洞察（源码注释原文）：
 *   "Models are poor at date arithmetic — a raw ISO timestamp doesn't trigger
 *    staleness reasoning the way '47 days ago' does."
 *
 * 因此：把记忆年龄渲染成人类可读文字，并对较旧记忆附加「可能过时」提示，
 * 避免带引用的旧记忆因为显得权威而误导模型。
 */

const DAY_MS = 86_400_000;

/** 记忆年龄（天） */
export function memoryAgeDays(mtimeMs) {
  if (!Number.isFinite(mtimeMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / DAY_MS));
}

/** 人类可读年龄（中文） */
export function memoryAge(mtimeMs) {
  const d = memoryAgeDays(mtimeMs);
  if (d === 0) return "今天";
  if (d === 1) return "昨天";
  if (d < 30) return `${d} 天前`;
  if (d < 365) return `约 ${Math.floor(d / 30)} 个月前`;
  return `约 ${Math.floor(d / 365)} 年前`;
}

/**
 * 过时提示：仅对超过 1 天的记忆返回非空文本。
 * 阈值设计参照原实现（>1 天即提示）。
 */
export function memoryFreshnessText(mtimeMs) {
  const d = memoryAgeDays(mtimeMs);
  if (d <= 1) return "";
  return `这条记忆是 ${d} 天前的，可能已过时——依赖它之前请先核对当前状态。`;
}

/** 把内容包装成带时效标注的记忆块 */
export function annotateMemory(content, mtimeMs) {
  const age = memoryAge(mtimeMs);
  const stale = memoryFreshnessText(mtimeMs);
  const head = stale ? `[记忆 · ${age} · ⚠️ ${stale}]` : `[记忆 · ${age}]`;
  return `${head}\n${String(content ?? "").trim()}`;
}

/** 批量标注（用于注入多段记忆） */
export function annotateMemories(items = []) {
  return items
    .filter((it) => it && typeof it.content === "string")
    .map((it) => annotateMemory(it.content, it.mtimeMs ?? Date.now()))
    .join("\n\n");
}
