import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractAtMentionedFiles,
  parseFileRef,
  isBinaryBuffer,
  readAttachment,
  collectAttachments,
  formatAttachments,
  ATTACHMENT_LIMITS,
} from "../attachments.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const root = mkdtempSync(path.join(os.tmpdir(), "sa-att-"));
writeFileSync(path.join(root, "a.txt"), "line1\nline2\nline3\nline4\nline5\n");
writeFileSync(path.join(root, "带 空格.txt"), "spaced\n");
writeFileSync(path.join(root, "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
mkdirSync(path.join(root, "dir"), { recursive: true });
writeFileSync(path.join(root, "big.txt"), "x".repeat(30000));

// ── 1) 引用提取 ──
t("普通 @file", JSON.stringify(extractAtMentionedFiles("看下 @a.txt")) === JSON.stringify(["a.txt"]));
t("引号路径含空格", JSON.stringify(extractAtMentionedFiles('看 @"带 空格.txt"')) === JSON.stringify(["带 空格.txt"]));
t("邮箱不误判", extractAtMentionedFiles("联系 a@b.com").length === 0);
t("去重", extractAtMentionedFiles("@a.txt @a.txt").length === 1);
t("多个引用保序", JSON.stringify(extractAtMentionedFiles("@a.txt @b.txt")) === JSON.stringify(["a.txt", "b.txt"]));
t("行范围引用", JSON.stringify(extractAtMentionedFiles("@a.txt#L2-4")) === JSON.stringify(["a.txt#L2-4"]));
t("agent 提及被排除", extractAtMentionedFiles('@"code-reviewer (agent)"').length === 0);
t("空内容返回空", extractAtMentionedFiles("").length === 0);

// ── 2) 行范围解析 ──
t("无范围", JSON.stringify(parseFileRef("a.txt")) === JSON.stringify({ path: "a.txt", start: null, end: null }));
t("单行范围", JSON.stringify(parseFileRef("a.txt#L3")) === JSON.stringify({ path: "a.txt", start: 3, end: 3 }));
t("多行范围", JSON.stringify(parseFileRef("a.txt#L2-4")) === JSON.stringify({ path: "a.txt", start: 2, end: 4 }));

// ── 3) 二进制检测 ──
t("NUL 判定为二进制", isBinaryBuffer(Buffer.from([1, 2, 0, 3])) === true);
t("纯文本不是二进制", isBinaryBuffer(Buffer.from("hello")) === false);

// ── 4) 单文件读取 ──
const a = readAttachment("a.txt", root);
t("读取成功", a.ok === true && a.content.includes("line1"));
t("不存在返回 not_found", readAttachment("nope.txt", root).reason === "not_found");
t("目录返回 is_directory", readAttachment("dir", root).reason === "is_directory");
t("二进制返回 binary", readAttachment("bin.dat", root).reason === "binary");
t("引号路径可读取", readAttachment("带 空格.txt", root).ok === true);

const ranged = readAttachment("a.txt#L2-3", root);
t("行范围读取", ranged.ok === true && ranged.content === "line2\nline3");
const single = readAttachment("a.txt#L4", root);
t("单行读取", single.content === "line4");
const overflow = readAttachment("a.txt#L1-999", root);
t("行范围越界不报错", overflow.ok === true && overflow.content.includes("line5"));

const big = readAttachment("big.txt", root);
t("超限截断", big.ok === true && big.truncated === true && big.content.length <= ATTACHMENT_LIMITS.maxBytesPerFile);

// ── 5) 批量收集 ──
const c1 = collectAttachments('看 @a.txt 和 @"带 空格.txt"', { cwd: root });
t("收集两个附件", c1.attachments.length === 2);
t("无跳过项", c1.skipped.length === 0);

const c2 = collectAttachments("@a.txt @nope.txt", { cwd: root });
t("缺失文件记入 skipped", c2.attachments.length === 1 && c2.skipped[0].reason === "not_found");

// 6 个真实文件触发 maxFiles 限制
for (let i = 0; i < 6; i++) writeFileSync(path.join(root, `f${i}.txt`), `content ${i}\n`);
const c3 = collectAttachments("@f0.txt @f1.txt @f2.txt @f3.txt @f4.txt @f5.txt", { cwd: root });
t("超过 maxFiles 被限制", c3.attachments.length === ATTACHMENT_LIMITS.maxFiles, `→ ${c3.attachments.length}`);
t("被限制的记入 skipped", c3.skipped.some((s) => s.reason === "too_many_files"));

const c4 = collectAttachments("@big.txt", { cwd: root, limits: { maxFiles: 5, maxBytesPerFile: 30000, maxTotalBytes: 10 } });
t("总量限制生效", c4.attachments.length === 0 && c4.skipped.some((s) => s.reason === "total_limit"));

// ── 6) 格式化 ──
const fmt = formatAttachments([{ ref: "a.txt", content: "hi", truncated: false }]);
t("格式化含标题", fmt.includes("### a.txt"));
t("格式化用代码块", fmt.includes("```"));
const fmt2 = formatAttachments([{ ref: "b.md", content: "```\ncode\n```", truncated: false }]);
t("内容含代码块时换 ~~~", fmt2.includes("~~~"));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
