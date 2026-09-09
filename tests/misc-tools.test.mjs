import { runTool, toOpenAITools } from "../tools.mjs";
import { existsSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
for (const n of ["sleep", "config", "tool_search"]) t(`${n} 已注册`, names.includes(n));
t("工具数 >= 25", names.length >= 25, `（${names.length}）`);

// sleep
const t0 = Date.now();
const sl = await runTool("sleep", { seconds: 0.3 }, {});
const ms = Date.now() - t0;
t("sleep 等待生效", !sl.isError && ms >= 250 && ms < 2000, `（${ms}ms）`);
// 上限逻辑不实测（会真等 300 秒），改为验证源码约束
const src = readFileSync(new URL("../tools.mjs", import.meta.url), "utf8");
t("sleep 有 300 秒上限", /Math.min\(Math.max\(Number\(seconds\) \|\| 1, 0.1\), 300\)/.test(src));

// config（用临时路径避免污染真实配置）
const cfgFile = path.join(os.tmpdir(), `sa-cfg-${Date.now()}.json`);
process.env.SELF_AGENT_CONFIG = cfgFile;
const c1 = await runTool("config", { action: "set", key: "theme", value: "dark" }, {});
t("config set", !c1.isError && c1.text.includes("已设置"));
const c2 = await runTool("config", { action: "get", key: "theme" }, {});
t("config get", !c2.isError && c2.text.includes("dark"));
const c3 = await runTool("config", { action: "list" }, {});
t("config list", !c3.isError && c3.text.includes("theme"));
const c4 = await runTool("config", { action: "delete", key: "theme" }, {});
t("config delete", !c4.isError && c4.text.includes("已删除"));
const c5 = await runTool("config", { action: "get" }, {});
t("config 缺 key 报错", c5.isError);
delete process.env.SELF_AGENT_CONFIG;

// tool_search
const s1 = await runTool("tool_search", { query: "测试" }, {});
t("tool_search 命中 run_tests", !s1.isError && s1.text.includes("run_tests"));
const s2 = await runTool("tool_search", { query: "文件" }, {});
t("tool_search 多结果", !s2.isError && s2.text.split("\n").length >= 2);
const s3 = await runTool("tool_search", { query: "zzz-nonexistent" }, {});
t("tool_search 无结果提示", !s3.isError && s3.text.includes("未找到"));

rmSync(cfgFile, { force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
