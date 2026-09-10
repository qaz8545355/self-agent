# Claude Code 学习笔记（十一轮完整版 · 28 项机制）

> 基于 2026-03-31 泄露的 Claude Code 源码（`/root/dsh/claude-code-pkg/`，约 1900 文件 / 51 万行 TS）。
> 本笔记只记录**学到并验证过**的设计，以及我们自己的实现与取舍。

## 总览

| # | 机制 | 源码出处 | 我们的实现 | 状态 |
|---|---|---|---|---|
| 1 | 工具即契约 | `src/Tool.ts` | `self-agent/tools.mjs` | ✅ |
| 2 | 权限决策流水线 | `utils/permissions/permissions.ts` | `execpolicy-guard.mjs` + `path-safety.mjs` | ✅ |
| 3 | 上下文四层压缩 | `services/compact/*` | `context.mjs`（两层简化） | ✅ |
| 4 | 子代理 fresh/fork | `tools/AgentTool/*` | `tools.mjs` 的 subagent | ✅ |
| 5 | 单循环状态机 | `query.ts` | `agent.mjs` | ✅ |
| 6 | 生命周期钩子 | `types/hooks.ts` 等 | `hooks.mjs` | ✅ |
| 7 | 记忆时效性 | `memdir/memoryAge.ts` | `memory-age.mjs` + bot-bridge | ✅ |
| 8 | 错误分类重试 | `services/api/errors.ts` | `errors.mjs` | ✅ |
| 9 | 依赖检测 | `utils/binaryCheck.ts` | `binary-check.mjs` | ✅ |
| 10 | 限流解析 | `services/rateLimitMessages.ts` | `errors.mjs`（parseRateLimitInfo） | ✅ |
| 11 | 后台清理 | `utils/backgroundHousekeeping.ts` | `session.mjs`（pruneSessions） | ✅ |
| 12 | QueryGuard 防重入 | `utils/QueryGuard.ts` | — | ⏸️ 取舍 |
| 13 | 命令级只读判定 | `utils/shell/readOnlyCommandValidation.ts` | `readonly-commands.mjs` | ✅ |
| 14 | 文件改动历史/回滚 | `utils/fileHistory.ts` | `file-history.mjs` + `file_history` 工具 | ✅ |
| 15 | 记忆文件注入 | `utils/claudemd.ts` | `memory-files.mjs` | ✅ |
| 16 | 技能参数 + 条件技能 | `skills/loadSkillsDir.ts` + `utils/argumentSubstitution.ts` | `skills.mjs` | ✅ |
| 17 | @文件附件注入 | `utils/attachments.ts` | `attachments.mjs` | ✅ |
| 18 | 后台任务运行时 | `src/tasks/` | `background-tasks.mjs` + `bg_task` | ✅ |
| 19 | worker 并行 | `coordinator/coordinatorMode.ts` | `subagent` + worktree 隔离并行 | ✅ |
| 20 | 工具输入校验 + schema 提示 | `services/tools/toolExecution.ts` | `tool-validation.mjs` | ✅ |
| 21 | prompt 状态诊断 | `services/api/promptCacheBreakDetection.ts` | `prompt-state.mjs` | ✅ |
| 22 | MCP 多作用域 + 审批 + 命名空间 | `services/mcp/config.ts` | `mcp.mjs`（增强） | ✅ |
| 23 | 权限决策审计 | `utils/permissions/yoloClassifier.ts` | `permission-audit.mjs` | ✅ |
| 24 | 重定向目标检查 | `utils/bash/ast.ts`（路径提取思路） | `safety.mjs`（增强） | ✅ |
| 25 | 文件分页读取 | `utils/Cursor.ts` | `read_file` 的 offset/limit | ✅ |
| 26 | CJK 感知 token 估算 | `services/tokenEstimation.ts` | `context.mjs`（增强） | ✅ |
| 27 | 生命周期钩子扩展（11 事件） | `types/hooks.ts` | `hooks.mjs`（增强） | ✅ |
| 28 | 命令模板 | `commands/`（189 文件） | `skills.mjs` + `~/.self-agent/commands` | ✅ |

---

## 1. 工具即契约

**源码**：`src/Tool.ts`（792 行）

