import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOOK_EVENTS, MATCHER_FIELDS, matchHooks, runHooks } from "../hooks.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const cfg = {
  PreToolUse: [{ matcher: "bash", command: "true" }],
  SessionStart: [{ matcher: "startup", command: "true" }],
  PreCompact: [{ matcher: "auto", command: "true" }],
  UserPromptSubmit: [{ matcher: "anything", command: "true" }, { command: "true" }],
  Stop: [{ command: "true" }],
  SessionEnd: [{ matcher: "completed", command: "true" }],
};

// ── 事件清单 ──
t("事件数量 11", HOOK_EVENTS.length === 11, `→ ${HOOK_EVENTS.length}`);
for (const e of ["SessionStart", "SessionEnd", "PostToolUseFailure", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop"]) {
  t(`包含 ${e}`, HOOK_EVENTS.includes(e));
}

// ── matcher 维度映射 ──
t("PreToolUse 匹配 tool_name", MATCHER_FIELDS.PreToolUse === "tool_name");
t("SessionStart 匹配 source", MATCHER_FIELDS.SessionStart === "source");
t("SessionEnd 匹配 reason", MATCHER_FIELDS.SessionEnd === "reason");
t("PreCompact 匹配 trigger", MATCHER_FIELDS.PreCompact === "trigger");
t("SubagentStop 匹配 agent", MATCHER_FIELDS.SubagentStop === "agent");
t("UserPromptSubmit 无 matcher 维度", MATCHER_FIELDS.UserPromptSubmit === null);

// ── matchHooks ──
t("工具事件按工具名匹配", matchHooks(cfg, "PreToolUse", { tool_name: "bash" }).length === 1);
t("工具名不匹配则跳过", matchHooks(cfg, "PreToolUse", { tool_name: "read_file" }).length === 0);
t("SessionStart 按 source 匹配", matchHooks(cfg, "SessionStart", { source: "startup" }).length === 1);
t("SessionStart 其他 source 跳过", matchHooks(cfg, "SessionStart", { source: "resume" }).length === 0);
t("PreCompact 按 trigger 匹配", matchHooks(cfg, "PreCompact", { trigger: "auto" }).length === 1);
t("SessionEnd 按 reason 匹配", matchHooks(cfg, "SessionEnd", { reason: "completed" }).length === 1);
t("无 matcher 的 hook 始终匹配", matchHooks(cfg, "Stop", {}).length === 1);
t("不支持 matcher 的事件会跳过带 matcher 的 hook", matchHooks(cfg, "UserPromptSubmit", { prompt: "x" }).length === 1);
t("字符串 payload 向后兼容", matchHooks(cfg, "PreToolUse", "bash").length === 1);
t("未配置事件返回空", matchHooks(cfg, "PostCompact", {}).length === 0);

// ── runHooks 对新事件可用 ──
const dir = mkdtempSync(path.join(os.tmpdir(), "sa-hookev-"));
const r1 = runHooks({ SessionStart: [{ command: "echo 已初始化" }] }, "SessionStart", { source: "startup" }, { cwd: dir });
t("SessionStart hook 执行", r1.ran === 1 && r1.outputs[0].includes("已初始化"), `→ ${JSON.stringify(r1.outputs)}`);

const r2 = runHooks({ SessionEnd: [{ command: "echo done" }] }, "SessionEnd", { reason: "completed" }, { cwd: dir });
t("SessionEnd hook 执行", r2.ran === 1 && r2.outputs[0].includes("done"));

const r3 = runHooks({ PostToolUseFailure: [{ command: "echo failed" }] }, "PostToolUseFailure", { tool_name: "bash" }, { cwd: dir });
t("PostToolUseFailure hook 执行", r3.ran === 1 && r3.outputs[0].includes("failed"));

const r4 = runHooks(
  { PreCompact: [{ command: 'cat > /dev/null; echo "{\\"additionalContext\\":\\"压缩前提醒\\"}"' }] },
  "PreCompact",
  { trigger: "auto" },
  { cwd: dir }
);
t("PreCompact 支持 JSON 输出", r4.outputs.join("").includes("压缩前提醒"), `→ ${JSON.stringify(r4.outputs)}`);

const r5 = runHooks({ SubagentStart: [{ matcher: "subagent", command: "echo sub" }] }, "SubagentStart", { agent: "subagent" }, { cwd: dir });
t("SubagentStart 按 agent 匹配", r5.ran === 1);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
