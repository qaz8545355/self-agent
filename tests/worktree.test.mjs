import { createWorktree, removeWorktree, isGitRepo, listWorktrees } from "../worktree.mjs";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const base = path.dirname(fileURLToPath(import.meta.url)) + "/..";

// 1) git 仓库识别
t("识别 git 仓库", isGitRepo(base) === true);
t("非 git 目录返回 false", isGitRepo("/tmp") === false);

// 2) 非 git 目录降级（不抛错）
const wtBad = createWorktree("/tmp", { name: "x" });
t("非 git 目录降级", wtBad.created === false && !!wtBad.error, `→ ${wtBad.error}`);

// 3) 创建 worktree
const wt = createWorktree(base, { name: "test" });
t("创建 worktree", wt.created === true && existsSync(wt.dir), `→ ${wt.dir}`);
t("worktree 出现在列表", listWorktrees(base).includes(wt.dir));

// 4) worktree 是独立副本（在副本里改文件不影响主工作区）
const probe = path.join(wt.dir, "wt-probe.txt");
writeFileSync(probe, "isolated", "utf8");
t("副本内可写", readFileSync(probe, "utf8") === "isolated");
t("主工作区不受影响", !existsSync(path.join(base, "wt-probe.txt")));

// 5) 清理
const rm = removeWorktree(wt);
t("清理 worktree", rm.removed === true && !existsSync(wt.dir));
t("清理后不在列表", !listWorktrees(base).includes(wt.dir));

// 6) 重复清理安全
const rm2 = removeWorktree(wt);
t("重复清理安全", rm2.removed === false);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
