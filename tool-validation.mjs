/**
 * tool-validation.mjs — 工具输入校验 + schema 未发送提示 + 工具错误分类
 *
 * 移植自 Claude Code `services/tools/toolExecution.ts`：
 * - `classifyToolError`：把工具异常归类（errno code / 自定义错误名 / Error）
 * - `buildSchemaNotSentHint`：当模型调用了一个**没随本次请求发送 schema** 的工具时，
 *   提示它先用工具检索加载（源码原文：schema 没发出去，模型会把数组/数字/布尔写成字符串，
 *   客户端校验直接拒绝 —— 与其让模型瞎猜，不如明确告诉它先加载）
 *
 * 校验用轻量 JSON Schema 子集（type / required / properties / enum），不引入 zod 依赖。
 */

/** 工具异常归类（对齐 classifyToolError） */
export function classifyToolError(error) {
  if (!error) return "UnknownError";
  const code = error?.code;
  // Node.js 文件系统错误：ENOENT / EACCES 等，比构造函数名更有用
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) return `Error:${code}`;
  const name = error?.name;
  if (typeof name === "string" && name !== "Error" && name.length > 3) return name.slice(0, 60);
  return "Error";
}

function typeName(v) {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  return typeof v;
}

function checkType(v, t) {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    default:
      return true; // 未知类型不拦
  }
}

/**
 * 轻量校验工具参数。
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateToolInput(schema, args) {
  const errors = [];
  if (!schema || typeof schema !== "object" || schema.type !== "object") return { ok: true, errors };

  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, errors: [`参数应为对象，实际 ${typeName(args)}`] };
  }

  for (const key of schema.required ?? []) {
    if (args[key] === undefined) errors.push(`缺少必填参数：${key}`);
  }

  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    const v = args[key];
    if (v === undefined) continue;
    const type = spec?.type;
    if (type && !checkType(v, type)) {
      errors.push(`参数 ${key} 类型应为 ${type}，实际 ${typeName(v)}`);
      continue;
    }
    if (type === "string" && Array.isArray(spec?.enum) && spec.enum.length && !spec.enum.includes(v)) {
      errors.push(`参数 ${key} 取值必须是 ${spec.enum.join(" / ")}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 模型调用了未发送 schema 的工具时的提示；工具在已发送集合里则返回 null。
 */
export function buildSchemaNotSentHint(toolName, activeToolNames = []) {
  if (!Array.isArray(activeToolNames) || activeToolNames.length === 0) return null;
  if (activeToolNames.includes(toolName)) return null;
  return (
    `\n\n注意：工具 ${toolName} 的 schema 没有随本次请求发送（当前工具集：${activeToolNames.length} 个）。` +
    `模型容易因此把数组/数字/布尔值写成字符串导致参数错误。` +
    `请先用 tool_search 加载它（query 用 "select:${toolName}"），再重试本次调用。`
  );
}