每个工具声明 `inputSchema` / `checkPermissions` / `isReadOnly` / `isConcurrencySafe` / `isDestructive` / `getPath`，权限层只做编排。

**我们的实现**：`tools.mjs` 的工具对象统一带 `name/description/parameters/isReadOnly/execute`。

**关键启示**：把"能不能跑、能不能并行"内聚到工具自身。

---

## 2. 权限决策流水线

**源码**：`utils/permissions/permissions.ts`（1486 行）

顺序：工具级 deny/ask 规则 → 工具自检 → 模式与 always-allow。`bypassPermissions` 下 `.git/`、`.claude/` 仍强制询问。

**我们的实现**：
- `path-safety.mjs`：危险删除路径、UNC、`~user`、shell 展开符、系统目录写入
- `execpolicy-guard.mjs`：正则策略 + 代码级校验 + **拒绝计数熔断**（连续 3 次/累计 20 次）
- **踩坑记录**：守卫曾因读 `exec.args`（实际字段是 `arguments`）**失效 17 天**——契约字段名必须以源码为准。

---

## 3. 上下文四层压缩

**源码**：`services/compact/*`（约 3960 行）

顺序：snip → microcompact（清旧工具结果）→ context collapse → autocompact（整段摘要）。
阈值 = 窗口 − min(maxOutput,20k) − 13k 缓冲；另有 20k 预警、3k 硬阻塞。
摘要提示词：禁调工具 + `<analysis>` 草稿 + `<summary>` 成品，9 个固定章节。

**我们的实现**：`context.mjs` 两层（L1 裁剪旧工具结果 / L2 整体摘要），阈值 65%，`compact-prompt-template.md` 移植 9 章节模板。

**启示**：能轻量解决就不做重压缩。

---

## 4. 子代理：fresh vs fork

**源码**：`tools/AgentTool/*`

- `fresh`：零上下文，防污染
- `fork`：继承父上下文 + 共享 prompt cache
- 结果只回传最后一条文本 + usage；工具黑白名单防递归

**我们的实现**：`subagent` 工具（独立上下文 + 递归防护 + 可选 model/max_steps）。

---

## 5. 单循环状态机

**源码**：`query.ts` / `QueryEngine.ts`

`while(true)`：压缩 → 调模型 → 流式执行工具 → 回填 → 继续；终止分层（无工具请求 → Stop hook → token 预算 → maxTurns → 费用上限）。

**我们的实现**：`agent.mjs`，终止 = 无工具调用 / 步数上限。

---

## 6. 生命周期钩子

