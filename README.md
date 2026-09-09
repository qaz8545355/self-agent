# self-agent

一个**自研的轻量 coding agent**：单循环状态机 + 契约式工具 + 分层安全 + 上下文压缩 + 子代理 + 技能加载。

> 设计借鉴 Claude Code 的架构思想（工具契约、单状态机、分层压缩），**代码为独立原创实现**，不包含任何第三方专有源码。
> 纯 Node.js ESM，无重依赖（仅 `yaml`）。

## 特性

- **工具契约**：每个工具声明 `name/description/parameters/isReadOnly/execute`
- **并发执行**：连续的只读工具并行、写工具串行（借鉴 Claude Code `toolOrchestration`），实测 3 倍提速
- **卡住检测**：连续 3 步「无文件改动 + 工具结果重复」自动终止，避免空转烧 token（`stallLimit` 可调，0 关闭）
- **记忆文件注入**：`AGENTS.md` / `CLAUDE.md` 分层加载（用户级 → 项目根 → 当前目录）+ `@include` 展开，超 40k 截断（移植 `claudemd`）
- **命令级只读判定**：bash 命令经配置表 + flag 校验判定是否只读（移植 `readOnlyCommandValidation`），只读命令可参与并行
- **文件改动历史**：写前自动备份，支持 list / diff / rewind 回滚（移植 `fileHistory`）
- **31 个内置工具**：`bash`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`subagent`、`skill`、`web_fetch`、`todo_write`、`git`、`memory`、`check_binary`、`apply_patch`、`file_history`、`run_tests`、`env_info`、`diff`、`ask_user`、`plan_mode`、`http_request`、`schedule`、`sleep`、`config`、`tool_search`、`notebook_edit`、`task`、`team`、`code_outline`、`mcp`、`lark_send`
- **安全层**：危险路径/命令拦截（`rm -rf /`、`chmod 777`、写系统目录等）、heredoc 剥离防误判
- **上下文压缩**：四层流水线（L1 清旧工具结果 → L2 折叠旧回复 → L3 整体摘要），逐层触发
- **子代理**：独立上下文、结果单点回传、递归防护、**worktree 隔离**（`isolation: "worktree"`）
- **技能**：兼容 `SKILL.md` 约定，可列出/加载现有技能
- **会话持久化**：JSON 落盘，支持 `--resume`
- **多模型**：OpenAI 兼容端点，可接任意中转（默认 1MMC）
- **生命周期钩子**：PreToolUse / PostToolUse / UserPromptSubmit / Stop（外部命令 + 退出码控制）
- **流式输出**：`--stream` 实时打印模型回复
- **飞书集成**：`lark_send` 工具可把结果推送到飞书

## 快速开始

```bash
git clone https://github.com/qaz8545355/self-agent.git
cd self-agent && npm install

# 单次任务
node cli.mjs --task "读取 README.md 并总结" --cwd .

# 指定模型 / 工作目录 / 步数（默认上限 100 步）
node cli.mjs --task "修复 lint 错误" --model gpt-5.6-sol --cwd /path --max-steps 30

# 恢复会话
node cli.mjs --resume sa-20260909-061054 --task "继续上一步"

# 列出会话
node cli.mjs --list
```

## Hooks（生命周期钩子）

在项目 `.self-agent/hooks.json` 或 `~/.self-agent/hooks.json` 配置（`SELF_AGENT_HOOKS` 可覆盖路径）：

```json
{
  "PreToolUse":  [{ "matcher": "bash", "command": "/path/to/check.sh" }],
  "PostToolUse": [{ "matcher": "write_file", "command": "/path/to/audit.sh" }],
  "UserPromptSubmit": [{ "command": "/path/to/enrich.sh" }],
  "Stop": [{ "command": "/path/to/verify-done.sh" }]
}
```

**契约**（与 Claude Code 一致）：

