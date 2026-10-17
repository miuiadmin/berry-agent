# telegram-channel 范式件——Telegram 双向渠道（/start 起会 + 终态推回 + 短指令审批）

无人值守「**在 IM 里发起、在 IM 里收口**」的第一条真实外延：TG 消息
`/start <提示>` 起无头会话并绑定 chat ↔ 会话；run 终态推回本 chat；期间
run 卡审批时推送摘要，人回短指令「批准」/「拒绝」收口。恰四指令（v1 射程
——全对话转投等于把 TG 变第二 TUI，拍板档维持界外）。

本件是 **IM 域第一条真实双向渠道**（狗粮定位：跑完不止找人，还能在 IM 里
答话），并承担长期公开样例义务——首个 `dist-tag=latest` 后第三方作者写
自己的渠道件时的对照样板（对照 notify 单向件：本件多入向触发 + 审批往返
两块新工面）。

## 试跑（零装机）

```bash
berry --plugin-file ./examples/telegram-channel
```

`--plugin-file` 为纯内存注入（装载计划 `_quick_test` 行，退出即消失）；
**试件形动作即授予**——试跑下 `node:https` 生效集 = 清单声明全集，零开门
即可装载（正式装机才须开门，见下）。试跑下没有录入 token 时，装载期即见
缺凭证 warn（降级语义自证——收发循环不起）。

## 装机（两形）

```bash
# 形一：本地路径直装
berry plugins install local:$(pwd)/examples/telegram-channel

# 形二：经本仓库自带本地市场源（examples/.claude-plugin/marketplace.json）
berry marketplace add ./examples
berry marketplace install telegram-channel@berry-agent-examples
```

装机 id = 本件 package.json 名 `berry-agent-example-telegram-channel`；两形
都只装不启，启用走 `berry plugins mount berry-agent-example-telegram-channel`。

## 开门义务清单（装机后、mount 前）

本件消费三门 + 一条零开门注记（恰四项）——前三项在启用清单
`~/.berry-agent/enabled.yaml` 的本件行 `opens` 里开（默认全关；开门路两门
分立：`channels.ui-backend` / `triggers.start-run` 进程级另可走顶层 `doors`
段 / TUI `/doors open` 两源任一含即门开，而 `grants.node-builtins` 系插件
道独面——**只行 `opens` 一源**；试件形 `--plugin-file` 动作即授予除外）：

```yaml
plugins:
  - id: berry-agent-example-telegram-channel
    opens: ['channels.ui-backend', 'triggers.start-run', 'grants.node-builtins']
    config:
      bindings: # 可选——静态绑定（见「绑定态」节）
        - chat: '424242'
          session: 'sess-已有会话id'
```

- **`channels.ui-backend`**（渠道门）：本件注册 TG 界面后端（终态推回 +
  审批往返 + 宿主 notify 扇出直推都挂在这张注册面上）。未开门的失败形 =
  激活期 `ctx.channels.registerUiBackend` fail-loud 拒（装载失败行级隔离，
  不牵连其他件）。
- **`triggers.start-run`**（无头会话门）：`/start` 指令起无头会话经触发器
  starter（受理先过帽再起会、永不 throw——拒与失败 warn 可诊）。未开门的
  失败形 = 激活期 `ctx.triggers.register` fail-loud 拒。
- **`grants.node-builtins`**（R3 第七枚——node: 内建受门档）：本件收发两腿
  （getUpdates 长轮询 + sendMessage）全部手写 `node:https` 最小客户端（清单
  `grants.nodeBuiltins` 恰一枚声明）。未开门的失败形 = 装载期
  `PLUGIN_NODE_BUILTIN_FORBIDDEN` 拒载（行级隔离）。定性铁律：该门禁是防
  误用 + 审计面，不是反恶意边界。
- **终态观测零开门注记**（第四项）：run 终态推回**不消费任何开门**——观测
  走界面后端的 `onEnvelope` 信封回调面（通道核把一切会话的事件扇给在册
  后端，本件按绑定 Map 窄滤 `agent_end`）。设计原案「fire 回执后动态
  `subscribeSessionLifecycle` scope 'self'」撞装载窗关闭律（apply 收口即
  关窗，后置订阅结构性 `PLUGIN_WINDOW_CLOSED`）——self 档虽零开门但路径
  不通，信封回调面语义等价（终态推回后释放动态绑定即「推完即撤」），且
  零额外门。

开门后 TUI `/reload`（或重启）即修复装载。受理成功另有 `capability/used`
一次性审计（开门制既有面，非本件私有逻辑）。

## 凭证一枚（token 不入 config 不入日志）

Telegram Bot token 走凭证盒（插件自域 `plugin:<本件 id>`）：

```bash
berry credentials add telegram-bot-token '<Bot token>' --namespace plugin:berry-agent-example-telegram-channel
```

- 值经 `ctx.get('secrets').get('telegram-bot-token')` 自域**现读**（轮换友好
  ——每轮长轮询 / 每次投递前现读，中途录入新 token 即生效）；token 只进
  URL 构造位，一切失败报文重铸不带 token 不带 URL；
- 缺席时装载期 warn + **收发循环不起**；本后端**整体退位为证词票**——
  `hasAudience` 返 false、`askApproval` 即决 `'unavailable'` 零推送（见
  「降级语义」节）。降级不崩装载（后端注册面照常）；中途录入 token 须
  `/reload` 重算（运行能力是装载时点一次探测）。

