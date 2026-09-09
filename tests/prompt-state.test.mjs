import {
  hashString,
  snapshotPrompt,
  diffPromptState,
  createPromptStateTracker,
} from "../prompt-state.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const tools = [
  { name: "bash", parameters: { type: "object", properties: { command: { type: "string" } } } },
  { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } },
];

// ── 1) 哈希 ──
t("相同输入哈希相同", hashString("abc") === hashString("abc"));
t("不同输入哈希不同", hashString("abc") !== hashString("abd"));
t("空值不抛错", typeof hashString(null) === "number");

// ── 2) 快照 ──
const s1 = snapshotPrompt({ system: "sys", tools, messages: [{ role: "user" }], model: "m1" });
t("快照含 systemHash", typeof s1.systemHash === "number");
t("快照含 toolsHash", typeof s1.toolsHash === "number");
t("快照含每个工具的 schema 哈希", s1.perToolHashes.bash !== undefined && s1.perToolHashes.read_file !== undefined);
t("快照记录消息数", s1.messageCount === 1);
t("快照记录模型", s1.model === "m1");

// ── 3) 变化诊断 ──
t("首次快照标记变化", diffPromptState(null, s1).changed === true);

const same = snapshotPrompt({ system: "sys", tools, messages: [{ role: "user" }, { role: "assistant" }], model: "m1" });
t("仅消息增长不算变化", diffPromptState(s1, same).changed === false);

const sysChanged = snapshotPrompt({ system: "sys2", tools, messages: [], model: "m1" });
const dSys = diffPromptState(s1, sysChanged);
t("system 变化被检出", dSys.changed === true && dSys.reasons.some((r) => r.includes("system")));

const toolsAdded = snapshotPrompt({ system: "sys", tools: [...tools, { name: "grep", parameters: {} }], messages: [], model: "m1" });
const dAdd = diffPromptState(s1, toolsAdded);
t("工具新增被检出", dAdd.reasons.some((r) => r.includes("新增") && r.includes("grep")));

const toolsRemoved = snapshotPrompt({ system: "sys", tools: [tools[0]], messages: [], model: "m1" });
const dDel = diffPromptState(s1, toolsRemoved);
t("工具移除被检出", dDel.reasons.some((r) => r.includes("移除") && r.includes("read_file")));

const modelChanged = snapshotPrompt({ system: "sys", tools, messages: [], model: "m2" });
t("模型变化被检出", diffPromptState(s1, modelChanged).reasons.some((r) => r.includes("模型")));

const schemaChanged = snapshotPrompt({
  system: "sys",
  tools: [{ name: "bash", parameters: { type: "object", properties: { command: { type: "number" } } } }, tools[1]],
  messages: [],
  model: "m1",
});
const dSchema = diffPromptState(s1, schemaChanged);
t("工具 schema 变化被检出", dSchema.reasons.some((r) => r.includes("bash") && r.includes("schema")));

// ── 4) 跟踪器 ──
const tracker = createPromptStateTracker();
const r1 = tracker.observe({ system: "s", tools, messages: [], model: "m" });
t("跟踪器首次标记变化", r1.changed === true);
const r2 = tracker.observe({ system: "s", tools, messages: [{ role: "user" }], model: "m" });
t("跟踪器第二次稳定", r2.changed === false);
const r3 = tracker.observe({ system: "s2", tools, messages: [], model: "m" });
t("跟踪器检出变化", r3.changed === true);
t("跟踪器保留上次快照", tracker.last.systemHash === r3.snapshot.systemHash);
tracker.reset();
t("重置后清空快照", tracker.last === null);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
