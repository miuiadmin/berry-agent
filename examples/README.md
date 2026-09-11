# examples —— 插件模板两形

示例插件模板（03 篇 §9.5）——**最小代码插件**与**纯技能包**两形，兼
testkit 断言矩阵的 fixture（对真模板跑全绿）。

| 模板                                            | 形态                                      | 装载语义                                                      |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| [`minimal-code-plugin/`](./minimal-code-plugin) | 代码插件（`entry` 指向入口文件）          | default export 的 async 函数装载即执行，注册面在 `ctx` 上打开 |
| [`pure-skill-pack/`](./pure-skill-pack)         | 纯声明包（`skills` 目录声明、无 `entry`） | 零码装载——包主入口不执行，`skills/` 下每个同名目录即一个技能  |

## 试跑（零装机）

```bash
# 代码插件——注册 /example-hello 命令
berry-agent --plugin-file ./examples/minimal-code-plugin

# 纯技能包——装载 markdown-table 技能
berry-agent --plugin-file ./examples/pure-skill-pack
```

`--plugin-file` 为纯内存注入（装载计划 `_quick_test` 行，退出即消失——
enabled.yaml 与装机账本零落盘）；正式装机走 `berry-agent plugins install
local:<绝对路径>`。

更多面（工具/钩子/提示词段/触发器/LSP/MCP……）见 `docs/plugins-dev.md`。
