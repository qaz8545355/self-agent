#!/usr/bin/env bash
# 阻止写入受保护路径（读取 stdin 的 JSON payload）
input=$(cat)
path=$(printf '%s' "$input" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('path',''))" 2>/dev/null)

case "$path" in
  /etc/*|/usr/*|/bin/*|*/.env|*production.yml|*production.yaml)
    printf '{"decision":"block","reason":"受保护路径，禁止写入：%s"}\n' "$path"
    exit 0
    ;;
esac
printf '{"decision":"allow"}\n'
