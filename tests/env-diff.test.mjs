import { runTool, toOpenAITools } from "../tools.mjs";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
t("env_info 已注册", names.includes("env_info"));
t("diff 已注册", names.includes("diff"));
t("工具数 >= 18", names.length >= 18, `（${names.length}）`);

// env_info
const e = await runTool("env_info", {}, { cwd: "/root/dsh/self-agent" });
t("env_info 返回平台信息", !e.isError && e.text.includes("平台:") && e.text.includes("Node:"));
t("env_info 含 git 信息", e.text.includes("Git:"));
t("env_info 含可用命令", e.text.includes("可用命令:"));

// diff
const dir = path.join(os.tmpdir(), `sa-diff-${Date.now()}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "a.txt"), "line1\nline2\nline3\n");
writeFileSync(path.join(dir, "b.txt"), "line1\nline2-changed\nline3\n");
const d = await runTool("diff", { file_a: "a.txt", file_b: "b.txt" }, { cwd: dir });
t("diff 输出差异", !d.isError && d.text.includes("line2-changed") && d.text.includes("-line2"));
writeFileSync(path.join(dir, "c.txt"), "line1\nline2\nline3\n");
const d2 = await runTool("diff", { file_a: "a.txt", file_b: "c.txt" }, { cwd: dir });
t("无差异提示", !d2.isError && d2.text.includes("无差异"));
const d3 = await runTool("diff", { file_a: "a.txt", file_b: "nope.txt" }, { cwd: dir });
t("文件不存在报错", d3.isError);

rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
