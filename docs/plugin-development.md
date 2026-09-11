# 插件开发指南

本文自包含覆盖 berry-agent 插件的全部开发面：清单、装载、ctx 能力面、扩展点、错误码与发布。架构背景见[架构总览](./architecture.md)。

一切能力皆以插件装载——官方 16 件（`core:` 前缀）与社区插件走**同一装载面**，第一方无私有车道。

## 插件是什么

一个插件 = 一个 npm 形包，包含：

- **manifest**（清单——包内声明）；
- **apply 函数**（入口——接收 `ctx` 注册能力，可返回清理函数随卸载回卷）；
- 可选的**技能目录**（纯声明载荷——零码装载）。

三种入口形态（解析序）：

1. **entry-file**：manifest 声明 `entry` 键 → 执行该文件；
2. **纯声明包**：`entry` 缺席且 `skills` 非空 → **零码装载**（包主入口不执行——技能清单是唯一载荷）；
3. **default-export**：缺省 → 执行包主入口的 default export。

## manifest

manifest 是包内声明面（键闭集，未知键**拒载**——拒绝式而非忽略式）：

| 键       | 形          | 说明                                                                                                        |
| -------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `id`     | string      | 插件 id；缺省取 package.json `name`。字符集：小写字母/数字/连字符，首字符非连字符；`core:` 前缀为官方件保留 |
| `label`  | string      | 展示名；缺省取 id                                                                                           |
| `entry`  | string      | 入口文件（相对包根）；缺席走解析序                                                                          |
| `grants` | object      | 授权申请面；单维 `writableRoots: string[]`                                                                  |
| `config` | JSON Schema | 配置形状（typebox 产物或等价 JSON Schema）；启用行 `config` 值同判据校验                                    |
| `api`    | object      | API 治理块（`minApiVersion` / `targetApiVersion` / `experimental`）                                         |
| `skills` | string[]    | 技能目录清单；非空即在场的唯一声明载荷                                                                      |

## apply 函数与 ctx

```ts
// entry 文件（或包主入口 default export）
export default async function apply(ctx, config) {
  // 注册能力……
  return () => {
    // 可选清理函数——卸载/装载失败回卷时执行
  };
}
```

装载时序：逐插件 apply（时钟帽 10s）；apply 期间 `ctx.provide` 落新服务、后续轮次自然解锁依赖方（Kahn 轮次排序）。apply 收口即关窗——此后该插件的注册动词仅宿主回调上下文内可用（装载窗口执法）。

### ctx 能力面