**源码**：13 个事件（`PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`Stop`/`SubagentStop`/`PreCompact` 等）

契约：stdin 收 JSON payload；退出码 0 继续 / 2 阻止；stdout 注入。

**我们的实现**：`hooks.mjs` 4 个核心事件，**额外硬化**：
- hook 命令自身过安全层（防恶意 hooks.json）
- 支持 JSON 输出（`decision`/`reason`/`additionalContext`）
- 失败写 `~/.self-agent/hook-errors.log`
- Stop hook 最多阻止 3 次防死循环

---

## 7. 记忆时效性

**源码**：`memdir/memoryAge.ts`（53 行）

> "Models are poor at date arithmetic — a raw ISO timestamp doesn't trigger staleness reasoning the way '47 days ago' does."

**我们的实现**：
- `memory-age.mjs`：中文年龄渲染 + 超 1 天加"可能已过时"警告
- 已接入君君 `bot-bridge.mjs` 的记忆注入（`[记忆-persona · 3 天前] ⚠️ ...`）

**效果**：agent 读到旧记忆后主动区分"记忆事实"与"需核对的现状"。

---

## 8. 错误分类重试

**源码**：`services/api/errors.ts`

**我们的实现**：`errors.mjs`
- prompt 过长 → 解析 token 差值（"137500 > 135000"）→ 强制压缩 → 重试
- 限流/过载/网络 → 指数退避
- 密钥/余额 → 直接失败

---

## 9. 依赖检测

**源码**：`utils/binaryCheck.ts`（53 行）

**我们的实现**：`binary-check.mjs` + `check_binary` 工具（带缓存）。
**动机**：实战中 agent 曾假设 `rg` 存在。

---

## 10. 限流解析

**源码**：`services/rateLimitMessages.ts`（靠结构化限额数据，非文本解析）

**我们的实现**（更实用，因为走中转只能解析文本）：
- "Resets in 4 days" → 长期限额 → **不重试**
- "retry after 30 seconds" → 短期 → 按重置时间退避

---

## 11. 后台清理

**源码**：`utils/backgroundHousekeeping.ts`（每 24h 清理缓存/旧文件）

**我们的实现**：`session.mjs` 的 `pruneSessions`（保留最近 50 个 / 30 天），CLI 保存后自动执行。

---

## 12. 学了但没移植

| 机制 | 原因 |
|---|---|
| QueryGuard 防重入状态机 | 为长驻进程并发控制设计；self-agent 是单次 CLI 调用，君君 bot 已有防重入守卫 |
| 41 个工具中的 LSP/Notebook/REPL | 场景不匹配 |
| 四层压缩的 collapse 投影 | 收益递减，两层已够用 |
| React/Ink 终端 UI | 技术栈不同 |

---

## 方法论（三轮下来的体会）

1. **先跑通，再拆解**——不要一上来抄代码
2. **学设计，不学实现**——契约、分层、隔离策略是通用的
3. **每加一个机制就写测试**——139 个用例就是这么来的
4. **以源码为准验证契约**——字段名/返回格式的差异会导致静默失效（守卫的教训）
5. **学完要判断取舍**——不是所有机制都值得移植

---

# 第四轮（2026-09-10）

## 13. 命令级只读判定

**源码**：`utils/shell/readOnlyCommandValidation.ts`（1893 行）

不是用正则猜，而是**命令配置表 + flag 逐项校验**：

- `safeFlags: Record<flag, 'none'|'number'|'string'|'char'|'{}'|'EOF'>`，逐 flag 校验参数类型
- `additionalCommandIsDangerousCallback`：子命令级黑名单（如 `git branch -d/-D`）
- **三类 parser differential 防护**（源码注释写得很细，都是真实漏洞）：
  1. `--flag=`（空值）不能吞掉下一个 token（`xargs -E= EOF echo foo` 可 RCE）
  2. 组合短旗标里若含带参旗标 → 整体拒绝（GNU getopt 会吞下一个 token）
  3. 不尊重 `--` 的工具（pyright）不能因遇到 `--` 就放行后续 flag
- `containsVulnerableUncPath`：UNC 路径可触发网络请求导致凭据泄露

**我们的实现**：`readonly-commands.mjs`
- 分词器（引号/转义）；未加引号的 `| & ; < > \` $ ( )` 一律判非只读
- 命令表：git 14 个子命令、docker 5 个、常用只读命令 20 个
- 接入 `isConcurrencySafe`：**bash 只读命令现在可与只读工具同批并行**（此前 bash 永远串行）

**效果**：71 个测试；`parallel.test.mjs` 验证「只读 bash 与 read_file 同批并行」。

## 14. 文件改动历史与回滚

**源码**：`utils/fileHistory.ts`（1115 行）

- 写之前先备份（`fileHistoryTrackEdit`），备份的是**改动前**内容
- 版本记录 `existed=false` 表示当时文件不存在 → 回滚 = 删除该文件
- 源码按 messageId 做快照分组，支持 transcript 恢复

**我们的实现**：`file-history.mjs` + `file_history` 工具
- 存储 `~/.self-agent/file-history/<sha1(file)>/vN`，每文件保留 50 版
- `write_file` / `edit_file` / `apply_patch` 落盘前自动 `trackEdit`
- 工具支持 `list` / `diff` / `rewind`

**取舍**：不做 messageId 快照分组（我们的会话模型更简单），回滚粒度按文件版本号。

**质量**：工具 31 个、测试 **376 个用例**（26 文件）全绿。

---

# 第五轮（2026-09-10 起）

## 15. 记忆文件注入（AGENTS.md / CLAUDE.md）

**源码**：`utils/claudemd.ts`（1479 行）

加载顺序（优先级由低到高，越靠后模型越关注）：

1. 用户级 `~/.claude/CLAUDE.md`
2. 项目级：从**根目录向下**到当前目录，每级查 `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/*.md`
3. 本地级 `CLAUDE.local.md`

