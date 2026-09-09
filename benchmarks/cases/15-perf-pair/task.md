`pairs.mjs` 里的 `findPair(numbers, target)` 要返回两个下标 `[i, j]`（`i < j`）使得 `numbers[i] + numbers[j] === target`；找不到时返回 `null`。

功能是对的，但 `node --test` 跑得极慢：最后一个用例要求 6 万个元素的输入在 1 秒内完成，现在远达不到。

请优化实现，让全部测试通过。约束：
- 保持函数签名和返回值语义不变（返回 `[i, j]` 或 `null`）
- 不要修改 `pairs.test.mjs`
- 不要引入第三方依赖