| 行为 | 说明 |
|---|---|
| stdin | 收到 JSON payload（`tool_name` / `tool_input` / `tool_result` / `prompt` 等） |
| **JSON 输出（优先）** | stdout 为 JSON：`{"decision":"allow\|block\|deny","reason":"...","additionalContext":"..."}` |
| 退出码 0 | 继续；stdout（非 JSON）作为附加信息注入上下文 |
| 退出码 2 | 阻止（PreToolUse 阻止工具、Stop 阻止结束并继续） |
| 其他退出码 | 记录为 hook 失败并写入日志，不阻断 |
| matcher | 正则匹配工具名；省略则匹配所有 |

**安全与可观测性**：

- hook 命令本身会经过安全层校验（`rm -rf /` 之类的恶意 hook 会被拒绝执行）
- 失败与拒绝写入 `~/.self-agent/hook-errors.log`（可用 `SELF_AGENT_HOOK_LOG` 覆盖）
- 性能提示：hook 每次调用 fork 一次进程，高频只读工具建议用 `matcher` 精确限定，避免配置全局 PostToolUse

## 示例

`examples/` 提供可直接使用的 hooks 示例：

- `block-protected-paths.sh` — 阻止写入 /etc、.env、production.yml
- `audit-log.sh` — 工具调用审计日志
- `require-tests.sh` — 没跑测试不许收工（质量门禁）

复制到项目 `.self-agent/` 即可生效，详见 `examples/README.md`。

## 配置

通过环境变量或项目根目录的 `.env.local`（不提交）配置：

| 变量 | 说明 | 默认 |
|---|---|---|
| `SELF_AGENT_BASE_URL` | 模型 API 地址（OpenAI 兼容） | `https://api.openai.com/v1` |
| `SELF_AGENT_MODEL` | 默认模型 | `gpt-4o-mini` |
| `SELF_AGENT_KEY_ENV` | 从哪个环境变量/凭据名取 key | `OPENAI_API_KEY` |
| `SELF_AGENT_CREDS` | 凭据 YAML 路径（`KEY: value` 格式） | `~/.dsh/.credentials.yaml` |
| `SELF_AGENT_CHAT_ID` | 飞书会话 ID（`lark_send` 用） | 无（未配置则报错） |
| `SELF_AGENT_SKILL_DIRS` | 技能目录，冒号分隔 | `~/.dsh/skills:~/.dsh/../dsh/.agents/skills` |

示例 `.env.local`：

```bash
SELF_AGENT_BASE_URL=https://your-relay.example/v1
SELF_AGENT_MODEL=your-model
SELF_AGENT_KEY_ENV=YOUR_API_KEY
SELF_AGENT_CHAT_ID=oc_xxxxxxxxxxxxxxxx
```

## 架构

```
cli.mjs          入口（参数解析 / 输出）
 └─ agent.mjs    核心循环：模型 → 工具调用 → 回填 → 继续
     ├─ llm.mjs      模型客户端（OpenAI 兼容）
     ├─ tools.mjs    工具注册表（8 个）
     ├─ context.mjs  token 估算 + 两层压缩
     ├─ safety.mjs   路径/命令安全校验
     ├─ skills.mjs   技能加载（SKILL.md）
     └─ session.mjs  会话持久化
```

## 安全设计

| 层 | 机制 |
|---|---|
| 路径 | 危险删除路径、UNC、`~user`、shell 展开符、系统目录写入 → 拦截 |
| 命令 | 正则策略（`execpolicy.json`）+ 代码级路径校验；`bash <<EOF` 不剥离 |
| 递归 | 子代理内禁止再派子代理 |
| 终止 | 无工具调用 / 步数上限 / 压缩失败熔断 |

## 错误分类与重试

移植 Claude Code `services/api/errors.ts` 的设计（`errors.mjs`）：

| 错误类型 | 处理 |
|---|---|
| prompt 过长 | **解析出 token 差值**（如 "137500 tokens > 135000"），强制压缩后重试 |
| 限流（短期）/ 过载 / 网络 | 指数退避自动重试；**解析重置时间**（"4 days"、"30 seconds"） |
| 限流（长期） | 如"4 天后重置"→ **不重试**，直接报错避免白等 |
| 密钥无效 / 余额不足 | 直接失败，不浪费时间重试 |

