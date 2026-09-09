import { runTool, toOpenAITools } from "../tools.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const dir = path.join(os.tmpdir(), `sa-patch-test-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const ctx = { cwd: dir };

// 准备文件
writeFileSync(path.join(dir, "a.txt"), "hello world\nfoo bar\n", "utf8");
writeFileSync(path.join(dir, "b.txt"), "AAA\nBBB\n", "utf8");

// 1) 工具注册
const names = toOpenAITools().map((x) => x.function.name);
t("apply_patch 已注册", names.includes("apply_patch"));
t("工具数 >= 15", names.length >= 15, `（${names.length}）`);

// 2) 正常多文件编辑
const r1 = await runTool("apply_patch", {
  edits: [
    { path: "a.txt", old_string: "hello", new_string: "HELLO" },
    { path: "b.txt", old_string: "AAA", new_string: "aaa" },
  ],
}, ctx);
t("多文件编辑成功", !r1.isError, `→ ${String(r1.text).slice(0, 60)}`);
t("a.txt 已改", readFileSync(path.join(dir, "a.txt"), "utf8").includes("HELLO"));
t("b.txt 已改", readFileSync(path.join(dir, "b.txt"), "utf8").includes("aaa"));

// 3) 同文件多项编辑
const r2 = await runTool("apply_patch", {
  edits: [
    { path: "a.txt", old_string: "foo", new_string: "FOO" },
    { path: "a.txt", old_string: "world", new_string: "WORLD" },
  ],
}, ctx);
t("同文件多项编辑", !r2.isError && readFileSync(path.join(dir, "a.txt"), "utf8").includes("FOO") && readFileSync(path.join(dir, "a.txt"), "utf8").includes("WORLD"));

// 4) 原子性：一项失败 → 全部不写入
const beforeA = readFileSync(path.join(dir, "a.txt"), "utf8");
const beforeB = readFileSync(path.join(dir, "b.txt"), "utf8");
const r3 = await runTool("apply_patch", {
  edits: [
    { path: "a.txt", old_string: "HELLO", new_string: "HACKED" },
    { path: "b.txt", old_string: "NOT_EXIST_XYZ", new_string: "x" },
  ],
}, ctx);
t("一项失败整体拒绝", r3.isError && r3.text.includes("未找到"));
t("原子性：a.txt 未被修改", readFileSync(path.join(dir, "a.txt"), "utf8") === beforeA);
t("原子性：b.txt 未被修改", readFileSync(path.join(dir, "b.txt"), "utf8") === beforeB);

// 5) old_string 不唯一 → 拒绝
writeFileSync(path.join(dir, "dup.txt"), "x\nx\n", "utf8");
const r4 = await runTool("apply_patch", { edits: [{ path: "dup.txt", old_string: "x", new_string: "y" }] }, ctx);
t("不唯一时拒绝", r4.isError && r4.text.includes("不唯一"));

// 6) 文件不存在 → 拒绝
const r5 = await runTool("apply_patch", { edits: [{ path: "nope.txt", old_string: "a", new_string: "b" }] }, ctx);
t("文件不存在拒绝", r5.isError && r5.text.includes("不存在"));

// 7) 路径安全：写系统目录 → 拒绝
const r6 = await runTool("apply_patch", { edits: [{ path: "/etc/passwd", old_string: "a", new_string: "b" }] }, ctx);
t("系统目录被安全层拒绝", r6.isError && r6.text.includes("安全层"));

// 8) 空 edits → 拒绝
const r7 = await runTool("apply_patch", { edits: [] }, ctx);
t("空数组拒绝", r7.isError);

rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
