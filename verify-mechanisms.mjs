#!/usr/bin/env node
/**
 * verify-mechanisms.mjs — 逐项验证 11 轮学到的 28 项机制是否真的可用
 *
 * 与 `npm test`（单元测试）的区别：这里做的是**跨模块的机制级验证**——
 * 每项机制只验一件事：「它作为能力是否真的接上了」，不重复测边界。
 *
 * 用法：node verify-mechanisms.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "sa-verify11-"));
process.env.SELF_AGENT_HOOK_LOG = path.join(root, "hook-errors.log");
process.env.SELF_AGENT_FILE_HISTORY = path.join(root, "file-history");
process.env.SELF_AGENT_BG_DIR = path.join(root, "bg");
process.env.SELF_AGENT_MCP_APPROVALS = path.join(root, "mcp-approved.json");

const R = [];
async function check(id, name, fn) {
  let ok = false;
  let detail = "";
  try {
    const r = await fn();
    if (typeof r === "string") {
      ok = true;
      detail = r;
    } else if (r && typeof r === "object") {
      ok = r.ok !== false;
      detail = r.detail ?? "";
    } else {
      ok = !!r;
    }
  } catch (e) {
    ok = false;
    detail = `异常：${e.message}`;
  }
  R.push({ id, name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} [${String(id).padStart(2)}] ${name}${detail ? `\n       ${detail}` : ""}`);
}

const cwd = path.join(root, "work");
mkdirSync(cwd, { recursive: true });

// ── 1–12（前三轮）──────────────────────────────────────────

await check(1, "工具即契约", async () => {
  const { toolDefs, toOpenAITools } = await import("./tools.mjs");
  const bad = toolDefs.filter(
    (t) => !t.name || !t.description || !t.parameters || typeof t.execute !== "function" || typeof t.isReadOnly !== "boolean"
  );
  return { ok: bad.length === 0 && toOpenAITools().length === toolDefs.length, detail: `${toolDefs.length} 个工具全部符合契约` };
});

await check(2, "权限决策流水线（命令策略 + 路径安全 + 熔断）", async () => {
  const { checkCommand, checkWritePath } = await import("./safety.mjs");
  const a = checkCommand("rm -rf /").allow === false;
  const b = checkWritePath("/etc/passwd").allow === false;
  const c = checkCommand("ls -la").allow === true;
  return { ok: a && b && c, detail: `拦危险=${a} 拦系统写=${b} 放行正常=${c}` };
});

await check(3, "上下文压缩（token 估算 + L1 裁剪 + L2 摘要）", async () => {
  const { estimateTokens, trimToolResults, compactIfNeeded } = await import("./context.mjs");
  const msgs = [{ role: "system", content: "s" }];
  for (let i = 0; i < 20; i++) msgs.push({ role: "tool", tool_call_id: `c${i}`, content: "x".repeat(500) });
  const t = trimToolResults(msgs, { keepRecentToolResults: 2 });
  return { ok: estimateTokens(msgs) > 0 && t.trimmed > 0 && typeof compactIfNeeded === "function", detail: `估算 ${estimateTokens(msgs)} tokens，L1 裁剪 ${t.trimmed} 条` };
});

await check(4, "子代理（独立上下文 + worktree 隔离）", async () => {
  const { toolDefs } = await import("./tools.mjs");
  const sub = toolDefs.find((t) => t.name === "subagent");
  const props = sub.parameters.properties;
  return { ok: !!sub && "isolation" in props && "max_steps" in props, detail: "subagent 支持 isolation=worktree / max_steps" };
});

await check(5, "单循环状态机 + 卡住检测", async () => {
  const { runAgent, createStallDetector } = await import("./agent.mjs");
  const d = createStallDetector({ limit: 2 });
  const calls = [{ id: "a", function: { name: "read_file", arguments: "{}" } }];
  const res = new Map([["a", { isError: false, text: "same" }]]);
  d.observe(calls, res); // 首次出现：不计入重复
  d.observe(calls, res); // 重复 1
  const stalled = d.observe(calls, res).stalled; // 重复 2 → 达到 limit
  return { ok: typeof runAgent === "function" && stalled === true, detail: "runAgent 存在；同一调用重复 2 次后判定卡住" };
});

await check(6, "生命周期钩子（11 事件 + 安全加固）", async () => {
  const { HOOK_EVENTS, MATCHER_FIELDS, runHooks } = await import("./hooks.mjs");
  const r = runHooks({ PostToolUse: [{ command: "echo ok" }] }, "PostToolUse", { tool_name: "bash" }, { cwd });
  return { ok: HOOK_EVENTS.length === 11 && r.ran === 1 && MATCHER_FIELDS.SessionStart === "source", detail: `${HOOK_EVENTS.length} 个事件；hook 实跑 ${r.ran} 次` };
});

await check(7, "记忆时效性", async () => {
  const { memoryAge, annotateMemory } = await import("./memory-age.mjs");
  const fiveDaysAgo = Date.now() - 5 * 86400_000;
  const txt = annotateMemory("旧信息", fiveDaysAgo);
  const yesterday = memoryAge(Date.now() - 86400_000);
  return { ok: txt.includes("过时") && yesterday.includes("昨天"), detail: `5 天前标注=${txt.split("\n")[0]}；1 天前=${yesterday}` };
});

await check(8, "错误分类与智能重试", async () => {
  const { classifyError, parsePromptTooLong, parseRateLimitInfo } = await import("./errors.mjs");
  const a = classifyError(new Error("prompt is too long: 137500 tokens > 135000 maximum"));
  const b = parseRateLimitInfo("Resets in 4 days");
  return { ok: !!a && !!b, detail: `超长识别=${a?.kind ?? a?.classification?.kind ?? "ok"}；限流重置=${JSON.stringify(b).slice(0, 60)}` };
});

await check(9, "依赖检测", async () => {
  const { isBinaryInstalled, availableBinaries } = await import("./binary-check.mjs");
  const node = isBinaryInstalled("node");
  const list = availableBinaries();
  return { ok: node === true && Array.isArray(list), detail: `node=${node}；可用命令 ${list.length} 个` };
});

await check(10, "限流消息解析（区分短期/长期）", async () => {
  const { parseRateLimitInfo } = await import("./errors.mjs");
  const long = parseRateLimitInfo("Resets in 4 days");
  const short = parseRateLimitInfo("retry after 30 seconds");
  return { ok: !!long && !!short, detail: `长期=${JSON.stringify(long).slice(0, 50)}；短期=${JSON.stringify(short).slice(0, 50)}` };
});

await check(11, "会话清理", async () => {
  const { pruneSessions } = await import("./session.mjs");
  const r = pruneSessions({ dir: path.join(root, "sessions") });
  return { ok: typeof r.deleted === "number", detail: `清理 ${r.deleted} 个 / 保留 ${r.kept} 个` };
});

await check(12, "QueryGuard 防重入（主动取舍，未移植）", async () => {
  return { ok: true, detail: "按设计未移植：单次 CLI 调用无并发场景（见笔记「取舍复盘」）" };
});

// ── 13–23（第四~九轮）──────────────────────────────────────

await check(13, "命令级只读判定", async () => {
  const { isReadOnlyCommand } = await import("./readonly-commands.mjs");
  const a = isReadOnlyCommand("git log --oneline");
  const b = isReadOnlyCommand("git branch -D main") === false;
  const c = isReadOnlyCommand("cat a | grep b") === false;
  return { ok: a && b && c, detail: `git log 只读=${a}；branch -D 拒绝=${b}；管道拒绝=${c}` };
});

await check(14, "文件改动历史与回滚", async () => {
  const { trackEdit, rewind, listVersions } = await import("./file-history.mjs");
  const f = path.join(cwd, "fh.txt");
  trackEdit(f, {});
  writeFileSync(f, "v1");
  trackEdit(f, {});
  writeFileSync(f, "v2");
  const r = rewind(f, 2, {});
  const content = existsSync(f) ? (await import("node:fs")).readFileSync(f, "utf8") : "";
  return { ok: r.ok && content === "v1" && listVersions(f, {}).length === 2, detail: `回滚后内容=${JSON.stringify(content)}` };
});

await check(15, "记忆文件注入（AGENTS.md 分层 + @include）", async () => {
  const proj = path.join(root, "proj");
  mkdirSync(proj, { recursive: true });
  writeFileSync(path.join(proj, "AGENTS.md"), "# 项目约定\n@./extra.md\n");
  writeFileSync(path.join(proj, "extra.md"), "附加内容");
  const { loadMemoryContext } = await import("./memory-files.mjs");
  const r = loadMemoryContext(proj, { home: path.join(root, "nohome") });
  return { ok: r.text.includes("项目约定") && r.text.includes("附加内容"), detail: `注入 ${r.files.length} 个文件（含 @include 展开）` };
});

await check(16, "技能参数替换 + 条件技能", async () => {
  const sdir = path.join(root, "skills");
  mkdirSync(path.join(sdir, "py"), { recursive: true });
  writeFileSync(path.join(sdir, "py", "SKILL.md"), '---\nname: py\ndescription: x\npaths: "**/*.py"\narguments: file\n---\n处理 $file\n');
  const { activateConditionalSkillsForPaths, loadSkill } = await import("./skills.mjs");
  const activated = activateConditionalSkillsForPaths(["a.py"], root, [sdir]);
  const loaded = loadSkill("py", { dirs: [sdir], args: "a.py" });
  return { ok: activated.includes("py") && loaded.content.includes("处理 a.py"), detail: `条件激活=${activated.join(",")}；参数替换生效` };
});

