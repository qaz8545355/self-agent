import { memoryAgeDays, memoryAge, memoryFreshnessText, annotateMemory, annotateMemories } from "../memory-age.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const DAY = 86_400_000;
const now = Date.now();

t("今天 = 0 天", memoryAgeDays(now) === 0);
t("昨天 = 1 天", memoryAgeDays(now - DAY) === 1);
t("47 天前 = 47 天", memoryAgeDays(now - 47 * DAY) === 47);
t("未来时间不返回负数", memoryAgeDays(now + DAY) === 0);
t("非法输入返回 0", memoryAgeDays(NaN) === 0);

t("年龄渲染：今天", memoryAge(now) === "今天");
t("年龄渲染：昨天", memoryAge(now - DAY) === "昨天");
t("年龄渲染：天", memoryAge(now - 5 * DAY) === "5 天前");
t("年龄渲染：月", memoryAge(now - 60 * DAY).includes("个月"));
t("年龄渲染：年", memoryAge(now - 400 * DAY).includes("年"));

t("今天不提示过时", memoryFreshnessText(now) === "");
t("昨天不提示过时", memoryFreshnessText(now - DAY) === "");
t("3 天前提示过时", memoryFreshnessText(now - 3 * DAY).includes("可能已过时"));

const fresh = annotateMemory("用户喜欢跑步", now);
t("新鲜记忆标注无警告", fresh.startsWith("[记忆 · 今天]") && !fresh.includes("⚠️"));

const old = annotateMemory("DSH 版本是 0.1.1-rc.2", now - 47 * DAY);
t("旧记忆带过时警告", old.includes("47 天前") && old.includes("⚠️") && old.includes("可能已过时"), `→ ${old.split("\n")[0]}`);

const multi = annotateMemories([
  { content: "记忆 A", mtimeMs: now },
  { content: "记忆 B", mtimeMs: now - 10 * DAY },
]);
t("批量标注包含两条", multi.includes("记忆 A") && multi.includes("记忆 B") && multi.split("[记忆 ·").length === 3);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
