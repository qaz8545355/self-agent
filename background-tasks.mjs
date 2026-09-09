/**
 * background-tasks.mjs — 后台任务运行时
 *
 * 移植自 Claude Code `src/tasks/`（LocalShellTask / LocalAgentTask 等）的核心设计：
 * - **任务即状态**：统一 `id / kind / status / outputFile / offset / notified`
 * - 输出落盘，**增量读**（按字节 offset），避免重复把大输出塞回上下文
 * - 完成通知：任务结束后进入待通知队列，主循环每步取一次（防重通知）
 * - **前台超时自动转后台**：超过 `FOREGROUND_MS` 未结束即返回 taskId，不阻塞主循环
 *
 * 与源码的差异：源码是长驻进程 + 多任务类型（shell/agent/remote/teammate…），
 * 我们只做单进程内的 shell 任务运行时。
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** 前台等待上限：超过即转后台（对齐源码「前台超 15s 自动转后台」） */
export const FOREGROUND_MS = 15_000;
/** 单次增量读取的最大字节数 */
export const MAX_READ_BYTES = 20_000;
/** 保留的最大历史任务数 */
const MAX_TASKS = 50;

const OUT_DIR = process.env.SELF_AGENT_BG_DIR ?? path.join(os.homedir(), ".self-agent", "bg-tasks");

/** id → task */
const tasks = new Map();
/** 已完成但尚未通知的任务 id 队列 */
const notifyQueue = [];
let seq = 0;

function nextId() {
  seq += 1;
  return `bg${Date.now().toString(36)}${seq.toString(36)}`;
}

function trimTasks() {
  if (tasks.size <= MAX_TASKS) return;
  const finished = [...tasks.values()]
    .filter((t) => t.status !== "running")
    .sort((a, b) => a.startedAt - b.startedAt);
  while (tasks.size > MAX_TASKS && finished.length) {
    const t = finished.shift();
    tasks.delete(t.id);
  }
}

/**
 * 启动一个后台 shell 任务。
 * @param {string} command
 * @param {{cwd?:string, label?:string}} [opts]
 * @returns {{id:string, status:string, outputFile:string}}
 */
export function startShellTask(command, opts = {}) {
  const { cwd = process.cwd(), label } = opts;
  const id = nextId();
  const outputFile = path.join(OUT_DIR, `${id}.log`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outputFile, "");

  const child = spawn("/bin/bash", ["-c", command], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const task = {
    id,
    kind: "shell",
    command,
    label: label ?? command.slice(0, 80),
    status: "running",
    outputFile,
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    notified: false,
    child,
  };
  tasks.set(id, task);

  const append = (chunk) => {
    try {
      appendFileSync(outputFile, chunk);
    } catch {
      /* 输出文件写失败不影响任务 */
    }
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  child.on("error", (err) => {
    append(`\n[启动失败] ${err.message}\n`);
    task.status = "failed";
    task.exitCode = -1;
    task.finishedAt = Date.now();
    notifyQueue.push(id);
  });

  child.on("close", (code, signal) => {
    if (task.status === "running") {
      task.status = signal ? "stopped" : code === 0 ? "completed" : "failed";
    }
    task.exitCode = code;
    task.finishedAt = Date.now();
    if (!task.notified) notifyQueue.push(id);
    trimTasks();
  });

  return task;
}

/** 任务摘要（不含 child 句柄） */
export function taskInfo(t) {
  const { child, ...rest } = t;
  let size = 0;
  try {
    size = statSync(t.outputFile).size;
  } catch {
    /* 文件可能已清理 */
  }
  return { ...rest, outputBytes: size };
}

export function getTask(id) {
  return tasks.get(id) ?? null;
}

export function listTasks() {
  return [...tasks.values()].map(taskInfo).sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * 增量读取任务输出。
 * @returns {{ok:boolean, text?:string, offset?:number, eof?:boolean, status?:string, error?:string}}
 */
export function readTaskOutput(id, options = {}) {
  const { offset = 0, maxBytes = MAX_READ_BYTES } = options;
  const t = tasks.get(id);
  if (!t) return { ok: false, error: `任务不存在：${id}` };
  if (!existsSync(t.outputFile)) return { ok: true, text: "", offset, eof: t.status !== "running", status: t.status };

  const buf = readFileSync(t.outputFile);
  const start = Math.max(0, Math.min(Number(offset) || 0, buf.length));
  const slice = buf.subarray(start, start + maxBytes);
  const nextOffset = start + slice.length;
  return {
    ok: true,
    text: slice.toString("utf8"),
    offset: nextOffset,
    eof: nextOffset >= buf.length && t.status !== "running",
    status: t.status,
    totalBytes: buf.length,
  };
}

/** 停止任务（SIGTERM → 2s 后 SIGKILL） */
export function stopTask(id) {
  const t = tasks.get(id);
  if (!t) return { ok: false, error: `任务不存在：${id}` };
  if (t.status !== "running") return { ok: false, error: `任务已结束（${t.status}）` };
  try {
    t.child.kill("SIGTERM");
    setTimeout(() => {
      if (t.status === "running") {
        try {
          t.child.kill("SIGKILL");
        } catch {
          /* 已退出 */
        }
      }
    }, 2000).unref?.();
    t.status = "stopped";
    t.finishedAt = Date.now();
    if (!t.notified) notifyQueue.push(id);
    return { ok: true, detail: `已停止 ${id}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** 取出待通知的完成任务（取出即标记已通知，防重） */
export function drainNotifications() {
  const out = [];
  while (notifyQueue.length) {
    const id = notifyQueue.shift();
    const t = tasks.get(id);
    if (!t || t.notified) continue;
    t.notified = true;
    out.push(taskInfo(t));
  }
  return out;
}

/** 仍在运行的任务数 */
export function runningCount() {
  return [...tasks.values()].filter((t) => t.status === "running").length;
}

/** 等待任务结束或超时；返回是否已结束 */
export function waitForTask(id, timeoutMs = FOREGROUND_MS) {
  const t = tasks.get(id);
  if (!t) return Promise.resolve(true);
  if (t.status !== "running") return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    t.child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** 清理某个任务的输出文件与记录 */
export function removeTask(id) {
  const t = tasks.get(id);
  if (!t) return { ok: false, error: `任务不存在：${id}` };
  if (t.status === "running") return { ok: false, error: "任务仍在运行，先 stop" };
  try {
    rmSync(t.outputFile, { force: true });
  } catch {
    /* 忽略 */
  }
  tasks.delete(id);
  return { ok: true, detail: `已清理 ${id}` };
}

/** 仅供测试：重置运行时状态 */
export function _reset() {
  for (const t of tasks.values()) {
    if (t.status === "running") {
      try {
        t.child.kill("SIGKILL");
      } catch {
        /* 忽略 */
      }
    }
  }
  tasks.clear();
  notifyQueue.length = 0;
  seq = 0;
}

export function outputDir() {
  return OUT_DIR;
}
