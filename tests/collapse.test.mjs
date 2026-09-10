import { collapseOldMessages, compactIfNeeded, estimateTokens } from "../context.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) collapse 基本功能
const msgs = [
  { role: "system", content: "sys" },
  ...Array.from({ length: 10 }, (_, i) => ({ role: "assistant", content: `回复 ${i} ` + "x".repeat(1000) })),
];
const r = collapseOldMessages(msgs, { keepRecentTurns: 3, maxChars: 100 });
t("折叠旧助手回复", r.collapsed === 7, `→ collapsed=${r.collapsed}`);
t("最近 3 条保留完整", r.messages.slice(-3).every((m) => !m.content.startsWith("[已折叠")));
t("折叠后 token 减少", estimateTokens(r.messages) < estimateTokens(msgs), `→ ${estimateTokens(msgs)} → ${estimateTokens(r.messages)}`);
t("折叠标记含原长度", r.messages[1].content.startsWith("[已折叠"));

// 2) 幂等
const r2 = collapseOldMessages(r.messages, { keepRecentTurns: 3, maxChars: 100 });
t("重复折叠幂等", r2.collapsed === 0);

// 3) 含 tool_calls 的回复不折叠
const withTools = [{ role: "assistant", content: "x".repeat(1000), tool_calls: [{}] }];
t("含工具调用的回复不折叠", collapseOldMessages(withTools, { keepRecentTurns: 0, maxChars: 100 }).collapsed === 0);

// 4) 短回复不折叠
const short = [{ role: "assistant", content: "ok" }];
t("短回复不折叠", collapseOldMessages(short, { keepRecentTurns: 0, maxChars: 100 }).collapsed === 0);

// 5) 分层触发：助手长回复多 → 应走到 L2 或更深
const chatHeavy = [{ role: "system", content: "s" }];
for (let i = 0; i < 20; i++) {
  chatHeavy.push({ role: "user", content: `问题 ${i}` });
  chatHeavy.push({ role: "assistant", content: `回答 ${i} ` + "z".repeat(2000) });
}
const rc = await compactIfNeeded(chatHeavy, {
  contextWindow: 30_000,
  thresholdRatio: 0.3,
  keepRecentMessages: 4,
  onEvent: () => {},
});
t("大上下文触发压缩", rc.compacted === true, `→ level=${rc.level}`);
t("返回层级标记", ["L1", "L2", "L3"].includes(rc.level), `→ ${rc.level}`);
t("压缩后 token 显著下降", estimateTokens(rc.messages) < estimateTokens(chatHeavy) * 0.7, `→ ${estimateTokens(chatHeavy)} → ${estimateTokens(rc.messages)}`);

// 6) 小上下文不压缩
const small = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
const rs = await compactIfNeeded(small, { contextWindow: 1_000_000, thresholdRatio: 0.65 });
t("小上下文不压缩", rs.compacted === false && rs.level === null);


// 7) 分层：无工具结果 + 助手长回复 → 应在 L2 停下
const l2case = [{ role: "system", content: "s" }];
for (let i = 0; i < 15; i++) l2case.push({ role: "assistant", content: "x".repeat(2000) });
const rl2 = await compactIfNeeded(l2case, {
  contextWindow: 20_000,
  thresholdRatio: 0.3,
  keepRecentTurns: 2,
  onEvent: () => {},
});
t("L2 折叠即可解决时停在 L2", rl2.level === "L2", `→ level=${rl2.level}`);

// 8) 分层：大量工具结果 + 少量对话 → 应在 L1 停下
const l1case = [{ role: "system", content: "s" }];
for (let i = 0; i < 30; i++) {
  l1case.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "bash", arguments: "{}" } }] });
  l1case.push({ role: "tool", tool_call_id: `c${i}`, content: "y".repeat(800) });
}
const rl1 = await compactIfNeeded(l1case, {
  contextWindow: 20_000,
  thresholdRatio: 0.3,
  keepRecentToolResults: 2,
  onEvent: () => {},
});
t("L1 裁剪即可解决时停在 L1", rl1.level === "L1", `→ level=${rl1.level}`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
