/**
 * 按人名汇总分钟数，并换算成小时。
 */
export function aggregate(rows) {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row.name, (totals.get(row.name) ?? 0) + row.minutes);
  }
  return totals;
}

export function toHours(minutes) {
  return (minutes / 60).toFixed(2);
}

export function totalMinutes(rows) {
  return rows.reduce((sum, row) => sum + row.minutes, 0);
}
