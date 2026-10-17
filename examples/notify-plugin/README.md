# notify 范式件——run 收口单向推送（SMTP / Telegram）

无人值守「**跑完主动找人**」的第一块自证：订阅 session/lifecycle 活体事件，
任一会话的 run **收口**（`run-settled`）时把终态推到人面通道——run 起拍
不打扰、只报收口。双后端并发投递（SMTP 邮件 / Telegram Bot 消息），任一
后端失败逐后端降级（warn 不抛、不阻主线不定崩宿主）。

本件同时是 **R3 门禁机制（grants.nodeBuiltins 两级档）的首个真实消费者**
（狗粮定位）——见下文「R3 狗粮定位」。

## 试跑（零装机）

```bash
berry --plugin-file ./examples/notify-plugin
```

`--plugin-file` 为纯内存注入（装载计划 `_quick_test` 行，退出即消失）；
**试件形动作即授予**——试跑下 `node:tls` / `node:net` 生效集 = 清单声明
全集，零开门即可装载（正式装机才须开门，见下）。试跑下没有真实 SMTP /
Telegram 配置时，装载期即见逐后端缺配置 warn（降级语义自证）。

## 装机（两形）

```bash
# 形一：本地路径直装
berry plugins install local:$(pwd)/examples/notify-plugin

# 形二：经本仓库自带本地市场源（examples/.claude-plugin/marketplace.json）
berry marketplace add ./examples
berry marketplace install notify-plugin@berry-agent-examples
```

装机 id = 本件 package.json 名 `berry-agent-example-notify`；两形都只装不
启，启用走 `berry plugins mount berry-agent-example-notify`。

## 开门义务清单（装机后、mount 前）

本件消费两枚门——都在启用清单 `~/.berry-agent/enabled.yaml` 的本件行
`opens` 里开（默认全关；开门路两门分立：`sessions.observe-cross` 进程级
另可走顶层 `doors` 段 / TUI `/doors open` 两源任一含即门开，而
`grants.node-builtins` 系插件道独面——**只行 `opens` 一源**，doors 段值域
不含此门、`/doors open` 会遭值域拒；试件形 `--plugin-file` 动作即授予除外）：

```yaml
plugins:
  - id: berry-agent-example-notify
    opens: ['grants.node-builtins', 'sessions.observe-cross']
    config:
      backend: both # 可选——配置见下节
```

- **`grants.node-builtins`**（R3 第七枚——node: 内建受门档）：本件 SMTP
  真腿 import `node:tls` / `node:net`（清单 `grants.nodeBuiltins` 恰两枚
  声明）。未开门的失败形 = 装载期 `PLUGIN_NODE_BUILTIN_FORBIDDEN` 拒载
  （行级隔离，不牵连其他件）；生效集 = **清单声明 ∩ 用户开门** 两方交集。
- **`sessions.observe-cross`**（高危面——跨树观测）：本件订阅 scope 取
  `'all'`（全会话终态拍），须此门。未开门的失败形 = 激活期
  `subscribeSessionLifecycle` fail-loud 拒（装载失败同不牵连他件）。

开门后 TUI `/reload`（或重启）即修复装载。受理成功另有 `capability/used`
一次性审计（开门制既有面，非本件私有逻辑）。

## 凭证两枚（token / 密码不入 config 不入日志）

SMTP 密码与 Telegram Bot token 走凭证盒（插件自域 `plugin:<本件 id>`）：

```bash
berry credentials add smtp-password '<SMTP 密码>' --namespace plugin:berry-agent-example-notify
berry credentials add telegram-bot-token '<Bot token>' --namespace plugin:berry-agent-example-notify
```

- 值只经 `ctx.get('secrets').get(<名>)` 自域现读（轮换友好）；缺席时该次
  推送逐后端 warn 跳过（指路本节录入命令）；
- SMTP 匿名投递形：不录 `smtp-password` 且 config 不填 `smtp-username`
  即不发 AUTH（此时零凭证可用）。

