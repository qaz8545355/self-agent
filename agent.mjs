/**
 * agent.mjs — 核心循环（单状态机，借鉴 Claude Code 的 queryLoop）
 *
 * 流程：模型 → 工具调用 → 回填 → 继续，直到无工具调用或达到步数上限。
 */
import { chat, chatStream } from "./llm.mjs";
import { toOpenAITools, runTool } from "./tools.mjs";
import { compactIfNeeded, estimateTokens } from "./context.mjs";
import { skillsCatalog } from "./skills.mjs";

export const SYSTEM_PROMPT = `你是一个 coding agent，运行在用户的服务器上，通过工具完成编程与运维任务。

工具使用规范：
- 修改文件前先 read_file 确认内容；编辑用 edit_file（old_string 必须唯一）。
- 执行命令用 bash；危险命令会被安全层拦截，被拦截时不要重试同样的命令，换安全做法或说明原因。
- 查找文件用 glob，搜索内容用 grep。
- 每次工具调用后根据结果决定下一步；不要臆测结果。
- 回答用中文，简洁；完成任务后给出结论和改动的文件清单。

安全底线：不执行删除系统目录、格式化磁盘、泄露密钥等操作。`;

/**
 * 运行一次 agent 任务。
 * @param {object} opts
 * @param {string} [opts.task] 用户任务；省略时沿用 messages
 * @param {Array} [opts.messages] 已有会话消息
 * @param {string} [opts.cwd]
 * @param {string} [opts.model]
 * @param {number} [opts.maxSteps]
 * @param {(ev:object)=>void} [opts.onEvent]
 */
export async function runAgent({
  task,
  messages = [],
  cwd = process.cwd(),
  model,
  maxSteps = 25,
  contextWindow = 1_050_000,
  thresholdRatio = 0.65,
  depth = 0,
  stream = false,
  onEvent = () => {},
} = {}) {
  let msgs = [...messages];
  if (!msgs.some((m) => m.role === "system")) {
    const systemContent = `${SYSTEM_PROMPT}\n\n## 可用技能\n${skillsCatalog()}\n\n需要某个技能的详细步骤时，调用 skill 工具加载它。`;
    msgs.unshift({ role: "system", content: systemContent });
  }
  if (task) msgs.push({ role: "user", content: task });

  let steps = 0;
  let totalTokens = 0;
  while (steps < maxSteps) {
    steps += 1;

    // 上下文压缩（仅超阈值时触发，先裁剪旧工具结果，再整体摘要）
    const compacted = await compactIfNeeded(msgs, { contextWindow, thresholdRatio, model, onEvent });
    if (compacted.compacted) msgs = compacted.messages;

    const resp = stream
      ? await chatStream({
          messages: msgs,
          tools: toOpenAITools(),
          model,
          onDelta: (text) => onEvent({ type: "delta", text }),
        })
      : await chat({ messages: msgs, tools: toOpenAITools(), model });
    totalTokens += resp.usage?.total_tokens ?? 0;
    onEvent({ type: "assistant", step: steps, content: resp.content, usage: resp.usage });

    const calls = resp.tool_calls ?? [];
    if (calls.length === 0) {
      return { content: resp.content, messages: msgs, steps, totalTokens, done: true };
    }

    // 工具配对：assistant 消息（含 tool_calls）+ 每个 tool 结果
    msgs.push({ role: "assistant", content: resp.content ?? "", tool_calls: calls });
    for (const tc of calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        args = {};
      }
      onEvent({ type: "tool", name: tc.function?.name, args });
      const result = await runTool(tc.function?.name, args, { cwd, depth, model });
      onEvent({ type: "tool_result", name: tc.function?.name, isError: !!result.isError, text: result.text });
      msgs.push({ role: "tool", tool_call_id: tc.id, content: result.text });
    }
  }

  return {
    content: `（达到步数上限 ${maxSteps}，已停止）`,
    messages: msgs,
    steps,
    totalTokens,
    done: false,
    aborted: true,
  };
}
