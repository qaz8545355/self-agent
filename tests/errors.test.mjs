import { parsePromptTooLong, classifyError, withRetry, ERROR_KINDS } from "../errors.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) prompt 过长解析
const p1 = parsePromptTooLong("prompt is too long: 137500 tokens > 135000 maximum");
t("解析 token 差值", p1 && p1.actual === 137500 && p1.max === 135000 && p1.gap === 2500, `→ ${JSON.stringify(p1)}`);
const p2 = parsePromptTooLong("context length exceeded: 1,050,000 tokens > 1,000,000");
t("解析带逗号数字", p2 && p2.actual === 1050000 && p2.gap === 50000);
t("无匹配返回 null", parsePromptTooLong("some other error") === null);

// 2) 错误分类
const cases = [
  ["prompt is too long: 137500 tokens > 135000 maximum", ERROR_KINDS.PROMPT_TOO_LONG, false],
  ["Rate limit reached, please retry", ERROR_KINDS.RATE_LIMIT, true],
  ["The server is overloaded", ERROR_KINDS.OVERLOADED, true],
  ["invalid api key", ERROR_KINDS.AUTH, false],
  ["insufficient balance", ERROR_KINDS.BALANCE, false],
  ["fetch failed: ECONNRESET", ERROR_KINDS.NETWORK, true],
  ["something weird", ERROR_KINDS.UNKNOWN, false],
];
for (const [msg, kind, retryable] of cases) {
  const info = classifyError(new Error(msg));
  t(`分类: ${kind}`, info.kind === kind && info.retryable === retryable, `→ ${info.kind}/${info.retryable}`);
}

// 3) prompt 过长附带 tokenInfo
const tooLong = classifyError(new Error("prompt is too long: 200000 tokens > 128000 maximum"));
t("过长错误带 shouldCompact + tokenInfo", tooLong.shouldCompact === true && tooLong.tokenInfo?.gap === 72000);

// 4) 状态码分类
t("HTTP 429 → rate_limit", classifyError({ status: 429, message: "x" }).kind === ERROR_KINDS.RATE_LIMIT);
t("HTTP 401 → auth", classifyError({ status: 401, message: "x" }).kind === ERROR_KINDS.AUTH);

// 5) withRetry：不可重试直接抛
let calls = 0;
try {
  await withRetry(async () => { calls++; throw new Error("something weird"); }, { maxRetries: 3 });
  t("不可重试错误直接抛出", false);
} catch (e) {
  t("不可重试错误直接抛出", calls === 1 && e.classification?.kind === ERROR_KINDS.UNKNOWN, `（调用 ${calls} 次）`);
}

// 6) withRetry：可重试会重试（用 2 次失败后成功，等待约 2s）
let attempts = 0;
const retryEvents = [];
const result = await withRetry(async () => {
  attempts++;
  if (attempts < 3) throw new Error("fetch failed: ECONNRESET");
  return "ok";
}, { maxRetries: 3, onRetry: (i) => retryEvents.push(i.kind) });
t("可重试错误最终成功", result === "ok" && attempts === 3, `（尝试 ${attempts} 次）`);
t("onRetry 收到分类", retryEvents.length === 2 && retryEvents.every((k) => k === ERROR_KINDS.NETWORK));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
