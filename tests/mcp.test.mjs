import { McpClient, loadMcpConfig, closeAll } from "../mcp.mjs";
import { runTool, toOpenAITools } from "../tools.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const here = path.dirname(fileURLToPath(import.meta.url));
const serverScript = path.join(here, "fixtures", "mcp-echo-server.mjs");
const dir = path.join(os.tmpdir(), `sa-mcp-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const cfgFile = path.join(dir, "mcp.json");
writeFileSync(cfgFile, JSON.stringify({ servers: { echo: { command: "node", args: [serverScript] } } }), "utf8");
process.env.SELF_AGENT_MCP_CONFIG = cfgFile;

// 1) 工具注册
const names = toOpenAITools().map((x) => x.function.name);
t("mcp 工具已注册", names.includes("mcp"));
t("工具数 >= 30", names.length >= 30, `（${names.length}）`);

// 2) 配置加载
const cfg = loadMcpConfig();
t("加载 mcp.json", Object.keys(cfg.servers).includes("echo"));

// 3) 客户端握手 + 列工具 + 调用
const client = new McpClient("echo", { command: "node", args: [serverScript] });
await client.connect();
const tools = await client.listTools();
t("MCP listTools", tools.length === 1 && tools[0].name === "echo", `→ ${JSON.stringify(tools.map((x) => x.name))}`);
const call = await client.callTool("echo", { text: "你好" });
t("MCP callTool", !call.isError && call.text === "echo: 你好", `→ ${call.text}`);
client.close();

// 4) 工具层：list_servers / list_tools / call
const s1 = await runTool("mcp", { action: "list_servers" }, {});
t("mcp list_servers", !s1.isError && s1.text.includes("echo"));
const s2 = await runTool("mcp", { action: "list_tools", server: "echo" }, {});
t("mcp list_tools", !s2.isError && s2.text.includes("echo"));
const s3 = await runTool("mcp", { action: "call", server: "echo", tool: "echo", args: { text: "world" } }, {});
t("mcp call", !s3.isError && s3.text.includes("echo: world"), `→ ${s3.text}`);
const s4 = await runTool("mcp", { action: "call", server: "nope", tool: "x" }, {});
t("未知 server 报错", s4.isError);
const s5 = await runTool("mcp", { action: "list_tools" }, {});
t("缺 server 报错", s5.isError);

closeAll();
delete process.env.SELF_AGENT_MCP_CONFIG;
rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
