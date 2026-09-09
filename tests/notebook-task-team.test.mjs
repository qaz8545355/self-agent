import { runTool, toOpenAITools } from "../tools.mjs";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
for (const n of ["notebook_edit", "task", "team"]) t(`${n} 已注册`, names.includes(n));
t("工具数 >= 28", names.length >= 28, `（${names.length}）`);

const dir = path.join(os.tmpdir(), `sa-nb-${Date.now()}`);
mkdirSync(dir, { recursive: true });

// notebook_edit
const nbPath = path.join(dir, "test.ipynb");
writeFileSync(nbPath, JSON.stringify({ cells: [{ cell_type: "code", source: ["print(1)"], outputs: [], metadata: {}, execution_count: null }], metadata: {}, nbformat: 4, nbformat_minor: 5 }), "utf8");
const n1 = await runTool("notebook_edit", { action: "list_cells", path: "test.ipynb" }, { cwd: dir });
t("notebook list_cells", !n1.isError && n1.text.includes("print(1)"));
const n2 = await runTool("notebook_edit", { action: "read_cell", path: "test.ipynb", index: 0 }, { cwd: dir });
t("notebook read_cell", !n2.isError && n2.text.includes("print(1)"));
const n3 = await runTool("notebook_edit", { action: "add_cell", path: "test.ipynb", content: "# 标题", cell_type: "markdown" }, { cwd: dir });
t("notebook add_cell", !n3.isError && JSON.parse(readFileSync(nbPath, "utf8")).cells.length === 2);
const n4 = await runTool("notebook_edit", { action: "replace_cell", path: "test.ipynb", index: 0, content: "print(42)" }, { cwd: dir });
t("notebook replace_cell", !n4.isError && JSON.parse(readFileSync(nbPath, "utf8")).cells[0].source.join("").includes("42"));
const n5 = await runTool("notebook_edit", { action: "read_cell", path: "test.ipynb", index: 99 }, { cwd: dir });
t("notebook 越界报错", n5.isError);

// task（临时文件）
const taskFile = path.join(dir, "tasks.json");
process.env.SELF_AGENT_TASKS = taskFile;
const k1 = await runTool("task", { action: "create", title: "写文档" }, {});
t("task create", !k1.isError && k1.text.includes("写文档"));
const tid = k1.text.match(/t[a-z0-9]+/)?.[0];
const k2 = await runTool("task", { action: "list" }, {});
t("task list", !k2.isError && k2.text.includes("写文档") && k2.text.includes("pending"));
const k3 = await runTool("task", { action: "complete", id: tid }, {});
t("task complete", !k3.isError && k3.text.includes("已完成"));
const k4 = await runTool("task", { action: "delete", id: tid }, {});
t("task delete", !k4.isError && k4.text.includes("已删除"));
const k5 = await runTool("task", { action: "complete", id: "nope" }, {});
t("task 不存在报错", k5.isError);
delete process.env.SELF_AGENT_TASKS;

// team（临时文件）
const teamFile = path.join(dir, "team.json");
process.env.SELF_AGENT_TEAM = teamFile;
const m1 = await runTool("team", { action: "add", name: "架构师A", role: "架构师", description: "复杂方案设计" }, {});
t("team add", !m1.isError && m1.text.includes("架构师A"));
const m2 = await runTool("team", { action: "list" }, {});
t("team list", !m2.isError && m2.text.includes("架构师A") && m2.text.includes("架构师"));
const m3 = await runTool("team", { action: "remove", name: "架构师A" }, {});
t("team remove", !m3.isError && m3.text.includes("已移除"));
delete process.env.SELF_AGENT_TEAM;

rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
