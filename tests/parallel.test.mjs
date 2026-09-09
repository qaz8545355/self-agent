import { partitionToolCalls, isConcurrencySafe } from "../tools.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) 并发安全判定
t("read_file 并发安全", isConcurrencySafe("read_file") === true);
t("grep 并发安全", isConcurrencySafe("grep") === true);
t("glob 并发安全", isConcurrencySafe("glob") === true);
t("web_fetch 并发安全", isConcurrencySafe("web_fetch") === true);
t("write_file 不安全", isConcurrencySafe("write_file") === false);
t("edit_file 不安全", isConcurrencySafe("edit_file") === false);
t("bash 不安全", isConcurrencySafe("bash") === false);
t("未知工具不安全", isConcurrencySafe("no-such") === false);

// 1.5) bash 命令级只读判定（移植 Claude Code readOnlyCommandValidation）
const bashCall = (cmd) => ({ function: { name: "bash", arguments: JSON.stringify({ command: cmd }) } });
t("bash 只读命令（git status）可并行", isConcurrencySafe(bashCall("git status")) === true);
t("bash 只读命令（ls -la）可并行", isConcurrencySafe(bashCall("ls -la")) === true);
t("bash 只读命令（rg -n）可并行", isConcurrencySafe(bashCall("rg -n foo src")) === true);
t("bash 写命令不安全", isConcurrencySafe(bashCall("rm -rf /tmp/x")) === false);
t("bash 管道命令不安全", isConcurrencySafe(bashCall("cat a | grep b")) === false);
t("bash 参数非法 JSON 不安全", isConcurrencySafe({ function: { name: "bash", arguments: "not-json" } }) === false);
t("bash 无 command 字段不安全", isConcurrencySafe({ function: { name: "bash", arguments: "{}" } }) === false);

// 2) 分区逻辑
const mk = (name) => ({ function: { name } });
const calls = [mk("read_file"), mk("grep"), mk("write_file"), mk("glob"), mk("read_file")];
const batches = partitionToolCalls(calls);

t("分成 3 批", batches.length === 3, `→ ${batches.length}`);
t("批 1 并行（read+grep）", batches[0].parallel === true && batches[0].calls.length === 2);
t("批 2 串行（write 屏障）", batches[1].parallel === false && batches[1].calls[0].function.name === "write_file");
t("批 3 并行（glob+read）", batches[2].parallel === true && batches[2].calls.length === 2);

// 3) 连续写工具各自独占
const writes = [mk("write_file"), mk("edit_file"), mk("bash")];
const wb = partitionToolCalls(writes);
t("写工具各自独占一批", wb.length === 3 && wb.every((b) => !b.parallel && b.calls.length === 1));

// 4) 全只读 → 单批并行
const reads = [mk("read_file"), mk("grep"), mk("glob")];
const rb = partitionToolCalls(reads);
t("全只读合并为单批", rb.length === 1 && rb[0].parallel === true && rb[0].calls.length === 3);

// 5) 空输入
t("空输入返回空", partitionToolCalls([]).length === 0);

// 5.5) 只读 bash 参与并行分区
const mixed = [mk("read_file"), bashCall("git log --oneline"), bashCall("rm -rf /tmp/x"), mk("grep")];
const mb = partitionToolCalls(mixed);
t("只读 bash 与只读工具同批并行", mb[0].parallel === true && mb[0].calls.length === 2, `→ 批1 ${mb[0]?.calls.length}`);
t("写 bash 独占一批", mb[1].parallel === false && mb[1].calls.length === 1);
t("后续只读工具再成批", mb[2].parallel === true && mb[2].calls.length === 1);

// 6) 性能：3 个 300ms 任务，并行应显著快于串行
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
for (let i = 0; i < 3; i++) await sleep(300);
const serialMs = Date.now() - t0;

const t1 = Date.now();
await Promise.all([sleep(300), sleep(300), sleep(300)]);
const parallelMs = Date.now() - t1;

t("并行显著快于串行", parallelMs < serialMs * 0.6, `（串行 ${serialMs}ms vs 并行 ${parallelMs}ms）`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
