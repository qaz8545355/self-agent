/**
 * 通用工具函数集合（历史遗留，逐步迁移中）。
 * 这里只有纯函数，不涉及文件读写。
 */

// --- util 001 ---
export function clamp1(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 002 ---
export function padStart2(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 003 ---
export function safeNumber3(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 004 ---
export function truncate4(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 005 ---
export function uniq5(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 006 ---
export function chunk6(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 007 ---
export function sumBy7(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 008 ---
export function formatBytes8(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 009 ---
export function slugify9(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 010 ---
export function isBlank10(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 011 ---
export function clamp11(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 012 ---
export function padStart12(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 013 ---
export function safeNumber13(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 014 ---
export function truncate14(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 015 ---
export function uniq15(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 016 ---
export function chunk16(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 017 ---
export function sumBy17(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 018 ---
export function formatBytes18(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 019 ---
export function slugify19(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 020 ---
export function isBlank20(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 021 ---
export function clamp21(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 022 ---
export function padStart22(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 023 ---
export function safeNumber23(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 024 ---
export function truncate24(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 025 ---
export function uniq25(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 026 ---
export function chunk26(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 027 ---
export function sumBy27(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 028 ---
export function formatBytes28(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 029 ---
export function slugify29(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 030 ---
export function isBlank30(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 031 ---
export function clamp31(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 032 ---
export function padStart32(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 033 ---
export function safeNumber33(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 034 ---
export function truncate34(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 035 ---
export function uniq35(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 036 ---
export function chunk36(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 037 ---
export function sumBy37(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 038 ---
export function formatBytes38(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 039 ---
export function slugify39(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 040 ---
export function isBlank40(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 041 ---
export function clamp41(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 042 ---
export function padStart42(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 043 ---
export function safeNumber43(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 044 ---
export function truncate44(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 045 ---
export function uniq45(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 046 ---
export function chunk46(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 047 ---
export function sumBy47(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 048 ---
export function formatBytes48(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 049 ---
export function slugify49(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 050 ---
export function isBlank50(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 051 ---
export function clamp51(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 052 ---
export function padStart52(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 053 ---
export function safeNumber53(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 054 ---
export function truncate54(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 055 ---
export function uniq55(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 056 ---
export function chunk56(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 057 ---
export function sumBy57(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 058 ---
export function formatBytes58(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 059 ---
export function slugify59(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 060 ---
export function isBlank60(text) {
  return String(text ?? "").trim().length === 0;
}

// --- util 061 ---
export function clamp61(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

// --- util 062 ---
export function padStart62(text, width, fill = " ") {
  const s = String(text);
  return s.length >= width ? s : fill.repeat(width - s.length) + s;
}

// --- util 063 ---
export function safeNumber63(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

// --- util 064 ---
export function truncate64(text, limit = 80) {
  const s = String(text);
  return s.length <= limit ? s : s.slice(0, limit - 1) + "…";
}

// --- util 065 ---
export function uniq65(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

// --- util 066 ---
export function chunk66(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

// --- util 067 ---
export function sumBy67(list, pick) {
  let total = 0;
  for (const item of list) {
    const v = Number(pick(item));
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

// --- util 068 ---
export function formatBytes68(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// --- util 069 ---
export function slugify69(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- util 070 ---
export function isBlank70(text) {
  return String(text ?? "").trim().length === 0;
}

