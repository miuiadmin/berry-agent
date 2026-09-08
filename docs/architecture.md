# 架构总览

本文自包含描述 berry-agent 的整体架构：定位、模块拓扑、运行时骨架、数据与通道。与代码同步维护；用法见[使用指南](./usage.md)，插件开发见[插件开发指南](./plugin-development.md)。

## 一句话定位

**单一、可扩展的个人 Agent**——对话与编码即本体，一切能力以**插件**装载。TypeScript + SQLite + [pi-ai](https://github.com/earendil-works/pi-ai)，对标 pi / dsh / opencode 形态。

核心理念一句话：**基座强在接口，能力长在插件**。接口承载力（扩展点、钩子、事件、服务面）做满、契约稳定做久；判据面（准入、安全固定件）属宿主裁决权，接口面属插件表达域——装得进不隐含权限。

## 分层：宿主固定件 + core: 官方插件

全仓 29 个模块（28 席进 DAG + bridge 留档不进），单向 DAG（`npm run lint:topology` 执法——相对导入只走边表白名单，边表双向校验）。

### 宿主固定件 12（卸掉任一件，首启「问→做→守→存」循环断）

| 模块           | 职责                                                                                 |
| -------------- | ------------------------------------------------------------------------------------ |
| `contracts`    | 全仓共享契约与词汇（事件词汇、错误基类 `BaseError`）——零依赖                         |
| `context`      | 作用域容器（服务目录、effect 回卷、fork 级联）                                       |
| `session`      | 会话域（SessionManager：创建/open/fork/检索）                                        |
| `agent`        | 模型对话域（loop 只认 StreamFn 签名——不 import llm）                                 |
| `llm`          | 模型运行时（provider 注册表、pi-ai 直连、faux 测试 provider）                        |
| `persist`      | 持久化（SQLite 单库、迁移框架、durable 事件、FTS 检索；better-sqlite3 只准出现在此） |
| `tools`        | 工具注册表与工具调用域                                                               |
| `safety`       | 安全判据面（沙箱档位、审批 ask/decide、allowlist）                                   |
| `compaction`   | 上下文压缩（摘要折叠）                                                               |
| `channels`     | 呈现通道核（信封路由、backend 注册、TUI 引擎全套件族）                               |
| `conversation` | 对话组合域（ConversationDriver、三通道路由、todo 机器）                              |
| `host`         | 装配根（CLI 解析/分派、运行时组装、插件装载、五个入口）                              |

### core: 官方插件 16（随包出厂、默认启用可禁用；id 以 `core:` 前缀，经同一插件装载面装配——第一方无私有车道）

| 插件               | 能力                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `core:exec`        | shell 执行工具族（bash 工具、进程树杀、输出截尾、env 白名单）                                                   |
| `core:skills`      | 技能装载（SKILL.md 双层结构、六位发现层、渐进披露、skill_manage）                                               |
| `core:web`         | 网络取数（fetch 工具 + ctx.fetch + SSRF 五卫生件）                                                              |
| `core:scheduler`   | 定时任务（jobs 表、抢占、`/tick`、cron 可选后端）                                                               |
| `core:goal`        | 目标续跑（goals 表族、计划态 fold、wake 双帽、预算双轨）                                                        |
| `core:subagent`    | 子代理（Job 注册表、provider 面、声明式物化）                                                                   |
| `core:checkpoint`  | 边界快照（pre-mutation 拍摄、blob 仓、`/rewind`）                                                               |
| `core:memory`      | 记忆（表族、合并/极性、注入两路、周期提取、导入导出）                                                           |
| `core:mcp`         | MCP 客户端桥（stdio JSON-RPC 手写最小桥）                                                                       |
| `core:lsp`         | LSP 客户端桥（Content-Length 帧、惰性实例、诊断回流）                                                           |
| `core:browser`     | 浏览器（CDP 手写桥、引擎发现、十工具、/browser install）                                                        |
| `core:webui`       | Web 界面（SPA + `/api/*`，经 SDK HTTP 面路由扩展位挂载）                                                        |
| `core:sdk`         | 自动化通道（HTTP+SSE `/v1/*` 传输、daemon 编舞、路由扩展位）                                                    |
| `core:obs`         | 观测（rollup 表族、`obs_query`、告警通知；自管库）                                                              |
| `core:issue`       | issue 模式（GitHub 轮询 + webhook、worktree 隔离、交付映射）                                                    |
| `core:credentials` | 凭证代管（加密存储、`ctx.secrets` 受理制开面、`@credentials:` env 注入、oauth 流与刷新链、`/credentials` 人面） |

## 运行时骨架

```
bin (berry-agent) → host/main
  ├─ 崩溃/信号编舞（crash.log 取证、SIGINT②/SIGTERM 优雅序）
  ├─ parseCli + dispatchCli（用法错退 2 / help·version 短路 / 非 TTY 卫兵退 2）
  └─ 五入口
      ├─ TUI（无参）──┐
      ├─ run 单次执行 ├─ assembleHostStack 公共段：
      ├─ serve 常驻    │   单活跃机标记 → 开库迁移 → 披露段 → 根作用域
      ├─ mcp 包装     │   → conversation 栈 → 插件装载（Kahn 轮次）
      └─ 诊断命令 ────┘     （dump-config / plugins list / sessions fork 同构）
```

要点：

- **单活跃机**：同一数据目录同一时刻恰一活跃进程（`active.json` 标记 + pid 判活，死 pid 自动接管）；
- **插件装载**：core: 注册表内置全启 + `enabled.yaml` 用户行覆盖；Kahn 轮次按 `ctx.provide` 依赖解锁排序；装载失败三档（跳过 / 降级 / 拒启）分立；
- **`:memory:` 同构纪律**：诊断命令与真实入口走同一装配序真源（`assembleHostStack`），防侧门件；
- **退出码三态**：0 成功 / 1 执行失败 / 2 环境态误用（用法错、非 TTY）。

## 会话与存储

- **单库单文件**：`~/.berry-agent/sessions.db`（SQLite；`BERRY_AGENT_DB_PATH` 三级梯子可重定位），0600 权限自检；
- **durable 事件流**：会话内 `seq` 单调、append-only；投影（transcript / todo / 快照）全是 fold 派生物——坏投影可由事件流重建；
- **FTS**：`session_fts` 全文索引（trigram、bm25）跨会话检索——派生物不修不补，`sessions reindex` 重建即修复；
- **fork**：边界快照分叉（种子事件只随种子走，活体优先事实源）；
- **记忆**：`core:memory` 表族（uuidv7 主键、版本链、TTL、效用分）+ FTS 检索。

数据目录全貌见[运维手册](./operations.md#数据目录)。

## 呈现通道

- **TUI（主界面）**：`channels` 内自研栈——渲染引擎（diff 帧管线、xterm oracle 互证）、输入解码（kitty 推栈、bracketed paste）、编辑器（fish 式 undo、IME）、Markdown 件、副屏回看器（`/history`）；
- **Web 界面（`--port` 开面）**：`core:webui` SPA + REST/SSE，经 `core:sdk` HTTP 面的路由扩展位挂载——恒回环、token 鉴权、三防线（Host/Origin/回环判定）；
- **SDK**：`berry-agent-sdk` npm 包（spawn stdio / 直连 HTTP 两传输）+ MCP 包装形态——自动化通道的完整契约面；
- **信封路由**：多 backend 并存（TUI + Web 同时在场），按 sessionId 各投各；审批（ask/decide）跨入口裁决，先 settle 者胜。

## 安全模型

- **沙箱档位**：read-only / workspace-write / danger（升权 allowed-once 审批缺席即 fail-closed）；
- **审批**：工具执行前 ask → 用户应答（allow / deny / always）——`always` 落 `allowlist.json` 持久回写；
- **SSRF 卫生**：URL 白名单 → 私网双查（字面 + DNS）→ 重定向逐跳复检 → 字节帽；
- **进程治理**：detached 进程组、树杀、登记簿孤儿清扫、pid 复用防线；
- **默认零遥测**：无使用统计、无崩溃上报、无版本检查——出厂网络面仅凭证供给的模型调用与用户显式动作。

## 更多

- [使用指南](./usage.md)——安装、CLI 命令族、TUI 键位、环境变量；
- [插件开发指南](./plugin-development.md)——manifest、ctx 能力面、扩展点、发布；
- [开发指南](./development.md)——仓库布局、四门禁、测试纪律、工程约定；
- [运维手册](./operations.md)——数据目录、备份恢复、故障排查。
