/**
 * mcp.mjs — MCP（Model Context Protocol）客户端
 *
 * 通过 stdio 与 MCP server 通信（JSON-RPC 2.0，换行分隔）：
 *   initialize → notifications/initialized → tools/list → tools/call
 *
 * 配置（~/.self-agent/mcp.json，可用 SELF_AGENT_MCP_CONFIG 覆盖）：
 *   { "servers": { "echo": { "command": "node", "args": ["server.mjs"], "env": {} } } }
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG = path.join(os.homedir(), ".self-agent", "mcp.json");

/** 项目级 server 的审批记录（可用 SELF_AGENT_MCP_APPROVALS 覆盖） */
const DEFAULT_APPROVALS =
  process.env.SELF_AGENT_MCP_APPROVALS ?? path.join(os.homedir(), ".self-agent", "mcp-approved.json");

/** 读取 MCP 配置 */
export function loadMcpConfig(file = process.env.SELF_AGENT_MCP_CONFIG ?? DEFAULT_CONFIG) {
  if (!existsSync(file)) return { file, servers: {} };
  try {
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    const servers = cfg?.servers && typeof cfg.servers === "object" ? cfg.servers : {};
    return { file, servers };
  } catch {
    return { file, servers: {}, error: "mcp.json 解析失败" };
  }
}

/** 单个 MCP server 连接 */
export class McpClient {
  constructor(name, conf) {
    this.name = name;
    this.conf = conf ?? {};
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
  }

