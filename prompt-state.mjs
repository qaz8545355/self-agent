/**
 * prompt-state.mjs — prompt 状态快照与变化诊断
 *
 * 移植自 Claude Code `services/api/promptCacheBreakDetection.ts`（727 行）。
 *
 * 源码的动机：prompt 缓存（prompt caching）只有在**前缀完全不变**时才命中；
 * 一旦 system prompt、工具集合或某个工具的 schema 发生变化，缓存就整体失效，成本陡增。
 * 源码在每次请求前记录状态快照（systemHash / toolsHash / perToolHashes / model / betas），
 * 下次请求时对比，定位「是哪一部分变了」。
 *
 * 我们做的是同一件事的最小可用版：记录快照 + 报告变化原因。
 * 差异：源码还会落盘 diff 文件、上报遥测、区分 cache_control TTL；
 * 我们只保留「变化诊断」，用于观测上下文抖动与成本异常。
 */

/** djb2 字符串哈希（对齐源码用的 djb2Hash） */
export function hashString(text) {
  let h = 5381;
  const s = String(text ?? "");
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * 生成一次 prompt 快照。
 * @param {{system?:string, tools?:Array<{name:string,parameters?:object}>, messages?:Array, model?:string}} input
 */
export function snapshotPrompt({ system = "", tools = [], messages = [], model = "" } = {}) {
  const perToolHashes = {};
  for (const t of tools) {
    perToolHashes[t.name] = hashString(JSON.stringify(t.parameters ?? {}));
  }
  return {
    systemHash: hashString(system),
    toolsHash: hashString([...tools.map((t) => t.name)].sort().join(",")),
    perToolHashes,
    toolNames: tools.map((t) => t.name),
    messageCount: messages.length,
    model,
    at: Date.now(),
  };
}

/**
 * 对比两次快照，返回变化原因。
 * @returns {{changed:boolean, reasons:string[]}}
 */
export function diffPromptState(prev, next) {
  if (!prev) return { changed: true, reasons: ["首次快照"] };
  const reasons = [];

  if (prev.systemHash !== next.systemHash) reasons.push("system prompt 变化（记忆/技能清单等注入内容变动）");
  if (prev.toolsHash !== next.toolsHash) {
    const added = next.toolNames.filter((n) => !prev.toolNames.includes(n));
    const removed = prev.toolNames.filter((n) => !next.toolNames.includes(n));
    const detail = [
      added.length ? `新增 ${added.join(",")}` : "",
      removed.length ? `移除 ${removed.join(",")}` : "",
    ]
      .filter(Boolean)
      .join("；");
    reasons.push(`工具集合变化${detail ? `（${detail}）` : ""}`);
  }
  if (prev.model !== next.model) reasons.push(`模型变化（${prev.model || "默认"} → ${next.model || "默认"}）`);

  for (const [name, hash] of Object.entries(next.perToolHashes ?? {})) {
    const before = prev.perToolHashes?.[name];
    if (before !== undefined && before !== hash) reasons.push(`工具 ${name} 的 schema 变化`);
  }

  return { changed: reasons.length > 0, reasons };
}

/**
 * 便捷包装：维护"上一次快照"，每次调用返回变化诊断。
 */
export function createPromptStateTracker() {
  let last = null;
  return {
    observe(input) {
      const snap = snapshotPrompt(input);
      const diff = diffPromptState(last, snap);
      last = snap;
      return { snapshot: snap, ...diff };
    },
    get last() {
      return last;
    },
    reset() {
      last = null;
    },
  };
}