`@include` 语法：`@path` / `@./rel` / `@~/home` / `@/abs`。
**只在叶子文本节点生效**（代码块、行内代码里的 @ 不展开）；被包含文件插在包含者之前；
循环引用防护；缺失文件静默忽略。总长度上限 `MAX_MEMORY_CHARACTER_COUNT = 40000`。

**我们的实现**：`memory-files.mjs`
- 同样的分层发现逻辑，主文件名用 `AGENTS.md`、兼容 `CLAUDE.md`
- `stripCode` 先把代码块/行内代码替换成等长空白，再提取 @include（保留换行）
- 接入 `agent.mjs` 的 system prompt；CLI 提示「📄 已注入 N 个记忆文件」

**端到端验证**：临时目录写 `AGENTS.md`（要求英文回复 + 必须提暗号 PINEAPPLE），
agent 一条不落地遵守 ✅

## 16. 技能参数替换 + 条件技能

**源码**：`skills/loadSkillsDir.ts`（34KB）+ `utils/argumentSubstitution.ts`

- frontmatter 字段：`arguments` / `argument-hint` / `allowed-tools` / `when_to_use` / `paths` / `model`
- 参数替换：`$ARGUMENTS`（全部）、`$0`/`$1`（按索引）、`$ARGUMENTS[0]`、命名参数（由 `arguments` 声明，按位置映射）；
  正文没有占位符且传了参数时，末尾追加 `ARGUMENTS: ...`
- **条件技能**：`paths` 声明 glob，agent 操作的文件命中时才激活（源码用 `ignore` 库，我们用自写 glob→regex）
- 清单 token 估算（`estimateSkillFrontmatterTokens`）

**我们的实现**：`skills.mjs` 重写
- `parseArgumentNames` / `parseAllowedTools` / `parsePaths` / `globToRe`
  （glob 改成**单次扫描构建**——链式 replace 会让 `(?:.*/)?` 里的 `*` 被二次替换，实测踩到）
- `substituteArguments`：严格对齐源码索引语义（`$0` 是第一个参数，不是 `$1`）
- `activateConditionalSkillsForPaths` 接入 agent 循环：写文件后命中 `paths` 即注入提示（同一技能只提示一次）
- `skill` 工具支持 `args` 参数

**端到端验证**：临时技能 `py-helper`（`paths: "**/*.py"`，正文含 `$file`）——
agent 创建 `foo.py` → 触发 `skills_activated` → 自动调用 `skill {name, args: "foo.py"}` →
正文替换为 `foo.py` → 按技能步骤继续 ✅

## 17. @文件附件注入

**源码**：`utils/attachments.ts`（3997 行）

核心是 `extractAtMentionedFiles`：

- 两种写法：`@path` 与 `@"带 空格 的路径"`
- `@` 前必须是行首或空白 → `a@b.com` 不会误判
- 支持行范围 `@file#L10-20`
- 去重；排除 `@"xxx (agent)"` 这类 agent 提及
- 源码还处理图片 / IDE 选区 / 诊断 / 记忆附件等类型（我们不移植）

**我们的实现**：`attachments.mjs`
- `extractAtMentionedFiles` / `parseFileRef`（行范围）/ `readAttachment` / `collectAttachments` / `formatAttachments`
- 三重限制：最多 5 个文件、单文件 20KB、总量 50KB；二进制（含 NUL）跳过；超限截断
- 接入 `agent.mjs`：任务文本里的 @ 引用自动注入用户消息；CLI 提示「📎 已附加 N 个文件」

**端到端验证**：`--task "@package.json 里的 name 和 version"` → **1 步**直接答对（省掉 read_file 那一步）

# 第六轮（2026-09-10 起）

## 18. 后台任务运行时

**源码**：`src/tasks/`（3286 行，LocalShellTask / LocalAgentTask / RemoteAgentTask…）

核心设计「任务即状态」：

- 统一 `id / kind / status / outputFile / offset / notified`
- 输出落盘 + **增量读**（按字节 offset），避免大输出反复塞回上下文
- **前台超 15s 自动转后台**，完成后进通知队列，主循环每步取一次（防重通知）
- 任务类型：shell / agent / remote / teammate / workflow / MCP 监控

