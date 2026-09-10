/**
 * agent.mjs — 核心循环（单状态机，借鉴 Claude Code 的 queryLoop）
 *
 * 流程：模型 → 工具调用 → 回填 → 继续，直到无工具调用或达到步数上限。
 */
import { chat, chatStream } from "./llm.mjs";
import { toOpenAITools, runTool, partitionToolCalls, selectToolsForTask } from "./tools.mjs";
import { compactIfNeeded, estimateTokens } from "./context.mjs";
import { skillsCatalog, activateConditionalSkillsForPaths } from "./skills.mjs";
import { loadMemoryContext } from "./memory-files.mjs";
import { collectAttachments, formatAttachments } from "./attachments.mjs";
import { drainNotifications } from "./background-tasks.mjs";
import { createPromptStateTracker } from "./prompt-state.mjs";
import { createAuditLog } from "./permission-audit.mjs";
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
  maxSteps = 100,
  stallLimit = 3,
  contextWindow = 1_050_000,
  thresholdRatio = 0.65,
  depth = 0,
  stream = false,
  onEvent = () => {},
} = {}) {
  let msgs = [...messages];
  if (!msgs.some((m) => m.role === "system")) {
    // 记忆文件（AGENTS.md / CLAUDE.md + @include），优先级由低到高拼接
    const memory = loadMemoryContext(cwd);
    const memoryBlock = memory.text ? `\n\n## 项目/用户指令（AGENTS.md）\n${memory.text}` : "";
    const systemContent = `${SYSTEM_PROMPT}${memoryBlock}\n\n## 可用技能\n${skillsCatalog()}\n\n需要某个技能的详细步骤时，调用 skill 工具加载它。`;
    msgs.unshift({ role: "system", content: systemContent });
    if (memory.files.length) {
      onEvent({ type: "memory_loaded", count: memory.files.length, truncated: memory.truncated });
    }
  }
  // 生命周期钩子（Claude Code hooks 移植）
  const { config: hookConfig, file: hookFile } = loadHooks(resolveHooksFile(cwd));
  if (hookFile && Object.keys(hookConfig).length) {
    onEvent({ type: "hooks_loaded", file: hookFile, events: Object.keys(hookConfig) });
  }

  // SessionStart hook（源码 types/hooks.ts 的同名事件）
  const sessionStart = runHooks(hookConfig, "SessionStart", { source: "startup", cwd }, { cwd });
  if (sessionStart.outputs.length) {
    msgs.push({ role: "user", content: `[SessionStart hook] ${sessionStart.outputs.join("；")}` });
  }
  /** 会话结束钩子（各返回点统一调用） */
  const endSession = (reason) => {
    try {
      runHooks(hookConfig, "SessionEnd", { reason, steps, cwd }, { cwd });
    } catch {
      /* hook 失败不影响返回 */
    }
  };

  if (task) {
    const pre = runHooks(hookConfig, "UserPromptSubmit", { prompt: task, cwd }, { cwd });
    const injected = pre.outputs.length ? `\n\n[UserPromptSubmit hook 注入]\n${pre.outputs.join("\n")}` : "";
    // @文件引用 → 自动注入内容（移植 attachments 的 extractAtMentionedFiles 设计）
    const attach = collectAttachments(task, { cwd });
    const attachBlock = attach.attachments.length
      ? `\n\n[自动附加的文件内容]\n${formatAttachments(attach.attachments)}`
      : "";
    msgs.push({ role: "user", content: task + injected + attachBlock });
    if (attach.attachments.length) {
      onEvent({
        type: "attachments_loaded",
        count: attach.attachments.length,
        refs: attach.attachments.map((a) => a.ref),
        skipped: attach.skipped.length,
      });
    }
  }

  // 按任务挑选工具集（减少每步 schema 开销）
  const activeTools = selectToolsForTask(task ?? msgs.filter((m) => m.role === "user").map((m) => m.content).join(" "));
  const activeToolNames = activeTools.map((t) => t.name);
  onEvent({ type: "tools_selected", count: activeTools.length, names: activeTools.map((t) => t.name) });

  let steps = 0;
  let totalTokens = 0;
  let stopBlocks = 0;
  // 卡住检测：连续 N 步「无文件改动 + 工具调用/结果重复」则提前终止（stallLimit=0 关闭）
  const stallDetector = createStallDetector({ limit: stallLimit });
  /** 已提示过的条件技能，避免重复注入 */
  const announcedSkills = new Set();
  /** prompt 状态跟踪（诊断缓存失效 / 上下文抖动） */
  const promptTracker = createPromptStateTracker();
  /** 权限决策审计 */
  const audit = createAuditLog();
  while (steps < maxSteps) {
    steps += 1;

    // 后台任务完成通知（每步取一次，防重）
    const bgNotes = drainNotifications();
    if (bgNotes.length) {
      onEvent({ type: "bg_notifications", count: bgNotes.length });
      msgs.push({
        role: "user",
        content:
          `[后台任务完成] ${bgNotes
            .map((n) => `${n.id}（${n.status}，exit=${n.exitCode ?? "?"}，输出 ${n.outputBytes} 字节）`)
            .join("；")}\n需要时用 bg_task {action:"output"} 读取输出。`,
      });
    }

    // 上下文压缩（仅超阈值时触发，先裁剪旧工具结果，再整体摘要）
    const preCompact = runHooks(hookConfig, "PreCompact", { trigger: "auto", messageCount: msgs.length, cwd }, { cwd });
    const compacted = await compactIfNeeded(msgs, { contextWindow, thresholdRatio, model, onEvent });
    if (compacted.compacted) {
      msgs = compacted.messages;
      runHooks(
        hookConfig,
        "PostCompact",
        { trigger: "auto", level: compacted.level ?? "unknown", messageCount: msgs.length, cwd },
        { cwd }
      );
    }
    if (preCompact.outputs.length) {
      msgs.push({ role: "user", content: `[PreCompact hook] ${preCompact.outputs.join("；")}` });
    }

    // prompt 状态诊断：system / 工具集合 / 模型 / 工具 schema 变化会影响前缀缓存
    const stateDiff = promptTracker.observe({
      system: msgs.find((m) => m.role === "system")?.content ?? "",
      tools: activeTools,
      messages: msgs,
      model: model ?? "",
    });
    if (stateDiff.changed && stateDiff.reasons[0] !== "首次快照") {
      onEvent({ type: "prompt_state_changed", reasons: stateDiff.reasons });
    }

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
      // 模型调用失败退出：也要触发 SessionEnd（异常路径同样收尾）
      endSession("error");
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
      endSession("completed");
      return { content: resp.content, messages: msgs, steps, totalTokens, done: true, audit: audit.summary() };
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

      // 权限决策审计（规则版分类：allow / ask / deny）
      const verdict = audit.record(tc.function?.name, args, { cwd });
      if (verdict.decision !== "allow") {
        onEvent({
          type: "permission_decision",
          tool: tc.function?.name,
          decision: verdict.decision,
          reason: verdict.reason,
        });
      }

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
        result = await runTool(tc.function?.name, args, { cwd, depth, model, activeToolNames });
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
        // 工具失败专用钩子（对齐源码 PostToolUseFailure）
        if (result.isError) {
          const failHook = runHooks(
            hookConfig,
            "PostToolUseFailure",
            {
              tool_name: tc.function?.name,
              tool_input: args,
              error: String(result.text ?? "").slice(0, 2000),
              cwd,
            },
            { cwd }
          );
          if (failHook.outputs.length) {
            result = { ...result, text: `${result.text}\n[PostToolUseFailure hook] ${failHook.outputs.join("；")}` };
          }
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

    // 条件技能：本步改动的文件若匹配某技能的 paths，注入提示（同一技能只提示一次）
    const changedPaths = calls
      .filter((tc) => WRITE_TOOL_NAMES.has(tc.function?.name) && !toolResults.get(tc.id)?.isError)
      .map((tc) => {
        try {
          return JSON.parse(tc.function?.arguments ?? "{}")?.path;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (changedPaths.length) {
      const activated = activateConditionalSkillsForPaths(changedPaths, cwd).filter(
        (n) => !announcedSkills.has(n)
      );
      if (activated.length) {
        for (const n of activated) announcedSkills.add(n);
        onEvent({ type: "skills_activated", names: activated });
        msgs.push({
          role: "user",
          content: `[技能激活] 你刚操作的文件匹配以下技能，需要时用 skill 工具加载：${activated.join(", ")}`,
        });
      }
    }

    // 卡住检测：没有文件改动且工具调用/结果与之前某步完全相同 → 空转，提前终止
    const stall = stallDetector.observe(calls, toolResults);
    if (stall.stalled) {
      onEvent({ type: "stalled", streak: stall.streak });
      endSession("stalled");
      return {
        content: `（连续 ${stall.streak} 步无进展：没有文件改动，且工具调用与结果重复，已提前终止）`,
        messages: msgs,
        steps,
        totalTokens,
        done: false,
        aborted: true,
        stalled: true,
      };
    }
  }

  endSession("max_steps");
  return {
    content: `（达到步数上限 ${maxSteps}，已停止）`,
    messages: msgs,
    steps,
    totalTokens,
    done: false,
    aborted: true,
  };
}

/** 写类工具：成功执行才算「有改动」 */
const WRITE_TOOL_NAMES = new Set(["write_file", "edit_file", "apply_patch", "notebook_edit"]);

/**
 * 卡住检测器：连续 N 步满足「无文件改动 + 工具调用/结果与之前某步完全相同」则判定卡住。
 *
 * 为什么这样判：
 * - 只读探索（结果每次不同）不会误判
 * - A/B/A/B 交替空转会被判出（第 N 次重复时触发）
 * - 写工具失败也算「无改动」，反复尝试同样的失败写入同样会被判出
 *
 * @param {{limit?: number}} [opts] 连续重复步数阈值：limit=3 表示同一操作重复 3 次（共执行 4 次）后终止；limit=0 关闭检测
 */
export function createStallDetector({ limit = 3 } = {}) {
  const seen = new Set();
  let streak = 0;

  const signatureOf = (calls, results) =>
    calls
      .map((tc) => {
        const r = results.get(tc.id);
        const status = r?.isError ? "ERR" : "OK";
        return `${tc.function?.name ?? "?"}:${tc.function?.arguments ?? ""}=>${status}:${String(r?.text ?? "").slice(0, 2000)}`;
      })
      .join("\n");

  return {
    /** 观察一步：calls 为模型本步的工具调用，results 为 Map<callId, {isError,text}> */
    observe(calls, results) {
      const wrote = calls.some((tc) => WRITE_TOOL_NAMES.has(tc.function?.name) && !results.get(tc.id)?.isError);
      const signature = signatureOf(calls, results);
      const repeated = seen.has(signature);
      seen.add(signature);

      if (wrote) streak = 0;
      else if (repeated) streak += 1;
      else streak = 0;

      return { stalled: limit > 0 && streak >= limit, streak, repeated, signature };
    },
    get streak() {
      return streak;
    },
  };
}
