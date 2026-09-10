import { estimateTextTokens, estimateTokens } from "../context.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// ── 文本估算：按字符类型加权 ──
t("空串为 0", estimateTextTokens("") === 0);
t("英文 ≈0.28 token/字符", estimateTextTokens("a".repeat(360)) === 101, `→ ${estimateTextTokens("a".repeat(360))}`);
t("中文 ≈1 token/字", estimateTextTokens("中".repeat(100)) === 100, `→ ${estimateTextTokens("中".repeat(100))}`);
t("中文四字 = 4 token", estimateTextTokens("你好世界") === 4);
t("中英混合", estimateTextTokens("hello世界") === 4, `→ ${estimateTextTokens("hello世界")}`);
t("中文标点计入 CJK", estimateTextTokens("。，！") === 3);
t("全角字符计入 CJK", estimateTextTokens("ＡＢ") === 2);
t("日文假名计入 CJK", estimateTextTokens("かな") === 2);
t("换行与空格算普通字符", estimateTextTokens("\n\n") === 1);
t("null 安全", estimateTextTokens(null) === 0);

// ── 更准的对比：旧实现（长度/2）对中文会低估 ──
const cjk100 = "中".repeat(100);
const oldEstimate = Math.ceil(cjk100.length / 2);
t("中文不再被低估一半", estimateTextTokens(cjk100) === 100 && oldEstimate === 50);

// ── 消息数组 ──
const one = estimateTokens([{ role: "user", content: "hi" }]);
t("消息含固定开销 4", one === estimateTextTokens("hi") + 4, `→ ${one}`);
const withCalls = estimateTokens([
  { role: "assistant", content: "", tool_calls: [{ id: "1", function: { name: "bash", arguments: '{"command":"ls"}' } }] },
]);
t("tool_calls 计入估算", withCalls > 4);
t("空数组为 0", estimateTokens([]) === 0);
t("非字符串 content 序列化后估算", estimateTokens([{ role: "user", content: [{ type: "text", text: "中文内容" }] }]) > 4);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