**我们的实现**：`background-tasks.mjs` + `bg_task` 工具
- `startShellTask` / `waitForTask` / `readTaskOutput`（增量）/ `stopTask` / `drainNotifications`
- bash 工具统一走后台运行时：前台等 15s，超时返回 taskId（不再靠 120s 硬超时把命令砍掉）
- 完成通知注入主循环：`[后台任务完成] …`

**端到端验证**：`sleep 18 && echo done-long` → 15s 后返回「⏳ 已转后台：bg…」→
agent 等待后读到 `done-long` ✅

## 19. worker 并行（协调者模式）

**源码**：`coordinator/coordinatorMode.ts`（19KB）

协调者只规划与综合，worker 提示自包含、禁止互查，并有工具黑白名单。

**我们的实现**：`subagent` 带 `isolation: "worktree"` 时判定为**并发安全** →
多个 worker 可在各自 worktree 副本内并行执行（默认仍串行，避免写冲突）。

**取舍**：没有移植「文件邮箱 / SendMessage 通信」——我们的子代理是单点回传结果，
不需要 worker 间通信，这也是第三轮对 QueryGuard 做过的同类判断。

# 第七轮（2026-09-10 起）

## 20. 工具输入校验 + schema 未发送提示

**源码**：`services/tools/toolExecution.ts`（1745 行）

- `inputSchema.safeParse(input)` —— **每次工具调用前都校验**；源码注释直言
  「surprisingly, the model is not great at generating valid input」
- 校验失败时调 `buildSchemaNotSentHint`：若该工具的 schema **没随请求发送**（工具按需加载的副作用），
  提示模型「先加载工具再重试」——因为 schema 缺失会让模型把数组/数字/布尔写成字符串
- `classifyToolError`：把异常归类成 `Error:ENOENT` / `ShellError` / `Error`，便于统计

**我们的实现**：`tool-validation.mjs`，接入 `runTool`
- 轻量 JSON Schema 子集校验：type / required / properties / enum（不引 zod 依赖）
- 未发送 schema 的工具 → 追加 `tool_search` 指引（`select:<tool>`）
- 工具异常输出带分类：`工具异常（Error:ENOENT）：...`

## 21. prompt 状态诊断

**源码**：`services/api/promptCacheBreakDetection.ts`（727 行）

prompt 缓存只在**前缀完全不变**时命中；system prompt、工具集合、任一工具 schema 变化都会整体失效。
源码每次请求前记录快照（systemHash / toolsHash / perToolHashes / model / betas），下次对比定位原因。

**我们的实现**：`prompt-state.mjs`
- `snapshotPrompt` / `diffPromptState` / `createPromptStateTracker`（djb2 哈希，对齐源码）
- 检出变化时上报 `prompt_state_changed`，CLI 打印具体原因
- **取舍**：不落盘 diff、不报遥测、不区分 cache_control TTL（中转端点的缓存行为未知）

**质量**：测试 549 → **594**（34 文件）；工具 32 个。

# 第八轮（2026-09-10 起）

## 22. MCP 多作用域 + 审批 + 命名空间

**源码**：`services/mcp/config.ts`（1578 行）+ `client.ts`（3348）+ `auth.ts`（2465）

- 配置按 **scope** 分层：enterprise / user / project / local / plugin / claudeAI，同名后者覆盖前者
- 每个 server 带 `scope` 标记，便于按来源施加不同策略
- 新 server 需要审批（`mcpServerApproval`），防止不可信来源自动执行命令
- 工具命名空间 `mcp__<server>__<tool>`，避免与内置工具冲突

**我们的实现**：`mcp.mjs` 增强 + `mcp` 工具
- `loadMcpConfigs(cwd)`：用户级 + 项目级合并，同名项目覆盖，server 带 `scope`/`sourceFile`
- **审批机制**：`serverSignature = sha1(name|command|args)`；**项目级 server 未批准拒绝连接**
  （威胁模型：clone 一个仓库，里面 `.self-agent/mcp.json` 指向恶意命令）
- 审批记录落盘 `~/.self-agent/mcp-approved.json`；改命令 → 签名变化 → 自动失效
- `namespacedToolName` / `parseNamespacedToolName`；工具 action 增加 `approve/revoke/list_approvals`

## 23. 权限决策审计

**源码**：`utils/permissions/yoloClassifier.ts`（1495 行）

