import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sa-mcp-scope-"));
process.env.SELF_AGENT_MCP_APPROVALS = path.join(tmp, "approved.json");
process.env.SELF_AGENT_MCP_CONFIG = path.join(tmp, "user-mcp.json");

const mcp = await import("../mcp.mjs");

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 用户级配置
writeFileSync(
  process.env.SELF_AGENT_MCP_CONFIG,
  JSON.stringify({
    servers: {
      shared: { command: "node", args: ["u.mjs"] },
      userOnly: { command: "node", args: ["x.mjs"] },
    },
  })
);
// 项目级配置
const proj = path.join(tmp, "proj");
mkdirSync(path.join(proj, ".self-agent"), { recursive: true });
writeFileSync(
  path.join(proj, ".self-agent", "mcp.json"),
  JSON.stringify({
    servers: {
      shared: { command: "node", args: ["p.mjs"] },
      projectOnly: { command: "node", args: ["y.mjs"] },
    },
  })
);

// ── 1) 多作用域合并 ──
const { servers, files } = mcp.loadMcpConfigs(proj);
t("合并用户级与项目级", Object.keys(servers).length === 3, `→ ${Object.keys(servers).join(",")}`);
t("项目级覆盖同名 server", servers.shared.args[0] === "p.mjs");
t("项目级 scope=project", servers.projectOnly.scope === "project");
t("用户级 scope=user", servers.userOnly.scope === "user");
t("记录来源文件数", files.length === 2);
t("记录 sourceFile", servers.projectOnly.sourceFile.includes(".self-agent"));

// ── 2) 签名 ──
t("签名稳定", mcp.serverSignature("a", { command: "node", args: ["x"] }) === mcp.serverSignature("a", { command: "node", args: ["x"] }));
t("命令变化签名变化", mcp.serverSignature("a", { command: "node", args: ["x"] }) !== mcp.serverSignature("a", { command: "node", args: ["y"] }));

// ── 3) 审批 ──
t("初始未批准", mcp.isServerApproved("projectOnly", servers.projectOnly) === false);
mcp.approveServer("projectOnly", servers.projectOnly);
t("批准后已批准", mcp.isServerApproved("projectOnly", servers.projectOnly) === true);
t("listApprovals 含记录", Object.keys(mcp.listApprovals()).includes("projectOnly"));
t("记录含命令", String(mcp.listApprovals().projectOnly.command).includes("y.mjs"));

const changed = { ...servers.projectOnly, args: ["z.mjs"] };
t("命令变化后审批失效", mcp.isServerApproved("projectOnly", changed) === false);
t("撤销返回 true", mcp.revokeServer("projectOnly") === true);
t("撤销后未批准", mcp.isServerApproved("projectOnly", servers.projectOnly) === false);
t("撤销不存在返回 false", mcp.revokeServer("nope") === false);

// ── 4) needsApproval / assertApproved ──
t("用户级不需审批", mcp.needsApproval(servers.userOnly) === false);
t("项目级需审批", mcp.needsApproval(servers.projectOnly) === true);
t("未批准时 assert 抛错", (() => {
  try { mcp.assertApproved("projectOnly", servers.projectOnly); return false; } catch { return true; }
})());
mcp.approveServer("projectOnly", servers.projectOnly);
t("批准后 assert 通过", (() => {
  try { mcp.assertApproved("projectOnly", servers.projectOnly); return true; } catch { return false; }
})());
t("用户级 assert 直接通过", (() => {
  try { mcp.assertApproved("userOnly", servers.userOnly); return true; } catch { return false; }
})());

// ── 5) 命名空间 ──
t("命名空间格式", mcp.namespacedToolName("echo", "say") === "mcp__echo__say");
t("解析命名空间", JSON.stringify(mcp.parseNamespacedToolName("mcp__echo__say")) === JSON.stringify({ server: "echo", tool: "say" }));
t("带下划线的 server 名", JSON.stringify(mcp.parseNamespacedToolName("mcp__my_server__do_it")) === JSON.stringify({ server: "my_server", tool: "do_it" }));
t("非法名返回 null", mcp.parseNamespacedToolName("echo") === null);

// ── 6) 工具层 ──
const { runTool } = await import("../tools.mjs");
const ls = await runTool("mcp", { action: "list_servers" }, { cwd: proj });
t("工具 list_servers 含项目 server", !ls.isError && ls.text.includes("projectOnly"));
t("工具显示审批状态", ls.text.includes("已批准"));
const la = await runTool("mcp", { action: "list_approvals" }, { cwd: proj });
t("工具 list_approvals 可用", !la.isError && la.text.includes("projectOnly"));
const rv = await runTool("mcp", { action: "revoke", server: "projectOnly" }, { cwd: proj });
t("工具 revoke 成功", !rv.isError);
t("revoke 后状态显示未批准", (await runTool("mcp", { action: "list_servers" }, { cwd: proj })).text.includes("未批准"));
const ap = await runTool("mcp", { action: "approve", server: "projectOnly" }, { cwd: proj });
t("工具 approve 成功", !ap.isError && ap.text.includes("已批准"));
t("approve 未知 server 报错", (await runTool("mcp", { action: "approve", server: "nope" }, { cwd: proj })).isError === true);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
