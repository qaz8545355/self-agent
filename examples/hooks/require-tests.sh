#!/usr/bin/env bash
# 收工门禁：没有测试通过标记时，阻止 agent 结束
if [ -f .self-agent/tests-passed ]; then
  printf '{"decision":"allow"}\n'
else
  printf '{"decision":"block","reason":"尚未运行测试：请先执行测试并创建 .self-agent/tests-passed"}\n'
fi
