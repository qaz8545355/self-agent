/**
 * attachments.mjs — 消息里的 @文件 引用自动注入内容
 *
 * 移植自 Claude Code `utils/attachments.ts` 的 `extractAtMentionedFiles` 一族设计：
 * - `@path`、`@"带 空格 的路径"` 两种写法
 * - 支持行范围：`@src/a.mjs#L10-20`、`@src/a.mjs#L10`
 * - 去重；`@` 前必须是行首或空白（所以 `a@b.com` 不会被误认）
 * - 二进制文件跳过；超限截断；总数/单文件/总字节三重限制
 *
 * 与源码的差异：源码还处理图片、IDE 选区、诊断信息、记忆附件等；我们只做「文件引用注入」。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 附件限制（源码记忆类常量是 200 行 / 4096 字节，这里按普通文件附件放宽） */
export const ATTACHMENT_LIMITS = {
  maxFiles: 5,
  maxBytesPerFile: 20000,
  maxTotalBytes: 50000,
};

const QUOTED_REF_RE = /(^|\s)@"([^"]+)"/g;
const PLAIN_REF_RE = /(^|\s)@([^\s@]+)/g;

/**
 * 提取 @ 引用的文件（去重，保持出现顺序）。
 * 引号写法优先，普通写法里跳过引号开头的那部分。
 */
export function extractAtMentionedFiles(content) {
  const text = String(content ?? "");
  const out = [];

  for (const m of text.matchAll(QUOTED_REF_RE)) {
    if (m[2] && !m[2].endsWith(" (agent)")) out.push(m[2]);
  }
  for (const m of text.matchAll(PLAIN_REF_RE)) {
    const ref = m[2];
    if (!ref || ref.startsWith('"')) continue;
    out.push(ref);
  }

  return [...new Set(out)];
}

/** 解析行范围语法：`a.mjs#L10-20` → {path, start, end} */
export function parseFileRef(ref) {
  const m = String(ref).match(/^(.*?)#L(\d+)(?:-(\d+))?$/i);
  if (!m) return { path: String(ref), start: null, end: null };
  return { path: m[1], start: Number(m[2]), end: m[3] ? Number(m[3]) : Number(m[2]) };
}

/** 二进制检测：前 8KB 出现 NUL 即视为二进制 */
export function isBinaryBuffer(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * 读取单个 @ 引用。
 * @returns {{ok:true, ref:string, path:string, content:string, truncated:boolean, bytes:number}
 *          |{ok:false, ref:string, reason:string}}
 */
export function readAttachment(ref, cwd = process.cwd(), limits = ATTACHMENT_LIMITS) {
  const { path: rel, start, end } = parseFileRef(ref);
  const abs = path.resolve(cwd, rel);

  if (!existsSync(abs)) return { ok: false, ref, reason: "not_found" };

  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return { ok: false, ref, reason: "stat_failed" };
  }
  if (stat.isDirectory()) return { ok: false, ref, reason: "is_directory" };

  let buf;
  try {
    buf = readFileSync(abs);
  } catch {
    return { ok: false, ref, reason: "read_failed" };
  }
  if (isBinaryBuffer(buf)) return { ok: false, ref, reason: "binary" };

  let text = buf.toString("utf8");
  let truncated = false;

  if (start !== null) {
    const lines = text.split("\n");
    const from = Math.max(1, start);
    const to = Math.min(lines.length, end ?? lines.length);
    text = lines.slice(from - 1, to).join("\n");
  }

  if (Buffer.byteLength(text, "utf8") > limits.maxBytesPerFile) {
    text = Buffer.from(text, "utf8").subarray(0, limits.maxBytesPerFile).toString("utf8");
    truncated = true;
  }

  return { ok: true, ref, path: abs, content: text, truncated, bytes: stat.size };
}

/**
 * 收集一条消息里的全部附件。
 * @returns {{attachments:Array, skipped:Array<{ref:string, reason:string}>}}
 */
export function collectAttachments(content, options = {}) {
  const { cwd = process.cwd(), limits = ATTACHMENT_LIMITS } = options;
  const refs = extractAtMentionedFiles(content);
  const attachments = [];
  const skipped = [];
  let total = 0;

  for (const ref of refs) {
    if (attachments.length >= limits.maxFiles) {
      skipped.push({ ref, reason: "too_many_files" });
      continue;
    }
    const a = readAttachment(ref, cwd, limits);
    if (!a.ok) {
      skipped.push({ ref, reason: a.reason });
      continue;
    }
    if (total + a.content.length > limits.maxTotalBytes) {
      skipped.push({ ref, reason: "total_limit" });
      continue;
    }
    total += a.content.length;
    attachments.push(a);
  }

  return { attachments, skipped };
}

/** 拼成注入用户消息的文本块 */
export function formatAttachments(attachments) {
  return attachments
    .map((a) => {
      const head = `### ${a.ref}${a.truncated ? "（已截断）" : ""}`;
      const fence = a.content.includes("```") ? "~~~" : "```";
      return `${head}\n${fence}\n${a.content}\n${fence}`;
    })
    .join("\n\n");
}