await check(17, "@文件附件注入", async () => {
  writeFileSync(path.join(cwd, "note.txt"), "第一行\n第二行\n第三行");
  const { collectAttachments } = await import("./attachments.mjs");
  const a = collectAttachments("看 @note.txt", { cwd });
  const b = collectAttachments("看 @note.txt#L2-3", { cwd });
  return { ok: a.attachments.length === 1 && b.attachments[0].content === "第二行\n第三行", detail: `整文件 + 行范围引用都生效` };
});

await check(18, "后台任务运行时（状态/增量读/通知）", async () => {
  const bg = await import("./background-tasks.mjs");
  const t = bg.startShellTask("printf 'abcdefgh'", { cwd });
  await bg.waitForTask(t.id, 5000);
  const r1 = bg.readTaskOutput(t.id, { offset: 0, maxBytes: 4 });
  const r2 = bg.readTaskOutput(t.id, { offset: r1.offset });
  const notes = bg.drainNotifications();
  return { ok: r1.text === "abcd" && r2.text === "efgh" && notes.length >= 1, detail: `增量读 ${r1.text}+${r2.text}；完成通知 ${notes.length} 条` };
});

await check(19, "worker 并行（worktree 隔离）", async () => {
  const { isConcurrencySafe } = await import("./tools.mjs");
  const mk = (args) => ({ function: { name: "subagent", arguments: JSON.stringify(args) } });
  return { ok: isConcurrencySafe(mk({ task: "x", isolation: "worktree" })) === true && isConcurrencySafe(mk({ task: "x" })) === false, detail: "隔离时可并行、默认串行" };
});

