import { createStallDetector } from "../agent.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const call = (name, args = "{}") => ({ id: `${name}|${args}`, function: { name, arguments: args } });
const ok = (text) => ({ isError: false, text });
const err = (text) => ({ isError: true, text });
const mkResults = (calls, res) => new Map(calls.map((c) => [c.id, res]));

// 1) 连续相同只读调用 + 相同结果 → 第 limit 次触发
const d1 = createStallDetector({ limit: 3 });
const readCalls = [call("read_file", '{"path":"a.txt"}')];
const readRes = mkResults(readCalls, ok("file content"));
t("第 1 次不 stalled", d1.observe(readCalls, readRes).stalled === false);
t("第 2 次不 stalled", d1.observe(readCalls, readRes).stalled === false);
t("第 3 次不 stalled（首现不计入重复）", d1.observe(readCalls, readRes).stalled === false);
const s4 = d1.observe(readCalls, readRes);
t("第 4 次 stalled", s4.stalled === true, `→ streak=${s4.streak}`);
t("streak 计数正确", s4.streak === 3);

// 2) 成功的写操作 → streak 归零
const d2 = createStallDetector({ limit: 3 });
d2.observe(readCalls, readRes);
d2.observe(readCalls, readRes);
const writeCalls = [call("write_file", '{"path":"b.txt","content":"x"}')];
const writeRes = mkResults(writeCalls, ok("已写入"));
const afterWrite = d2.observe(writeCalls, writeRes);
t("成功写入后 streak 归零", afterWrite.streak === 0, `→ ${afterWrite.streak}`);

// 3) 结果每次不同（只读探索）→ 永不 stalled
const d3 = createStallDetector({ limit: 3 });
let stalled3 = false;
for (let i = 0; i < 8; i++) {
  const r = new Map([[readCalls[0].id, ok(`different output ${i}`)]]);
  if (d3.observe(readCalls, r).stalled) stalled3 = true;
}
t("结果变化时不 stalled", stalled3 === false);

// 4) A/B/A/B 交替空转 → 第 5 次触发
const d4 = createStallDetector({ limit: 3 });
const A = [call("bash", '{"command":"date"}')];
const B = [call("bash", '{"command":"whoami"}')];
const rA = mkResults(A, ok("2026-09-10"));
const rB = mkResults(B, ok("root"));
d4.observe(A, rA);
d4.observe(B, rB);
d4.observe(A, rA);
d4.observe(B, rB);
const s5 = d4.observe(A, rA);
t("A/B 交替第 5 次 stalled", s5.stalled === true, `→ streak=${s5.streak}`);

// 5) 写工具失败算「无改动」→ 反复失败同样被判出
const d5 = createStallDetector({ limit: 3 });
const badWrite = [call("edit_file", '{"path":"c.txt","old_string":"x","new_string":"y"}')];
const badRes = mkResults(badWrite, err("old_string 未找到"));
d5.observe(badWrite, badRes);
d5.observe(badWrite, badRes);
d5.observe(badWrite, badRes);
t("重复失败的写入会 stalled", d5.observe(badWrite, badRes).stalled === true);

// 6) limit=0 关闭检测
const d6 = createStallDetector({ limit: 0 });
let stalled6 = false;
for (let i = 0; i < 10; i++) if (d6.observe(readCalls, readRes).stalled) stalled6 = true;
t("limit=0 时关闭检测", stalled6 === false);

// 7) 空调用列表（模型没调工具）不应算进展
const d7 = createStallDetector({ limit: 2 });
const empty = [];
d7.observe(empty, new Map());
d7.observe(empty, new Map());
t("空调用重复会 stalled", d7.observe(empty, new Map()).stalled === true);

// 8) 默认 limit = 3
const d8 = createStallDetector();
d8.observe(readCalls, readRes);
d8.observe(readCalls, readRes);
d8.observe(readCalls, readRes);
t("默认 limit 为 3", d8.observe(readCalls, readRes).stalled === true);

// 9) repeated 标记
const d9 = createStallDetector({ limit: 5 });
t("首次 repeated=false", d9.observe(readCalls, readRes).repeated === false);
t("二次 repeated=true", d9.observe(readCalls, readRes).repeated === true);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
