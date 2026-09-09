import { pruneSessions } from "../session.mjs";
import { mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

const dir = path.join(os.tmpdir(), `sa-session-test-${Date.now()}`);
mkdirSync(dir, { recursive: true });

// 5 个会话，时间从今天往前递减
for (let i = 0; i < 5; i++) {
  writeFileSync(
    path.join(dir, `s${i}.json`),
    JSON.stringify({ id: `s${i}`, updatedAt: new Date(Date.now() - i * 86_400_000).toISOString(), messages: [] })
  );
}
const count = () => readdirSync(dir).filter((f) => f.endsWith(".json")).length;

const r1 = pruneSessions({ keep: 3, dir });
t("keep=3 删除 2 个", r1.deleted === 2 && r1.kept === 3, `→ deleted=${r1.deleted}, kept=${r1.kept}`);
t("目录剩 3 个", count() === 3);

const r2 = pruneSessions({ keep: 10, maxAgeDays: 2, dir });
t("maxAgeDays=2 删除更早的", r2.deleted === 1 && count() === 2, `→ deleted=${r2.deleted}, 剩 ${count()}`);

const r3 = pruneSessions({ keep: 10, maxAgeDays: 30, dir });
t("无过期时不动", r3.deleted === 0 && count() === 2);

const r4 = pruneSessions({ keep: 10, dir: path.join(os.tmpdir(), "sa-not-exist-" + Date.now()) });
t("目录不存在时安全返回", r4.deleted === 0 && r4.kept === 0);

rmSync(dir, { recursive: true, force: true });
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