配合 `check_binary` 工具（依赖检测 + 缓存），解决"假设外部命令存在"的问题。

## 记忆时效性

移植 Claude Code `memdir/memoryAge` 的设计——源码注释指出：

> "Models are poor at date arithmetic — a raw ISO timestamp doesn't trigger staleness reasoning the way **'47 days ago'** does."

实现（`memory-age.mjs`）：

- 记忆年龄渲染成中文（今天 / 昨天 / N 天前 / 约 N 个月前）
- **超过 1 天的记忆自动附加「可能已过时」警告**
- `memory` 工具读取长期记忆时自动标注；跳过原始对话流水，优先返回 `persona.md`

实测效果：agent 读到 5 天前的画像后，**主动区分"记忆事实"与"需核对的现状"**，并列出待核对项。

## 实战验证

带 bug 的小项目（`divide` 除零未处理、`average` 空数组返回 NaN）实测：

```bash
node cli.mjs --task "运行 npm test，修复失败的测试。只允许修改 calculator.mjs" --cwd /path
```

结果：**5 步完成**（跑测试 → 定位 → 读代码 → edit_file 修复 → 复验），5/5 测试通过，
且严格遵守约束——只改了 `calculator.mjs`，未触碰测试文件。

## 基准评测

用真实任务衡量能力（不只是"功能没坏"）：

```bash
node benchmarks/run.mjs        # 15 个真实任务：修 bug / 实现 / 重构 / 写测试 / 写脚本 / 约束遵守 / 性能优化
```

用例结构：`task.md` + `setup/` + `check.mjs`；结果含通过率、步数、token 消耗。
用例自检（防止 check 本身被硬编码绕过）：`node benchmarks/selfcheck.mjs`。
详见 `benchmarks/README.md`。

覆盖维度：bug 修复、功能实现、跨文件重构、写测试、脚本编写、**约束遵守**（不许改测试/数据）、
**探索定位**（无提示的 bug）、**假绿检测**（命令成功但实际没干活）、**多文件接线**、**大文件检索**。

## 测试

```bash
npm test          # 运行全部测试（tests/run-all.mjs）
```

| 测试文件 | 用例 |
|---|---:|
| `memory-age.test.mjs` | 16 |
| `errors.test.mjs` | 21 |
| `binary-check.test.mjs` | 7 |
| `safety.test.mjs` | 14 |
| `context.test.mjs` | 12 |
| `hooks.test.mjs` | 9 |
| `hooks-enhanced.test.mjs` | 8 |
| `tools.test.mjs` | 8 |
| `git.test.mjs` | 7 |
| `skills.test.mjs` | 12（无技能目录时自动跳过） |
| `subagent.test.mjs` | 4 |
| `session.test.mjs` | 5 |
| `parallel.test.mjs` | 26 |
| `apply-patch.test.mjs` | 13 |
| `collapse.test.mjs` | 13 |
| `worktree.test.mjs` | 10 |
| `run-tests.test.mjs` | 11 |
| `env-diff.test.mjs` | 9 |
| `lifecycle-tools.test.mjs` | 15 |
| `misc-tools.test.mjs` | 14 |
| `notebook-task-team.test.mjs` | 17 |
| `code-outline.test.mjs` | 12 |
| `mcp.test.mjs` | 10 |
| `tool-select.test.mjs` | 11 |
| `readonly-commands.test.mjs` | 71 |
| `file-history.test.mjs` | 21 |
| `cli-defaults.test.mjs` | 11 |
| `stall-detector.test.mjs` | 14 |
| `memory-files.test.mjs` | 29 |
| **合计** | **430** |

CI：GitHub Actions（push / PR 自动跑）。

## 与 Claude Code 的差异

| 维度 | Claude Code | self-agent |
|---|---|---|
| 语言/运行时 | TypeScript + Bun + React Ink | 纯 Node ESM |
| 工具数 | 41 | 30 |
| 上下文压缩 | 四层流水线 | 两层 |
| UI | 终端 React | 文本流 |
| 依赖 | 大量 | 仅 yaml |

## 许可证

MIT
