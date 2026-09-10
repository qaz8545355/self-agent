export function formatAmount(amount) {
  return String(Math.round(amount * 100) / 100);
}