| 面           | 动词                                                                                 | 语义                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 服务目录     | `get(name)` / `tryGet(name)` / `provide(name, svc)`                                  | 取服务（缺席 fail-loud 附服务目录名单）/ 诚实缺席档 / 注册（撞名拒；跨插件可见——装载序依赖的事实源）                |
| 作用域       | `effect(register)`                                                                   | 可逆注册（LIFO 回卷；帽 10⁴）                                                                                       |
| 钩子         | `on(hookName, handler)`                                                              | fail-closed（词不在主表拒）；handler 包 5s 钟                                                                       |
| 活体事件     | `emit(name, data?)`                                                                  | 自域词 `${pluginId}/` 起头强制——全局词结构性不可达                                                                  |
| 工具         | `tools.register(def, opts?)`                                                         | 拒绝式撞名执法；返回 Disposer                                                                                       |
| 命令         | `channels.registerCommand(name, handler, description?)`                              | `/命令` 人面；后写胜出                                                                                              |
| 模型         | `llm.registerProvider(provider)`                                                     | provider 注册（后写胜出 upsert）                                                                                    |
| durable 词汇 | `events.registerSessionEventType(meta)`                                              | **不可逆**——进程生命周期词汇，无 disposer                                                                           |
| 跨会话订阅   | `events.subscribeSessionLifecycle(handler, opts?)`                                   | scope 三档 `self`/`tree`/`all`（all 走 `sessions.observe-cross` 门检 + 审计恰一笔）；装载窗注册即挂 effect 自动撤订 |
| 消息角色     | `agent.registerMessageRole(role, def)`                                               | 自定义消息角色（拒绝式）                                                                                            |
| 子代理       | `agent.registerSubagentProvider(def)`                                                | 程序化 named provider（撞名/词法两闸；注册即派生 `agent_<name>` 静态工具入 boot 全局层）                              |
| 提示词       | `prompts.registerSection(slot, builder, opts?)`                                      | 系统提示词段（slot 域前缀两段式执法）；`opts.volatile.reason` 声明会话内可变段——置请求尾不进缓存稳定区，缺省即承诺会话内稳定（漂移 warn 不拒） |
| 触发器       | `triggers.register(def)`                                                             | 事件触发起会（门检/撞名/格式三闸）                                                                                  |
| 凭证         | `secrets.get(name)` / `secrets.set(name, value)` / `secrets.registerOAuthFlow(spec)` | 自域隔离读 / 宿主回调窗内写（受理制）/ oauth 流注册（装载窗 only——详见[凭证节](#凭证ctxsecrets)）                   |
| UI 后端      | `channels.registerUiBackend(backend)`                                                | 自定义 UI 后端（拒绝式；`channels.ui-backend` 高危面开门制**前置**于撞名律——未开门连撞名检查都不可达）              |
| 自省         | `host`                                                                               | 宿主信息面（版本、装配、本插件 id）                                                                                 |

频率护栏：注册类动词 1000 次 / 滑动 1s 窗（越限 `PLUGIN_RATE_LIMITED`）。

### 工具定义（ctx.tools.register 入参）

```ts
{
  name: 'my_tool',                    // 全局唯一（拒绝式撞名）
  description: '给模型看的一句话用途',
  parameters: Type.Object({ ... }),    // JSON Schema（根须 object；typebox 产物或等价手写）
  effect: 'write',                     // 'read'（缺省）| 'write'——调度语义 + 审批触发
  repeatable: false,                   // 缺省 true；false = 禁静默重试（副作用型）
  timeoutMs: 30_000,                   // 缺省走管道 60s
  // owner：无需传——宿主注册受理壳无条件覆写为注册者 pluginId（自报值恒不达
  // 注册表，冒名结构性不存在）；归因随 tool/call 审计载荷写时带出
  async execute(args, toolCtx) {
    // 一切失败编码为 isError 结果返回（数据面）；抛错由管道兜底包装
    return { isError: false, content: [{ type: 'text', text: 'ok' }] };
  },
}
```

`effect: 'write'` 的工具在写前触发审批（ask → 用户 allow / deny / always——always 落 `allowlist.json` 持久回写）；审批缺席即 fail-closed。

### 凭证（ctx.secrets）

第三方服务凭证由宿主代管（加密存储，`core:credentials` 件承载）——插件**结构性不落明文**，三动词 + 一引用形：

- **读**：`ctx.secrets.get(name)` 返回明文值（in-process 同特权诚实成文）——**namespace 自域隔离缺省**：插件只见自域 `plugin:<你的 id>` 条目；跨域读走高危面 `credentials.read-cross`（默认关——用户显式开门 + 逐次审计；未开门拒 `CREDENTIALS_NAMESPACE_DENIED`）；
- **写（受理制）**：`ctx.secrets.set(name, value)` **只在宿主回调窗内可达**——即用户发起 oauth 授权流、宿主回调你的 handler 之时；窗外调用拒 `CREDENTIALS_WRITE_WINDOW_CLOSED`。静态凭证不归插件写：用户经 `/credentials add <name> <value> --namespace plugin:<你的 id>` 人面录入；
- **oauth 流**：`ctx.secrets.registerOAuthFlow(spec)`（装载窗 only——apply 期间声明注册）声明 device-code 端点；用户在 TUI 执行 `/credentials oauth <你的插件 id>` 发起，token 经流写回你的自域、刷新链由件内自持（三振标过期只通知不删）；
- **env 注入引用形**：`{ GITHUB_TOKEN: '@credentials:github-token' }` 形的 env 值（消费面 v1 = MCP/LSP server config 的 `env`）由宿主在 spawn 时刻展开——明文只进子进程环境，配置面/工具结果/日志恒只见 `@credentials:` 引用形原文。

错误码族：`CREDENTIALS_NOT_FOUND`（名缺席）/ `CREDENTIALS_NAMESPACE_DENIED`（越域未开门）/ `CREDENTIALS_WRITE_WINDOW_CLOSED`（窗外写）/ `CREDENTIALS_ENV_REF_INVALID`（引用形坏形）/ oauth 流三态 `CREDENTIALS_OAUTH_DENIED`（用户拒绝授权）/ `CREDENTIALS_OAUTH_EXPIRED`（device-code 过期）/ `CREDENTIALS_OAUTH_FLOW_FAILED`（端点传输/流编舞失败）。

### HTTP 路由（受限开放——`sdk-routes` 服务面）

插件可在宿主 HTTP 面注册**受限路由**（v1 绑定回环地址、不可自选）——先开门后可达：

```yaml
# enabled.yaml 你的插件行——高危面开门（默认全关）
- id: my-plugin
  opens: ['sdk.register-route']
```

```ts
// 入口模块：inject 声明（排序位——装载序依赖的事实源）
export const inject = ['sdk-routes'];

export default async function apply(ctx) {
  const routes = ctx.get('sdk-routes');
  const remove = routes.register({
    method: 'GET',
    path: '/status/:kind', // suffix——前缀恒由受理面施加
    auth: 'token', // 鉴权档（见下）
    bodyLimitBytes: 64 * 1024, // 可选——≤1MiB，缺席即 1MiB
    handler: async (req, res) => {
      // Node 原生 http 形（IncomingMessage/ServerResponse + 路由上下文第三参）
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
  });
  return () => remove(); // 摘除函数进清理面
}
```

约束面（受理序逐条执法）：最终路径恒 `/plugins/<你的 id><suffix>`（前缀受理面施加、域外不可达）；每插件路由数帽 16；鉴权档子集 `token` / `token-or-cookie` / `open{purpose}`（purpose ∈ `liveness` / `static-shell`——鉴权逃生档不开放插件道）；尾段 `*` 为域内 catch-all。拒码族 `SDK_ROUTE_PATH_RESERVED` / `SDK_ROUTE_AUTH_FORBIDDEN` / `SDK_ROUTE_BODY_LIMIT` / `SDK_ROUTE_LIMIT_REACHED`；未开门时 `sdk-routes` 服务面结构性缺席（`CONTEXT_SERVICE_MISSING`）。注册只在装载窗内（`/reload` 换代随代回收重放）。

### 跨会话操控（受限开放——`sessions-control` 服务面）

插件可向**其他会话**注入输入、打断在飞 run、撤回在队件（模型侧同能力走宿主内建 `session_send` / `session_interrupt` / `session_withdraw` 工具族——两面同一实现源、动词语义单源）——先开门后可达：

```yaml
# enabled.yaml 你的插件行——高危面开门（默认全关；操控全域无树内豁免）
- id: my-plugin
  opens: ['sessions.control-cross']
```

```ts
// 入口模块：inject 声明（排序位——装载序依赖的事实源）
export const inject = ['sessions-control'];

export default async function apply(ctx) {
  const control = ctx.get('sessions-control');
  // caller 无参数位——受理面恒按本插件身份铸归因 source `plugin:<你的 id>`
  //（伪造结构性不存在）；a2a 链深按插件道起跳 1 计
  const receipt = await control.send({
    targetSessionId: 'other-session',
    text: '跨会话指令',
    dedupeKey: 'job-42-step-3', // 可选幂等键——同键重复 send 返原回执不重复注入（键域按调用方分域；近期窗内存位不承诺跨进程）
  });
  // receipt.status ∈ 'delivered'（已投递）/ 'queued'（目标 busy 期 steer 入列，
  // 溢出时被丢件呈报不静默）/ 'dropped'（队列拒新）——发送方不选通道，
  // idle 起跑 / busy 合批 / 停摆落 inject 由目标会话驱动侧单源路由
  if (receipt.status === 'queued') {
    // 在队件可撤回（messageId = send 回执所铸 id）
    await control.withdraw({ targetSessionId: 'other-session', messageId: receipt.messageId });
    // 'withdrawn' = 已移除；'delivered' = 已出队 no-op 诚实回执（不虚构撤回成功）
  }
  // 打断只打断当前 run——回执含 stillQueued 在队操控件清单 + queuedCount 计数，
  // 调用方据此决定是否 withdraw 余件（在队件保留在下次 followUp 作种子续跑）
  await control.interrupt({ targetSessionId: 'other-session' });
}
```

受理序（逐动词执法）：send = 幽灵守卫 `SESSION_TARGET_NOT_FOUND` → 门检 `SESSION_CONTROL_DENIED` → a2a 链深帽 `SESSION_ROUND_LIMIT`（缺省 5）→ 乐观并发位 `expectedTurnId` 翻页拒 `SESSION_TURN_STALE` → 投递（目标未 open 即 resume 自动打开）；interrupt = 幽灵守卫 → 门检 → 无在飞拒 `SESSION_INACTIVE`（响亮拒不静默 no-op）；withdraw 同前两闸。

## import 白名单（插件可 import 什么）

三道白名单（越出即拒载）：

1. `node:` 内建模块；
2. **虚拟面六键闭集**：`berry-agent`、`berry-agent/llm`、`berry-agent/sqlite`、`typebox`、`typebox/value`、`typebox/compile`——装载器注入的同实例模块，永不落 node_modules 解析；
3. 插件目录树内自带 node_modules 的第三方依赖。

`berry-agent` 主键注入**宿主契约公开面**（工具定义 `ToolDefinition`、事件词汇、错误基类 `BaseError`、消息/审批/LLM 共享类型——插件作者的主要类型面）；`typebox` 三键注入与宿主同实例的校验库（工具参数 Schema 用它写最顺）。`berry-agent/llm` 与 `berry-agent/sqlite` 两子键为保留位（模型层与数据库窄面随后续版本接入）。

## 启用与配置

启用清单 `~/.berry-agent/enabled.yaml`（缺席 = 全 `core:` 内置态；损坏 = fail-loud 拒启并给修复指引）：

```yaml
plugins:
  - id: my-plugin # 必填
    config: { ... } # 可选——按 manifest config 判据校验（整值替换非合并）
    disabled: true # 可选——行级禁用
    opens: [...] # 可选——高危面开门授予集（默认全关；进程级开门另走顶层 doors 段 / TUI /doors open——两源任一含即门开）
```

用户行与 `core:` 同名行字段级后写胜出（可覆盖官方件 config 或禁用单件）。

## 错误码（插件域 `PLUGIN_` 前缀）

| 码                               | 语义                                                   |
| -------------------------------- | ------------------------------------------------------ |
| `PLUGIN_SHAPE_INVALID`           | 清单形状/字符集/未知键/install 拒不合规                |
| `PLUGIN_IMPORT_FORBIDDEN`        | import 越出三道白名单                                  |
| `PLUGIN_APPLY_FAILED`            | apply 抛错或超 10s 时钟帽（错误归一）                  |
| `PLUGIN_RATE_LIMITED`            | 注册动词越频率护栏                                     |
| `PLUGIN_WINDOW_CLOSED`           | 装载窗口关窗后注册（宿主回调上下文内例外）             |
| `PLUGIN_CONFIG_INVALID`          | 启用行 config 值不符 manifest 判据                     |
| `PLUGIN_LOAD_FAILED`             | 装载失败（跳过/降级/拒启三档分立处置）                 |
| `PLUGIN_HOOK_UNKNOWN`            | `ctx.on` 钩名不在主表（fail-closed 拒）                |
| `PLUGIN_EVENT_TYPE_CONFLICT`     | 自定义事件类型撞 LIVE 词表既有词（核心词/域名式/在册） |
| `PLUGIN_PROMPT_SLOT_INVALID`     | 提示词段 slot 非本插件域两段式                         |
| `PLUGIN_PROMPT_SECTION_CONFLICT` | 同 slot 提示词段重复注册（两段同位即拒）               |
| `PLUGIN_CAPABILITY_DOOR_CLOSED`  | 高危面未开门即用（默认全关——见各受限开放节）           |

全册错误码总目录见规范 02 §5.3（注册表单源）；装机域 `PLUGIN_INSTALL_FAILED` / `PLUGIN_UNINSTALL_REFUSED` 见 [usage.md](usage.md#plugins-插件管理)。

错误全仓单基类 `BaseError`（`{ code, message, cause? }`）——catch 一律按 code 分派。

## 发布

```json
{
  "name": "my-berry-plugin",
  "keywords": ["berry-agent-plugin"]
}
```

`berry-agent-plugin` keyword 是 npm 生态发现键——按此键检索即得插件生态全集。发布常规 npm 包即可；用户侧装机动词全在场：`berry-agent plugins install npm:<包名>`（npm 源含钉版安装 + `--omit=dev` + min-release-age 供应链护栏；另有 `git:<url>[#<ref>]` 与 `local:<路径>` 两源形，ref 词法详见 [usage.md](usage.md#plugins-插件管理)）或 TUI 内 `/plugins install`。装机写入账本与启用行，成功尾提示重载（TUI 面自动链 `/reload`，CLI 面下次启动生效）。

## 最小完整示例

```ts
// my-plugin/index.ts
import type { ToolDefinition } from 'berry-agent'; // 宿主契约公开面（虚拟主键注入）

export default async function apply(ctx, config) {
  // ctx 能力面见上表；此处以结构类型消费（类型面随后续版本随虚拟面扩充）
  const disposeTool = ctx.tools.register({
    name: 'echo_twice',
    description: '把输入重复两遍返回',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    effect: 'read',
    async execute(args) {
      const text = String((args as { text: string }).text);
      return { isError: false, content: [{ type: 'text', text: `${text}${text}` }] };
    },
  } satisfies ToolDefinition);

  const disposeCommand = ctx.channels.registerCommand(
    'twice',
    (input: string) => {
      return `命令收到：${input}`;
    },
    '重复两遍示例命令',
  );

  return () => {
    disposeTool();
    disposeCommand();
  };
}
```

## 下一步

- [开发指南](./development.md)——本仓开发约定与门禁；
- [运维手册](./operations.md)——enabled.yaml 运维与插件故障排查。
