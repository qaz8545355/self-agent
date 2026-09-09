/**
 * readonly-commands.mjs — 命令级只读判定
 *
 * 移植自 Claude Code `utils/shell/readOnlyCommandValidation.ts`（1893 行）。
 * 目的：把「这条 bash 命令是否只读」从正则猜测升级为**基于命令配置表的 flag 校验**。
 *
 * 用途：
 * - `partitionToolCalls`：只读命令可与其他只读调用并行（原来 bash 永远串行）
 * - 安全层：只读命令在受限模式下可放行，其余仍走 execpolicy
 *
 * 设计原则：**无法确定就返回 false**（宁可不并行，不可误放行）。
 */

/** flag 取值类型（对齐源码 FlagArgType） */
export const FLAG_PATTERN = /^-[a-zA-Z0-9_-]/;

/** 校验 flag 的参数是否符合声明类型 */
export function validateFlagArgument(value, argType) {
  switch (argType) {
    case "none":
      return false; // 该类型不该带参数
    case "number":
      return /^\d+$/.test(value);
    case "string":
      return true;
    case "char":
      return value.length === 1;
    case "{}":
      return value === "{}";
    case "EOF":
      return value === "EOF";
    default:
      return false;
  }
}

/**
 * 分词：支持单/双引号与反斜杠转义。
 * 返回 { tokens, unsafe }；unsafe=true 表示存在**未加引号**的 shell 元字符（管道/重定向/命令替换等），
 * 这类命令一律不视为只读。
 */
export function tokenize(commandLine) {
  const tokens = [];
  let cur = "";
  let hasToken = false;
  let quote = null;

  const pushToken = () => {
    if (hasToken) {
      tokens.push(cur);
      cur = "";
      hasToken = false;
    }
  };

  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === "\\" && quote === '"' && i + 1 < commandLine.length) {
        cur += commandLine[++i];
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasToken = true;
      continue;
    }

    if (ch === "\\" && i + 1 < commandLine.length) {
      cur += commandLine[++i];
      hasToken = true;
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }

    // 未加引号的元字符：管道、重定向、命令替换、后台、串联
    if ("|&;<>`$()".includes(ch)) {
      return { tokens, unsafe: true };
    }

    cur += ch;
    hasToken = true;
  }

  pushToken();
  return { tokens, unsafe: false };
}

/**
 * 校验一段 flag/参数（移植 validateFlags 的核心循环）。
 * 覆盖源码里记录的三类 parser differential 攻击：
 * 1. `--flag=`（空值）不应吞掉下一个 token
 * 2. 组合短旗标中若含「带参旗标」则整体拒绝（GNU getopt 会吞下一个 token）
 * 3. 不尊重 `--` 的工具不能因为遇到 `--` 就放行后续 flag
 */
