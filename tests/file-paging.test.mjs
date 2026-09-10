import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const dir = mkdtempSync(path.join(os.tmpdir(), "sa-paging-"));
writeFileSync(path.join(dir, "big.txt"), Array.from({ length: 300 }, (_, i) => `line${i + 1}`).join("\n"));
writeFileSync(path.join(dir, "small.txt"), "a\nb\nc");
mkdirSync(path.join(dir, "sub"), { recursive: true });

// ── 基本读取 ──
const all = await runTool("read_file", { path: "small.txt" }, { cwd: dir });
t("默认读全文", !all.isError && all.text.includes("a") && all.text.includes("c"));
t("输出带行号", /^1\ta/m.test(all.text), `→ ${JSON.stringify(all.text.slice(0, 20))}`);
t("短文件无续读提示", !all.text.includes("继续读用"));

// ── limit ──
const lim = await runTool("read_file", { path: "big.txt", limit: 10 }, { cwd: dir });
const limLines = lim.text.split("\n").filter((l) => /^\d+\t/.test(l));
t("limit 生效（10 行）", limLines.length === 10, `→ ${limLines.length}`);
t("提示总行数", lim.text.includes("共 300 行"));
t("提示续读 offset", lim.text.includes("offset=11"));

// ── offset ──
const off = await runTool("read_file", { path: "big.txt", offset: 291, limit: 20 }, { cwd: dir });
t("offset 生效", off.text.includes("line291"));
t("offset 起始行号正确", /^291\t/m.test(off.text));
t("读到末尾无续读提示", !off.text.includes("继续读用"));

// ── 边界 ──
const over = await runTool("read_file", { path: "big.txt", offset: 9999 }, { cwd: dir });
t("offset 超范围有提示", over.text.includes("超出文件范围"));
const huge = await runTool("read_file", { path: "big.txt", limit: 99999 }, { cwd: dir });
t("超大 limit 被夹到上限且不崩", !huge.isError && huge.text.length > 0);
const z = await runTool("read_file", { path: "big.txt", offset: 0, limit: 0 }, { cwd: dir });
t("非法 offset/limit 归一化", !z.isError && z.text.includes("line1"));

// ── 错误 ──
t("目录报错", (await runTool("read_file", { path: "sub" }, { cwd: dir })).isError === true);
t("不存在报错", (await runTool("read_file", { path: "nope.txt" }, { cwd: dir })).isError === true);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