## 绑定态（v1 语义——纯内存）

chat ↔ 会话映射两源：

- **静态绑定**（config `bindings` 数组，boot 载入）：`[{ chat, session }]`
  ——把已有会话（如主 TUI 会话）的终态/审批接到指定 chat。重启后由 config
  重建。坏值条目激活期 warn 跳过（降级不崩装载）。**注**：v1 configSchema
  字型是扁平闭集（text/secret/select/boolean）表达不了对象数组——本键
  不进 configSchema，由本件行级宽校验（上面 yaml 例即完整形）。
- **动态绑定**（`/start` 即绑）：起会回执 `sessionId` 直接入账（触发器回执
  锚 `{ sessionId }` 的第一消费者——免「枚举会话反猜对号」三跳绕行）。
  **纯内存、重启即失**：重启后旧 chat 不再绑定，TG 侧发 `/status` 会如实
  报未绑定——重新 `/start` 即可（新起会话，不是恢复旧会话）。

终态推回后**动态绑定即释放**（一次起会一程绑定）；静态绑定是 config 声明
的常驻意图，终态推回不释放。同 chat 重复 `/start` = 换绑到新会话。

## 四指令用法（恰四——v1 射程）

| 指令            | 行为                                                          |
| --------------- | ------------------------------------------------------------- |
| `/start <提示>` | 经触发器 starter 起无头会话（prompt 即首条输入）并绑定本 chat |
| `/status`       | 查当前绑定 + 本 chat 挂起审批                                 |
| `批准`          | 答本 chat 当前挂起审批（resolve `approve`）                   |
| `拒绝`          | 答本 chat 当前挂起审批（resolve `reject`）                    |

其余消息忽略（不回话不转投——把 TG 变第二 TUI 在 v1 射程外）。`/start`
收严格：群形 `/start@<bot名> <提示>` 剥地址段取提示（bot 名不混入
prompt）；`/startxyz` 命令词粘连形不认领（忽略）。

## 审批往返语义

run 卡审批时宿主把摘要扇给本后端（`askApproval`）：

- 无绑定的会话 → 本后端投 `'unavailable'`（多后端竞速的**证词票**非裁决票
  ——全后端皆无人时宿主才整体降级 unavailable）；
- 绑定 chat 收到摘要（`summary` 在场用之；缺席防御形从 reason/工具名组——
  不虚构）+ 回复指引；
- **per-chat 单飞让位**：新审批到达即旧挂起以 `'unavailable'` 收口（旧摘要
  已被顶替——诚实证词非裁决）；
- 人回「批准」/「拒绝」→ `'approve'`/`'reject'`（裁决票，先答先得归宿主
  竞速核）；
- 宿主撤销（`opts.signal` abort）→ `'cancel'`（宿主侧静默丢弃迟到腿——
  无害）。

宿主 `notify` 扇出（`ctx.ui.notify` 的通知）也直推一切已绑定 chat（v1 全档
直推不筛 level——零绑定零推）。

## 降级语义

推送是**尽力通知不是账务**：投递失败（凭证缺席 / 网络故障 / 非 2xx 应答）
→ `ctx.ui.notify(..., { level: 'warn' })` 一条 warn，本轮跳过不重试不排队、
绝不抛出阻主线。唯一例外：宿主 notify 扇出腿的投递失败**静默吞**（该腿若
失败再 warn 会扇出回本后端成无界回环——结构止环位）。收发循环故障走指数
退避（1s 起步、60s 封顶）重试，每退避一条 warn 可诊。

**零 token 装载形**（降级态）：收发循环不起之外，`askApproval` **即决
`'unavailable'`**（证词票——不挂起）且 `hasAudience` 返 false——多后端
竞速下其他后端照常作答；本件为唯一可答后端时宿主整体 fail-closed 收口
（挂着永不退位即毒化竞速，永挂是修前洞）。中途录入 token 后须 `/reload`
重算（运行能力是装载时点一次探测）。

## v1 有意边界（如实注记）

- 恰四指令：无对话转投、无回看、无 `/stop`（远程停会话走宿主会话管理面）；
- 长轮询游标纯内存（重启从 0 重放 TG 留存的未确认更新——TG 侧 24h 窗口）；
- 动态绑定重启即失（不做绑定态落盘——本件零文件写入，无 writableRoots 诉求）；
- 只认 `message.text` 形更新（channel_post / edited_message / 回调钮等忽略）；
- 宿主 notify 扇出全档直推不筛 level；
- 无去重 / 节流 / 排队（每事件即推，失败即丢，warn 可诊）。

## 测试

```bash
npx vitest run examples/telegram-channel/test/lifecycle.test.ts
```

本件测试是 **examples 域首个 vitest 收录件**（notify 件维持 node 直跑自持
形）：它装配**真宿主契约面**（真 createPluginContext 门检 + 真 TriggerRegistry
三闸 + 真触发器回执），拷走即失真，故逐件点名进宿主 node 轨（不开
`examples/**` 通配——会误收 notify 的顶层断言形）。收发缝 `__tg`（named
export）是唯一网络替身位——poll / send 两槽注入期间真腿零触达，全程零真
网络。
