import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRows } from "./modules/parse.mjs";
import { renderReport } from "./modules/render.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] ?? "report";

if (cmd === "report") {
  const text = readFileSync(path.join(here, "data", "raw.txt"), "utf8");
  process.stdout.write(renderReport(parseRows(text)));
} else {
  console.error(`未知命令：${cmd}`);
  process.exit(1);
}