源码用 **LLM** 判定动作是否需要人工确认（`classifyYoloAction`），配套 `formatActionForClassifier`
把动作转成可判定文本，并记录决策与理由。

**我们的实现**：`permission-audit.mjs`（规则版）
- `classifyAction` → `allow / ask / deny` + 可解释理由，复用已有三层安全（execpolicy / 路径安全 / 只读判定）
- `createAuditLog` 累计决策分布（含 askRatio / denyRatio），用于发现"总是 ask"的噪声
- 接入 agent 循环：每个工具调用前分类，非 allow 上报事件；CLI 结束打印审计摘要
- **取舍**：不接 LLM 分类（成本 + 我们的安全层已能覆盖主要场景）；返回结构可直接喂给将来的 LLM 兜底

**质量**：测试 594 → **655**（36 文件）。

# 第九轮（2026-09-10 起）

## 24. 重定向目标检查

**源码**：`utils/bash/ast.ts`（2679 行）+ `bashParser.ts`（4436 行）

源码用完整 bash AST 判断命令语义（哪些 token 是路径、哪些是重定向目标、子命令结构）。
我们不需要 4000+ 行的完整解析器（对当前场景是过度设计），但**路径提取的思路**直接可用。

**我们的实现**：`safety.mjs` 新增 `extractRedirectTargets`
- 提取 `>`、`>>`、`2>`、`&>` 的目标路径（处理引号；跳过 `/dev/null` 与 `2>&1` 这类 fd 复制）
- 目标路径过 `checkWritePath`：`echo x > /etc/passwd` 这类「命令无害、目标危险」的情况被拦
- `checkCommand(command, { cwd })` 支持按 cwd 解析相对路径

**顺带补上的漏洞**：之前的安全层只看「命令」不看「重定向目标」，
`echo hacked > /etc/passwd` 完全绕过策略匹配。

## 25. 文件分页读取

**源码**：`utils/Cursor.ts`（1530 行）—— 按 offset/limit 增量读取，避免一次把大文件塞进上下文。

**我们的实现**：`read_file` 支持 `offset` / `limit`（默认 2000 行、上限 5000），
超出范围时提示「共 N 行，继续读用 offset=X」。

## 26. CJK 感知的 token 估算

**源码**：`services/tokenEstimation.ts`（直接调 API `countTokens`，我们没有这个条件）

**我们的实现**：`context.mjs` 的 `estimateTextTokens`
- 按字符类型加权：**CJK ≈ 1 token/字，其他 ≈ 0.28 token/字符**（约 3.6 字符/token）
- 旧实现统一「2 字符/token」→ 中文低估一倍、英文高估一倍
- **连带影响**：估算变准后，两个用「刚好超过阈值」构造的测试失效，已同步调整构造量

**质量**：测试 655 → **706**（39 文件）。

# 第十轮（2026-09-10 起）

## 27. 生命周期钩子扩展（4 → 11 个事件）

**源码**：`types/hooks.ts` 的 `hookEventName` 字面量（PreToolUse / PostToolUse / PostToolUseFailure /
UserPromptSubmit / SessionStart / SessionEnd / SubagentStart / SubagentStop / PreCompact / Notification /
PermissionDenied / FileChanged / CwdChanged …）

关键设计：**不同事件用不同字段做 matcher 匹配**（工具事件匹配工具名，SessionStart 匹配 source，
PreCompact 匹配 trigger，Subagent* 匹配 agent），而不是统一拿工具名去匹配。

**我们的实现**：`hooks.mjs` + agent 接入
- `HOOK_EVENTS` 扩到 11 个；新增 `MATCHER_FIELDS` 映射表
- `matchHooks(config, event, payload)` 按事件取对应字段（兼容旧的「直接传字符串」签名）
- 接入点：SessionStart（会话开始）/ SessionEnd（正常、stalled、步数上限、**异常退出**四条路径）/
  PostToolUseFailure（工具 isError）/ PreCompact / PostCompact（压缩前后）/ SubagentStart / SubagentStop
- **顺带修的缺陷**：模型调用异常退出时不会触发 SessionEnd，已在异常路径补上（try/catch 里 throw 前收尾）

**端到端验证**：hooks.json 里给 SessionStart/SessionEnd 加写文件副作用 → 跑一次 CLI →
两个文件都生成 ✅（那次模型调用正好 524 故障，反而验证了异常路径的 SessionEnd）

