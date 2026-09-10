`node --test` 有一个测试失败（search 的空结果）。同时 `src/` 下四个模块 `users.mjs / orders.mjs / logs.mjs / search.mjs` 各自复制了一份 `paginate()`，行为并不一致。

请完成：

1. 把分页逻辑抽成**单一实现** `src/paginate.mjs`，四个模块改为引用它（不得再保留各自的拷贝）。
2. 按下面的规范统一行为，修正现有偏差。
3. 保持每个模块的公开导出名与参数个数不变。

分页规范：`paginate(items, page, perPage) → { items, totalPages }`

- `page < 1` 或非整数（如 `0`、`-1`、`1.5`）→ 抛 `RangeError`。
- 不得修改传入数组（不得 `sort` / `splice` 原数组）。
- `items` 为当前页元素；`totalPages = Math.ceil(items.length / perPage)`。
- 末页必须包含剩余项，不得 off-by-one。
- 空数组 → `{ items: [], totalPages: 0 }`。

约束：

- 只允许修改 `src/` 下的代码，**不得修改 `test/`**（验证会逐字节比对测试文件）。
- 四个模块的公开 API 不变（导出名与参数个数）：
  - `users.mjs`：`listUsers(users, page, perPage)`
  - `orders.mjs`：`listOrders(orders, page, perPage)`
  - `logs.mjs`：`listLogs(logs, page, perPage)`
  - `search.mjs`：`searchItems(items, page, perPage)`
- 验证会在**可见测试之外的输入**上，把四个模块的行为与参考实现逐项比对，并检查全项目只有一个 `paginate` 函数定义、且四个模块都从它导入。

修完运行 `node --test` 确认全绿。
