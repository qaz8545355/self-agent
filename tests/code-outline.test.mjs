import { runTool, toOpenAITools } from "../tools.mjs";
import { extractSymbols } from "../code-outline.mjs";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const names = toOpenAITools().map((x) => x.function.name);
t("code_outline 已注册", names.includes("code_outline"));
t("工具数 >= 29", names.length >= 29, `（${names.length}）`);

// JS 提取
const js = 'export function foo() {}\nclass Bar {}\nconst baz = () => {};\nexport const qux = 1;\n';
const s1 = extractSymbols(js, "a.mjs");
t("JS 提取 function", s1.some((x) => x.kind === "function" && x.name === "foo"));
t("JS 提取 class", s1.some((x) => x.kind === "class" && x.name === "Bar"));
t("JS 提取 arrow-fn", s1.some((x) => x.name === "baz"));

// Python
const py = 'def hello():\n    pass\nclass World:\n    def method(self):\n        pass\n';
const s2 = extractSymbols(py, "a.py");
t("Python 提取 def", s2.some((x) => x.kind === "function" && x.name === "hello"));
t("Python 提取 class", s2.some((x) => x.kind === "class" && x.name === "World"));

// Go / Rust
t("Go 提取 func", extractSymbols("func main() {}\ntype Foo struct{}", "a.go").some((x) => x.name === "main"));
t("Rust 提取 fn", extractSymbols("pub fn run() {}\nstruct S;", "a.rs").some((x) => x.name === "run"));

// 不支持的类型
t("未知类型返回空", extractSymbols("whatever", "a.txt").length === 0);

// 工具层
const dir = path.join(os.tmpdir(), `sa-outline-${Date.now()}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "t.mjs"), "export function a() {}\nexport class B {}\n");
const r = await runTool("code_outline", { path: "t.mjs" }, { cwd: dir });
t("工具返回大纲", !r.isError && r.text.includes("function") && r.text.includes("class"));
const r2 = await runTool("code_outline", { path: "nope.mjs" }, { cwd: dir });
t("文件不存在报错", r2.isError);
rmSync(dir, { recursive: true, force: true });

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
