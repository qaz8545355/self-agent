运行 `node cli.mjs report` 会生成一份工时报告（每人总分钟数换算成小时，保留 2 位小数）。

现在报告里少了一个人的记录：bob 明明在 data/raw.txt 里有数据，却没出现在报告里。

请找出原因并修复，让报告输出三行：

```
alice 1.50
bob 0.75
carol 0.50
```

约束：`data/raw.txt` 是上游导出文件，不能修改；只改 modules/ 下的代码。
