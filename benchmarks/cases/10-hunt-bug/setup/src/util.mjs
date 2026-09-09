export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