## 28. 命令模板

**源码**：`commands/`（189 个文件）—— 斜杠命令系统，与 skills 是两套机制
（命令=一句话任务模板，skill=能力包 + 详细步骤）。

**我们的实现**：不新造轮子——把命令目录纳入技能体系
- `~/.self-agent/commands/*.md`（用户级，可用 `SELF_AGENT_COMMAND_DIRS` 覆盖）
- frontmatter 复用：`description` / `argument-hint` / `arguments`
- 加载与参数替换完全复用 `loadSkill` + `substituteArguments`（`$ARGUMENTS` / `$1` / 命名参数）
- `listSkills` 返回 `kind: "skill" | "command"`，清单里命令标 `[命令]`
- **取舍**：不新增 `cmd` 工具（避免和 `skill` 工具语义重复、增加模型选择负担）

**质量**：测试 706 → **752**（41 文件）。

---

# 第十一轮：收尾

## 一、路线图最终状态

盘点 `claude-code-pkg/ex/src`（51 万行 TS / 3806 文件），剔除 React/Ink UI 与平台集成后，
值得学的机制约 28 项，**11 轮全部学完**：

| 轮次 | 内容 | 状态 |
|---|---|---|
| 1–3 | 工具契约、权限、压缩、子代理、状态机、钩子、记忆、错误分类、依赖检测、限流、清理 | ✅ 12 项 |
| 4 | 命令级只读判定、文件历史/回滚 | ✅ 2 项 |
| 5 | CLAUDE.md 注入、技能参数 + 条件技能、@文件附件注入 | ✅ 3 项 |
| 6 | 后台任务运行时、worker 并行（worktree 隔离） | ✅ 2 项 |
| 7 | 工具输入校验 + schema 提示、prompt 状态诊断 | ✅ 2 项 |
| 8 | MCP 多作用域 + 审批 + 命名空间、权限决策审计 | ✅ 2 项 |
| 9 | 重定向目标检查、文件分页读取、CJK 感知 token 估算 | ✅ 3 项 |
| 10 | 生命周期钩子扩展（11 事件）、命令模板 | ✅ 2 项 |
| **11** | **取舍复盘 + 架构对齐 + 最终验收** | ✅ 收尾 |

## 二、取舍复盘：学了但**没有**移植

判断标准和"做了什么"同样重要——以下都是看过源码后**主动放弃**的：

| 机制 | 源码出处 | 不移植的理由 |
|---|---|---|
| QueryGuard 防重入状态机 | `utils/QueryGuard.ts` | 为长驻进程并发控制设计；self-agent 是单次 CLI 调用，bot 侧已有守卫 |
| 文件邮箱 / SendMessage 通信 | `utils/teammateMailbox.ts`（1183 行） | 子代理是单点回传结果，不需要 worker 间通信 |
| 完整 bash AST 解析 | `utils/bash/ast.ts` + `bashParser.ts`（7100 行） | 4000+ 行解析器对当前场景过度；只取「路径提取」思路（→ 重定向目标检查） |
| React/Ink 终端 UI | `components/` + `ink/`（约 10 万行） | 技术栈不同（React+Ink vs 纯 Node 文本流），且非 agent 能力 |
| IDE 桥接 / 远程控制 / 遥测 | `bridge/` `remote/` `server/` `analytics/` | 平台集成，与自托管 CLI 场景不匹配 |
| 插件市场 | `utils/plugins/marketplaceManager.ts`（2643 行） | 我们已有 SKILL.md 约定 + 技能加载，插件生态暂不需要 |
| 权限 LLM 分类器 | `utils/permissions/yoloClassifier.ts` | 成本不划算；规则层已覆盖主要场景，返回结构已留好扩展位 |
| 四层压缩的 collapse 投影 | `services/compact/` | 收益递减，两层（裁工具结果 + 整体摘要）已够用 |
| 平台 OAuth / 企业策略 | `services/oauth/` `policyLimits/` | 单人自托管场景不需要 |
| 其他任务类型（remote/teammate/workflow） | `src/tasks/` | 只移植 LocalShellTask 的语义（任务即状态 + 增量读 + 通知） |

## 三、架构对齐：self-agent 模块地图

