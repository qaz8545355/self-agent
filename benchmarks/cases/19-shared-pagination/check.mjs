import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// 四个模块的公开 API 契约（导出名 + 参数个数）
const API = [
  { file: "src/users.mjs", exports: ["listUsers"], arity: 3 },
  { file: "src/orders.mjs", exports: ["listOrders"], arity: 3 },
  { file: "src/logs.mjs", exports: ["listLogs"], arity: 3 },
  { file: "src/search.mjs", exports: ["searchItems"], arity: 3 },
];

// 参考实现：check 内置，独立于被测代码
function refPaginate(items, page, perPage) {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  const totalPages = Math.ceil(items.length / perPage);
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), totalPages };
}

function walkMjs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMjs(p, out);
    else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function countPaginateDefs(src) {
  const fns = (src.match(/\bfunction\s+paginate\s*\(/g) ?? []).length;
  const vars = (src.match(/\b(?:const|let|var)\s+paginate\s*=/g) ?? []).length;
  return fns + vars;
}

const json = (v) => JSON.stringify(v);

export async function check(cwd) {
  const problems = [];

  // 1) test/ 必须与 expected/ 逐字节一致（防放水）
  const expectedTestDir = path.join(here, "expected", "test");
  for (const f of readdirSync(expectedTestDir)) {
    const expected = readFileSync(path.join(expectedTestDir, f), "utf8");
    let actual = "";
    try {
      actual = readFileSync(path.join(cwd, "test", f), "utf8");
    } catch {
      /* 缺失按不一致处理 */
    }
    if (actual !== expected) problems.push(`测试文件被改动或丢失：test/${f}`);
  }

  // 2) 全部测试必须通过
  try {
    execFileSync("node", ["--test"], { cwd, encoding: "utf8", timeout: 20000, stdio: "pipe" });
  } catch (e) {
    problems.push(`测试未通过：${String(e.stdout ?? e.message).slice(0, 200)}`);
  }

  // 5) 单一实现：全项目只有一个 paginate 定义，位于 src/paginate.mjs，四个模块从它导入
  const sharedPath = path.join(cwd, "src", "paginate.mjs");
  if (!existsSync(sharedPath)) {
    problems.push("缺少共享实现 src/paginate.mjs");
  }
  let defFiles = [];
  for (const p of walkMjs(cwd)) {
    if (countPaginateDefs(readFileSync(p, "utf8")) > 0) defFiles.push(path.relative(cwd, p));
  }
  if (defFiles.length !== 1) {
    problems.push(`全项目 paginate 定义出现在 ${defFiles.length} 个文件（应为 1）：${defFiles.map((f) => f.replaceAll("\\", "/")).join(", ")}`);
  } else if (defFiles[0].replaceAll("\\", "/") !== "src/paginate.mjs") {
    problems.push(`唯一的 paginate 定义在 ${defFiles[0]}，应抽到 src/paginate.mjs`);
  }
  if (existsSync(sharedPath) && countPaginateDefs(readFileSync(sharedPath, "utf8")) !== 1) {
    problems.push("src/paginate.mjs 中应有且仅有一个 paginate 定义");
  }
  for (const { file } of API) {
    let src = "";
    try {
      src = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      problems.push(`缺少文件 ${file}`);
      continue;
    }
    if (!/["'`]\.\/paginate\.mjs["'`]/.test(src) || !/\bpaginate\b/.test(src)) {
      problems.push(`${file} 未从 ./paginate.mjs 导入 paginate`);
    }
  }

  // 3) + 4) 载入四个模块，做 API / 行为 parity / 不可变性检查
  const load = (rel) => import(pathToFileURL(path.join(cwd, rel)).href);
  const mods = [];
  for (const spec of API) {
    try {
      mods.push({ spec, mod: await load(spec.file) });
    } catch (e) {
      problems.push(`无法加载 ${spec.file}：${e.message}`);
    }
  }

  if (mods.length === API.length) {
    // API 未变
    for (const { spec, mod } of mods) {
      const actual = Object.keys(mod)
        .filter((k) => k !== "default")
        .sort();
      if (actual.join(",") !== [...spec.exports].sort().join(",")) {
        problems.push(`${spec.file} 导出名改变：${actual.join(",")} ≠ ${[...spec.exports].sort().join(",")}`);
      }
      const fn = mod[spec.exports[0]];
      if (typeof fn !== "function") problems.push(`${spec.file} 缺少函数 ${spec.exports[0]}`);
      else if (fn.length !== spec.arity) problems.push(`${spec.file} 的 ${spec.exports[0]} 参数个数 ${fn.length} ≠ ${spec.arity}`);
    }
  }

  // novel 输入：数据集覆盖 末页剩余项 / 非整除 / 越界页 / 空数组 / 单元素
  const datasets = [
    { items: ["a", "b", "c", "d", "e"], perPage: 2, pages: [1, 2, 3, 4] },
    { items: [1, 2, 3, 4, 5, 6], perPage: 3, pages: [1, 2, 3] },
    { items: [], perPage: 2, pages: [1] },
    { items: ["only"], perPage: 5, pages: [1] },
  ];
  const badPages = [0, -1, 1.5, NaN];

  for (const { spec, mod } of mods) {
    const fn = mod[spec.exports[0]];
    if (typeof fn !== "function") continue;

    // 行为必须与参考实现逐项一致
    for (const { items, perPage, pages } of datasets) {
      for (const page of pages) {
        let got, want;
        try {
          got = fn(items.slice(), page, perPage);
        } catch (e) {
          problems.push(`${spec.exports[0]}(items=${json(items)}, page=${page}, perPage=${perPage}) 抛错：${e.message}`);
          continue;
        }
        want = refPaginate(items.slice(), page, perPage);
        if (json(got) !== json(want)) {
          problems.push(`${spec.exports[0]}(len=${items.length}, page=${page}, perPage=${perPage}) = ${json(got)}，应为 ${json(want)}`);
        }
      }
    }

    // page 非法时必须抛 RangeError
    for (const page of badPages) {
      let ok = false;
      try {
        fn(["a", "b"], page, 2);
      } catch (e) {
        ok = e instanceof RangeError;
      }
      if (!ok) problems.push(`${spec.exports[0]} 对 page=${String(page)} 未抛 RangeError`);
    }

    // 不得修改传入数组
    const original = ["x", "y", "z", "w", "v"];
    const before = json(original);
    try {
      fn(original, 2, 2);
    } catch {
      /* 忽略：上面已单独检查抛错 */
    }
    if (json(original) !== before) problems.push(`${spec.exports[0]} 修改了传入数组（应为纯函数）`);
  }

  return {
    passed: problems.length === 0,
    detail: problems.length
      ? problems.join("；")
      : "分页已抽为单一实现，四个模块行为与参考一致、API 未变、入参未被修改",
  };
}
