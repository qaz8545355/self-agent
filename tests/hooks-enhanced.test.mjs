import path from "node:path";
import os from "node:os";
const TMP = os.tmpdir();
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { loadHooks, runHooks, parseHookOutput, resolveHooksFile } from "../hooks.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// JSON 输出解析
t("解析 decision=block", parseHookOutput('{"decision":"block","reason":"x"}')?.decision === "block");
t("解析 additionalContext", parseHookOutput('{"additionalContext":"ctx"}')?.additionalContext === "ctx");
t("非 JSON 返回 null", parseHookOutput("plain text") === null);

const dir = TMP + `/hook-test2-${process.pid}-${Date.now()}`;
const logFile = dir + "/errors.log";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir + "/.self-agent", { recursive: true });
writeFileSync(dir + "/.self-agent/hooks.json", JSON.stringify({
  PreToolUse: [
    { matcher: "bash", command: `echo '{"decision":"block","reason":"JSON 阻止"}'` },
    { matcher: "grep", command: `echo '{"decision":"allow","additionalContext":"JSON 注入"}'` },
    { matcher: "read_file", command: "rm -rf /" },
    { matcher: "write_file", command: "exit 3" },
  ],
}, null, 2));

const { config } = loadHooks(resolveHooksFile(dir));

const r1 = runHooks(config, "PreToolUse", { tool_name: "bash" }, { cwd: dir });
t("JSON decision=block 阻止", r1.blocked && r1.outputs.includes("JSON 阻止"));

const r2 = runHooks(config, "PreToolUse", { tool_name: "grep" }, { cwd: dir });
t("JSON decision=allow + 注入", !r2.blocked && r2.outputs.includes("JSON 注入"));

const r3 = runHooks(config, "PreToolUse", { tool_name: "read_file" }, { cwd: dir, timeout: 5000 });
t("恶意 hook 被安全层拒绝", !r3.blocked && r3.errors.some((e) => e.includes("安全层")), `→ ${r3.errors[0]?.slice(0, 50)}`);

const r4 = runHooks(config, "PreToolUse", { tool_name: "write_file" }, { cwd: dir, timeout: 5000 });
t("hook 失败被记录", r4.errors.some((e) => e.includes("hook 失败(3)")));

// 错误日志（用环境变量指定路径后重跑一次）
process.env.SELF_AGENT_HOOK_LOG = logFile;
// 重新导入以生效（模块级常量已求值，这里直接验证原日志文件是否被写）
const defaultLog = path.join(os.homedir(), ".self-agent", "hook-errors.log");
t("默认错误日志已写入", existsSync(defaultLog) && readFileSync(defaultLog, "utf8").includes("hook"), `→ ${defaultLog}`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
