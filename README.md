# berry-agent

单一、可扩展的个人 Agent——对话与编码即本体，一切能力以**插件**装载。
TypeScript + SQLite + [pi-ai](https://github.com/earendil-works/pi-ai)。

> 状态：`0.1.0-alpha.1`，开发中——契约先行、逐批纵切落地；官方插件 16 件已随包出厂。包尚未在 npm 首发——下方两路安装待首发后可用，源码构建即时可用（见[使用指南](./docs/usage.md#安装)）。

核心理念：**基座强在接口，能力长在插件**——扩展点/钩子/事件/服务面做满做稳，任何能力（shell 执行、技能、浏览器、定时任务、记忆、Web 界面……）都以插件装载表达；官方件与社区件走同一装载面，第一方无私有车道。

## 安装

要求 Node.js ≥ 24。两路任选：

```bash
# 路一：安装脚本（两段式——先落盘再执行；不要用管道直灌，断流会让 shell 执行半截脚本）
curl -fsSL -o install.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/install.sh
sh install.sh

# 路二：npm
npm install -g berry-agent
```

从源码构建见[使用指南](./docs/usage.md#安装)；卸载见[使用指南](./docs/usage.md#卸载)。

## 快速开始

```bash
berry-agent                    # TUI：直进对话（按当前目录续接最新会话）
berry-agent run "一句话单发"     # 单次执行 → stdout
berry-agent sessions list      # 会话管理：list / resume / fork / search / reindex
berry-agent plugins list       # 插件装机管理：list / check / install / uninstall / mount / unmount / toggle / update
berry-agent credentials list   # 凭证管理：add / list / rm（TUI 另有 oauth 授权流）
berry-agent doors list         # 开门制门态只读（开/关走 TUI /doors open|close）
berry-agent serve --port 7860  # 常驻宿主（Web 界面 + /v1/* 程序调用面）
```

首启自动创建 `~/.berry-agent/`。模型缺省 `anthropic/claude-sonnet-5`，凭证按 provider 生态变量供给（如 `ANTHROPIC_API_KEY`），`BERRY_AGENT_MODEL` 可覆盖。

完整命令族、旗标、环境变量与 TUI 键位见[使用指南](./docs/usage.md)。

## 官方插件 16 件（默认启用，可禁用）

`core:exec`（shell 执行）· `core:skills`（技能）· `core:web`（网络取数）· `core:scheduler`（定时任务）· `core:goal`（目标续跑）· `core:subagent`（子代理）· `core:checkpoint`（边界快照/rewind）· `core:memory`（记忆）· `core:mcp`（MCP 客户端）· `core:lsp`（LSP 客户端）· `core:browser`（浏览器）· `core:webui`（Web 界面）· `core:sdk`（自动化通道）· `core:obs`（观测）· `core:issue`（issue 模式）· `core:credentials`（凭证代管）

## 自动化通道

- **npm SDK**：`npm install berry-agent-sdk`——类型化客户端（spawn stdio / 直连 HTTP 两传输）；
- **MCP**：`berry-agent mcp` 以 MCP server 形态暴露两工具，任意 MCP 客户端可接入；
- **守护**：`serve --daemon` + `serve status` / `serve stop`。

## 环境变量

前缀一律 `BERRY_AGENT_*`：

| 变量                                 | 作用                                                    | 缺省                        |
| ------------------------------------ | ------------------------------------------------------- | --------------------------- |
| `BERRY_AGENT_MODEL`                  | 覆盖缺省模型                                            | `anthropic/claude-sonnet-5` |
| `BERRY_AGENT_DATA_DIR`               | 数据目录                                                | `~/.berry-agent`            |
| `BERRY_AGENT_DB_PATH`                | 库文件路径（独立梯子）                                  | `<数据目录>/sessions.db`    |
| `BERRY_AGENT_LOG_LEVEL`              | error / warn / info / debug / silent                    | `info`                      |
| `BERRY_AGENT_BASH_PATH`              | bash 可执行路径                                         | PATH 发现序                 |
| `BERRY_AGENT_FD_PATH`                | `@` 补全的 fd 路径（保留位——fd 批未触，当前仅内置遍历） | —                           |
| `BERRY_AGENT_BROWSER_PATH`           | 浏览器引擎路径                                          | 引擎发现序                  |
| `BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE` | 插件装机供应链护栏：npm 源最小发布龄分钟数（0 = 关窗）  | 1440                        |

## 遥测

**默认不发任何网络包**——无使用统计、无崩溃上报、无版本检查。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词），此外零。详见[运维手册](./docs/operations.md#遥测立场)。

## 文档

| 册                                           | 内容                                 |
| -------------------------------------------- | ------------------------------------ |
| [架构总览](./docs/architecture.md)           | 分层、模块拓扑、运行时骨架、安全模型 |
| [使用指南](./docs/usage.md)                  | 安装、命令族、TUI、环境变量          |
| [插件开发指南](./docs/plugin-development.md) | manifest、ctx 能力面、扩展点、发布   |
| [开发指南](./docs/development.md)            | 门禁、拓扑律、测试纪律、贡献流程     |
| [运维手册](./docs/operations.md)             | 数据目录、备份恢复、故障排查         |

## 开发

```bash
npm install
npm run typecheck       # 门禁一：tsc --noEmit
npm test                # 门禁二：vitest run
npm run lint:topology   # 门禁三：模块 DAG 边表 + API 治理面门禁
npm run format:check    # 门禁四：prettier 检查
npm run build           # 构建链（webui → tsc → API 声明快照）
```

四门禁提交前全绿。贡献流程见[开发指南](./docs/development.md)与 [CONTRIBUTING](./CONTRIBUTING.md)。

## License

[MIT](./LICENSE)
