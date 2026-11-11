# 聚合工具适配指南

面向把 berry-agent 当作被驱动 agent 接入的编排器 / 工作台 / 编辑器作者（paseo、hapi、t3 code、Zed 型 ACP 宿主，或自研脚本）。自包含覆盖：发现与探活、无头执行、常驻服务面、审批转发、隔离与密钥边界。安装与日常使用见[使用指南](./usage.md)。

> 状态：`0.1.x`（alpha）。CLI 与 SDK 面已可用且向后兼容承诺按「加法扩展不破坏」执行；`berry acp`（ACP v1 server 包装形态）已落地——聚合器经本文的 run / serve / MCP / ACP 四面接入。

## 一、发现与探活

- 二进制名 `berry`（npm 包名 `berry-agent`，`npm install -g berry-agent` 后 PATH 可寻址）。
- 探活：`berry --version`（裸 semver 一行，退出码 0；未安装即非零——可直接作 systemd/cron 探活判据）。
- 版本协商：SDK / HTTP 面带协议版本（见下）；CLI 旗标面无版本握手，聚合器按 `--version` 前缀分档即可。
- 环境变量一律 `BERRY_AGENT_*` 前缀：`BERRY_AGENT_MODEL`（覆盖缺省模型）、`BERRY_AGENT_DATA_DIR`（覆盖 `~/.berry-agent` 数据目录）、`BERRY_AGENT_LOG_LEVEL`（error/warn/info/debug/silent，缺省 info）。

## 二、无头执行：`berry run`（一问一答 / 管道形）

```bash
berry run "总结这个仓库的架构"            # stdout 出末条 assistant 文本
cat report.md | berry run -              # `-` 位参 = 从 stdin 读全文作消息体
berry run - < input.txt                  # 同上（重定向形）
berry run -- -                           # 字面 "-" 作消息（`--` 终结符后恒字面）
```

| 面         | 事实                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输出三档   | `--output-format text`（缺省，stdout 只出末条 assistant 文本）/\| `json`（终值单对象一行 NDJSON：`sessionId`/`status`/`turns`/`usage`/`durationMs`/`models`〔逐模型 usage 分解〕/`lastMessage`）/\| `stream`（AgentEvent NDJSON 逐事件直出——与 serve 线协议同源事件面）                                                      |
| stdin 喂入 | `-` 位置参数 = 读 stdin 全文（EOF 止）；非 `-` 一律不读；超 10 MiB（UTF-8 字节）或空输入 = 用法错退 2                                                                                                                                                                                                                        |
| 续接族     | `--session <id>`（按 id 续接）/ `--continue`（取 cwd 最新会话续接）/ `--fork`（边界快照分叉，不带 id 取 cwd 最新）——三者互斥；**缺省每次新建会话**（脚本可预期性优先）。聚合器落盘 berry 的 `sessionId` 后续接即为原生 session_id 直用，零映射                                                                               |
| 退出码四档 | `0` 成功收场；`1` 执行失败（failed/truncated）；`2` 用法错；`130` 中止（aborted——SIGINT 协作中止，「取消 ≠ 出错」可判别）。**错误路径必及时非零退出，不挂死**                                                                                                                                                                |
| 产物位     | `--output-last-message <file>`（末条 assistant 文本原子写文件——CI 取产物不解析 stdout）；`--output-schema <file>`（typebox JSON Schema 收场约束，不合退 1 带 `STRUCTURED_OUTPUT_*` 码）                                                                                                                                      |
| 预算/沙箱  | `--read-only`（只读沙箱单发）/ `--preset conservative\|balanced\|open`（权限预设逐次生效）；`--max-turns <n>`（到帽截断，status 如实标 `truncated`）                                                                                                                                                                         |
| 降流量     | `--no-delta`（线面退订 message_update 增量——整消息事件仍在）；`--ephemeral`（零落盘单发——不留会话痕，聚合器自管留档时用）                                                                                                                                                                                                    |
| 审批通道   | run 无交互应答者：未预填时审批类原语 fail-closed（不挂死）——无人值守预填用 `--answers "tool=answer,..."`（approve/reject/always 三值、全等或 `前缀*` 通配；**always 只做会话内粘性、不落跨会话策略表**）；交互审批转发走 serve 面的 `decide`（B1 决策袋：approve 伴 `updatedInput` 改写 / always 伴 `suggestionIndex` 选定） |

## 三、常驻服务面：`berry serve`（多会话 / 流式 / 审批双向）

```bash
berry serve --daemon                 # 后台守护：Unix sock 缺省接入点
berry serve --daemon --port 7860     # + 统一 HTTP 面 TCP 侧（SPA + /api/* + /v1/*）
berry serve                          # 前台 stdio JSONL（一次一调用方——脚本 spawn 直连形态）
berry serve status / serve stop      # 探活（0 在跑/1 未跑）与优雅停（幂等）
```

