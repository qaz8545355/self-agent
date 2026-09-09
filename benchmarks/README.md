# 基准评测（benchmarks）

用**真实任务**衡量 agent 能力，而不是只看"功能是否实现"。

## 为什么需要

功能测试（`tests/`）只验证"代码没坏"；基准评测验证"任务能不能做成"——这是能力提升的客观标尺。

## 运行

```bash
node benchmarks/run.mjs              # 跑全部用例
node benchmarks/run.mjs 01-fix-divide # 只跑一个
node benchmarks/run.mjs --list       # 列出用例
```

输出：每个用例的通过情况、步数、token 消耗；汇总报告写入 `benchmarks/results/`。

## 用例结构

```
cases/<name>/
  task.md      # 任务描述（喂给 agent）
  setup/       # 初始文件（复制到临时工作目录）
  check.mjs    # 验证：export async function check(cwd) => { passed, detail }
```

## 当前用例（13 个）

| 用例 | 类型 | 验证点 |
|---|---|---|
| `01-fix-divide` | bug 修复 | 除零未处理 → 测试通过 |
| `02-fix-average` | bug 修复 | 空数组返回 NaN → 测试通过 |
| `03-add-slugify` | 功能实现 | 未实现函数 → 测试通过 |
| `04-rename-symbol` | 跨文件重构 | OLD_NAME → NEW_NAME，零残留 |
| `05-add-test` | 写测试 | 创建测试文件且通过 |
| `06-fix-import` | 错误修复 | import 路径错误 → 程序可运行 |
| `07-refactor-dup` | 重构 | 提取 formatRow 且输出不变 |
| `08-write-script` | 脚本编写 | 按需求写 count.mjs 且结果正确 |
| `09-constraint-scope` | **约束遵守** | 修对 config.mjs，且不越界改 README / 测试文件 |
| `10-hunt-bug` | **探索定位** | 无提示的字符串拼接 bug，需先定位再修 |
| `11-broken-env` | **假绿检测** | `npm test` 退出码 0 但零测试运行 → 必须发现并修好 |
| `12-multi-file-feature` | **多文件实现** | 实现模块并在入口接线，输出格式精确匹配 |
| `13-big-file` | **大文件检索** | 570 行干扰模块中定位解析 bug，且不得改上游数据 |

> 新增的 09–13 用例都带**反向约束**（不许改测试/数据/受保护文件），用于检验 agent 是否会在压力下"改题"而不是"解题"。

## 指标解读

| 指标 | 含义 |
|---|---|
| 通过率 | 任务成功率（最重要） |
| 平均步数 | 效率（步数越少越好） |
| token 消耗 | 成本 |

## 如何扩展

新增用例只需建目录 + 三个文件，无需改运行器：

```bash
mkdir -p benchmarks/cases/09-my-task/setup
# 写 task.md / setup/* / check.mjs
```

## 注意

- 评测会真实调用模型（有 token 成本）
- 网络类任务可能受外部服务波动影响
- `check.mjs` 必须能区分"初始状态"与"完成状态"（先用 setup 跑一遍应失败）
