/**
 * 解析上游导出的工时文件：每行一条记录。
 */
export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [name, minutes] = trimmed.split(":");
    if (!name || minutes === undefined) continue;

    rows.push({ name: name.trim(), minutes: Number(minutes) });
  }
  return rows;
}
