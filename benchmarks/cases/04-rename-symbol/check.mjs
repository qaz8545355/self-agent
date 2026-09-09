import { readdirSync, readFileSync } from "node:fs";
export async function check(cwd) {
  const files = readdirSync(cwd).filter((f) => f.endsWith(".mjs"));
  let oldLeft = 0, newFound = 0;
  for (const f of files) {
    const t = readFileSync(`${cwd}/${f}`, "utf8");
    if (t.includes("OLD_NAME")) oldLeft++;
    if (t.includes("NEW_NAME")) newFound++;
  }
  return {
    passed: oldLeft === 0 && newFound >= 3,
    detail: `OLD_NAME 残留 ${oldLeft} 个文件，NEW_NAME 出现于 ${newFound} 个文件`,
  };
}
