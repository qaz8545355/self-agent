import {
  isReadOnlyCommand,
  tokenize,
  validateFlagArgument,
  containsVulnerableUncPath,
} from "../readonly-commands.mjs";

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log(`✅ ${name}`)) : (fail++, console.log(`❌ ${name}`)); };

// ── git 只读子命令 ──
t("git status 只读", isReadOnlyCommand("git status"));
t("git status --porcelain 只读", isReadOnlyCommand("git status --porcelain"));
t("git log --oneline 只读", isReadOnlyCommand("git log --oneline"));
t("git log -n 5 只读", isReadOnlyCommand("git log -n 5"));
t("git log -5 只读（数字简写）", isReadOnlyCommand("git log -5"));
t("git diff --stat 只读", isReadOnlyCommand("git diff --stat"));
t("git show --stat 只读", isReadOnlyCommand("git show --stat"));
t("git branch -a 只读", isReadOnlyCommand("git branch -a"));
t("git branch --list 只读", isReadOnlyCommand("git branch --list"));
t("git branch -D main 非只读", !isReadOnlyCommand("git branch -D main"));
t("git branch --delete main 非只读", !isReadOnlyCommand("git branch --delete main"));
t("git push 非只读", !isReadOnlyCommand("git push origin main"));
t("git commit 非只读", !isReadOnlyCommand("git commit -m x"));
t("git checkout 非只读", !isReadOnlyCommand("git checkout main"));
t("git 未知子命令非只读", !isReadOnlyCommand("git frobnicate"));

// ── 常用只读命令 ──
t("ls -la 只读", isReadOnlyCommand("ls -la"));
t("ls --color=auto 只读", isReadOnlyCommand("ls --color=auto"));
t("ls --unknown 非只读", !isReadOnlyCommand("ls --unknown"));
t("ls -l -- 只读", isReadOnlyCommand("ls -l --"));
t("cat README.md 只读", isReadOnlyCommand("cat README.md"));
t("head -n 20 f 只读", isReadOnlyCommand("head -n 20 f"));
t("wc -l f 只读", isReadOnlyCommand("wc -l f"));
t("rg -n foo src/ 只读", isReadOnlyCommand("rg -n foo src/"));
t("rg --files 只读", isReadOnlyCommand("rg --files"));
t("grep -rn foo . 只读", isReadOnlyCommand("grep -rn foo ."));
t("grep -A20 foo f 只读（附加数字）", isReadOnlyCommand("grep -A20 foo f"));
t("find . -name '*.mjs' 只读", isReadOnlyCommand("find . -name '*.mjs'"));
t("docker ps 只读", isReadOnlyCommand("docker ps"));
t("docker images -a 只读", isReadOnlyCommand("docker images -a"));
t("docker run 非只读", !isReadOnlyCommand("docker run alpine"));
t("docker rm 非只读", !isReadOnlyCommand("docker rm abc"));

// ── 写/危险操作 ──
t("rm -rf / 非只读", !isReadOnlyCommand("rm -rf /"));
t("find . -delete 非只读", !isReadOnlyCommand("find . -name x -delete"));
t("find . -exec 非只读", !isReadOnlyCommand("find . -exec rm {} ;"));
t("find . -fprint 非只读", !isReadOnlyCommand("find . -fprint out.txt"));

// ── shell 元字符：一律不视为只读 ──
t("管道非只读", !isReadOnlyCommand("cat a | grep b"));
t("重定向非只读", !isReadOnlyCommand("echo hi > out.txt"));
t("追加重定向非只读", !isReadOnlyCommand("cat a >> b"));
t("命令替换非只读", !isReadOnlyCommand("git log $(pwd)"));
t("反引号非只读", !isReadOnlyCommand("git log `pwd`"));
t("后台非只读", !isReadOnlyCommand("ls &"));
t("串联非只读", !isReadOnlyCommand("ls; rm -rf /"));
t("&& 非只读", !isReadOnlyCommand("ls && rm -rf /"));
t("引号内的管道不算元字符", isReadOnlyCommand("grep 'a|b' file.txt"));

// ── 前导命令白名单 ──
t("sudo 非只读", !isReadOnlyCommand("sudo ls"));
t("node -e 非只读", !isReadOnlyCommand("node -e 'console.log(1)'"));
t("bash -c 非只读", !isReadOnlyCommand("bash -c ls"));
t("xargs 永不只读", !isReadOnlyCommand("xargs -rI echo sh -c id"));
t("env 非只读", !isReadOnlyCommand("env ls"));

// ── flag 解析边界（对齐源码记录的 parser differential）──
t("git log -- --oneline 只读（-- 后是路径）", isReadOnlyCommand("git log -- --oneline"));
t("无参旗标带 = 拒绝", !isReadOnlyCommand("grep -n= foo file"));
t("带参旗标缺参数拒绝", !isReadOnlyCommand("git log -n"));
t("组合旗标含带参旗标拒绝", !isReadOnlyCommand("grep -rA foo f"));
t("未知短旗标拒绝", !isReadOnlyCommand("ls -Z"));
t("空命令非只读", !isReadOnlyCommand(""));
t("非字符串非只读", !isReadOnlyCommand(null));
t("未知命令非只读", !isReadOnlyCommand("foo bar"));

// ── tokenize ──
const tk = tokenize("grep -n 'a b' file");
t("tokenize 引号保留空格", tk.tokens.length === 4 && tk.tokens[2] === "a b");
t("tokenize 检测未引号元字符", tokenize("a | b").unsafe === true);
t("tokenize 双引号转义", tokenize('echo "a\\"b"').tokens[1] === 'a"b');
t("tokenize 空引号保留空 token", tokenize("grep '' f").tokens[1] === "");

// ── validateFlagArgument ──
t("number 类型校验", validateFlagArgument("12", "number") && !validateFlagArgument("1a", "number"));
t("char 类型校验", validateFlagArgument("f", "char") && !validateFlagArgument("ff", "char"));
t("string 类型校验", validateFlagArgument("任意", "string"));
t("none 类型恒 false", !validateFlagArgument("x", "none"));

// ── UNC 路径 ──
t("UNC 反斜杠检测", containsVulnerableUncPath("cat \\\\server\\share"));
t("UNC 正斜杠检测", containsVulnerableUncPath("cp //server/share/x ."));
t("WebDAV 变体检测", containsVulnerableUncPath("\\\\host@SSL@8443\\x"));
t("普通路径不误报", !containsVulnerableUncPath("cat /root/file.txt"));
t("http URL 不误报", !containsVulnerableUncPath("https://example.com/a"));
t("空串不误报", !containsVulnerableUncPath(""));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
