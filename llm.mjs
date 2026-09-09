/**
 * llm.mjs — 模型客户端（OpenAI 兼容，走 1MMC 中转站）
 */
import "./env.mjs";
import { withRetry } from "./errors.mjs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CREDS = process.env.SELF_AGENT_CREDS ?? path.join(os.homedir(), ".dsh", ".credentials.yaml");

function readKey(envName) {
  if (process.env[envName]) return process.env[envName];
  try {
    const m = readFileSync(CREDS, "utf8").match(new RegExp(`^\\s*${envName}:\\s*(\\S+)`, "m"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** 合并调用方 signal 与默认超时（避免请求永久挂起） */
function withTimeout(signal, ms = Number(process.env.SELF_AGENT_TIMEOUT_MS) || 180_000) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export const DEFAULTS = {
  baseURL: process.env.SELF_AGENT_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.SELF_AGENT_MODEL ?? "gpt-4o-mini",
  keyEnv: process.env.SELF_AGENT_KEY_ENV ?? "OPENAI_API_KEY",
};

/**
 * 单次对话请求。
 * @returns {{content: string, tool_calls?: Array, usage?: object, model?: string}}
 */
export async function chat({ messages, tools, model, baseURL, apiKey, temperature = 0, maxTokens = 8192, signal, onRetry }) {
  const key = apiKey ?? readKey(DEFAULTS.keyEnv);
  if (!key) throw new Error(`缺少 API key（${DEFAULTS.keyEnv}）`);
  const url = `${baseURL ?? DEFAULTS.baseURL}/chat/completions`;
  const body = {
    model: model ?? DEFAULTS.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  // 带分类的自动重试：限流/过载/网络错误指数退避；密钥/余额错误直接失败
  return withRetry(
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: withTimeout(signal),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const err = new Error(`模型返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`模型调用失败（HTTP ${res.status}）：${data?.error?.message ?? text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      const choice = data.choices?.[0];
      if (!choice) throw new Error(`模型无返回：${text.slice(0, 200)}`);
      return {
        content: choice.message?.content ?? "",
        tool_calls: choice.message?.tool_calls,
        usage: data.usage,
        model: data.model,
        finish_reason: choice.finish_reason,
      };
    },
    { onRetry }
  );
}

/**
 * 流式对话请求（SSE）。
 * @param {(chunk:string)=>void} [onDelta] 每收到一段文本时回调
 * @returns {Promise<{content:string, tool_calls?:Array, model?:string, finish_reason?:string}>}
 */
export async function chatStream({
  messages,
  tools,
  model,
  baseURL,
  apiKey,
  temperature = 0,
  maxTokens = 8192,
  onDelta,
  signal,
}) {
  const key = apiKey ?? readKey(DEFAULTS.keyEnv);
  if (!key) throw new Error(`缺少 API key（${DEFAULTS.keyEnv}）`);
  const url = `${baseURL ?? DEFAULTS.baseURL}/chat/completions`;
  const body = {
    model: model ?? DEFAULTS.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: withTimeout(signal),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`模型调用失败（HTTP ${res.status}）：${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finish_reason = null;
  const toolMap = new Map(); // index -> { id, name, arguments }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const d = choice.delta ?? {};
      if (d.content) {
        content += d.content;
        onDelta?.(d.content);
      }
      if (d.tool_calls) {
        for (const tc of d.tool_calls) {
          const i = tc.index ?? 0;
          const cur = toolMap.get(i) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          toolMap.set(i, cur);
        }
      }
      if (choice.finish_reason) finish_reason = choice.finish_reason;
    }
  }

  const tool_calls = [...toolMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({ id: v.id, type: "function", function: { name: v.name, arguments: v.arguments } }));

  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    model,
    finish_reason,
  };
}
