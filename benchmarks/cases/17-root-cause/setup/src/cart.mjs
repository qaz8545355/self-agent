import { toCents, formatCents } from "./util/money.mjs";

const CATALOG = {
  apple: 1.239,
  banana: 0.996,
  cherry: 12.346,
};

export function priceOf(item) {
  return toCents(CATALOG[item]);
}

export function cartTotal(items) {
  return items.reduce((sum, item) => sum + priceOf(item), 0);
}

export function formatTotal(items) {
  return formatCents(cartTotal(items));
}
