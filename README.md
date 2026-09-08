# self-agent

一个**自研的轻量 coding agent**：单循环状态机 + 契约式工具 + 分层安全 + 上下文压缩 + 子代理 + 技能加载。

> 设计借鉴 Claude Code 的架构思想（工具契约、单状态机、分层压缩），**代码为独立原创实现**，不包含任何第三方专有源码。
> 纯 Node.js ESM，无重依赖（仅 `yaml`）。

## 特性

- **工具契约**：每个工具声明 `name/description/parameters/isReadOnly/execute`
- **11 个内置工具**：`bash`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`、`subagent`、`skill`、`web_fetch`、`todo_write`、`lark_send`
- **安全层**：危险路径/命令拦截（`rm -rf /`、`chmod 777`、写系统目录等）、heredoc 剥离防误判
- **上下文压缩**：token 估算 + 两层策略（L1 裁剪旧工具结果 / L2 整体摘要）
- **子代理**：独立上下文、结果单点回传、递归防护
- **技能**：兼容 `SKILL.md` 约定，可列出/加载现有技能
- **会话持久化**：JSON 落盘，支持 `--resume`
- **多模型**：OpenAI 兼容端点，可接任意中转（默认 1MMC）
- **流式输出**：`--stream` 实时打印模型回复
- **飞书集成**：`lark_send` 工具可把结果推送到飞书

## 快速开始

```bash
# 依赖
cd /root/dsh/self-agent && npm install

# 单次任务
node cli.mjs --task "读取 README.md 并总结" --cwd .

# 指定模型 / 工作目录 / 步数
node cli.mjs --task "修复 lint 错误" --model gpt-5.6-sol --cwd /path --max-steps 30

# 恢复会话
node cli.mjs --resume sa-20260909-061054 --task "继续上一步"

# 列出会话
node cli.mjs --list
```

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

## 测试

| 模块 | 用例 | 结果 |
|---|---|---|
| 安全层 | 14 | ✅ 全通过 |
| 上下文压缩 | 12 | ✅ 全通过 |
| 子代理 | 4 | ✅ 全通过 |
| 技能加载 | 12 | ✅ 全通过 |

## 与 Claude Code 的差异

| 维度 | Claude Code | self-agent |
|---|---|---|
| 语言/运行时 | TypeScript + Bun + React Ink | 纯 Node ESM |
| 工具数 | 41 | 11 |
| 上下文压缩 | 四层流水线 | 两层 |
| UI | 终端 React | 文本流 |
| 依赖 | 大量 | 仅 yaml |

## 许可证

MIT
