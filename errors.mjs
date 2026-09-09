/**
 * errors.mjs — API 错误分类与重试（移植 Claude Code services/api/errors.ts 的设计）
 *
 * 核心思想：把模型返回的模糊错误消息分类，针对性处理：
 *   - prompt 过长 → 解析 token 差值，触发压缩后重试
 *   - 限流/过载/网络 → 指数退避重试
 *   - 密钥/余额 → 直接失败，不浪费时间重试
 */

export const ERROR_KINDS = {
  PROMPT_TOO_LONG: "prompt_too_long",
  RATE_LIMIT: "rate_limit",
  OVERLOADED: "overloaded",
  AUTH: "auth",
  BALANCE: "balance",
  NETWORK: "network",
  UNKNOWN: "unknown",
};

/**
 * 从错误消息解析 prompt 超限的 token 差值。
 * 例："prompt is too long: 137500 tokens > 135000 maximum"
 * @returns {{actual:number, max:number, gap:number}|null}
 */
export function parsePromptTooLong(message) {
  const m = String(message ?? "").match(/(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i);
  if (!m) return null;
  const actual = Number(m[1].replace(/,/g, ""));
  const max = Number(m[2].replace(/,/g, ""));
  if (!Number.isFinite(actual) || !Number.isFinite(max)) return null;
  return { actual, max, gap: actual - max };
}

/**
 * 分类一个错误。
 * @param {unknown} err
 * @returns {{kind:string, retryable:boolean, shouldCompact?:boolean, waitMs?:number, tokenInfo?:object|null}}
 */
export function classifyError(err) {
  const msg = String(err?.message ?? err ?? "");
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? 0);

  if (
    status === 400 &&
    /prompt is too long|context length|context_length_exceeded|maximum context|too many tokens/i.test(msg)
  ) {
    return { kind: ERROR_KINDS.PROMPT_TOO_LONG, retryable: false, shouldCompact: true, tokenInfo: parsePromptTooLong(msg) };
  }
  if (/prompt is too long|context length|context_length_exceeded|maximum context|too many tokens/i.test(msg)) {
    return { kind: ERROR_KINDS.PROMPT_TOO_LONG, retryable: false, shouldCompact: true, tokenInfo: parsePromptTooLong(msg) };
  }
  if (status === 429 || /rate limit|too many requests|quota exceeded|请求过于频繁/i.test(msg)) {
    return { kind: ERROR_KINDS.RATE_LIMIT, retryable: true, waitMs: 5000 };
  }
  if (status === 529 || status === 503 || /overloaded|server is busy|temporarily unavailable|繁忙/i.test(msg)) {
    return { kind: ERROR_KINDS.OVERLOADED, retryable: true, waitMs: 3000 };
  }
  if (status === 401 || status === 403 || /invalid api key|unauthorized|not logged in|认证失败/i.test(msg)) {
    return { kind: ERROR_KINDS.AUTH, retryable: false };
  }
  if (/insufficient|balance|credit|余额不足|欠费/i.test(msg)) {
    return { kind: ERROR_KINDS.BALANCE, retryable: false };
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed|network|socket hang up/i.test(msg)) {
    return { kind: ERROR_KINDS.NETWORK, retryable: true, waitMs: 2000 };
  }
  return { kind: ERROR_KINDS.UNKNOWN, retryable: false };
}

/**
 * 带分类的重试包装：只对可重试错误做指数退避。
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{maxRetries?:number, onRetry?:(info:object)=>void}} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { maxRetries = 2, onRetry = () => {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const info = classifyError(e);
      if (!info.retryable || attempt === maxRetries) {
        if (e && typeof e === "object") e.classification = info;
        throw e;
      }
      const waitMs = (info.waitMs ?? 2000) * Math.pow(2, attempt);
      onRetry({ attempt: attempt + 1, kind: info.kind, waitMs, error: String(e?.message ?? e) });
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}
