/**
 * skills.mjs — 技能加载（复用 SKILL.md 约定）
 *
 * 技能来源目录（按顺序扫描）：
 *   ~/.dsh/skills          自定义技能
 *   ~/dsh/.agents/skills   lark-* 技能
 */
import "./env.mjs";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

/**
 * 技能来源目录（按顺序扫描，可用 SELF_AGENT_SKILL_DIRS 以冒号分隔覆盖）：
 *   ~/.dsh/skills          自定义技能
 *   ~/dsh/.agents/skills   lark-* 等技能
 */
export const SKILL_DIRS = process.env.SELF_AGENT_SKILL_DIRS
  ? process.env.SELF_AGENT_SKILL_DIRS.split(path.delimiter)
  : [
      path.join(os.homedir(), ".dsh", "skills"),
      path.join(os.homedir(), "dsh", ".agents", "skills"),
    ];

function parseFrontmatter(txt) {
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

/**
 * 列出所有技能。
 * @returns {Array<{name:string, dir:string, description:string, source:string}>}
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
        out.push({
          name: fm.name ?? e.name,
          dir: path.join(dir, e.name),
          description: String(fm.description ?? "").replace(/\s+/g, " ").trim(),
          source: dir,
        });
      } catch {
        /* 跳过损坏技能 */
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 加载指定技能的完整 SKILL.md。
 * @returns {{name:string, dir:string, description:string, content:string}|null}
 */
export function loadSkill(name, dirs = SKILL_DIRS) {
  const all = listSkills(dirs);
  const s = all.find((x) => x.name === name || path.basename(x.dir) === name);
  if (!s) return null;
  try {
    return { ...s, content: readFileSync(path.join(s.dir, "SKILL.md"), "utf8") };
  } catch {
    return null;
  }
}

/** 生成技能清单文本（用于 system prompt 注入，限制长度避免占用过多上下文） */
export function skillsCatalog(dirs = SKILL_DIRS, limit = 40) {
  const all = listSkills(dirs);
  if (!all.length) return "(无可用技能)";
  const lines = all.slice(0, limit).map((s) => `- ${s.name}: ${s.description.slice(0, 80)}`);
  if (all.length > limit) lines.push(`…（共 ${all.length} 个技能，可用 skill 工具查看全部）`);
  return lines.join("\n");
}
