#!/usr/bin/env node
/**
 * cli.mjs — self-agent 入口
 *
 * 用法：
 *   node cli.mjs --task "任务描述" [--cwd 目录] [--model 模型] [--max-steps N]
 *   node cli.mjs --resume <sessionId> --task "继续的任务"
 *   node cli.mjs --list
 */
import { runAgent } from "./agent.mjs";
import { saveSession, loadSession, listSessions, newSessionId, pruneSessions } from "./session.mjs";

function parseArgs(argv) {
  const out = { cwd: process.cwd(), maxSteps: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task" || a === "-t") out.task = argv[++i];
    else if (a === "--resume" || a === "-r") out.resume = argv[++i];
    else if (a === "--model" || a === "-m") out.model = argv[++i];
    else if (a === "--cwd" || a === "-C") out.cwd = argv[++i];
    else if (a === "--max-steps") out.maxSteps = Number(argv[++i]);
    else if (a === "--stream") out.stream = true;
    else if (a === "--list") out.list = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!a.startsWith("-")) out.task = out.task ? `${out.task} ${a}` : a;
  }
  return out;
}

const USAGE = `self-agent — 自研 coding agent

用法:
  node cli.mjs --task "任务描述" [选项]
选项:
  --cwd <dir>       工作目录（默认当前目录）
  --model <name>    模型（默认 gpt-6-astra，走 1MMC 中转）
  --max-steps <n>   最大步数（默认 100）
  --stream          流式输出模型回复（实时打印）
  --resume <id>     恢复指定会话
  --list            列出会话
  --help            显示帮助`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (opts.list) {
    const list = listSessions();
    if (!list.length) return console.log("（无会话）");
    for (const s of list) console.log(`${s.id}  ${s.updatedAt ?? "?"}  ${s.messages} 条消息`);
    return;
  }
  if (!opts.task) {
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }

  const sessionId = opts.resume ?? newSessionId();
  const prev = opts.resume ? loadSession(opts.resume) : null;
  if (opts.resume && !prev) console.error(`⚠️ 会话 ${opts.resume} 不存在，将新建`);

  const onEvent = (ev) => {
    if (ev.type === "delta") process.stdout.write(ev.text);
    else if (ev.type === "parallel_batch") console.log(`⚡ 并行执行 ${ev.count} 个只读工具`);
    else if (ev.type === "retry") console.log(`🔄 重试（${ev.kind}，等待 ${ev.waitMs}ms）`);
    else if (ev.type === "force_compact") console.log(`📦 上下文超限，强制压缩后重试`);
    else if (ev.type === "stalled") console.log(`⛔ 连续 ${ev.streak} 步无进展（无文件改动 + 结果重复），提前终止`);
    else if (ev.type === "memory_loaded") console.log(`📄 已注入 ${ev.count} 个记忆文件${ev.truncated ? "（超长已截断）" : ""}`);
    else if (ev.type === "assistant" && ev.content && !opts.stream) console.log(`\n💭 ${ev.content.slice(0, 400)}`);
    else if (ev.type === "tool") console.log(`\n🔧 ${ev.name} ${JSON.stringify(ev.args).slice(0, 200)}`);
    else if (ev.type === "tool_result") {
      console.log(`${ev.isError ? "❌" : "✅"} ${String(ev.text).slice(0, 300)}`);
    }
  };

  const result = await runAgent({
    task: opts.task,
    messages: prev?.messages ?? [],
    cwd: opts.cwd,
    model: opts.model,
    maxSteps: opts.maxSteps,
    stream: opts.stream,
    onEvent,
  });

  console.log(`\n────────────\n${result.content}`);
  const file = saveSession(sessionId, result.messages, { model: opts.model, cwd: opts.cwd });
  // 后台清理旧会话（保留最近 50 个 / 30 天）
  try {
    const pruned = pruneSessions();
    if (pruned.deleted > 0) console.log(`[清理] 删除旧会话 ${pruned.deleted} 个，保留 ${pruned.kept} 个`);
  } catch {
    /* 清理失败不影响主流程 */
  }
  console.log(`\n[session ${sessionId}] steps=${result.steps} tokens≈${result.totalTokens} → ${file}`);
}

main().catch((e) => {
  console.error(`错误：${e.message}`);
  process.exit(1);
});
