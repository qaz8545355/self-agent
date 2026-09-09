import { aggregate, toHours } from "./compute.mjs";

/**
 * 渲染报告：每行「姓名 小时数」，保持输入顺序。
 */
export function renderReport(rows) {
  const totals = aggregate(rows);
  const lines = [];
  for (const [name, minutes] of totals) {
    lines.push(`${name} ${toHours(minutes)}`);
  }
  return `${lines.join("\n")}\n`;
}
