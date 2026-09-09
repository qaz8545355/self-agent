/** 把「元」金额换算成「分」（精确到分） */
export function toCents(amount) {
  return Math.floor(amount * 100);
}

/** 把「分」格式化成 $x.xx */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}
