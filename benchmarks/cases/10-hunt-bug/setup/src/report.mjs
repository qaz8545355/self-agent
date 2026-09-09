import { orders } from "./data.mjs";

export function countOrders() {
  return orders.length;
}

export function sumOrders() {
  return orders.reduce((acc, o) => acc + o.amount, 0);
}
