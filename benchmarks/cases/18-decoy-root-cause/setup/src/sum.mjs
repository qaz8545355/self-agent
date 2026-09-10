export function sumRows(rows) {
  let total = 0;
  for (const row of rows) {
    const value = Number(row.amount);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}
