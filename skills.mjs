/**
 * skills.mjs — 技能加载（SKILL.md 约定 + 参数替换 + 条件技能）
 *
 * 移植自 Claude Code：
 * - `skills/loadSkillsDir.ts`：frontmatter 字段解析、条件技能（`paths`）、清单 token 估算
 * - `utils/argumentSubstitution.ts`：`$ARGUMENTS` / `$1` / 命名参数替换
 *
 * 技能来源目录（按顺序扫描，可用 SELF_AGENT_SKILL_DIRS 以冒号分隔覆盖）：
 *   ~/.dsh/skills          自定义技能
 *   ~/dsh/.agents/skills   lark-* 等技能
 */
import "./env.mjs";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

export const SKILL_DIRS = process.env.SELF_AGENT_SKILL_DIRS
  ? process.env.SELF_AGENT_SKILL_DIRS.split(path.delimiter)
  : [
      path.join(os.homedir(), ".dsh", "skills"),
      path.join(os.homedir(), "dsh", ".agents", "skills"),
    ];

export function parseFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: txt };
  let fm = {};
  try {
    fm = parse(m[1]) ?? {};
  } catch {
    fm = {};
  }
  return { fm, body: txt.slice(m[0].length) };
}

/** frontmatter.arguments → 参数名数组（过滤空串与纯数字，避免和 $0/$1 冲突） */
export function parseArgumentNames(argumentNames) {
  const isValid = (n) => typeof n === "string" && n.trim() !== "" && !/^\d+$/.test(n);
  if (Array.isArray(argumentNames)) return argumentNames.filter(isValid);
  if (typeof argumentNames === "string") return argumentNames.split(/\s+/).filter(isValid);
  return [];
}

/** `allowed-tools` 支持数组或空格/逗号分隔字符串 */
export function parseAllowedTools(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `paths` → glob 数组；全是匹配所有（`**`）时视为无条件 */
export function parsePaths(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\n]/);
  const cleaned = list.map((p) => String(p).trim()).filter(Boolean);
  if (!cleaned.length) return [];
  if (cleaned.every((p) => p === "**" || p === "**/*" || p === "*")) return [];
  return cleaned;
}

/** 简化 glob → 正则（支持 **、*、?）；单次扫描构建，避免链式替换互相破坏 */
export function globToRe(pat) {
  let re = "^";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

/** 命令行式分词（支持引号），用于把技能参数字符串拆成数组 */
export function parseArgs(argString) {
  if (typeof argString !== "string") return [];
  const out = [];
  let cur = "";
  let quote = null;
  let has = false;
  for (let i = 0; i < argString.length; i++) {
    const ch = argString[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has) {
        out.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has) out.push(cur);
  return out;
}

/**
 * 参数替换（移植 substituteArguments）：
 * - 命名参数 `$foo` 按 argumentNames 顺序映射到位置参数
 * - `$ARGUMENTS[0]` / `$0` / `$1` 位置参数
 * - `$ARGUMENTS` 全部参数字符串
 * - 没有占位符且 args 非空且 appendIfNoPlaceholder → 末尾追加 `\n\nARGUMENTS: ...`
 */
export function substituteArguments(content, args, options = {}) {
  const { appendIfNoPlaceholder = true, argumentNames = [] } = options;
  if (args === undefined || args === null) return content;

  const parsed = parseArgs(args);
  const original = content;

  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i];
    if (!name) continue;
    content = content.replace(new RegExp(`\\$${name}(?![\\[\\w])`, "g"), parsed[i] ?? "");
  }

  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, idx) => parsed[Number(idx)] ?? "");
  content = content.replace(/\$(\d+)(?!\w)/g, (_, idx) => parsed[Number(idx)] ?? "");
  content = content.replaceAll("$ARGUMENTS", args);

  if (content === original && appendIfNoPlaceholder && args) {
    content = `${content}\n\nARGUMENTS: ${args}`;
  }
  return content;
}

function metaFrom(fm, dir, entryName, source) {
  return {
    name: String(fm.name ?? entryName),
    dir,
    source,
    description: String(fm.description ?? "").replace(/\s+/g, " ").trim(),
    whenToUse: fm.when_to_use ? String(fm.when_to_use) : undefined,
    argumentHint: fm["argument-hint"] != null ? String(fm["argument-hint"]) : undefined,
    arguments: parseArgumentNames(fm.arguments),
    allowedTools: parseAllowedTools(fm["allowed-tools"]),
    paths: parsePaths(fm.paths),
    model: fm.model ? String(fm.model) : undefined,
  };
}

/**
 * 列出所有技能。
 * @returns {Array<object>} 含 name/dir/description/source/arguments/argumentHint/paths 等
 */
export function listSkills(dirs = SKILL_DIRS) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(dir, e.name, "SKILL.md");
      if (!existsSync(file)) continue;
      try {
        const { fm } = parseFrontmatter(readFileSync(file, "utf8"));
        out.push(metaFrom(fm, path.join(dir, e.name), e.name, dir));
      } catch {
        /* 跳过损坏技能 */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 加载指定技能；传 args 时做参数替换。
 * 兼容旧签名 loadSkill(name, dirs)。
 * @returns {{name:string, dir:string, content:string}|null}
 */
export function loadSkill(name, options = {}) {
  const { dirs = SKILL_DIRS, args } = Array.isArray(options) ? { dirs: options } : options;
  const all = listSkills(dirs);
  const s = all.find((x) => x.name === name || path.basename(x.dir) === name);
  if (!s) return null;
  try {
    const raw = readFileSync(path.join(s.dir, "SKILL.md"), "utf8");
    const { body } = parseFrontmatter(raw);
    const content = args === undefined ? body : substituteArguments(body, args, { argumentNames: s.arguments });
    return { ...s, content, raw };
  } catch {
    return null;
  }
}

/** 生成技能清单文本（用于 system prompt 注入，限制长度避免占用过多上下文） */
export function skillsCatalog(dirs = SKILL_DIRS, limit = 40) {
  const all = listSkills(dirs);
  if (!all.length) return "(无可用技能)";
  const lines = all.slice(0, limit).map((s) => {
    const hint = s.argumentHint ? ` ${s.argumentHint}` : "";
    const cond = s.paths.length ? ` [条件技能：${s.paths.join(", ")}]` : "";
    return `- ${s.name}${hint}: ${s.description.slice(0, 80)}${cond}`;
  });
  if (all.length > limit) lines.push(`…（共 ${all.length} 个技能，可用 skill 工具查看全部）`);
  return lines.join("\n");
}

/**
 * 条件技能激活：给定本步操作过的文件路径，返回因此激活的技能名。
 * 匹配规则：技能的 `paths` glob 命中任一 cwd 相对路径即激活。
 */
export function activateConditionalSkillsForPaths(filePaths = [], cwd = process.cwd(), dirs = SKILL_DIRS) {
  const activated = [];
  for (const s of listSkills(dirs)) {
    if (!s.paths.length) continue;
    const res = s.paths.map(globToRe);
    for (const fp of filePaths) {
      const rel = path.isAbsolute(fp) ? path.relative(cwd, fp) : fp;
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (res.some((re) => re.test(rel))) {
        activated.push(s.name);
        break;
      }
    }
  }
  return activated;
}

/** 技能清单注入上下文的 token 估算（≈4 字符/token，对齐源码 roughTokenCountEstimation） */
export function estimateCatalogTokens(dirs = SKILL_DIRS) {
  const text = skillsCatalog(dirs, 1000);
  return Math.ceil(text.length / 4);
}
