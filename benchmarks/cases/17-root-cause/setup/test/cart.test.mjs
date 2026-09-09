import test from "node:test";
import assert from "node:assert";
import { priceOf, cartTotal, formatTotal } from "../src/cart.mjs";

test("单价换算成分", () => {
  assert.strictEqual(priceOf("apple"), 124);
  assert.strictEqual(priceOf("banana"), 100);
});

test("购物车总价", () => {
  assert.strictEqual(cartTotal(["apple", "banana"]), 224);
});

test("格式化总价", () => {
  assert.strictEqual(formatTotal(["cherry"]), "$12.35");
});
