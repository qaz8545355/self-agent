# 示例：hooks 配置

把 `hooks.json` 和 `hooks/` 目录复制到项目的 `.self-agent/` 下即可生效：

```bash
mkdir -p .self-agent
cp examples/hooks.json .self-agent/hooks.json
cp -r examples/hooks .self-agent/hooks
chmod +x .self-agent/hooks/*.sh
```

## 三个示例

| 文件 | 事件 | 作用 |
|---|---|---|
| `block-protected-paths.sh` | PreToolUse | 阻止写入 `/etc`、`/usr`、`.env`、`*production.yml` 等受保护路径 |
| `audit-log.sh` | PostToolUse | 把每次工具调用追加到 `~/.self-agent/audit.log`（`SELF_AGENT_AUDIT_LOG` 可覆盖） |
| `require-tests.sh` | Stop | 没有 `.self-agent/tests-passed` 标记时，阻止 agent 收工（质量门禁） |

## 契约回顾

- hook 从 **stdin** 收到 JSON payload
- 输出 JSON：`{"decision":"allow|block|deny","reason":"...","additionalContext":"..."}`
- 或用退出码：`0` 继续、`2` 阻止
- hook 命令本身会过安全层；失败写入 `~/.self-agent/hook-errors.log`

## 自定义提示

- 用 `matcher` 正则精确限定工具名，避免高频只读工具触发 hook（有 fork 开销）
- hook 里不要假设 cwd，用 `$PWD` 或显式路径
- 阻止时给出**可执行**的原因，方便 agent 换正确做法
