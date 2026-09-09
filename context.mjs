/**
 * context.mjs — 上下文估算与压缩（移植 Claude Code 的分层思路，MVP 简化版）
 *
 * 两层策略：
 *   L1 裁剪：把「较旧的 tool 结果」替换为占位符（保留最近 N 条完整）
 *   L2 摘要：仍超阈值时，把早期对话压成一条摘要消息（保留 system + 最近 N 轮）
 *
 * 工具配对不变量：裁剪只改 tool 消息的 content，不删除消息本身。
 */
import { chat } from "./llm.mjs";

/** 粗估 token：中英混合按 2 字符/token，外加每条消息固定开销 */
export function estimateTokens(messages = []) {
  let total = 0;
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    total += Math.ceil(c.length / 2) + 4;
    if (m.tool_calls) total += Math.ceil(JSON.stringify(m.tool_calls).length / 2);
  }
  return total;
}

/** 是否达到压缩阈值 */
export function shouldCompact(messages, { contextWindow = 1_050_000, thresholdRatio = 0.65 } = {}) {
  return estimateTokens(messages) >= Math.floor(contextWindow * thresholdRatio);
}

const COMPACT_PLACEHOLDER = (n) => `[已裁剪：原 ${n} 字符的工具结果，如需可重新执行该工具]`;

/**
 * L1：裁剪旧工具结果。
 * @returns {{messages: Array, trimmed: number}}
 */
export function trimToolResults(messages, { keepRecentToolResults = 8 } = {}) {
  const idx = [];
  messages.forEach((m, i) => {
    if (m.role === "tool") idx.push(i);
  });
  const toTrim = idx.slice(0, Math.max(0, idx.length - keepRecentToolResults));
  if (toTrim.length === 0) return { messages, trimmed: 0 };
  let trimmed = 0;
  const out = messages.map((m, i) => {
    if (!toTrim.includes(i)) return m;
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    if (c.startsWith("[已裁剪")) return m;
    trimmed += 1;
    return { ...m, content: COMPACT_PLACEHOLDER(c.length) };
  });
  return { messages: out, trimmed };
}

/**
 * L2 collapse：把「较早的助手长回复」投影成短摘要（保留开头，标注省略长度）。
 * 只处理纯文本回复（不含 tool_calls），保留最近 keepRecentTurns 条。
 * @returns {{messages:Array, collapsed:number}}
 */
export function collapseOldMessages(messages, { keepRecentTurns = 6, maxChars = 400 } = {}) {
  const idx = [];
  messages.forEach((m, i) => {
    if (
      m.role === "assistant" &&
      !m.tool_calls &&
      typeof m.content === "string" &&
      m.content.length > maxChars
    ) {
      idx.push(i);
    }
  });
  const toCollapse = idx.slice(0, Math.max(0, idx.length - keepRecentTurns));
  if (toCollapse.length === 0) return { messages, collapsed: 0 };
  let collapsed = 0;
  const out = messages.map((m, i) => {
    if (!toCollapse.includes(i)) return m;
    if (m.content.startsWith("[已折叠")) return m;
    collapsed += 1;
    return { ...m, content: `[已折叠 ${m.content.length} 字符] ${m.content.slice(0, maxChars)}…` };
  });
  return { messages: out, collapsed };
}

const SUMMARY_PROMPT = `请为以下对话生成一份可无缝续接的摘要，只输出摘要正文（不要调用工具）。

摘要需覆盖：
1. 用户的核心请求与意图
2. 关键技术概念
3. 涉及的文件与代码段（路径 + 为什么重要）
4. 错误与修复
5. 已完成的工作
6. 待办任务
7. 当前进度与下一步

要求：简洁、事实准确、不臆测。`;

/**
 * L2：把早期对话压成一条摘要消息。
 * 保留：system 消息 + 最近 keepRecentMessages 条消息；其余交给模型摘要。
 * @returns {{messages: Array, summarized: number}}
 */
export async function summarizeHistory(messages, { model, keepRecentMessages = 12, onEvent = () => {} } = {}) {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= keepRecentMessages) return { messages, summarized: 0 };

  const old = rest.slice(0, rest.length - keepRecentMessages);
  const recent = rest.slice(rest.length - keepRecentMessages);

  const transcript = old
    .map((m) => `[${m.role}] ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
    .join("\n")
    .slice(0, 60_000);

  let summary = "(摘要生成失败)";
  try {
    const resp = await chat({
      model,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: transcript },
      ],
      maxTokens: 2000,
    });
    summary = (resp.content || "").trim() || summary;
  } catch (e) {
    summary = `(摘要生成失败：${e.message})`;
  }
  onEvent({ type: "compacted", summarized: old.length, summaryLength: summary.length });

  const boundary = {
    role: "user",
    content: `[上下文压缩] 以下是此前对话的摘要（原 ${old.length} 条消息已折叠）。继续时像从未中断一样工作，不要复述摘要。\n\n${summary}`,
  };
  return { messages: [...system, boundary, ...recent], summarized: old.length };
}

/**
 * 按需压缩（四层流水线，借鉴 Claude Code）：
 *   L0 snip（工具结果写入时已截断）→ L1 清旧工具结果 → L2 折叠旧助手回复 → L3 整体摘要
 * 能轻量解决就不做重压缩。
 */
export async function compactIfNeeded(messages, opts = {}) {
  const { contextWindow, thresholdRatio, model, onEvent = () => {}, keepRecentMessages, force = false } = opts;
  const still = (m) => shouldCompact(m, { contextWindow, thresholdRatio });
  if (!force && !still(messages)) {
    return { messages, compacted: false, level: null };
  }
  const before = estimateTokens(messages);

  // L1：清旧工具结果
  const l1 = trimToolResults(messages, opts);
  if (!still(l1.messages)) {
    onEvent({ type: "compact_l1", trimmed: l1.trimmed, before, after: estimateTokens(l1.messages) });
    return { messages: l1.messages, compacted: true, level: "L1" };
  }

  // L2：折叠较早的助手长回复（投影）
  const l2 = collapseOldMessages(l1.messages, opts);
  if (!still(l2.messages)) {
    onEvent({ type: "compact_l2", collapsed: l2.collapsed, before, after: estimateTokens(l2.messages) });
    return { messages: l2.messages, compacted: true, level: "L2" };
  }

  // L3：整体摘要
  const l3 = await summarizeHistory(l2.messages, { model, keepRecentMessages, onEvent });
  if (l1.trimmed === 0 && l2.collapsed === 0 && l3.summarized === 0) {
    // 没有可压缩的内容，不虚报压缩
    return { messages, compacted: false, level: null };
  }
  if (l3.summarized === 0) {
    const best = l2.collapsed > 0 ? l2.messages : l1.messages;
    const level = l2.collapsed > 0 ? "L2" : "L1";
    onEvent({ type: `compact_${level.toLowerCase()}`, before, after: estimateTokens(best) });
    return { messages: best, compacted: true, level };
  }
  onEvent({ type: "compact_l3", summarized: l3.summarized, before, after: estimateTokens(l3.messages) });
  return { messages: l3.messages, compacted: true, level: "L3" };
}