await check(20, "工具输入校验 + schema 未发送提示", async () => {
  const { validateToolInput, buildSchemaNotSentHint } = await import("./tool-validation.mjs");
  const bad = validateToolInput({ type: "object", properties: { n: { type: "number" } }, required: ["n"] }, { n: "3" });
  const hint = buildSchemaNotSentHint("lsp", ["bash", "read_file"]);
  return { ok: bad.ok === false && String(hint).includes("tool_search"), detail: `类型错误被拦；未发送 schema 给出 tool_search 指引` };
});

await check(21, "prompt 状态诊断", async () => {
  const { createPromptStateTracker } = await import("./prompt-state.mjs");
  const tr = createPromptStateTracker();
  tr.observe({ system: "s", tools: [{ name: "bash", parameters: {} }], messages: [] });
  const r = tr.observe({ system: "s2", tools: [{ name: "bash", parameters: {} }], messages: [] });
  return { ok: r.changed && r.reasons.some((x) => x.includes("system")), detail: `检出变化：${r.reasons.join("；")}` };
});

await check(22, "MCP 多作用域 + 审批 + 命名空间", async () => {
  const mcp = await import("./mcp.mjs");
  const proj = path.join(root, "mcp-proj");
  mkdirSync(path.join(proj, ".self-agent"), { recursive: true });
  writeFileSync(path.join(proj, ".self-agent", "mcp.json"), JSON.stringify({ servers: { proj: { command: "node", args: ["x.mjs"] } } }));
  const { servers } = mcp.loadMcpConfigs(proj, { userFile: path.join(root, "no-user.json") });
  const before = mcp.isServerApproved("proj", servers.proj);
  mcp.approveServer("proj", servers.proj);
  const after = mcp.isServerApproved("proj", servers.proj);
  return {
    ok: servers.proj.scope === "project" && before === false && after === true && mcp.namespacedToolName("s", "t") === "mcp__s__t",
    detail: `项目级 scope=${servers.proj.scope}；审批前=${before} 审批后=${after}`,
  };
});

