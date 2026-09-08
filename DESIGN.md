# self-agent — 自研 coding agent（阶段 ③）

> 目标：用自有实现替换 Claude Code 的核心模块，形成可合法使用、可维护的 coding agent 内核。
> 设计借鉴（非复制）：Claude Code 的工具契约 / 权限决策 / 单循环状态机；DSH 的技能与记忆思路。

## 架构

```
cli.mjs            入口：参数解析、REPL/单次执行
  └─ agent.mjs     核心循环（单状态机）
       ├─ llm.mjs      模型客户端（OpenAI 兼容，走 1MMC 中转）
       ├─ tools.mjs    工具注册表（契约式声明）
       │    ├─ bash           执行命令（危险拦截）
       │    ├─ read_file      读文件
       │    ├─ write_file     写文件（路径校验）
       │    ├─ edit_file      精确替换编辑
       │    ├─ glob           文件名匹配
       │    └─ grep           内容搜索
       ├─ safety.mjs   安全层：路径校验 + 命令策略（复用 path-safety.mjs）
       └─ session.mjs  会话持久化（JSON，可 resume）
```

## 核心设计（借鉴要点）

1. **工具即契约**：每个工具声明 `name/description/parameters/execute/isReadOnly`
2. **单循环状态机**：`模型 → 工具调用 → 回填 → 继续`，直到无工具调用或达到上限
3. **分层终止**：无工具请求 → 步数上限 → token 预算
4. **安全前置**：写文件/删除类操作先过路径校验；bash 命令先过策略匹配
5. **工具配对**：每次 tool_call 必有对应 tool result（含错误）
6. **会话持久化**：消息数组落盘，支持 `--resume`

## 与 Claude Code 的差异（自有实现）

| 维度 | Claude Code | self-agent |
|---|---|---|
| 语言/运行时 | TypeScript + Bun + React Ink | 纯 Node ESM（无重依赖） |
| UI | 终端 React | 纯文本流式 |
| 工具数 | 41 | MVP 6 个 |
| 权限 | 多层规则引擎 | 路径校验 + 正则策略（够用） |
| 上下文 | 四层压缩 | token 估算 + 阈值截断（MVP） |

## 里程碑

- [x] M1：设计与骨架
- [x] M2：核心循环 + 6 工具 + 安全层（2026-09-09 端到端跑通，安全层 14/14 测试通过）
- [x] M3：token 估算 + 两层压缩（2026-09-09，单元 12/12 + 集成触发验证）
- [x] M4：子代理（2026-09-09，端到端 + 递归防护 4/4）
- [x] M5：技能加载（2026-09-09，44 个技能可列出/加载，单元 12/12 + 端到端验证）

## 扩展（2026-09-09）

- [x] M6：流式输出（SSE，`--stream`）
- [x] M7：工具扩充（web_fetch / todo_write / lark_send，共 11 个）
- [x] M8：真实运维任务验证（服务器巡检 3 步完成）
- [x] M9：飞书集成（结果推送到飞书）
- [x] M10：发布准备（README / LICENSE / package.json）

- [x] M11：生命周期钩子（2026-09-09，4 个事件 + 退出码契约，单元 9/9 + 端到端拦截验证）
- [x] M12：git 只读工具（12 个工具）