- **接入点**：daemon 形缺省 `<数据目录>/serve/daemon.sock`（Unix-domain socket，本地文件权限即信任边界）；TCP 侧可选 `--sdk-port <n>`（daemon 专属；`--sdk-host` 非回环值**必配** `BERRY_AGENT_SDK_TOKEN`，缺席拒启）。
- **鉴权**：`Authorization: Bearer <token>`；未显式配 token 时 daemon 自动生成并在 `<数据目录>/serve/daemon.log` 披露（stderr 重定向位）。
- **版本协商**：每请求携 `x-sdk-protocol` 头，不符即 `400 SDK_PROTOCOL_MISMATCH`——第一天就版本化，不猜。
- **端点闭集**（`/v1/*`）：

| 端点            | 方法    | 语义                                                                                                                                                                          |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/prompt`    | POST    | 新发/续发（`sessionId` 缺席即新建；携自选 `messageId` 幂等——同 ID 同内容重收执、异内容 `SDK_MESSAGE_CONFLICT`；回执首帧恒 `ack`，含 `sessionId`/`duplicate`/`routedChannel`） |
| `/v1/interrupt` | POST    | 中止在飞 run（HTTP 无应答档 = 204）                                                                                                                                           |
| `/v1/decide`    | POST    | **审批应答**（与 TUI/web 三入口同一竞速漏斗——先 settle 者胜，后到幂等回执 superseded）                                                                                        |
| `/v1/entries`   | POST    | 断线对账（`since` 窗口 `(since, 高水位]`，回 `nextCursor` 可跟尽）                                                                                                            |
| `/v1/sessions`  | GET     | 会话清单（id/标题/末活动时间）                                                                                                                                                |
| `/v1/events`    | GET SSE | 事件流建立（查询参 `sessionId`/`after`/`noDelta`——即 hello 动词的 HTTP 承载）                                                                                                 |

- **事件流与断线补齐**：`/v1/events` 先重放（`entries` 帧 → `replay-end` 游标帧）后直播（`event`/`heartbeat`/`ask` 帧）。每事件带 per-session 单调 `seq`；重连携 `after=N` 从断点续拉，或 `/v1/entries` 单独对账。**流式 delta 缺省开**，降流量用 `noDelta`（整消息事件仍在）。
- **心跳是协议义务**：idle 超阈（缺省 5000ms）即发 `heartbeat` 帧（载 sessionId/run 态/当前阶段 thinking·tool·retry/累计 elapsedMs）——「慢」不会被误读为「死」，聚合器状态机（idle/working/blocked）可直接消费。
- **能力公告**（hello capabilities）：每个 `hello` 帧携带可选 `capabilities` 载荷——`models`（栈内模型清单）/ `tools`（工具名快照）/ `features`（能力串：`acp`·`mcp-server` = 安装级恒在、`webui` = 本进程面可开、`images` = 附件栈）。**每 hello 现取**（断线重连即重取）；快照语义——core:mcp 异步发现在途时 `tools` 可滞后，勿据单次快照判「永不」。与 §六 ACP initialize 能力位分立不合并（ACP 词面系官方 schema）。
- **审批外推**：run 遇审批即推 `ask` 帧（会话流上），聚合器人审后 `/v1/decide` 应答——这是**应答能力不是自动批准**；无订阅者时 fail-closed（不会挂着等）。
- **单活跃机**：一数据目录一 daemon（第二实例 `HOST_DATA_DIR_BUSY` 拒启）。ACP 形差异：`berry acp` 第二实例**不拒启**——自动纯字节代理入首实例（多连接复用，见[§六](#六acp-面berry-acp已落地)）。聚合器「拉起-接入」编舞：先 `serve status` 探活，未跑再 `--daemon` 拉起，然后连 sock/TCP——不发明自动接管。
- **npm SDK**：[`berry-agent-sdk`](https://www.npmjs.com/package/berry-agent-sdk)（零配置类型化客户端）——`spawnServeTransport`（托管 spawn `berry serve` stdio 子进程，一条 NDJSON 线）与 `httpSdkTransport`（sock/TCP + SSE 直连）两传输同一方法面：`prompt`/`subscribe`/`sessions`/`getEntries`/`decide`/`interrupt`。**推荐聚合器直接消费 SDK 包**，线协议词汇与主仓单源同编译、类型零漂移。

## 四、MCP 面：`berry mcp`（能力出口——被别家 agent 当工具调）

```bash
berry mcp                            # stdio MCP server（行帧 JSON-RPC）
```

- 工具面收窄两件（异步档）：`berry-agent`（会话发起/续接，受理即回执 sessionId）+ `berry-agent-reply`（durable 投影轮询，`lastSeq` 续读位）。
- **MCP 形无审批通道、无直播线**：只消费 durable 投影（审批 fail-closed 不经此面）。需要审批转发 / 实时流的聚合器走第三节 serve 面。
- 定位一句话：**MCP = 能力出口（工具被任意 host 消费）；会话出口 = serve/SDK 面**（ACP = 会话出口的协议兼容形）。berry 自身作为 MCP 客户端的消费经插件面配置——`berry mcp list / add <name> <command> [args…] / remove <name>` 客户端管理族直接编辑 core:mcp 行配置（零装配、`/reload` 生效；`add` 收绝对路径命令、词法拒绝用法错退 2、重名与缺席退 1 指路）。

## 五、聚合器公约对照（ berry 侧承诺 ）

| 公约             | berry 侧                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发现/探活        | PATH 寻址 `berry`；`--version` 探活（退出码即谓词）                                                                                                                 |
| worktree 承载    | **由聚合器自建**（每会话一 worktree + 专属分支）；berry 会话按 `workspace_root` 锚定（cwd 归一形），多会话多根天然分立，不碰聚合器主检出                            |
| 密钥自持         | berry 用**自身凭证面**（`~/.berry-agent` 凭证盒 + `BERRY_AGENT_MODEL`/渠道 env）——聚合器**勿注入**模型密钥；berry 不读聚合器的密钥托管                              |
| 状态机消费       | `heartbeat` 帧（run 态/阶段）+ `agent_end` 终态——协议事件优先，无屏幕抓取需求                                                                                       |
| 会话续接         | 原生 `sessionId` 直用（`run --session` / `prompt` 携带 / ACP 形 `session/new·prompt`）——聚合器落盘续接零映射                                                        |
| 用量上报         | json 终值 `usage`/`models`（run 形——已结账可用）+ 事件流 `agent_end.usage` 位（serve 形——**预留态**：供源未落恒缺席，聚合器勿依赖；供源兑现另批）——聚合器不发明计量 |
| durable 崩溃接管 | 会话事件 durable 落库 + `seq`/`after` 重放——daemon 重启后聚合器从断点补齐，无第二套恢复路径                                                                         |

## 六、ACP 面：`berry acp`（已落地）

ACP（Agent Client Protocol）v1 agent 侧包装——Zed / paseo / hapi / t3 型宿主经 ACP 连驱 berry 的入口位。stdio 行帧 JSON-RPC、零旗标面：

```bash
berry acp     # stdio 直连（客户端 spawn 形态——宿主配置里填可执行名 + 参数）
```

- **方法基线集**（v1）：`initialize`（protocolVersion 整数 1 回显制；能力位诚实——`loadSession: true`、`promptCapabilities.image: true`，未承载位不虚报）/ `session/new`（`cwd` 必携绝对路径 → berry 会话工作区根〔AGENTS.md 发现锚由此而来〕；`mcpServers` 非空即 -32602 拒收——v1 有意边界，MCP 客户端配置经 berry 插件面装载——manifest `server` 键声明形见[插件开发指南](./plugin-development.md#manifest)）/ `session/prompt`（内容块 text·image·resource_link；晚应答——`agent_end` 终态到达才回 `stopReason`）/ `session/cancel`（→ berry interrupt，终值 `cancelled`）/ `session/load`（durable 全量重放为 `session/update` 序）/ `session/update`（直播：`agent_message_chunk`/`agent_thought_chunk`/`tool_call`/`tool_call_update`；session/load 重放另含 `user_message_chunk`）/ `session/request_permission`（审批双向：ask 外推为 2..N+2 档选项——建议候选集在场时逐条「始终允许」+ 允许本次 + 拒绝（缺席 = 两档；optionId 携索引后缀 `allow-always-N` 供选定索引映射），应答汇入 berry 跨入口审批竞速漏斗；宿主接入示例：Zed（agent 列表自定义 ACP agent：command `berry`，args `["acp"]`）；paseo/hapi 型聚合器（ACP 适配器位同填 `berry acp`）。
- **多连接复用**：首 `berry acp` 持数据目录锁后顺带监听 `<数据目录>/acp.sock`——每 socket 连接独立 face（多连接入同一进程内多 face 承载）；后到 spawn 撞 `HOST_DATA_DIR_BUSY` 时自动纯字节代理 stdio↔socket（零装配零协议解析——聚合端「每会话一 spawn」拓扑免改）；进程退场条件 = **全部连接退场**（非仅 stdio EOF）——单活跃不变式不动，不放宽单活跃律。锁持有者非 ACP 形态（TUI/serve 等）时无 socket 可接，后到 `berry acp` 回落既有 fail-loud 拒启（诚实拒入不静默）。

---

维护注：本文与代码同步维护（承诺面 = `berry --help` / `docs/usage.md` 单源核对）；面语义真源：run 族 `src/host/run-entry.ts`、serve/SDK 面 `plugins/sdk/`、MCP 面 `plugins/sdk/mcp.ts`。
