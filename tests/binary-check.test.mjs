import { isBinaryInstalled, clearBinaryCache, availableBinaries, missingBinaries } from "../binary-check.mjs";

let pass = 0, fail = 0;
const t = (name, cond, extra = "") => { cond ? (pass++, console.log(`✅ ${name}${extra}`)) : (fail++, console.log(`❌ ${name}${extra}`)); };

clearBinaryCache();

t("node 存在", isBinaryInstalled("node") === true);
t("不存在的命令返回 false", isBinaryInstalled("definitely-not-a-real-binary-xyz") === false);
t("空字符串返回 false", isBinaryInstalled("") === false);

// 缓存：第二次调用应命中缓存（通过 monkeypatch 难以验证，改为验证结果一致）
t("缓存后结果一致", isBinaryInstalled("node") === true);

const list = ["node", "definitely-not-a-real-binary-xyz", "git"];
t("availableBinaries 过滤", availableBinaries(list).includes("node") && !availableBinaries(list).includes("definitely-not-a-real-binary-xyz"));
t("missingBinaries 过滤", missingBinaries(list).includes("definitely-not-a-real-binary-xyz") && !missingBinaries(list).includes("node"));

clearBinaryCache();
t("清缓存后仍正常", isBinaryInstalled("node") === true);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
