import { estimateTokens, shouldCompact, trimToolResults, compactIfNeeded } from "../context.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) token 估算单调性
const m1 = [{ role: "user", content: "hello" }];
const m2 = [{ role: "user", content: "hello".repeat(100) }];
t("token 估算随内容增长", estimateTokens(m2) > estimateTokens(m1));
t("空数组为 0", estimateTokens([]) === 0);

// 2) 阈值判断
const big = [{ role: "user", content: "x".repeat(200_000) }];
t("大上下文触发压缩", shouldCompact(big, { contextWindow: 100_000, thresholdRatio: 0.5 }));
t("小上下文不触发", !shouldCompact(m1, { contextWindow: 1_000_000, thresholdRatio: 0.65 }));

// 3) L1 裁剪旧工具结果
const msgs = [];
msgs.push({ role: "system", content: "sys" });
for (let i = 0; i < 12; i++) {
  msgs.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "bash", arguments: "{}" } }] });
  msgs.push({ role: "tool", tool_call_id: `c${i}`, content: `result-${i}-${"y".repeat(500)}` });
}
const l1 = trimToolResults(msgs, { keepRecentToolResults: 4 });
t("L1 裁剪了旧工具结果", l1.trimmed === 8, `（裁剪 ${l1.trimmed} 条）`);
const toolMsgs = l1.messages.filter((m) => m.role === "tool");
t("最近 4 条完整保留", toolMsgs.slice(-4).every((m) => !m.content.startsWith("[已裁剪")));
t("消息总数不变（保持工具配对）", l1.messages.length === msgs.length);

// 4) 幂等：重复裁剪不叠加
const l1b = trimToolResults(l1.messages, { keepRecentToolResults: 4 });
t("重复裁剪幂等", l1b.trimmed === 0);

// 5) L2 摘要（用假模型，避免真实调用）
let fakeCalled = 0;
const fake = async () => { fakeCalled++; return { content: "这是摘要内容" }; };
// 直接验证 summarizeHistory 的裁剪逻辑通过 compactIfNeeded 的 L2 分支
const many = [{ role: "system", content: "sys" }];
for (let i = 0; i < 30; i++) many.push({ role: "user", content: `msg-${i}-` + "z".repeat(2000) });
const r = await compactIfNeeded(many, {
  contextWindow: 20_000, thresholdRatio: 0.5, keepRecentMessages: 6,
  onEvent: () => {},
});
t("超阈值触发压缩", r.compacted);
t("压缩后消息数大幅减少", r.messages.length < many.length, `（${many.length} → ${r.messages.length}）`);
t("保留 system 消息", r.messages.some((m) => m.role === "system"));
t("包含压缩边界标记", r.messages.some((m) => typeof m.content === "string" && m.content.includes("[上下文压缩]")));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