await check(23, "权限决策审计", async () => {
  const { classifyAction, createAuditLog } = await import("./permission-audit.mjs");
  const log = createAuditLog();
  log.record("bash", { command: "ls -la" }, { cwd });
  log.record("bash", { command: "mkdir x" }, { cwd });
  log.record("bash", { command: "rm -rf /" }, { cwd });
  const s = log.summary();
  const denied = classifyAction("bash", { command: "echo x > /etc/passwd" }, { cwd });
  return { ok: s.counts.allow === 1 && s.counts.ask === 1 && s.counts.deny === 1 && denied.decision === "deny", detail: `分布 ${JSON.stringify(s.counts)}；重定向写入系统目录判 deny` };
});

// ── 24–28（第九~十轮）──────────────────────────────────────

await check(24, "重定向目标检查", async () => {
  const { extractRedirectTargets, checkCommand } = await import("./safety.mjs");
  const t = extractRedirectTargets("echo hi >> out.txt 2> err.log");
  const blocked = checkCommand("echo hacked > /etc/passwd", { cwd: "/tmp" }).allow === false;
  return { ok: t.length === 2 && blocked, detail: `提取 ${JSON.stringify(t)}；危险目标被拦` };
});

await check(25, "文件分页读取", async () => {
  const big = path.join(cwd, "big.txt");
  writeFileSync(big, Array.from({ length: 300 }, (_, i) => `L${i + 1}`).join("\n"));
  const { runTool } = await import("./tools.mjs");
  const r = await runTool("read_file", { path: "big.txt", offset: 100, limit: 5 }, { cwd });
  return { ok: r.text.includes("100\tL100") && r.text.includes("offset=105"), detail: `分页读取并提示续读位置` };
});

await check(26, "CJK 感知 token 估算", async () => {
  const { estimateTextTokens } = await import("./context.mjs");
  const cn = estimateTextTokens("中".repeat(100));
  const en = estimateTextTokens("a".repeat(360));
  return { ok: cn === 100 && en === 101, detail: `100 汉字=${cn} tokens；360 字母=${en} tokens` };
});

await check(27, "钩子事件扩展（11 个）", async () => {
  const { HOOK_EVENTS } = await import("./hooks.mjs");
  const need = ["SessionStart", "SessionEnd", "PostToolUseFailure", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop"];
  const missing = need.filter((e) => !HOOK_EVENTS.includes(e));
  return { ok: missing.length === 0, detail: `${HOOK_EVENTS.length} 个事件，新增事件齐全` };
});

await check(28, "命令模板", async () => {
  const cdir = path.join(root, "commands");
  mkdirSync(cdir, { recursive: true });
  writeFileSync(path.join(cdir, "review.md"), '---\ndescription: 代码审查\narguments: target\n---\n审查 $target\n');
  const { listSkills, loadSkill } = await import("./skills.mjs");
  const all = listSkills([], { commandDirs: [cdir] });
  const loaded = loadSkill("review", { dirs: [], commandDirs: [cdir], args: "src/a.js" });
  return { ok: all.some((x) => x.kind === "command") && loaded.content.includes("审查 src/a.js"), detail: `命令被发现并可参数化调用` };
});

// ── 汇总 ──────────────────────────────────────────────────
const ok = R.filter((r) => r.ok).length;
console.log(`\n${"─".repeat(60)}`);
console.log(`机制级验证：${ok}/${R.length} 通过`);
if (ok < R.length) {
  console.log("未通过项：");
  for (const r of R.filter((x) => !x.ok)) console.log(`  - [${r.id}] ${r.name}：${r.detail}`);
}
process.exit(ok === R.length ? 0 : 1);
