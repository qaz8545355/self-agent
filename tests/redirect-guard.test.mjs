import { extractRedirectTargets, checkCommand } from "../safety.mjs";
import { classifyAction } from "../permission-audit.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// ── 重定向目标提取 ──
t("提取 > 目标", JSON.stringify(extractRedirectTargets("echo hi > out.txt")) === JSON.stringify(["out.txt"]));
t("提取 >> 目标", JSON.stringify(extractRedirectTargets("echo hi >> log.txt")) === JSON.stringify(["log.txt"]));
t("提取 2> 目标", JSON.stringify(extractRedirectTargets("cmd 2> err.log")) === JSON.stringify(["err.log"]));
t("提取 &> 目标", JSON.stringify(extractRedirectTargets("cmd &> all.log")) === JSON.stringify(["all.log"]));
t("忽略 /dev/null", extractRedirectTargets("cmd > /dev/null").length === 0);
t("忽略 2>&1", extractRedirectTargets("cmd > out.txt 2>&1").length === 1);
t("引号路径", JSON.stringify(extractRedirectTargets('echo x > "my file.txt"')) === JSON.stringify(["my file.txt"]));
t("单引号路径", JSON.stringify(extractRedirectTargets("echo x > 'a b.txt'")) === JSON.stringify(["a b.txt"]));
t("多目标", extractRedirectTargets("a > x 2> y").length === 2);
t("无重定向返回空", extractRedirectTargets("ls -la").length === 0);
t("空值安全", extractRedirectTargets(null).length === 0);

// ── 重定向目标的安全检查 ──
t("写 /etc 被拦", checkCommand("echo hacked > /etc/passwd").allow === false);
t("追写 /etc 被拦", checkCommand("echo hacked >> /etc/hosts").allow === false);
t("2> 到系统目录被拦", checkCommand("cmd 2> /var/lib/x.log").allow === false);
t("写工作目录放行", checkCommand("echo hi > out.txt", { cwd: "/tmp" }).allow === true);
t("相对路径按 cwd 解析", checkCommand("echo hi > ../etc/x", { cwd: "/usr/local" }).allow === false);
t("重定向到 /dev/null 放行", checkCommand("cmd > /dev/null").allow === true);
t("拦截理由提到重定向", String(checkCommand("echo x > /etc/passwd").reason).includes("重定向"));
t("普通只读命令不受影响", checkCommand("ls -la").allow === true);
t("危险删除仍被拦", checkCommand("rm -rf /").allow === false);

// ── 与审计分类联动 ──
const v = classifyAction("bash", { command: "echo x > /etc/passwd" }, { cwd: "/tmp" });
t("审计把重定向写入判为 deny", v.decision === "deny", `→ ${v.decision}`);
const ok = classifyAction("bash", { command: "echo x > out.txt" }, { cwd: "/tmp" });
t("工作目录重定向不是 deny", ok.decision !== "deny");

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
