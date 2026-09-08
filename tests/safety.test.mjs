import os from "node:os";
import { checkCommand, checkWritePath } from "../safety.mjs";

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log(`✅ ${name}`)) : (fail++, console.log(`❌ ${name}`)); };

// 危险命令应拦截
t("rm -rf / 拦截", !checkCommand("rm -rf /").allow);
t("rm -rf ~/.ssh 拦截", !checkCommand(`rm -rf ${os.homedir()}/.ssh`).allow);
t("git push -f 拦截", !checkCommand("git push -f origin main").allow);
t("chmod 777 拦截", !checkCommand("chmod 777 /tmp/x").allow);
t("mkfs 拦截", !checkCommand("mkfs.ext4 /dev/vda1").allow);

// 正常命令应放行
t("echo 放行", checkCommand("echo hi").allow);
t("rm -rf /tmp/x 放行", checkCommand("rm -rf /tmp/x").allow);
t("ls 放行", checkCommand("ls -la").allow);
t("git push 放行", checkCommand("git push origin main").allow);

// heredoc 剥离
t("heredoc 含敏感词放行", checkCommand("python3 - << 'EOF'\n# chmod 777 doc\nprint(1)\nEOF").allow);

// 写入路径校验
t("写 /etc/passwd 拦截", !checkWritePath("/etc/passwd").allow);
t("写 /root 拦截", !checkWritePath("/root").allow);
t("写 /tmp/x 放行", checkWritePath("/tmp/x").allow);
t("写 /root/dsh/x 放行", checkWritePath("/root/dsh/x").allow);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
