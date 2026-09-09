/**
 * agent.mjs — 核心循环（单状态机，借鉴 Claude Code 的 queryLoop）
 *
 * 流程：模型 → 工具调用 → 回填 → 继续，直到无工具调用或达到步数上限。
 */
import { chat, chatStream } from "./llm.mjs";
import { toOpenAITools, runTool, partitionToolCalls, selectToolsForTask } from "./tools.mjs";
import { compactIfNeeded, estimateTokens } from "./context.mjs";
import { skillsCatalog } from "./skills.mjs";
import { loadHooks, resolveHooksFile, runHooks } from "./hooks.mjs";
import { classifyError } from "./errors.mjs";

export const SYSTEM_PROMPT = `你是一个 coding agent，运行在用户的服务器上，通过工具完成编程与运维任务。

工具使用规范：
- 修改文件前先 read_file 确认内容；编辑用 edit_file（old_string 必须唯一）。
- 查找文件用 glob 工具，搜索内容用 grep 工具——两者都是**内置实现，不依赖 rg / find / grep 等外部命令**，不要用 bash 去调这些命令。
- 执行命令用 bash；bash 只接受 command 一个参数（工作目录已固定，不需要也不能传 cwd/workdir）。
- 依赖外部命令（rg / jq / ffmpeg 等）前，先用 check_binary 确认它存在，不存在就改用内置工具或替代方案。
- 危险命令会被安全层拦截；被拦截时不要重试同样的命令，换安全做法或说明原因。
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
  // 生命周期钩子（Claude Code hooks 移植）
  const { config: hookConfig, file: hookFile } = loadHooks(resolveHooksFile(cwd));
  if (hookFile && Object.keys(hookConfig).length) {
    onEvent({ type: "hooks_loaded", file: hookFile, events: Object.keys(hookConfig) });
  }

  if (task) {
    const pre = runHooks(hookConfig, "UserPromptSubmit", { prompt: task, cwd }, { cwd });
    const injected = pre.outputs.length ? `\n\n[UserPromptSubmit hook 注入]\n${pre.outputs.join("\n")}` : "";
    msgs.push({ role: "user", content: task + injected });
  }

  // 按任务挑选工具集（减少每步 schema 开销）
  const activeTools = selectToolsForTask(task ?? msgs.filter((m) => m.role === "user").map((m) => m.content).join(" "));
  onEvent({ type: "tools_selected", count: activeTools.length, names: activeTools.map((t) => t.name) });

  let steps = 0;
  let totalTokens = 0;
  let stopBlocks = 0;
  while (steps < maxSteps) {
    steps += 1;

    // 上下文压缩（仅超阈值时触发，先裁剪旧工具结果，再整体摘要）
    const compacted = await compactIfNeeded(msgs, { contextWindow, thresholdRatio, model, onEvent });
    if (compacted.compacted) msgs = compacted.messages;

    let resp;
    try {
      resp = stream
        ? await chatStream({
            messages: msgs,
            tools: toOpenAITools(activeTools),
            model,
            onDelta: (text) => onEvent({ type: "delta", text }),
          })
        : await chat({
            messages: msgs,
            tools: toOpenAITools(activeTools),
            model,
            onRetry: (info) => onEvent({ type: "retry", ...info }),
          });
    } catch (e) {
      const cls = e?.classification ?? classifyError(e);
      if (cls.shouldCompact) {
        // 上下文超限：强制压缩后重试本轮（不消耗额外步数）
        onEvent({ type: "force_compact", tokenInfo: cls.tokenInfo, error: String(e?.message ?? e) });
        const forced = await compactIfNeeded(msgs, {
          contextWindow,
          thresholdRatio,
          model,
          onEvent,
          force: true,
        });
        msgs = forced.messages;
        steps -= 1;
        continue;
      }
      throw e;
    }
    totalTokens += resp.usage?.total_tokens ?? 0;
    onEvent({ type: "assistant", step: steps, content: resp.content, usage: resp.usage });

    const calls = resp.tool_calls ?? [];
    if (calls.length === 0) {
      // Stop hook：可阻止结束（要求继续），最多阻止 3 次防死循环
      const stop = runHooks(hookConfig, "Stop", { cwd, steps, last_message: resp.content }, { cwd });
      if (stop.blocked && stopBlocks < 3) {
        stopBlocks += 1;
        onEvent({ type: "stop_blocked", outputs: stop.outputs, count: stopBlocks });
        msgs.push({ role: "assistant", content: resp.content ?? "" });
        msgs.push({
          role: "user",
          content: `[Stop hook 要求继续] ${stop.outputs.join("；") || "请继续完成任务"}`,
        });
        continue;
      }
      return { content: resp.content, messages: msgs, steps, totalTokens, done: true };
    }

    // 工具配对：assistant 消息（含 tool_calls）+ 每个 tool 结果
    msgs.push({ role: "assistant", content: resp.content ?? "", tool_calls: calls });

    // 单个工具执行（含 Pre/Post hook）
    const executeOne = async (tc) => {
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        args = {};
      }
      onEvent({ type: "tool", name: tc.function?.name, args });

      const preHook = runHooks(
        hookConfig,
        "PreToolUse",
        { tool_name: tc.function?.name, tool_input: args, cwd },
        { cwd }
      );
      let result;
      if (preHook.blocked) {
        result = { isError: true, text: `⛔ 被 PreToolUse hook 阻止：${preHook.outputs.join("；") || "无原因"}` };
      } else {
        result = await runTool(tc.function?.name, args, { cwd, depth, model });
        const postHook = runHooks(
          hookConfig,
          "PostToolUse",
          {
            tool_name: tc.function?.name,
            tool_input: args,
            tool_result: result.text,
            is_error: !!result.isError,
            cwd,
          },
          { cwd }
        );
        if (postHook.outputs.length) {
          result = { ...result, text: `${result.text}\n[PostToolUse hook] ${postHook.outputs.join("；")}` };
        }
        if (preHook.outputs.length) {
          result = { ...result, text: `[PreToolUse hook] ${preHook.outputs.join("；")}\n${result.text}` };
        }
      }
      onEvent({ type: "tool_result", name: tc.function?.name, isError: !!result.isError, text: result.text });
      return result;
    };

    // 分区执行：连续的只读调用并行，写调用串行（借鉴 Claude Code toolOrchestration）
    const toolResults = new Map();
    for (const batch of partitionToolCalls(calls)) {
      if (batch.parallel && batch.calls.length > 1) {
        onEvent({ type: "parallel_batch", count: batch.calls.length });
        const settled = await Promise.all(batch.calls.map(async (tc) => [tc.id, await executeOne(tc)]));
        for (const [id, r] of settled) toolResults.set(id, r);
      } else {
        for (const tc of batch.calls) toolResults.set(tc.id, await executeOne(tc));
      }
    }
    // 按原始顺序回填，保持工具配对不变量
    for (const tc of calls) {
      const r = toolResults.get(tc.id) ?? { isError: true, text: "工具结果丢失" };
      msgs.push({ role: "tool", tool_call_id: tc.id, content: r.text });
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
