import { toCents, formatCents } from "./util/money.mjs";

export function applyPercentOff(amount, percent) {
  return toCents(amount * (1 - percent / 100));
}

export function formatDiscounted(amount, percent) {
  return formatCents(applyPercentOff(amount, percent));
}