26 个核心模块 / 5557 行（不含测试），每个模块都能追溯到一条学到的机制：

| 模块 | 职责 | 对应源码 |
|---|---|---|
| `agent.mjs` | 单循环状态机 + 工具编排 + 钩子接入 + 卡住检测 | `query.ts` / `toolOrchestration` |
| `llm.mjs` | 模型客户端（流式 + 重试） | `services/api/claude.ts` |
| `tools.mjs` | 工具注册表（32 个）+ 并发分区 | `Tool.ts` |
| `safety.mjs` / `path-safety.mjs` | 命令策略 + 路径校验 + 重定向目标检查 | `utils/permissions/` + `bash/ast` |
| `readonly-commands.mjs` | 命令级只读判定（配置表 + flag 校验） | `shell/readOnlyCommandValidation.ts` |
| `tool-validation.mjs` | 工具输入校验 + schema 未发送提示 | `services/tools/toolExecution.ts` |
| `permission-audit.mjs` | 权限决策分类与审计 | `permissions/yoloClassifier.ts` |
| `context.mjs` | CJK 感知 token 估算 + 两层压缩 | `compact/` + `tokenEstimation.ts` |
| `prompt-state.mjs` | prompt 前缀状态诊断 | `api/promptCacheBreakDetection.ts` |
| `session.mjs` | 会话持久化 + 自动清理 | `sessionStorage` + `backgroundHousekeeping` |
| `memory-age.mjs` | 记忆时效性渲染 | `memdir/memoryAge.ts` |
| `memory-files.mjs` | AGENTS.md 分层注入 + `@include` | `utils/claudemd.ts` |
| `skills.mjs` | 技能 + 命令模板（参数替换 / 条件技能） | `loadSkillsDir.ts` + `argumentSubstitution.ts` |
| `attachments.mjs` | @文件引用自动注入 | `utils/attachments.ts` |
| `hooks.mjs` | 11 个生命周期事件 + 安全加固 | `types/hooks.ts` |
| `background-tasks.mjs` | 后台任务运行时（状态/增量读/通知） | `src/tasks/` |
| `file-history.mjs` | 文件改动历史与回滚 | `utils/fileHistory.ts` |
| `worktree.mjs` | worktree 隔离 | `utils/worktree.ts` |
| `mcp.mjs` | MCP 客户端 + 多作用域 + 审批 | `services/mcp/` |
| `errors.mjs` | 错误分类与智能重试 | `api/errors.ts` + `rateLimitMessages.ts` |
| `binary-check.mjs` | 依赖检测 + 缓存 | `utils/binaryCheck.ts` |
| `code-outline.mjs` / `run-tests.mjs` | 代码结构提取 / 测试运行 | 自研（源码无对应） |
| `env.mjs` / `cli.mjs` | 配置与入口 | `entrypoints/` |

## 四、最终验收

| 指标 | 值 |
|---|---|
| 学到的机制 | **28 项**（11 轮） |
| 自研代码 | **5557 行 / 26 模块** |
| 测试 | **752 个用例 / 41 文件** 全绿 |
| 内置工具 | **32 个** |
| 基准评测 | **17 个用例**（10 类能力维度）+ 自检门禁 |
| 机制级验证 | `node verify-mechanisms.mjs` → **28/28 通过** |

## 五、方法论（十一轮下来）

1. **先跑通，再拆解**——不要一上来抄代码
2. **学设计，不学实现**——契约、分层、隔离策略是通用的（bash 那 7100 行解析器就没抄）
3. **每加一个机制就写测试**——752 个用例是这么来的
4. **以源码为准验证契约**——字段名差异会导致静默失效（守卫 `args` vs `arguments` 失效 17 天）
5. **学完要判断取舍**——上面那张"不移植清单"和移植清单一样重要
6. **估算精度会影响下游**——token 估算改准后，两个"刚好超阈值"的测试立刻失效，说明阈值行为真的变了
7. **守卫自己的守卫**——评测 check 本身会被硬编码绕过（15 个用例里 12 个中招），
   必须用「初始必失败 + 参考修复必通过 + 作弊必被拒」三道门禁反过来验证 check
8. **难度上去了不等于区分度上去了**——加难用例后通过率仍 100%，只有成本曲线（步数/token）动了起来

