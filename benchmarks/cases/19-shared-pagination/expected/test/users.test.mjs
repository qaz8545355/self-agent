import test from "node:test";
import assert from "node:assert";
import { listUsers } from "../src/users.mjs";

const users = ["u1", "u2", "u3", "u4", "u5"];

test("users 第一页", () => {
  assert.deepStrictEqual(listUsers(users, 1, 2), { items: ["u1", "u2"], totalPages: 3 });
});

test("users 中间页", () => {
  assert.deepStrictEqual(listUsers(users, 2, 2), { items: ["u3", "u4"], totalPages: 3 });
});

test("users 末页含剩余项", () => {
  assert.deepStrictEqual(listUsers(users, 3, 2), { items: ["u5"], totalPages: 3 });
});

test("users 空数组", () => {
  assert.deepStrictEqual(listUsers([], 1, 2), { items: [], totalPages: 0 });
});
