/**
 * env.mjs — 加载项目根目录下的 .env.local（不进入版本库）
 * 必须在读取 process.env 的模块之前被求值。
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, ".env.local");

if (existsSync(file)) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (process.env[key] !== undefined) continue; // 真实环境变量优先
      process.env[key] = rawVal.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 忽略配置读取失败 */
  }
}
