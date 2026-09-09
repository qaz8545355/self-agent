import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

// 1) --help 正常且写明默认步数
const help = spawnSync(process.execPath, [path.join(root, "cli.mjs"), "--help"], { encoding: "utf8" });
t("--help 正常退出", help.status === 0, `→ exit=${help.status}`);
t("--help 显示默认 100 步", /最大步数（默认 100）/.test(help.stdout));
t("--help 仍列出 --max-steps", /--max-steps/.test(help.stdout));

// 2) 默认步数常量（防回退）
const agentSrc = readFileSync(path.join(root, "agent.mjs"), "utf8");
const cliSrc = readFileSync(path.join(root, "cli.mjs"), "utf8");
const benchSrc = readFileSync(path.join(root, "benchmarks", "run.mjs"), "utf8");
const toolsSrc = readFileSync(path.join(root, "tools.mjs"), "utf8");

t("agent 默认 maxSteps=100", /maxSteps = 100,/.test(agentSrc));
t("cli 默认 maxSteps=100", /maxSteps: 100/.test(cliSrc));
t("benchmark 默认 100 步", /maxSteps = 100/.test(benchSrc));

// 3) 子代理步数下限 100
t("子代理步数下限 100", /Math\.max\(100, Number\(max_steps\) \|\| 100\)/.test(toolsSrc));
t("子代理描述写默认 100", /子代理最大步数（默认 100）/.test(toolsSrc));

// 4) 旧值不应残留
t("agent 无 25 步残留", !/maxSteps = 25/.test(agentSrc));
t("cli 无 25 步残留", !/maxSteps: 25/.test(cliSrc));
t("benchmark 无 20 步残留", !/maxSteps = 20/.test(benchSrc));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