## 配置示例（enabled.yaml 行级 config）

```yaml
config:
  backend: both # both | smtp | telegram
  smtp-host: smtp.example.com
  smtp-port: '465' # 缺省 465；STARTTLS 档常配 587
  smtp-from: agent@example.com
  smtp-to: owner@example.com
  smtp-username: agent@example.com # 缺席 = 不发 AUTH（匿名投递）
  smtp-starttls: false # false = 隐式 TLS 直连（465 常形）；true = 明文连入后升级（587 常形）
  telegram-chat-id: '424242'
```

**扁平键形说明**：configSchema 键名受 `^[a-z][a-z0-9-]*$` 闭集（无点无
斜杠），组前缀靠 `smtp-` / `telegram-` 命名区分；端口无 number 字型（v1
闭集 text/secret/select/boolean），以 text 声明、投递期解析。缺后端关键
配置 = 该后端装载期 warn + 跳过（另一后端不受牵连）；坏值同律降级不崩装载。

## SMTP 两档传输形

- `smtp-starttls: false`（缺省）= **隐式 TLS** 直连：`node:tls.connect`
  起手即握手（465 常形）；
- `smtp-starttls: true` = **STARTTLS**：`node:net.connect` 明文连入 →
  EHLO → STARTTLS 升级握手（证书校验缺省开）→ TLS 内再 EHLO（587 常形）。

会话式：问候(220) → EHLO → [STARTTLS + EHLO] → [AUTH PLAIN] →
MAIL/RCPT → DATA(354) → 终点号(250) → QUIT(221)；DATA 段行尾归一 +
RFC 5321 点填充；单连接 15s 整体超时（悬挂连接不留面）。零第三方依赖
（不引 nodemailer——`inject` 空数组）。

## 降级语义（fire-and-forget 同 core:mcp 惯用形）

推送是**尽力通知不是账务**：任一后端任一环失败（凭证缺席 / 网络故障 /
非 2xx 应答）→ `ctx.ui.notify(..., { level: 'warn' })` 逐后端一条 warn，
本轮跳过、不重试不排队、绝不抛出阻主线。凭证与 token 永不进失败报文。

## R3 狗粮定位（首个真实消费者）

R3（node: 内建分级门禁）此前只有机制自证无真实消费者——本件以
`node:tls` / `node:net` 两受门内建的真实诉求，从插件侧走完「清单声明 →
用户开门 → 生效集交集 → 受理审计」全链。**定性铁律（规范原文转述）：
该门禁是防误用 + 审计面，不是反恶意边界**——不得宣传为安全增强或沙箱；
对照面：Telegram 真腿走 `global fetch`（globals 面不定级、非门禁射程），
同件内两腿分野即「tls 受门 vs fetch 非门」的活教材。

## v1 有意边界（如实注记）

- **不做**去重 / 节流 / 重试 / 排队（每收口拍即推，失败即丢，warn 可诊）；
- scope 固定 `'all'` 不滤会话、**不滤终态**（completed / aborted / failed /
  终态缺席〔崩溃路径〕四形都推——缺席形如实报「终态缺席」不虚构终值）；
- SMTP 认证仅 AUTH PLAIN（无 LOGIN/OAUTH）；无附件 / HTML / 多收件人；
- 单进程内每收口拍每后端恰一次投递（无并发合并）。

## 测试

```bash
node examples/notify-plugin/test/lifecycle.test.ts
```

自持形（零宿主 devDep、零真网络）：四锚——导出面形状（含发送缝两槽）/
激活语义（注册恰一 + scope 定谳 + 回卷 disposer）/ run-settled 文案组形
（终态在场 / 缺席两形）/ 双后端假发送器注入 + 失败降级。**发送缝**
`__senders`（named export）是唯一测试替身位——SMTP 真腿与 Telegram
fetch 真腿在测试全程零触达；node 直跑 / vitest / node:test 均可（宿主
vitest 不收录 examples/**——模板文件不在宿主门禁内执行，本测试同样以
node 直跑为准）。