export function validateFlags(tokens, startIndex, config, options = {}) {
  const { commandName, rawCommand, xargsTargetCommands } = options;
  let i = startIndex;

  while (i < tokens.length) {
    let token = tokens[i];
    if (!token) {
      i++;
      continue;
    }

    // xargs：找到目标命令即停止校验
    if (xargsTargetCommands && commandName === "xargs" && (!token.startsWith("-") || token === "--")) {
      if (token === "--" && i + 1 < tokens.length) {
        i++;
        token = tokens[i];
      }
      if (token && xargsTargetCommands.includes(token)) break;
      return false;
    }

    if (token === "--") {
      if (config.respectsDoubleDash !== false) {
        i++;
        break; // 其后都是位置参数
      }
      i++;
      continue;
    }

    if (token.startsWith("-") && token.length > 1 && FLAG_PATTERN.test(token)) {
      const hasEquals = token.includes("=");
      const [flag, ...valueParts] = token.split("=");
      const inlineValue = valueParts.join("=");

      if (!flag) return false;

      const flagArgType = config.safeFlags[flag];

      if (!flagArgType) {
        // git 的 -<数字> 是 -n <数字> 的简写
        if (commandName === "git" && /^-\d+$/.test(flag)) {
          i++;
          continue;
        }

        // grep/rg 的附加数字参数（-A20）
        if (
          (commandName === "grep" || commandName === "rg") &&
          flag.startsWith("-") &&
          !flag.startsWith("--") &&
          flag.length > 2
        ) {
          const base = flag.slice(0, 2);
          const value = flag.slice(2);
          const baseType = config.safeFlags[base];
          if (baseType && /^\d+$/.test(value)) {
            if (validateFlagArgument(value, baseType)) {
              i++;
              continue;
            }
            return false;
          }
        }

        // 组合短旗标：必须全部是无参旗标
        if (flag.startsWith("-") && !flag.startsWith("--") && flag.length > 2) {
          for (let j = 1; j < flag.length; j++) {
            const single = "-" + flag[j];
            const type = config.safeFlags[single];
            if (!type) return false;
            if (type !== "none") return false; // 带参旗标混在组合里 → 拒绝
          }
          i++;
          continue;
        }

        return false; // 未知 flag
      }

      if (flagArgType === "none") {
        if (hasEquals) return false; // 无参旗标不该带 =
        i++;
      } else {
        let argValue;
        if (hasEquals) {
          argValue = inlineValue;
          i++;
        } else {
          const next = tokens[i + 1];
          if (i + 1 >= tokens.length || (next && next.startsWith("-") && next.length > 1 && FLAG_PATTERN.test(next))) {
            return false; // 缺参数
          }
          argValue = next || "";
          i += 2;
        }

        // string 类型不允许以 - 开头（防止类型混淆注入）
        if (flagArgType === "string" && argValue.startsWith("-")) {
          const isGitSort = flag === "--sort" && commandName === "git" && /^-[a-zA-Z]/.test(argValue);
          if (!isGitSort) return false;
        }

        if (!validateFlagArgument(argValue, flagArgType)) return false;
      }
    } else {
      i++; // 位置参数（路径、版本号等）放行
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// 命令配置表
// ---------------------------------------------------------------------------

const COMMON_HELP = { "--help": "none", "-h": "none", "--version": "none" };

/** git 只读子命令 */
export const GIT_READONLY_SUBCOMMANDS = {
  status: {
    safeFlags: {
      "-s": "none", "--short": "none", "--porcelain": "none", "-b": "none", "--branch": "none",
      "--ignored": "none", "-u": "string", "--untracked-files": "string", "-z": "none", ...COMMON_HELP,
    },
  },
  log: {
    safeFlags: {
      "--oneline": "none", "--graph": "none", "-n": "number", "--max-count": "number", "--stat": "none",
      "-p": "none", "--patch": "none", "--all": "none", "--branches": "none", "--tags": "none",
      "--since": "string", "--after": "string", "--until": "string", "--before": "string",
      "--author": "string", "--grep": "string", "--format": "string", "--pretty": "string",
      "-S": "string", "--no-merges": "none", "--follow": "none", "--name-only": "none",
      "--name-status": "none", "--decorate": "none", "--abbrev-commit": "none", "--reverse": "none",
      "--sort": "string", ...COMMON_HELP,
    },
  },
  diff: {
    safeFlags: {
      "--stat": "none", "--name-only": "none", "--name-status": "none", "--cached": "none",
      "--staged": "none", "-U": "number", "--unified": "number", "--color": "string", "--no-color": "none",
      "-w": "none", "--word-diff": "none", "--check": "none", "--quiet": "none", "--exit-code": "none",
      ...COMMON_HELP,
    },
  },
  show: {
    safeFlags: {
      "--stat": "none", "--name-only": "none", "--format": "string", "--pretty": "string",
      "-s": "none", "--no-patch": "none", "--abbrev-commit": "none", ...COMMON_HELP,
    },
  },
  branch: {
    safeFlags: {
      "-a": "none", "-r": "none", "-l": "none", "--list": "none", "-v": "none", "-vv": "none",
      "--merged": "none", "--no-merged": "none", "--contains": "string", "--format": "string",
      "--show-current": "none", ...COMMON_HELP,
    },
    // -d/-D/-m/-M/--delete 是写操作
    additionalCommandIsDangerousCallback: (_raw, args) =>
      args.some((a) => ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--edit-description"].includes(a)),
  },
  "rev-parse": { safeFlags: { "--short": "none", "--abbrev-ref": "none", "--verify": "none", "--is-inside-work-tree": "none", ...COMMON_HELP } },
  "ls-files": { safeFlags: { "-m": "none", "-o": "none", "-c": "none", "-s": "none", "--deleted": "none", "--modified": "none", ...COMMON_HELP } },
  blame: { safeFlags: { "-L": "string", "-w": "none", "-n": "none", "--line-porcelain": "none", ...COMMON_HELP } },
  shortlog: { safeFlags: { "-s": "none", "-n": "none", "--numbered": "none", "--summary": "none", ...COMMON_HELP } },
  reflog: { safeFlags: { "--oneline": "none", "-n": "number", ...COMMON_HELP } },
  describe: { safeFlags: { "--tags": "none", "--all": "none", "--long": "none", ...COMMON_HELP } },
  "cat-file": { safeFlags: { "-t": "none", "-s": "none", "-p": "none", ...COMMON_HELP } },
  "show-ref": { safeFlags: { "--heads": "none", "--tags": "none", "--verify": "none", ...COMMON_HELP } },
  "count-objects": { safeFlags: { "-v": "none", "-H": "none", ...COMMON_HELP } },
};

/** docker 只读子命令 */
export const DOCKER_READONLY_SUBCOMMANDS = {
  ps: { safeFlags: { "-a": "none", "--all": "none", "-q": "none", "--format": "string", "--filter": "string", "-n": "number", ...COMMON_HELP } },
  images: { safeFlags: { "-a": "none", "--all": "none", "-q": "none", "--format": "string", "--filter": "string", ...COMMON_HELP } },
  inspect: { safeFlags: { "--format": "string", "-f": "string", ...COMMON_HELP } },
  version: { safeFlags: { "--format": "string", ...COMMON_HELP } },
  logs: { safeFlags: { "--tail": "string", "-f": "none", "--since": "string", "--timestamps": "none", ...COMMON_HELP } },
};

/** 单命令（无子命令）只读配置 */
export const READONLY_COMMANDS = {
  ls: { safeFlags: { "-l": "none", "-a": "none", "-A": "none", "-h": "none", "-R": "none", "-t": "none", "-r": "none", "-1": "none", "-d": "none", "-i": "none", "--color": "string", "--all": "none", "--long": "none", ...COMMON_HELP } },
  cat: { safeFlags: { "-n": "none", "-b": "none", "-A": "none", "-v": "none", "-s": "none", "-E": "none", ...COMMON_HELP } },
  head: { safeFlags: { "-n": "number", "-c": "number", "-q": "none", "-v": "none", ...COMMON_HELP } },
  tail: { safeFlags: { "-n": "number", "-c": "number", "-q": "none", "-v": "none", ...COMMON_HELP } },
  wc: { safeFlags: { "-l": "none", "-w": "none", "-c": "none", "-m": "none", ...COMMON_HELP } },
  stat: { safeFlags: { "-c": "string", "--format": "string", "-f": "none", ...COMMON_HELP } },
  file: { safeFlags: { "-b": "none", "-i": "none", "--mime": "none", ...COMMON_HELP } },
  du: { safeFlags: { "-s": "none", "-h": "none", "-a": "none", "--max-depth": "number", ...COMMON_HELP } },
  df: { safeFlags: { "-h": "none", "-T": "none", "-i": "none", ...COMMON_HELP } },
  ps: { safeFlags: { "-e": "none", "-f": "none", "-a": "none", "-u": "none", "-x": "none", "-o": "string", ...COMMON_HELP } },
  which: { safeFlags: { "-a": "none", ...COMMON_HELP } },
  whoami: { safeFlags: { ...COMMON_HELP } },
  pwd: { safeFlags: { ...COMMON_HELP } },
  date: { safeFlags: { "-u": "none", "-I": "none", "--iso-8601": "string", "+%Y-%m-%d": "none", ...COMMON_HELP } },
  uname: { safeFlags: { "-a": "none", "-s": "none", "-r": "none", "-m": "none", ...COMMON_HELP } },
  id: { safeFlags: { "-u": "none", "-g": "none", "-n": "none", ...COMMON_HELP } },
  echo: { safeFlags: { "-n": "none", "-e": "none", ...COMMON_HELP } },
  rg: {
    safeFlags: {
      "-n": "none", "-i": "none", "-l": "none", "--files": "none", "--files-with-matches": "none",
      "--hidden": "none", "--no-ignore": "none", "-t": "string", "-T": "string", "-g": "string",
      "-A": "number", "-B": "number", "-C": "number", "--json": "none", "-c": "none", "--count": "none",
      "-w": "none", "-F": "none", "-v": "none", "-s": "none", "-U": "none", "--type": "string",
      "--glob": "string", "--max-count": "number", "-m": "number", ...COMMON_HELP,
    },
  },
  grep: {
    safeFlags: {
      "-n": "none", "-i": "none", "-r": "none", "-R": "none", "-l": "none", "-c": "none", "-v": "none",
      "-w": "none", "-E": "none", "-F": "none", "-G": "none", "-A": "number", "-B": "number",
      "-C": "number", "--color": "string", "-s": "none", "-q": "none", "-H": "none", "-h": "none",
      ...COMMON_HELP,
    },
  },
  find: {
    safeFlags: {
      "-name": "string", "-type": "char", "-maxdepth": "number", "-mindepth": "number",
      "-path": "string", "-not": "none", "-print": "none", "-empty": "none", "-newer": "string",
      "-size": "string", "-iname": "string", "-mtime": "number", ...COMMON_HELP,
    },
    // -delete / -exec / -ok / -fprint* 是写操作或任意命令执行
    additionalCommandIsDangerousCallback: (raw) =>
      /(-delete|-exec|-execdir|-ok|-okdir|-fprint|-fprintf|-fls)\b/.test(raw),
  },
  git: { __subcommands: GIT_READONLY_SUBCOMMANDS },
  docker: { __subcommands: DOCKER_READONLY_SUBCOMMANDS },
};

/** 明确不允许作为「只读」判定的命令（可能执行任意代码） */
const FORBIDDEN_LEADING = new Set([
  "sudo", "env", "xargs", "sh", "bash", "zsh", "node", "npm", "npx", "python", "python3",
  "perl", "ruby", "eval", "exec", "source", "timeout", "watch", "nice", "nohup", "doas",
]);

/**
 * 判定一条命令是否是**只读**的（可安全并行执行）。
 * 判定不了就返回 false。
 */
export function isReadOnlyCommand(commandLine) {
  if (typeof commandLine !== "string" || !commandLine.trim()) return false;

  const parsed = tokenize(commandLine);
  if (!parsed || parsed.unsafe) return false;

  const tokens = parsed.tokens;
  if (!tokens.length) return false;

  const cmd = tokens[0];
  if (FORBIDDEN_LEADING.has(cmd)) return false;

  const entry = READONLY_COMMANDS[cmd];
  if (!entry) return false;

  if (entry.__subcommands) {
    const sub = tokens[1];
    const subCfg = entry.__subcommands[sub];
    if (!subCfg) return false;
    const args = tokens.slice(2);
    if (subCfg.additionalCommandIsDangerousCallback?.(commandLine, args)) return false;
    return validateFlags(tokens, 2, subCfg, { commandName: cmd, rawCommand: commandLine });
  }

  const args = tokens.slice(1);
  if (entry.additionalCommandIsDangerousCallback?.(commandLine, args)) return false;
  return validateFlags(tokens, 1, entry, { commandName: cmd, rawCommand: commandLine });
}

/**
 * 检测 UNC 路径（`\\server\share`、`//server/share`、WebDAV 变体）。
 * 移植自源码 containsVulnerableUncPath：这类路径可能触发网络请求导致凭据泄露。
 */
export function containsVulnerableUncPath(text) {
  if (typeof text !== "string" || !text) return false;
  // \\host\share 或 //host/share（排除 http:// 之类的协议前缀）
  if (/\\\\[^\\\s]/.test(text)) return true;
  if (/(^|[\s"'(])\/\/[^/\s]/.test(text)) return true;
  // WebDAV 变体：\\host@SSL@8443\ 或 \\host\DavWWWRoot\
  if (/@SSL@|DavWWWRoot/i.test(text)) return true;
  return false;
}
