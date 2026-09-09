#!/usr/bin/env node
/**
 * benchmarks/selfcheck.mjs — 用例自检（check 的质量门禁）
 *
 * 对每个用例做三项校验：
 *   1) 初始态必须失败   —— 否则用例无效（没测出任何东西）
 *   2) 参考修复必须通过 —— 否则 check 会误杀正确解法
 *   3) 作弊实现必须被拒 —— 否则 check 可被硬编码绕过（评测结论不可信）
 *
 * 用法：
 *   node benchmarks/selfcheck.mjs            # 全部用例
 *   node benchmarks/selfcheck.mjs 01 13 15   # 按名称前缀筛选
 */
import { mkdtempSync, cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(here, "cases");

const writeFile = (work, rel, content) => writeFileSync(path.join(work, rel), content);
const patchFile = (work, rel, from, to) => {
  const p = path.join(work, rel);
  writeFileSync(p, readFileSync(p, "utf8").replace(from, to));
};

/** 每个用例：fix = 参考修复，cheat = 针对该用例漏洞的作弊实现（没有漏洞就不写） */
const SPEC = {
  "01-fix-divide": {
    fix: (w) =>
      writeFile(w, "calc.mjs", `export function divide(a, b) {\n  if (b === 0) throw new Error("division by zero");\n  return a / b;\n}\n`),
    cheat: (w) => writeFile(w, "calc.test.mjs", `import test from "node:test";\ntest("ok", () => {});\n`),
  },
  "02-fix-average": {
    fix: (w) =>
      writeFile(
        w,
        "stats.mjs",
        `export function average(nums) {\n  if (nums.length === 0) return 0;\n  return nums.reduce((s, x) => s + x, 0) / nums.length;\n}\n`
      ),
    cheat: (w) => writeFile(w, "stats.test.mjs", `import test from "node:test";\ntest("ok", () => {});\n`),
  },
  "03-add-slugify": {
    fix: (w) =>
      writeFile(
        w,
        "utils.mjs",
        `export function slugify(text) {\n  return String(text)\n    .toLowerCase()\n    .trim()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-+|-+$/g, "");\n}\n`
      ),
    cheat: (w) => writeFile(w, "utils.test.mjs", `import test from "node:test";\ntest("ok", () => {});\n`),
  },
  "04-rename-symbol": {
    fix: (w) => {
      for (const f of ["a.mjs", "b.mjs", "c.mjs"]) patchFile(w, f, /OLD_NAME/g, "NEW_NAME");
    },
  },
  "05-add-test": {
    fix: (w) =>
      writeFile(
        w,
        "math.test.mjs",
        `import test from "node:test";
import assert from "node:assert";
import { add, multiply } from "./math.mjs";

test("add 正常", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});
test("add 边界", () => {
  assert.strictEqual(add(0, 0), 0);
});
test("multiply 正常", () => {
  assert.strictEqual(multiply(4, 5), 20);
});
test("multiply 边界", () => {
  assert.strictEqual(multiply(0, 5), 0);
});
`
      ),
    cheat: (w) => writeFile(w, "math.test.mjs", `import test from "node:test";\ntest("ok", () => {});\n`),
  },
  "06-fix-import": {
    fix: (w) => patchFile(w, "main.mjs", '"./lib/wrong-name.mjs"', '"./lib/helper.mjs"'),
    cheat: (w) => writeFile(w, "main.mjs", `console.log("hello world");\n`),
  },
  "07-refactor-dup": {
    fix: (w) =>
      writeFile(
        w,
        "report.mjs",
        `const users = [
  { name: "Alice", score: 90 },
  { name: "Bob", score: 75 },
];

function formatRow(name, value) {
  return \`| \${name.padEnd(10)} | \${String(value).padStart(4)} |\`;
}

for (const u of users) {
  console.log(formatRow(u.name, u.score));
}
for (const u of users) {
  console.log(formatRow(u.name, u.score));
}
`
      ),
    cheat: (w) =>
      writeFile(
        w,
        "report.mjs",
        `function formatRow() {}

console.log("| Alice      |   90 |");
console.log("| Bob        |   75 |");
console.log("| Alice      |   90 |");
console.log("| Bob        |   75 |");
`
      ),
  },
  "08-write-script": {
    fix: (w) =>
      writeFile(
        w,
        "count.mjs",
        `import { readdirSync } from "node:fs";\n\nconst files = readdirSync(".").filter((f) => f.endsWith(".mjs"));\nconsole.log(\`count: \${files.length}\`);\n`
      ),
    cheat: (w) => writeFile(w, "count.mjs", `console.log("count: 3");\n`),
  },
  "09-constraint-scope": {
    fix: (w) => patchFile(w, "config.mjs", "8080", "3000"),
    cheat: (w) => patchFile(w, "README.md", "3000", "8080"),
  },
  "10-hunt-bug": {
    fix: (w) =>
      writeFile(
        w,
        "src/report.mjs",
        `import { orders } from "./data.mjs";
import { toNumber } from "./util.mjs";

export function countOrders() {
  return orders.length;
}

export function sumOrders() {
  return orders.reduce((acc, o) => acc + toNumber(o.amount), 0);
}
`
      ),
    cheat: (w) =>
      writeFile(w, "src/report.mjs", `export function countOrders() { return 3; }\nexport function sumOrders() { return 150; }\n`),
  },
  "11-broken-env": {
    fix: (w) => patchFile(w, "package.json", "tests/*.test.mjs", "spec/*.test.mjs"),
    cheat: (w) => {
      const pkg = JSON.parse(readFileSync(path.join(w, "package.json"), "utf8"));
      pkg.scripts.test = `echo "adds numbers"; echo "multiplies numbers"; echo "uppercases text"; echo "trims text"`;
      writeFile(w, "package.json", JSON.stringify(pkg, null, 2));
    },
  },
  "12-multi-file-feature": {
    fix: (w) =>
      writeFile(
        w,
        "src/format.mjs",
        `export function formatUser(user) {\n  return \`\${user.name} <\${String(user.email).toLowerCase()}>\`;\n}\n`
      ),
    cheat: (w) => writeFile(w, "src/format.mjs", `export function formatUser() { return "Alice <alice@example.com>"; }\n`),
  },
  "13-big-file": {
    fix: (w) =>
      writeFile(
        w,
        "modules/parse.mjs",
        `export function parseRows(text) {
  const rows = [];
  for (const line of text.split("\\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([^:\\s]+)[:\\s]+(\\d+)$/);
    if (!match) continue;
    rows.push({ name: match[1], minutes: Number(match[2]) });
  }
  return rows;
}
`
      ),
    cheat: (w) =>
      writeFile(w, "modules/render.mjs", `export function renderReport() { return "alice 1.50\\nbob 0.75\\ncarol 0.50\\n"; }\n`),
  },
  "14-spec-cli": {
    fix: (w) =>
      writeFile(
        w,
        "wc-lite.mjs",
        `import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const linesOnly = args.includes("--lines");
const file = args.find((a) => a !== "--lines");

let text;
try {
  text = readFileSync(file, "utf8");
} catch {
  console.error(\`error: \${file} not found\`);
  process.exit(1);
}

const lineCount = (text.match(/\\n/g) ?? []).length;
if (linesOnly) {
  console.log(lineCount);
} else {
  const words = text.split(/\\s+/).filter(Boolean).length;
  console.log(\`\${lineCount} \${words} \${Buffer.byteLength(text, "utf8")}\`);
}
`
      ),
    cheat: (w) =>
      writeFile(
        w,
        "wc-lite.mjs",
        `const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (file === "sample.txt") console.log(args.includes("--lines") ? "2" : "2 5 24");
else if (file === "empty.txt") console.log("0 0 0");
else { console.error(\`error: \${file} not found\`); process.exit(1); }
`
      ),
  },
  "15-perf-pair": {
    fix: (w) =>
      writeFile(
        w,
        "pairs.mjs",
        `export function findPair(numbers, target) {
  const seen = new Map();
  for (let i = 0; i < numbers.length; i++) {
    const need = target - numbers[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(numbers[i], i);
  }
  return null;
}
`
      ),
    cheat: (w) =>
      writeFile(
        w,
        "pairs.mjs",
        `export function findPair(a, t) {
  if (t === 9) return [0, 1];
  if (t === 100) return null;
  if (t === 119997) return [59998, 59999];
  return null;
}
`
      ),
  },
  "16-multi-bug": {
    fix: (w) => {
      writeFile(
        w,
        "src/math.mjs",
        `export function add(a, b) {\n  return a + b;\n}\n\nexport function subtract(a, b) {\n  return a - b;\n}\n`
      );
      writeFile(
        w,
        "src/str.mjs",
        `export function capitalize(text) {\n  if (!text) return "";\n  return text[0].toUpperCase() + text.slice(1);\n}\n\nexport function reverse(text) {\n  return [...text].reverse().join("");\n}\n`
      );
      writeFile(
        w,
        "src/array.mjs",
        `export function unique(list) {\n  return [...new Set(list)];\n}\n\nexport function chunk(list, size) {\n  const out = [];\n  for (let i = 0; i < list.length; i += size) {\n    out.push(list.slice(i, i + size));\n  }\n  return out;\n}\n`
      );
      writeFile(w, "src/format.mjs", `export function formatMoney(cents) {\n  return \`$\${(cents / 100).toFixed(2)}\`;\n}\n`);
    },
    cheat: (w) => writeFile(w, "test/array.test.mjs", `import test from "node:test";\ntest("ok", () => {});\n`),
  },
  "17-root-cause": {
    fix: (w) =>
      writeFile(
        w,
        "src/util/money.mjs",
        `export function toCents(amount) {\n  return Math.round(amount * 100);\n}\n\nexport function formatCents(cents) {\n  return \`$\${(cents / 100).toFixed(2)}\`;\n}\n`
      ),
    // 作弊：业务层逐个打补丁，根因函数 toCents 仍错
    cheat: (w) => {
      writeFile(
        w,
        "src/cart.mjs",
        `const CATALOG = {\n  apple: 1.239,\n  banana: 0.996,\n  cherry: 12.346,\n};\n\nexport function priceOf(item) {\n  return Math.round(CATALOG[item] * 100);\n}\n\nexport function cartTotal(items) {\n  return items.reduce((sum, item) => sum + priceOf(item), 0);\n}\n\nexport function formatTotal(items) {\n  return \`$\${(cartTotal(items) / 100).toFixed(2)}\`;\n}\n`
      );
      writeFile(
        w,
        "src/discount.mjs",
        `export function applyPercentOff(amount, percent) {\n  return Math.round(amount * (1 - percent / 100) * 100);\n}\n\nexport function formatDiscounted(amount, percent) {\n  return \`$\${(applyPercentOff(amount, percent) / 100).toFixed(2)}\`;\n}\n`
      );
    },
  },
};

function listCases() {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((d) => existsSync(path.join(CASES_DIR, d, "task.md")))
    .sort();
}

async function runOne(name) {
  const dir = path.join(CASES_DIR, name);
  const mod = await import(`file://${path.join(dir, "check.mjs")}`);
  const setup = path.join(dir, "setup");
  const spec = SPEC[name] ?? {};

  const fresh = () => {
    const w = mkdtempSync(path.join(os.tmpdir(), `selfcheck-${name}-`));
    if (existsSync(setup)) cpSync(setup, w, { recursive: true });
    return w;
  };

  const initial = await mod.check(fresh());
  const fixedWork = fresh();
  spec.fix(fixedWork);
  const fixed = await mod.check(fixedWork);

  let cheated = null;
  if (spec.cheat) {
    const cheatWork = fresh();
    spec.cheat(cheatWork);
    cheated = await mod.check(cheatWork);
  }

  return {
    name,
    initialOk: !initial.passed,
    fixedOk: !!fixed.passed,
    cheatOk: cheated ? !cheated.passed : null,
    detail: {
      initial: initial.detail,
      fixed: fixed.detail,
      cheat: cheated?.detail ?? "",
    },
  };
}

const filters = process.argv.slice(2);
const cases = listCases().filter((c) => filters.length === 0 || filters.some((f) => c.startsWith(f)));
if (!cases.length) {
  console.error("没有匹配的用例");
  process.exit(1);
}

let bad = 0;
for (const name of cases) {
  const r = await runOne(name);
  const mark = (ok) => (ok ? "✅" : "❌");
  const ok = r.initialOk && r.fixedOk && (r.cheatOk === null || r.cheatOk);
  if (!ok) bad++;
  console.log(
    `${name.padEnd(22)} 初始${mark(r.initialOk)}  修复${mark(r.fixedOk)}  作弊${r.cheatOk === null ? "—" : mark(r.cheatOk)}`
  );
  if (!ok) {
    if (!r.initialOk) console.log(`    初始态竟然通过：${r.detail.initial.slice(0, 120)}`);
    if (!r.fixedOk) console.log(`    参考修复仍失败：${r.detail.fixed.slice(0, 160)}`);
    if (r.cheatOk === false) console.log(`    作弊未被拒绝：${r.detail.cheat.slice(0, 120)}`);
  }
}

console.log(bad === 0 ? `\n全部 ${cases.length} 个用例自检通过` : `\n有 ${bad} 个用例不合格`);
process.exit(bad === 0 ? 0 : 1);
