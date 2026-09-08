import os from "node:os";
const TMP = os.tmpdir();
import { writeFileSync, mkdirSync } from "node:fs";
import { loadHooks, runHooks, matchHooks, resolveHooksFile } from "../hooks.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const dir = TMP + "/hook-test";
mkdirSync(dir + "/.self-agent", { recursive: true });
writeFileSync(dir + "/.self-agent/hooks.json", JSON.stringify({
  PreToolUse: [
    { matcher: "bash", command: 'input=$(cat); echo "$input" | grep -q forbidden && { echo "命令包含禁用词"; exit 2; } || exit 0' },
    { matcher: "read_file", command: 'echo "read hook 注入"; exit 0' },
  ],
  PostToolUse: [{ matcher: "bash", command: 'echo "post-bash-ok"; exit 0' }],
  UserPromptSubmit: [{ command: 'echo "prompt-hook-injected"; exit 0' }],
  Stop: [{ command: 'exit 0' }],
}, null, 2));

const { config, file } = loadHooks(resolveHooksFile(dir));
t("hooks.json 加载成功", !!file && Object.keys(config).length === 4, `→ ${file}`);

t("matcher 匹配 bash", matchHooks(config, "PreToolUse", "bash").length === 1);
t("matcher 不匹配 grep", matchHooks(config, "PreToolUse", "grep").length === 0);
t("无 matcher 匹配所有", matchHooks(config, "UserPromptSubmit", "anything").length === 1);

// PreToolUse：正常命令放行
const ok = runHooks(config, "PreToolUse", { tool_name: "bash", tool_input: { command: "ls" } }, { cwd: dir });
t("PreToolUse 正常命令不阻止", !ok.blocked);

// PreToolUse：命中禁用词被阻止（退出码 2）
const blocked = runHooks(config, "PreToolUse", { tool_name: "bash", tool_input: { command: "run forbidden thing" } }, { cwd: dir });
t("PreToolUse 退出码 2 阻止", blocked.blocked, `→ ${blocked.outputs.join(";")}`);

// PostToolUse：输出注入
const post = runHooks(config, "PostToolUse", { tool_name: "bash", tool_result: "ok" }, { cwd: dir });
t("PostToolUse 输出注入", post.outputs.includes("post-bash-ok"));

// UserPromptSubmit
const ups = runHooks(config, "UserPromptSubmit", { prompt: "hi" }, { cwd: dir });
t("UserPromptSubmit 输出注入", ups.outputs.includes("prompt-hook-injected"));

// Stop
const stop = runHooks(config, "Stop", {}, { cwd: dir });
t("Stop 正常放行", !stop.blocked);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
