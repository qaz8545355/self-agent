import { formatAction, classifyAction, createAuditLog, DECISION } from "../permission-audit.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const cwd = "/tmp/sa-audit";

// ── 1) 动作格式化 ──
t("bash 格式化", formatAction("bash", { command: "ls -la" }) === "bash: ls -la");
t("write_file 格式化", formatAction("write_file", { path: "a.txt", content: "abc" }).includes("a.txt（3 字符）"));
t("apply_patch 格式化", formatAction("apply_patch", { edits: [1, 2] }).includes("2 处编辑"));
t("未知工具格式化", formatAction("foo", { a: 1 }).startsWith("foo:"));

// ── 2) 分类：bash ──
const r1 = classifyAction("bash", { command: "ls -la" }, { cwd });
t("只读 bash → allow", r1.decision === DECISION.ALLOW && r1.source === "readonly");
const r2 = classifyAction("bash", { command: "rm -rf /" }, { cwd });
t("危险 bash → deny", r2.decision === DECISION.DENY && r2.source === "execpolicy");
const r3 = classifyAction("bash", { command: "mkdir -p x" }, { cwd });
t("普通 bash → ask", r3.decision === DECISION.ASK);
t("分类结果带 action 文本", typeof r1.action === "string" && r1.action.includes("ls"));

// ── 3) 分类：写工具 ──
t("写工作目录 → allow", classifyAction("write_file", { path: "src/a.js", content: "x" }, { cwd }).decision === DECISION.ALLOW);
t("写 /etc → deny", classifyAction("write_file", { path: "/etc/passwd", content: "x" }, { cwd }).decision === DECISION.DENY);
t("写 /boot → deny", classifyAction("write_file", { path: "/boot/x", content: "x" }, { cwd }).decision === DECISION.DENY);
t("写工作区内的 /root/xxx → allow（工作区在 /root 下）", classifyAction("write_file", { path: "/root/dsh/x", content: "x" }, { cwd }).decision === DECISION.ALLOW);
t("edit_file 工作目录 → allow", classifyAction("edit_file", { path: "a.js" }, { cwd }).decision === DECISION.ALLOW);
t("apply_patch 全合法 → allow", classifyAction("apply_patch", { edits: [{ path: "a.js" }, { path: "b.js" }] }, { cwd }).decision === DECISION.ALLOW);
t("apply_patch 含非法路径 → deny", classifyAction("apply_patch", { edits: [{ path: "a.js" }, { path: "/etc/hosts" }] }, { cwd }).decision === DECISION.DENY);
t("写工具缺 path → ask", classifyAction("write_file", {}, { cwd }).decision === DECISION.ASK);

// ── 4) 分类：只读工具 / 未知 ──
t("read_file → allow", classifyAction("read_file", { path: "a" }, { cwd }).decision === DECISION.ALLOW);
t("grep → allow", classifyAction("grep", { pattern: "x" }, { cwd }).decision === DECISION.ALLOW);
t("未知工具 → ask", classifyAction("mystery_tool", {}, { cwd }).decision === DECISION.ASK);
t("deny 带理由", classifyAction("write_file", { path: "/etc/passwd" }, { cwd }).reason.includes("系统目录") ||
  classifyAction("write_file", { path: "/etc/passwd" }, { cwd }).reason.length > 0);

// ── 5) 审计日志 ──
const log = createAuditLog();
log.record("bash", { command: "ls" }, { cwd });
log.record("bash", { command: "mkdir x" }, { cwd });
log.record("write_file", { path: "/etc/passwd" }, { cwd });
const sum = log.summary();
t("审计统计总数 3", sum.total === 3);
t("审计统计 allow=1", sum.counts.allow === 1);
t("审计统计 ask=1", sum.counts.ask === 1);
t("审计统计 deny=1", sum.counts.deny === 1);
t("askRatio 计算", sum.askRatio === 0.333);
t("entries 记录 3 条", log.entries().length === 3);
t("entries 含工具名", log.entries()[0].tool === "bash");
log.reset();
t("reset 清空", log.summary().total === 0 && log.entries().length === 0);

const limited = createAuditLog({ limit: 2 });
limited.record("bash", { command: "ls" }, { cwd });
limited.record("bash", { command: "ls" }, { cwd });
limited.record("bash", { command: "ls" }, { cwd });
t("limit 生效", limited.entries().length === 2);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
