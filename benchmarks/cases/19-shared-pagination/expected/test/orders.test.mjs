import test from "node:test";
import assert from "node:assert";
import { listOrders } from "../src/orders.mjs";

const orders = ["o1", "o2", "o3", "o4", "o5"];

test("orders 第一页", () => {
  assert.deepStrictEqual(listOrders(orders, 1, 2), { items: ["o1", "o2"], totalPages: 3 });
});

test("orders 中间页", () => {
  assert.deepStrictEqual(listOrders(orders, 2, 2), { items: ["o3", "o4"], totalPages: 3 });
});

test("orders 空数组", () => {
  assert.deepStrictEqual(listOrders([], 1, 2), { items: [], totalPages: 0 });
});
