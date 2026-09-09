import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  trackEdit,
  listVersions,
  rewind,
  diffStats,
  clearHistory,
  historyFileCount,
  historyRoot,
} from "../file-history.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const root = mkdtempSync(path.join(os.tmpdir(), "sa-fh-"));
const work = mkdtempSync(path.join(os.tmpdir(), "sa-fh-work-"));
const f = path.join(work, "a.txt");

// 1) 新文件：记录「当时不存在」
const v1 = trackEdit(f, { root });
t("首次 trackEdit 版本 1", v1.version === 1);
t("首次 trackEdit existed=false", v1.existed === false);
t("首次无备份文件", v1.backupFile === null);

writeFileSync(f, "line1\nline2\n");

// 2) 第二次 trackEdit 备份当前内容
const v2 = trackEdit(f, { root });
t("第二次 trackEdit 版本 2", v2.version === 2);
t("第二次 trackEdit existed=true", v2.existed === true);
t("第二次有备份文件", v2.backupFile === "v2");

writeFileSync(f, "changed\n");

// 3) 回滚到 v2 → 恢复改动前内容
const r1 = rewind(f, 2, { root });
t("回滚 v2 成功", r1.ok === true, `→ ${r1.detail ?? r1.error}`);
t("回滚后内容恢复", readFileSync(f, "utf8") === "line1\nline2\n");

// 4) 回滚到 v1 → 当时文件不存在 → 删除文件
const r2 = rewind(f, 1, { root });
t("回滚 v1 删除文件", r2.ok === true && !existsSync(f));

// 5) 版本列表
const vs = listVersions(f, { root });
t("历史版本数 2", vs.length === 2, `→ ${vs.length}`);
t("版本按时间递增", vs[0].version === 1 && vs[1].version === 2);

// 6) diffStats
writeFileSync(f, "x\n");
const d = diffStats(f, 2, { root });
t("diffStats 备份行数 3", d.ok === true && d.backupLines === 3, `→ ${d.backupLines}`);
t("diffStats 当前行数 2", d.currentLines === 2, `→ ${d.currentLines}`);
t("diffStats 标记已变化", d.changed === true);

// 7) 不存在的版本
t("回滚不存在版本失败", rewind(f, 99, { root }).ok === false);
t("diffStats 不存在版本失败", diffStats(f, 99, { root }).ok === false);

// 8) 多文件计数与清理
const f2 = path.join(work, "b.txt");
writeFileSync(f2, "b\n");
trackEdit(f2, { root });
t("文件计数 >= 2", historyFileCount({ root }) >= 2, `→ ${historyFileCount({ root })}`);
const c = clearHistory(f, { root });
t("清理单文件历史", c.ok === true && listVersions(f, { root }).length === 0);
t("清理不影响其他文件", listVersions(f2, { root }).length === 1);

// 9) 目录型路径不崩
t("目录路径 trackEdit 不抛错", (() => { try { trackEdit(work, { root }); return true; } catch { return false; } })());

// 10) 默认根目录
t("historyRoot 是路径", typeof historyRoot() === "string" && historyRoot().includes("file-history"));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
