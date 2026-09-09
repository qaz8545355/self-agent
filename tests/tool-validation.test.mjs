import { classifyToolError, validateToolInput, buildSchemaNotSentHint } from "../tool-validation.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// ── 1) 错误分类 ──
const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
t("errno code 归类", classifyToolError(enoent) === "Error:ENOENT");
const custom = Object.assign(new Error("boom"), { name: "ShellError" });
t("自定义错误名归类", classifyToolError(custom) === "ShellError");
t("普通 Error 归类", classifyToolError(new Error("x")) === "Error");
t("空值归类", classifyToolError(null) === "UnknownError");
t("短名字不采纳", classifyToolError(Object.assign(new Error("x"), { name: "Ab" })) === "Error");

// ── 2) 参数校验 ──
const schema = {
  type: "object",
  properties: {
    path: { type: "string" },
    count: { type: "number" },
    flag: { type: "boolean" },
    list: { type: "array" },
    mode: { type: "string", enum: ["a", "b"] },
  },
  required: ["path"],
};

t("合法参数通过", validateToolInput(schema, { path: "x" }).ok === true);
t("缺必填报错", validateToolInput(schema, {}).errors.some((e) => e.includes("path")));
t("字符串给数字报错", validateToolInput(schema, { path: "x", count: "3" }).ok === false);
t("数字合法", validateToolInput(schema, { path: "x", count: 3 }).ok === true);
t("布尔类型校验", validateToolInput(schema, { path: "x", flag: "yes" }).ok === false);
t("数组类型校验", validateToolInput(schema, { path: "x", list: {} }).ok === false);
t("enum 校验", validateToolInput(schema, { path: "x", mode: "c" }).ok === false);
t("enum 合法值通过", validateToolInput(schema, { path: "x", mode: "b" }).ok === true);
t("非对象参数报错", validateToolInput(schema, "not-an-object").ok === false);
t("数组参数报错", validateToolInput(schema, []).ok === false);
t("无 schema 放行", validateToolInput(null, { any: 1 }).ok === true);
t("可选参数缺失不报错", validateToolInput(schema, { path: "x" }).errors.length === 0);
t("未声明参数不拦", validateToolInput(schema, { path: "x", extra: 1 }).ok === true);
t("integer 类型校验", validateToolInput({ type: "object", properties: { n: { type: "integer" } } }, { n: 1.5 }).ok === false);
t("integer 合法值", validateToolInput({ type: "object", properties: { n: { type: "integer" } } }, { n: 2 }).ok === true);

// ── 3) schema 未发送提示 ──
const active = ["read_file", "grep", "bash"];
t("已发送工具无提示", buildSchemaNotSentHint("read_file", active) === null);
const hint = buildSchemaNotSentHint("lsp", active);
t("未发送工具给出提示", typeof hint === "string" && hint.includes("lsp"));
t("提示包含 tool_search 指引", hint.includes("tool_search") && hint.includes("select:lsp"));
t("空工具集不提示", buildSchemaNotSentHint("lsp", []) === null);
t("工具集缺失不提示", buildSchemaNotSentHint("lsp", undefined) === null);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
