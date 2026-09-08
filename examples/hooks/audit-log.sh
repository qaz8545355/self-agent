#!/usr/bin/env bash
# 审计日志：把每次工具调用追加到日志文件
input=$(cat)
log="${SELF_AGENT_AUDIT_LOG:-$HOME/.self-agent/audit.log}"
mkdir -p "$(dirname "$log")"
printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$input" >> "$log"
printf '{"additionalContext":"操作已审计"}\n'
