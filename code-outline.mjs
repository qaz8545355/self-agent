/**
 * code-outline.mjs — 轻量代码结构提取（不依赖 LSP server）
 *
 * 目的：让 agent 快速了解文件结构（函数/类/导出），比通读全文更省 token。
 * 支持：JavaScript / TypeScript / Python / Go / Rust（正则提取，够用为主）。
 */

const PATTERNS = {
  js: [
    { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { re: /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
    { re: /^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { re: /^\s*class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
    { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "arrow-fn" },
    { re: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "export" },
    { re: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/, kind: "arrow-fn" },
    { re: /^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/, kind: "method" },
  ],
  py: [
    { re: /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/, kind: "function" },
    { re: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class" },
  ],
  go: [
    { re: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, kind: "function" },
    { re: /^type\s+([A-Za-z_]\w*)\s+/, kind: "type" },
  ],
  rs: [
    { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
    { re: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/, kind: "struct" },
    { re: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/, kind: "enum" },
    { re: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/, kind: "trait" },
    { re: /^\s*impl\s+([A-Za-z_]\w*)/, kind: "impl" },
  ],
};

function langOf(filePath = "") {
  const p = String(filePath).toLowerCase();
  if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p)) return "js";
  if (/\.py$/.test(p)) return "py";
  if (/\.go$/.test(p)) return "go";
  if (/\.rs$/.test(p)) return "rs";
  return null;
}

/**
 * 提取文件中的符号。
 * @param {string} content
 * @param {string} filePath 用于判断语言
 * @returns {Array<{kind:string, name:string, line:number, indent:number}>}
 */
export function extractSymbols(content, filePath = "") {
  const lang = langOf(filePath);
  if (!lang) return [];
  const pats = PATTERNS[lang];
  const out = [];
  const lines = String(content ?? "").split("\n");

  lines.forEach((line, i) => {
    for (const { re, kind } of pats) {
      const m = line.match(re);
      if (!m) continue;
      // Python 模式第 2 组是名字；其余第 1 组
      const name = lang === "py" ? m[2] : m[1];
      if (!name) continue;
      const indent = (line.match(/^\s*/) ?? [""])[0].length;
      out.push({ kind, name, line: i + 1, indent });
      break; // 一行只归一类
    }
  });

  // 去重（同名同 kind 只留首个）
  const seen = new Set();
  return out.filter((s) => {
    const k = `${s.kind}:${s.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 渲染为紧凑文本 */
export function renderOutline(symbols, { max = 100 } = {}) {
  if (!symbols.length) return "（未提取到符号）";
  const shown = symbols.slice(0, max);
  const text = shown
    .map((s) => `${String(s.line).padStart(4)}  ${"  ".repeat(Math.min(s.indent >> 1, 3))}${s.kind.padEnd(9)} ${s.name}`)
    .join("\n");
  return symbols.length > max ? `${text}\n…（共 ${symbols.length} 个符号）` : text;
}