  /** 启动 server 并完成 initialize 握手 */
  async connect({ timeout = 15_000 } = {}) {
    if (this.ready) return this;
    if (!this.conf.command) throw new Error(`MCP server「${this.name}」缺少 command`);
    this.proc = spawn(this.conf.command, this.conf.args ?? [], {
      cwd: this.conf.cwd ?? process.cwd(),
      env: { ...process.env, ...(this.conf.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.on("exit", (code) => {
      this.ready = false;
      for (const { reject } of this.pending.values()) reject(new Error(`MCP server 退出（code=${code}）`));
      this.pending.clear();
    });

    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "self-agent", version: "0.19.0" },
      },
      { timeout }
    );
    this._notify("notifications/initialized", {});
    this.ready = true;
    return this;
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // 非 JSON 行忽略
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  }

  _write(obj) {
    if (!this.proc?.stdin?.writable) throw new Error("MCP server 未运行");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  _notify(method, params) {
    this._write({ jsonrpc: "2.0", method, params });
  }

  /** 发送请求并等待结果 */
  request(method, params = {}, { timeout = 30_000 } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 请求超时：${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /** 列出该 server 的工具 */
  async listTools() {
    await this.connect();
    const res = await this.request("tools/list", {});
    return Array.isArray(res?.tools) ? res.tools : [];
  }

  /** 调用工具 */
  async callTool(name, args = {}) {
    await this.connect();
    const res = await this.request("tools/call", { name, arguments: args }, { timeout: 60_000 });
    const content = Array.isArray(res?.content) ? res.content : [];
    const text = content
      .map((c) => (c?.type === "text" ? c.text : `[${c?.type ?? "unknown"}]`))
      .join("\n");
    return { text: text || "(无文本返回)", isError: !!res?.isError, raw: res };
  }

  close() {
    try {
      this.proc?.kill("SIGTERM");
    } catch {
      /* 忽略 */
    }
    this.proc = null;
    this.ready = false;
  }
}

/** 连接缓存（同一 server 复用进程） */
const pool = new Map();

/** 获取（并按需连接）某个 server 的客户端；enforceApproval=true 时校验项目级 server 审批 */
export async function getClient(name, conf, options = {}) {
  if (options.enforceApproval) assertApproved(name, conf, options.approvalFile ?? DEFAULT_APPROVALS);
  if (pool.has(name)) {
    const c = pool.get(name);
    if (c.ready) return c;
    pool.delete(name);
  }
  const client = new McpClient(name, conf);
  await client.connect();
  pool.set(name, client);
  return client;
}

/** 关闭全部连接 */
export function closeAll() {
  for (const c of pool.values()) c.close();
  pool.clear();
}

// ---------------------------------------------------------------------------
// 多作用域配置（移植 services/mcp/config.ts 的 scope 设计）
// ---------------------------------------------------------------------------

/**
 * 合并多作用域配置：用户级（`~/.self-agent/mcp.json`）→ 项目级（`<cwd>/.self-agent/mcp.json`）。
 * 同名 server 项目级覆盖用户级；每个 server 带 `scope` 与 `sourceFile`。
 */
export function loadMcpConfigs(cwd = process.cwd(), options = {}) {
  const userFile = options.userFile ?? process.env.SELF_AGENT_MCP_CONFIG ?? DEFAULT_CONFIG;
  const projectFile = options.projectFile ?? path.join(cwd, ".self-agent", "mcp.json");

  const servers = {};
  const files = [];
  for (const [file, scope] of [
    [userFile, "user"],
    [projectFile, "project"],
  ]) {
    if (!existsSync(file)) continue;
    files.push(file);
    let cfg = {};
    try {
      cfg = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // 解析失败跳过该文件
    }
    for (const [name, conf] of Object.entries(cfg?.servers ?? {})) {
      if (!conf || typeof conf !== "object") continue;
      servers[name] = { ...conf, scope, sourceFile: file };
    }
  }
  return { servers, files };
}

/** server 签名：由 name + command + args 决定（改了命令就需重新批准） */
export function serverSignature(name, conf) {
  return createHash("sha1")
    .update(`${name}|${conf?.command ?? ""}|${JSON.stringify(conf?.args ?? [])}`)
    .digest("hex")
    .slice(0, 16);
}

export function readApprovals(file = DEFAULT_APPROVALS) {
  if (!existsSync(file)) return {};
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function writeApprovals(data, file = DEFAULT_APPROVALS) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function isServerApproved(name, conf, file = DEFAULT_APPROVALS) {
  const rec = readApprovals(file)[name];
  return !!rec && rec.signature === serverSignature(name, conf);
}

/** 批准一个 server（记录签名） */
export function approveServer(name, conf, file = DEFAULT_APPROVALS) {
  const data = readApprovals(file);
  const record = {
    signature: serverSignature(name, conf),
    command: `${conf?.command ?? ""} ${(conf?.args ?? []).join(" ")}`.trim(),
    scope: conf?.scope ?? "user",
    approvedAt: new Date().toISOString(),
  };
  data[name] = record;
  writeApprovals(data, file);
  return record;
}

export function revokeServer(name, file = DEFAULT_APPROVALS) {
  const data = readApprovals(file);
  if (!data[name]) return false;
  delete data[name];
  writeApprovals(data, file);
  return true;
}

export function listApprovals(file = DEFAULT_APPROVALS) {
  return readApprovals(file);
}

/** 项目级 server 需要显式批准（防止 clone 来的仓库里 mcp.json 自动执行命令） */
export function needsApproval(conf) {
  return conf?.scope === "project";
}

/** 未批准时抛错 */
export function assertApproved(name, conf, file = DEFAULT_APPROVALS) {
  if (!needsApproval(conf)) return;
  if (!isServerApproved(name, conf, file)) {
    throw new Error(
      `MCP server「${name}」来自项目配置（${conf.sourceFile}），尚未批准，拒绝连接。` +
        `确认可信后用 mcp 工具 action=approve 批准。`
    );
  }
}

// ---------------------------------------------------------------------------
// 工具命名空间
// ---------------------------------------------------------------------------

/** MCP 工具在 agent 侧的名字：mcp__<server>__<tool> */
export function namespacedToolName(server, tool) {
  return `mcp__${server}__${tool}`;
}

/** 解析命名空间；非法返回 null */
export function parseNamespacedToolName(name) {
  const m = String(name ?? "").match(/^mcp__(.+?)__(.+)$/);
  if (!m) return null;
  return { server: m[1], tool: m[2] };
}
