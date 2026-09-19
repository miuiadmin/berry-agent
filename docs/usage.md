# 使用指南

本文自包含覆盖 berry-agent 的安装、入口命令族、TUI 操作与环境变量。架构背景见[架构总览](./architecture.md)。

> 状态：`0.1.0-alpha.4`（开发版）。命令族动词已全数装配（升级维护动词 `upgrade` 亦于本版三态接线——CLI 命令表）——不含糊、不静默。已上 npm——当前版本与 dist-tag 见 registry，安装三路皆即时可用。

## 安装

要求 Node.js ≥ 24。三路任选。

**路一：安装脚本（推荐新用户）**——两段式，先落盘再执行：

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/install.sh
sh install.sh
```

> 不要写成 `curl … | sh` 管道直灌：连接中段断裂时 shell 会执行半截脚本。
> 脚本依次做：Node ≥ 24 检查 → `npm install -g berry-agent` → 安装验证（`berry --version` 优先、旧命令名 `berry-agent --version` 回落） → 欢迎横幅；失败时给出排查建议（权限 / 网络）。
>
> 从 alpha.1 升级的用户：bin 已换代为 `berry`——净切、不留双名别名；npm 升级会把旧链 `berry-agent` 自动重链为 `berry`，旧命令名随之失效，脚本请改用 `berry`。

**路二：npm 直接安装**：

```bash
npm install -g berry-agent
```

**路三：源码构建**：

```bash
git clone https://github.com/miuiadmin/berry-agent.git
cd berry-agent
npm install
npm run build
node dist/host/main.js --help
```

首次启动自动创建数据目录 `~/.berry-agent/`（可用 `BERRY_AGENT_DATA_DIR` 重定位）。

## 卸载

程序与数据分账卸载：

```bash
npm rm -g berry-agent        # 程序（源码形态删除 clone 目录即可）
rm -rf ~/.berry-agent/       # 数据目录——含记忆/会话历史/插件装机物，删除不可恢复
```

数据目录不会随程序卸载删除——内含记忆/会话历史/凭证盒（加密存储 + `secret.key` 加密钥，两者同在才可解密）/插件装机物；如需保留记忆，删除前请先在 TUI 内执行 `/memory-export` 导出。交互式卸载（带确认与指引）可用卸载脚本：

```bash
curl -fsSL -o uninstall.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/uninstall.sh
sh uninstall.sh
```

## 模型配置

缺省模型 `anthropic/claude-sonnet-5`（凭证按 provider 生态变量供给）。

```bash
export ANTHROPIC_API_KEY=sk-...   # 凭证按 provider 生态变量供给
export BERRY_AGENT_MODEL=anthropic/claude-opus-5   # 或覆盖任意已注册 provider/model
```

## 入口命令族

```
berry [命令] [旗标]
```

| 命令                | 作用                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| （无参）            | TUI 主入口：直进对话                                                                                                                                                                                                                                                                                                                                         |
| `run "<message>"`   | 单次执行：一轮对话 → stdout 输出结果                                                                                                                                                                                                                                                                                                                         |
| `serve`             | 常驻宿主（stdio JSONL；另有 `serve status` / `serve stop` 管理动词）                                                                                                                                                                                                                                                                                         |
| `mcp`               | MCP server 包装形态                                                                                                                                                                                                                                                                                                                                          |
| `dump-config`       | 打印实际生效装配（诊断）                                                                                                                                                                                                                                                                                                                                     |
| `plugins <sub>`     | 插件生命周期八动词全在场：`list` / `check` 只读（`check` = 装机体检三色面：绿 = 兼容通过、红 = 版本断裂/悬空装机/坏清单/坏账本〔退出码轴——任红退 1〕、legacy = api 块未声明不计断裂、黄 = 用废弃遥测〔空集无行〕），`install` / `uninstall` / `mount` / `unmount` / `toggle` / `update` 写侧（npm 源含钉版安装 + `--omit=dev` + min-release-age 供应链护栏） |
| `marketplace <sub>` | 插件市场：`add` / `remove` / `update` / `list` / `discover` / `install` / `uninstall` / `upgrade`（装机寻址形 `name@市场名`；明细见下文「marketplace 市场聚合」节）                                                                                                                                                                                          |
| `sessions <sub>`    | 会话管理：`list` / `resume <id>` / `fork <id>` / `search <query>` / `export <id>` / `reindex`                                                                                                                                                                                                                                                                |
| `credentials <sub>` | 凭证管理：`add <name> <value>` / `list` / `rm <name>`（`--namespace <ns>` 指定域；oauth 授权流仅在 TUI `/credentials`）                                                                                                                                                                                                                                      |
| `doors <sub>`       | 开门制门态只读：`list`（开/关编辑走 TUI `/doors open\|close`）                                                                                                                                                                                                                                                                                               |
| `upgrade`           | 升级维护动词：npm 全局形查 registry dist-tags，有新版即代执行 `npm i -g berry-agent@<latest>` 并提示重启生效（v1 不热换）；pnpm / yarn / bun / 源码形只打对应管理器指引不代执行；远端 `latest` 非 semver 白名单形诚实拒（registry 响应不可信——不达 spawn 插值位）                                                                                            |

退出码三态：**0** 成功（含诚实空——空清单/零命中非失败）/ **1** 执行失败 / **2** 环境态误用（用法错、TUI 在非交互环境）。

通用旗标：`--help` / `--version` 各入口收（`--help` 短路排在子命令自身校验之后——如 `run` 缺 message 时 `--help` 先吃用法错退 2，`serve --help` 则正常打帮助退 0）；`--debug`（日志提级）主入口族收（无参 TUI / `run` / `serve` / `dump-config`）——子命令族（plugins/marketplace/sessions/credentials/doors/mcp）不设此旗标，传入即用法错退 2；例外：`upgrade` 亦收 `--debug`（07 §8.5 第 1 条三态已装配——2026-09-19 启动版本检查批）。`--port <n>` TUI / run / serve / dump-config 收（dump-config 忽略不起监听）；`--no-plugins` 安全模式不入自动化入口 serve / mcp；`--plugin-file <path>` 快速试件（插件目录或单文件入口 `.js`/`.mjs`/`.ts`——纯内存注入试件行，退出即消失零落盘；TUI / run 收，`dump-config` 互斥拒）。

### 命令名与包名

npm 包名是 `berry-agent`（`npm install -g berry-agent`），装出来的命令是 **`berry`**——`npx berry-agent` 同样可跑（npx 对单 bin 包自动执行）。

源码形态（npm 全局安装之前）可设别名指向构建产物：

```bash
alias berry='node /path/to/berry-agent/dist/host/main.js'
```

### TUI（无参启动）

无参启动按当前目录取最新会话——有则续接、无则新建。入口旗标：`--port <n>`（开统一 HTTP 面——Web 界面与程序调用族同面）、`--no-plugins`（安全模式）、`--debug`、`--plugin-file <path>`（快速试件——插件免装机试跑，见[插件开发指南](./plugin-development.md#快速试跑--plugin-file零装机)）。

键位册（29 个动作按域分组——`/help` 键位册同源呈现；动作 id 用于下文「用户设置」的键位覆盖）：

| 域     | 键位                                 | 动作 id                       | 说明                           |
| ------ | ------------------------------------ | ----------------------------- | ------------------------------ |
| 全局   | `ctrl+c`                             | `global.interrupt`            | 中断当前 run（不可覆盖）       |
| 全局   | `ctrl+d`                             | `global.quit`                 | 退出（空框时）（不可覆盖）     |
| 全局   | `ctrl+p`                             | `global.model-cycle`          | 切换模型（下一 run 生效）      |
| 思考块 | `ctrl+t`                             | `thinking.toggle`             | 思考块折叠/展开                |
| 工具卡 | `ctrl+o`                             | `tools.toggle-expand`         | 工具卡展开/收起                |
| 编辑器 | `enter`                              | `editor.submit`               | 提交输入                       |
| 编辑器 | `alt+enter`                          | `editor.queue-followup`       | 提交并排队候跑                 |
| 编辑器 | `shift+enter` / `ctrl+j`             | `editor.new-line`             | 换行                           |
| 编辑器 | `ctrl+-` / `ctrl+_`                  | `editor.undo`                 | 撤销                           |
| 编辑器 | `left` / `ctrl+b`                    | `editor.move-left`            | 光标左移                       |
| 编辑器 | `right` / `ctrl+f`                   | `editor.move-right`           | 光标右移                       |
| 编辑器 | `alt+left` / `ctrl+left` / `alt+b`   | `editor.move-word-left`       | 左移一词                       |
| 编辑器 | `alt+right` / `ctrl+right` / `alt+f` | `editor.move-word-right`      | 右移一词                       |
| 编辑器 | `home` / `ctrl+a`                    | `editor.line-start`           | 行首                           |
| 编辑器 | `end` / `ctrl+e`                     | `editor.line-end`             | 行尾                           |
| 编辑器 | `ctrl+]`                             | `editor.jump-forward`         | 跳至下一空行                   |
| 编辑器 | `ctrl+alt+]`                         | `editor.jump-backward`        | 跳至上一空行                   |
| 编辑器 | `pageup`                             | `editor.page-up`              | 编辑器上翻页                   |
| 编辑器 | `pagedown`                           | `editor.page-down`            | 编辑器下翻页                   |
| 编辑器 | `backspace`                          | `editor.delete-backward`      | 向前删字符                     |
| 编辑器 | `delete` / `ctrl+d`                  | `editor.delete-forward`       | 向后删字符                     |
| 编辑器 | `ctrl+w` / `alt+backspace`           | `editor.delete-word-backward` | 向前删一词（被删段入 kill 环） |
| 编辑器 | `alt+d` / `alt+delete`               | `editor.delete-word-forward`  | 向后删一词                     |
| 编辑器 | `ctrl+u`                             | `editor.delete-to-line-start` | 删至行首（被删段入 kill 环）   |
| 编辑器 | `ctrl+k`                             | `editor.delete-to-line-end`   | 删至行尾（被删段入 kill 环）   |
| 编辑器 | `ctrl+y`                             | `editor.yank`                 | 粘贴最近 kill 段               |
| 编辑器 | `alt+y`                              | `editor.yank-pop`             | 环游标步进替换（kill 环）      |
| 编辑器 | `up`                                 | `editor.history-prev`         | 上一条历史                     |
| 编辑器 | `down`                               | `editor.history-next`         | 下一条历史                     |

全局两条（中断/退出）是会话生命线**不可覆盖**；其余动作均可经 `settings.json` 的 `keybindings` 键覆盖（见下文「用户设置」）。`ctrl+c` 中断在飞 run——挂起的审批/问询随之中止（撤销说明行落正文流）。`ctrl+d` 双绑（空框 = 退出 / 非空 = 向后删字）是缺省既定的分层消解形。`ctrl+p` 模型循环——切换即时登记、**下一 run 起跑生效**（在飞 run 不中途换模型），footer 模型段随切刷新；会话级旋钮不写盘，重启回 env/缺省模型位。`alt+enter` 候跑提交——在飞 run 期不等待不打断：显式排队候当前 run 终态后作种子新起 run（`enter` 在 busy 期的顶注缺省不动——两键分职：`enter` 顶注 / `alt+enter` 候跑；idle 期同普通提交），排队成功回执一行。词删/行删三键（`ctrl+w`、`ctrl+u`、`ctrl+k`）的被删段入 kill 环，`ctrl+y` 取回最近一段、`alt+y` 环游标步进替换。`meta`（macOS cmd）族键不占用——键串文法不含 meta，留给终端与系统快捷键。

触发前缀与鼠标（非键位册动作）：

| 键   | 作用                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| `@`  | 文件路径补全（工作区根锚定；`@"带空格 路径"` 引号形；子序列模糊过滤同律）                                         |
| `/`  | 命令补全（注册命令表——子序列模糊过滤〔大小写不敏感、前缀命中置顶〕；四命令子动词与深位枚举随位补全）              |
| 鼠标 | 副屏（十三内建面板）滚轮滚动；`/history` 另有左键拖选复制（OSC 52——终端支持时直达剪贴板）；主对话面 v1 不消费鼠标 |

状态行（底部 footer）分栏呈现：左段常驻信息 `cwd 短名 · 模型名 · 会话短 id`（段缺席缩位不虚报、超宽整字截断），右段运行态（转轮 / 实时工具名 / 用量累计——插件 `setStatus` 写入同段）。cwd 段在 git 仓库内时附**短支名后缀**（直读 `.git/HEAD` 取支名——detached HEAD 与非 git 目录缺席不显占位；不轮询，checkout 后随切焦或重画收敛）。

TUI 内建命令（随插件装载动态扩展）：`/plugins`（插件管理 TUI 面——`list` 装载态三分区 / `mount <id>`·`unmount <id>`·`toggle <id>` 行编辑 / `config <id>` 配置表单〔configSchema 逐字段问答——secret 入凭证盒不落 yaml〕；写动词成功尾自动链重载；市场选装形走 `/marketplace` 副屏或 CLI `berry marketplace <sub>`，ref 形 install/uninstall/update 维持 CLI `berry plugins <sub>`）、`/reload`（热重载——会话运行中自动排队、run 收场后执行；回执含新代工具面 diff）、`/danger`（危险工具闸人面——`approve [ttlDays]` 签发 consent / `status` 运维呈单）、`/doors`（开门制人面——`list` 高危面门态清单〔闭门附同源 reason〕/ `open <capability>`、`close <capability>` 进程级门段编辑；授予双源 = 插件行 `opens` 位 + `doors` 段，任一含即门开——CLI 侧另有 `berry doors list` 只读形）、`/approval`（审批分档人面——`status` 当前 sandbox 档与审批 policy〔值 + 四层来源〕/ `entries` 工具策略表活体全列 / `explain <tool> [pattern]` 真裁决干跑〔与守门行同源命中标注〕/ `preset <conservative|balanced|open>` 预设写盘〔settings.json 两键 + open 档七条建议集 append，下次启动生效〕），`/history`（副屏会话回看）、`/rewind`（边界快照回卷）、`/goal`（目标续跑管理——`create <schedule 串> <objective 全文> [--write] [--budget <n>]` 建续跑 goal〔锚定本会话；schedule 串形见下文〔/tick 定时任务〕节；`--write` = needsWrite 申报非授权——`/goal approve` 批准后生效；`--budget` = 记账刹停帽（前台计数 + 委派折叠合计）；首跑 = schedule 首次到点〕、`wake <goalId>` 手动起闹〔停滞/预算双复位 + 挂钟复活〕、`list` 全部 goal 状态·挂钟·预算速览、`show <goalId>` 单 goal 详情〔计划态 + 唤醒审计 + needsWrite 双位态〕、`approve <goalId>` 人面批准 needsWrite 申报〔判据门批准位——批准后 gate kind command 可申报并真跑评测（恒 workspace-write 档 + 30s 帽 + 无升权出路）；exec 件禁用形下申报照拒（诚实缺席），files/diagnostics 判据不受影响〕；预算帽尽自动停靠〔挂钟行停 + 会话落 paused〕、后台日池回充时自动唤醒续跑）、`/tick`（定时任务面——`add|list|rm|run|enable|disable` 六动词，用法与 schedule 串形见下文〔/tick 定时任务〕节；到点执行双形态：宿主在跑 = 进程内推进、宿主停机 = cron 可选后端子进程触发〔`BERRY_AGENT_CRON=1` 开启——见「无人值守与预算停靠」〕）、`/browser install`（浏览器引擎安装）、`/credentials`（凭证管理——add/list/rm 与 oauth 授权流）、`/memory`（记忆管理面副屏——f 冻结切换 / d 忘掉〔confirm 两段式〕/ r 恢复 / e 导出 / Tab 筛选循环全部→活体→冻结→终态；memory 件装载时注册、通道不支持时降级提示）、`/sessions`（会话切换器——副屏清单光标选定切焦）、`/usage`（会话用量面板——本会话全 run 累计分表）、`/help`（命令与键位帮助——命令册 + 键位册双源副屏）、`/new`（同 cwd 建新会话即切焦——回执一行新会话短 id，旧会话不动、`/sessions` 可回切；新会话首事件落库前暂不在 `/sessions` 清单——footer 短 id 即其可见位）、`/status`（状态汇总副屏）、`/debug`（调试信息副屏——日志路径/生效配置）、`/themes`（主题切换副屏 + 自定义主题——选定写 `theme` 键，见下文「用户设置」）、`/diff`（工作区改动总览副屏——本会话 edit 类工具改动按文件分组）、`/skills`（技能列表/回填副屏——`enter` 回填调用形入输入框，不直接执行）、`/marketplace`（插件市场选装副屏——`enter` 选装/卸载〔卸载双相：核查清单回执 → 三选裁决（取消/保留数据/清数据）〕· `u` 换装 · `r` 刷新〔恒回源强制重取——鲜缓存亦重取，非 `discover` 的 TTL 惰性腿〕；busy 单槽跨开屏持久——收屏后动作在飞重开可见回执；源管理〔`add`/`remove`〕留 CLI `berry marketplace`，见下文「marketplace 市场聚合」节）、`/thinking`（思考档位切换副屏——off~max 七档选定、当前档 ● 标记；下一 run 起生效，档位是否生效随模型能力——模型不支持思考时静默无效）、`/sandbox`（沙箱档位切换副屏——read-only / workspace-write / danger 三档选定、当前档 ● 标记；即刻生效于后续工具调用——在飞 run 内下一工具调用起按新档执法）、`/upgrade`（检查更新薄壳——本地 / 远端 dist-tags 对照回执一行：有新版即指引「退出后执行 berry upgrade」（TUI 内不代执行）、已是最新如实说、失败诚实报；启动另有 24h 节流的静默检查——有新版 notify 一行、按版本去重，`BERRY_AGENT_SKIP_UPDATE_CHECK` 置值即归零）、`/guide`（快速上手参考副屏——版本 / 核心命令 / 文档地图 / 升级与卸载四段静态快照）（`/new` `/status` `/debug` `/themes` `/diff` `/skills` `/marketplace` `/thinking` `/sandbox` `/upgrade` `/guide` 十一词为 TUI 本地命令——恰零参命中、带参即用法错，不进通道命令表，与 `/exit` 同律）、`/export`（会话导出 markdown 落盘——`~/.berry-agent/exports/<会话id>-<时间戳>.md` 并回执一行路径；无参 = 焦点会话、`/export <会话id>` 指定会话；空会话照落盘、指定 id 不在场诚实拒）、`/memory-export` `/memory-import`（记忆导入导出）、`/exit`（退出 TUI——与 Ctrl+D 同路优雅退出）、`/quit`（`/exit` 别名；两词为 TUI 本地退出词，不进通道命令表）等。尾参活体补全三处：`/plugins` 的 `mount` / `unmount` / `toggle` / `config` 子动词收插件 id、`/rewind <id>` 收回退点 id、`/export <会话id>` 收会话 id——三尾参位按活体清单补全（每查询现取：插件集随装载面、回退点随会话、会话清单随库行——与 `/sessions` 清单同源，零事件新会话无行不补）。Web 界面输入框同词对等：`/thinking` / `/sandbox` 恰零参命中即开档位选择浮层（档位行集与当前档取自服务端、点击选定即切档并呈现回执），带参形同用法错——折 Web 界面既有错误通知条、不提交；档位面经会话族三端点承载：`GET /api/sessions/:id/tiers`（取档位词表与当前档）、`PUT /api/sessions/:id/thinking-level` / `PUT /api/sessions/:id/sandbox-mode`（切档，回执文案与 TUI 同源）。

### TUI 副屏面板

副屏 = 主对话面上的全屏只读覆盖层，同一时刻只开一个（占用中新开请求降级提示——先退当前副屏再开）。通用退出键 `q` / `Esc`；`Ctrl+C` 打断、`Ctrl+D` 退出进程（先收副屏再转退出柄）。十三个内建面板：

- `/history` —— 会话回看：全量历史正文只读快照（与主屏同一渲染管线），`↑`/`↓`/`PgUp`/`PgDn`/`Home`/`End` 键盘滚动 + 鼠标滚轮、左键拖选复制；
- `/memory` —— 记忆管理：活体/冻结/终态三分区，`f` 冻结切换 / `d` 忘掉〔confirm 两段式〕/ `r` 恢复 / `e` 导出 / `Tab` 筛选循环（全部→活体→冻结→终态）；
- `/sessions` —— 会话切换：会话清单光标选择（`↑`/`↓` 移动、`PgUp`/`PgDn`/`Home`/`End` 翻选、`Enter` 选定切焦）；
- `/usage` —— 会话用量：本会话全 run 累计分表（轮次 + token 输入/输出/缓存读/缓存写四分 + 合计 + 费用——无费用上报时如实呈现）；
- `/status` —— 状态汇总：版本 / 模型位（当前 provider/model + 全集计数——`ctrl+p` 模型循环同数据源）/ 会话（短 id / cwd 短名 / 轮次）/ 数据目录 / theme 生效档 / env 旋钮生效值（MODEL / DATA_DIR / LOG_LEVEL 三键白名单——凭证与 token 恒不入面）；
- `/debug` —— 调试信息：daemon.log 路径与尾行快照（帽 50 行、token 明文行掩码；非 daemon 形缺席行如实呈现）/ log level 生效值 / settings 解析态（键位覆盖拒载与主题坏值警告的汇总面）/ sqlite 路径 / 已装载插件 id 清单——凭证值恒不入面；
- `/themes` —— 主题切换：内置 `auto` / `dark` / `light` 三档 + `themes/` 自定义主题（坏文件条目 ⚠ 标注）的选择器（▸ 光标 + `Enter` 选定 + 当前档 ● 标记）；选定即时换装并写 `settings.json` 的 `theme` 键（见下文「用户设置」）；
- `/thinking` —— 思考档位：off~max 七档选定（▸ 光标 + `Enter` 选定 + 当前档 ● 标记）；选定后下一 run 起生效，是否生效随模型能力——模型不支持思考时静默无效；
- `/sandbox` —— 沙箱档位：read-only / workspace-write / danger 三档选定（▸ 光标 + `Enter` 选定 + 当前档 ● 标记）；选定即刻生效于后续工具调用（在飞 run 内下一工具调用起按新档执法），切会话各档独立；
- `/diff` —— 工作区改动总览：本会话 edit 类工具的文件改动按文件分组（组头文件名 + 增删行计数、组体词级 diff；`Enter` 展开 / 收起）——数据源为会话事件投影、零 git 子进程（答「本会话改了什么」，工作树现状归 git 自查）；
- `/skills` —— 技能列表：发现层胜者单行（标注来源层）；`Enter` 回填技能调用形入输入框并收副屏——不直接执行，技能执行走模型侧消费路；
- `/help` —— 命令与键位帮助：命令册（通道命令表 + TUI 本地命令族〔退出词与本地拦截命令〕合流）与键位册（当前生效键位按域分组——含用户覆盖生效形）双源；
- `/guide` —— 快速上手参考：版本 / 核心命令 / 文档地图（docs 五册路径）/ 升级与卸载四段静态快照（新机起手一屏——文案装配位单源）。

面板命令随对应能力装配在场而注册（缺席不注册、不虚报——`/memory` 件缺席或通道不支持时降级提示）；面板内容为打开时刻的静态快照（打开后新事件不进副屏，返回主屏全帧补显）。

### 用户设置（settings.json）

数据目录下 `~/.berry-agent/settings.json`（文件缺席 = 全缺省；手编改动下次启动生效）。TUI 相关键两枚：

```json
{
  "theme": "dark",
  "keybindings": {
    "thinking.toggle": "ctrl+g"
  }
}
```

- `theme`——TUI 主题档：内置 `dark` / `light` / `auto` 三值（缺省 `auto`）或自定义主题名（形见下）；`auto` = 启动时发 OSC 11 背景色查询按终端明暗裁定色板，并订阅明暗变化通知（支持的终端切换明暗即时跟随换板；无应答维持暗色）；显式 `dark`/`light` 不探测；`/themes` 副屏选定同写本键；
- `keybindings`——键位用户覆盖（动作 id → 单个键串，**整体替换**该动作的缺省键集——非追加；同动作多条以末条为准）：动作 id 见上文键位册表；键串文法 = 修饰键固定序 `ctrl+alt+shift+` + 单字符或具名键（`enter` `escape` `tab` `backspace` `delete` `insert` `up` `down` `left` `right` `home` `end` `pageup` `pagedown` `space`，全小写）。坏条目逐条拒载并点名警告（TUI 启动落屏「键位覆盖未生效：<原因>」）——不炸启动、好条目照常生效、拒载动作回退缺省键位。拒载四形：未知动作 / 不可覆盖动作（全局两条）/ 畸形键串 / 键冲突（覆盖后同键动作集与缺省册不一致）。

该文件同时承载 `/approval preset` 写入的 `sandboxMode` / `approvalPolicy` 两键（审批持久缺省档）；机器写盘只动自己的键，手编的其他键原样保留。

**自定义主题**：`theme` 键值域另收自定义主题名——`~/.berry-agent/themes/<名>.json`（文件名即主题名：字母数字开头，可含 `.` `_` `-`，帽 64 字符；`dark` / `light` / `auto` 为保留词，同名文件被内置档遮蔽）。文件 = 主题语义键 16 枚的部分覆盖，缺键回退内置基板同位键（基板按终端明暗探测选定——与主题文件选择正交）。键清单：`accent` / `text` / `secondary` / `thinkingText` / `success` / `error` / `diffAdded` / `diffRemoved` / `link` / `tableRule` / `codeInline` + 高亮五键 `codeKeyword` / `codeString` / `codeComment` / `codeNumber` / `codeFunction`。色值三形（示例最小形）：

```json
{
  "accent": "#0e7490",
  "success": 2,
  "codeKeyword": { "rgb": "#cf222e", "ansi16": 1 }
}
```

hex 串（`#rrggbb` / `#rgb`）、数值（0-15 = 终端 16 色板位、16-255 = 256 色索引）、`{ "rgb", "ansi16" }` 对象（精确对位——`rgb` 主值随终端色域降采，16 档用 `ansi16` 覆写位）。坏文件（缺席 / 非法 JSON / 顶层非对象 / 任一色值坏形）= 警告一行点名并回退既有档（不炸启动）；未知键点名忽略、文件照常载入。

### run 单次执行

```bash
berry run "解释这段代码的作用"
berry run --continue "继续刚才的话题"          # 取当前目录最新会话续接
berry run --session <id> "继续指定会话"         # 按 id 续接
berry run --fork "从这里分叉另起一路"           # 边界快照分叉后续跑
berry run --ephemeral "一次性问题，零落盘"       # 零落盘单发
berry run --read-only "只读分析这个仓库"         # 只读沙箱单发
berry run --preset open "重构这个模块"           # 权限预设逐次生效（open 档）
```

run 旗标族：

| 旗标                                            | 作用                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--output-format <text\|json\|stream>`          | 输出三档（缺省 text）                                                                                                                                                                                                     |
| `--output-last-message <file>`                  | 末条 assistant 文本原子写文件                                                                                                                                                                                             |
| `--ephemeral`                                   | 零落盘单发（与续接族/`--tick`/`--background` 互斥）                                                                                                                                                                       |
| `--max-turns <n>`                               | turn 数帽（到帽收场如实标 truncated）                                                                                                                                                                                     |
| `--session <id>` / `--continue` / `--fork [id]` | 续接族三选一（互斥）                                                                                                                                                                                                      |
| `--read-only`                                   | read-only 沙箱单发                                                                                                                                                                                                        |
| `--preset <conservative\|balanced\|open>`       | 权限预设逐次生效不写盘（两旋钮：sandbox 档 + 审批 policy；与 `--read-only` 互斥；持久切换走 TUI `/approval preset`）                                                                                                      |
| `--tick <名>`                                   | 到点触发载体：按名读定时任务行自跑其提示词（与 message 位置参数互斥）                                                                                                                                                     |
| `--background`                                  | 后台道预算记账入口                                                                                                                                                                                                        |
| `--no-delta`                                    | 线面退订流式增量                                                                                                                                                                                                          |
| `--output-schema <file>`                        | 结构化输出：JSON Schema 文件（根须为带 `type` 字段的对象且 `type` 值属七基本类型之一 object/array/string/number/integer/boolean/null——Union/Intersect 根形 v1 不收）注入约束，收场校验末条回复须整体单一 JSON 且合 schema |

`--output-schema` 两档失败语义：文件本身坏形（不可读/非法 JSON/根非带 `type` 字段对象/根 `type` 值域外——如拼写手误）= 用法错退 2（执行前拦——不跑模型）；收场校验失败（末条回复非单一 JSON 或不合 schema）= 退 1 并在 stderr 载 `STRUCTURED_OUTPUT_PARSE_FAILED` / `STRUCTURED_OUTPUT_SCHEMA_MISMATCH` 码（`--output-format json` 档终值对象另载 `errorCode`/`errorMessage` 位；truncated/失败/中止收场不叠加校验；收场末条回复无任何文本块〔如仅思考块收场〕= 校验靶不存在，同不叠加、如实退 0）。

裸 `--` 之后的 argv 全字面（正当以 `--` 起头的消息内容保真送达）；未识别 `--` 词一律用法错退 2——防旗标语义静默并进消息正文送模型。

### sessions 会话管理

```bash
berry sessions list              # 清单：id/标题/时间/血缘（updated 倒序，帽 100）
berry sessions resume <id>       # 按 id 续接后进 TUI（与无参 TUI 的按目录取最新互补）
berry sessions fork <id>         # 边界快照分叉（种子事件随种子走）
berry sessions search "关键词"    # 跨会话全文检索（bm25 序，输出 id/标题/#seq/切窗摘录）
berry sessions export <id>       # 会话导出 markdown 落盘（exports/<会话id>-<时间戳>.md——与 TUI /export 同源拼装；Web 面「导出」键同源直出下载）
berry sessions reindex           # 全文索引全量重建（派生物不修不补——重建即修复）
```

读腿（list/search/reindex）零装配直开库——不开运行时、不占单活跃机标记；`fork` 与 `run --fork` 同机（钩子保真）；`resume` 在非交互环境退 2 并指引改 `run --session`。

### credentials 凭证管理

```bash
berry credentials add github-token ghp_...                        # 录入 host 域（core:issue 件消费——同名即生效）
berry credentials add api-key secret... --namespace plugin:my-plugin   # 录入插件域（插件经 ctx.get("secrets") 读自域）
berry credentials list                                            # 全域列示——域/名/来源/更新时间
berry credentials rm github-token                                 # 撤销（删除唯一路径）
```

- **值永不呈现**：录入回执与列示只含域/名/来源与时间——值只进加密存储（shell 历史里的 argv 仍属本机明文，敏感值建议改用 TUI `/credentials`）；
- 域形两态：`host`（宿主域——core: 出厂件消费，如 issue 件的 `github-token` / `issue-webhook-secret` 两名；缺省）与 `plugin:<id>`（插件域）；插件经 `ctx.get("secrets")` 只读自己的域，跨域读需用户显式开门；

### doors 开门制门态只读

```bash
berry doors list   # 高危面门态清单（闭门附同源 reason；授予双源分组呈现）
```

只读面——开/关动词 CLI 不受理（退 1），编辑走 TUI `/doors open <capability>` / `/doors close <capability>`（进程级 doors 段）；插件道开门走启用行 `opens` 位（两源任一含即门开）。

- **模型 API key 不入凭证盒**（v1）：模型凭证按 provider 生态变量供给（如 `ANTHROPIC_API_KEY`）——把模型 key `add` 进凭证盒不会生效；
- **静态凭证人面唯写** = 本命令族；oauth 授权流（device-code）仅在 TUI `/credentials oauth`——CLI 不设此动词；
- 零装配直开库（sessions 读腿同形）——不起运行时即用；退出码 0/1（用法错归解析层退 2）。

### serve 常驻宿主与自动化通道

```bash
berry serve                    # 前台 stdio JSONL 线协议（SDK spawn 形态）
berry serve --daemon           # 后台守护（unix sock 为缺省接入点）
berry serve --daemon --port 7860        # 守护 + 统一 HTTP 面 TCP 侧开面
berry serve --daemon --sdk-port 7870    # sdk 线协议面 TCP 侧（daemon 专属；前台形传入即退 2）
berry serve --no-delta         # 线面退订流式增量（run/serve 共收）
berry serve status             # 守护态查询（只读豁免——不占单活跃机）
berry serve stop               # 停守护
```

`--sdk-host`（daemon 专属）指定线协议面绑定地址——**非回环值必配 `BERRY_AGENT_SDK_TOKEN`**（见环境变量表）。

配套生态：

- **npm SDK**：`berry-agent-sdk`（类型化客户端，spawn stdio / 直连 HTTP 两传输）**已上 npm**（alpha 档，`npm install berry-agent-sdk` 可装，随主仓演进）——SDK 源码在仓内 `packages/berry-agent-sdk`，开发态仍可 `file:` 链本地消费；
- **MCP 包装**：`berry mcp` 以 MCP server 形态暴露 `berry-agent` / `berry-agent-reply` 两工具，供任意 MCP 客户端接入；
- **`--port` 统一 HTTP 面**：SPA Web 界面 + `/api/*`（Web 界面族）+ `/v1/*`（程序调用族）三族同面，恒回环，token 鉴权（令牌仅启动 stderr 一次性显示）。Web 界面输入框 `@` 同样触发文件路径补全——同 TUI 判据（工作区根锚定、引号感知、`@"带空格 路径"` 引号形、子序列模糊过滤），候选弹层 `↑`/`↓` 循环、`Enter` 整 token 代换、`Esc` 关层。

### 无人值守与预算停靠

无人值守 run（goal 续跑、issue 处理、定时任务到点、`run --background`）的模型调用记**后台道**、计入当日后台预算日池（durable `llm/usage` 聚合——重启不清零、用户可审计当日谁花了多少）；前台对话不占日池。子代理委派例外恒律：模型派子代理的花销恒记后台道、计入当日日池——含前台对话发起的委派（委派 run 属后台编排）。日池耗尽 = 后台道调用拒发（下周期再试），在飞无人值守会话不硬杀——**停靠**（durable 落 `session/paused` 词）三面同律：

- **goal 会话**：挂钟行停摆 + 会话停靠（`/goal list` 可见）；日池回充自动复活挂钟续跑；
- **issue 会话**：停靠项登记，回充时经唤醒消息续跑；
- **普通无人值守会话**（定时任务行 / 后台 run）：会话级停靠项，回充时同链唤醒。

日池回充（自然翻日或提额）由宿主 **budget-extended 广播**统一唤醒上述三面。停靠态 `paused` 在模型工具 `session_list` 状态档可见；Web 界面 v1 不呈现停靠态。后台 run 用量达日池 70 / 85 / 95% 时逐轮注入预算提示 / 预警 / 临界三档软着陆文案（临界档指令收尾陈述结论与未竟项；预警只对后台道生效，前台对话恒无）。

定时任务到点执行双形态：宿主在跑 = 进程内推进（与前台 run 同池并发帽、审批 fail-closed 同律）；宿主停机期 = cron 可选后端（`BERRY_AGENT_CRON=1` 显式开启即写系统 crontab 的授权凭据）子进程触发 `run --tick`——同任务跨进程防双跑（他实例在飞诚实让位），行账（上次触发/结局/下次到点）durable 落结。

### /tick 定时任务（schedule 串形）

TUI 内 `/tick` 六动词——用法错时 TUI 现场呈现同一份用法文案，本节与之同源：

```text
/tick add <名> <schedule 串> <prompt 全文> [--cwd <绝对径>] [--enable]
/tick list
/tick rm <名>
/tick run <名>
/tick enable <名>
/tick disable <名>
```

`add` 缺省建行**停用**——「存在 ≠ 启用」，`enable` 显式开跑（`--enable` 建行即启用）；`--cwd` 锚定任务工作目录（绝对径）；`run` 手动起跑一轮（与 `run --tick <名>` 同载体）。`/goal create` 的 schedule 串与此同法。schedule 串形五写四形（`once` 有绝对/相对两写）：

| 串形                  | 语义                                                      |
| --------------------- | --------------------------------------------------------- |
| `every:<n>[s\|m\|h]`  | 间隔重复（n 正整数；总秒数下限 5s）                       |
| `once@+<n>[s\|m\|h]`  | 一次性相对延迟（自建行时刻起）                            |
| `once@<ISO>`          | 一次性绝对时刻                                            |
| `daily@HH:MM`         | 每日（本地时区 24h 制）                                   |
| `weekly@<days>@HH:MM` | 每周（days = 逗号分隔星期名——mon/tue/.../sun 全写或三写） |

语义三条：`once` 触发后不再到点（行留表可见、不再 due）；错过不重放（宿主停机期错过的到点重启后直接跳下一刻）；`daily`/`weekly` 按本地时区解释（存储/比较恒 ISO UTC）。坏串拒 `SCHEDULER_SCHEDULE_INVALID`（message 载原因）。

### issue 驱动工作模式（core:issue）

监听 GitHub issue 的无人值守处理模式：件**缺省零装载**——`enabled.yaml` 给 `core:issue` 行配 `config` 才启用（坏形响亮拒 `ISSUE_CONFIG_INVALID`）。触发双源：轮询（缺省每 120s）+ webhook（统一 HTTP 面〔`--port`〕开面后挂 `/webhooks/issue` 路由，`X-Hub-Signature-256` HMAC 验签；secret 缺席 = 路由在场但守卫拒）。命中 issue 起一次隔离处理：独立 worktree（`issue-N` 命名，撞名让位 `-r2..-r9`）+ headless 会话（后台道预算记账、每 issue 消息帽缺省 400）。重跑同 issue 时**前次分支全列举进提示词**（git 史即断点真源——可续作也可从头独立解决）；提示词同时带对账纪律（完成前逐条对账 issue 正文与评论中的显式要求）与边界禁令（严禁自行 push / 开 PR / 发评论——交付由编排层收口）。

模型侧两工具：`issue_get`（读 issue 正文与评论，64KiB 上下文帽）与 `issue_escalate`（上报待裁决问题——`question` 必填，可选 `options` 候选 / `recommendation` 建议 / `continueWithDefault` 缺省案；只登记不发评论，escalation 进回执转人审，不中途打断任务）。

**交付验证门**（渐进启用安全键）：`config` 配 `verifyCommand`（如 `npm test`）即在场——编排层在交付前一步于 worktree 内真跑该命令，非 0 退出 / 超时 / 执行异常一律**拒交付**，收口 failed 转人审（回执评论附退出码与输出尾证据，分支留存供排查）；缺席 = 无门不拦交付（空串是坏形拒——配了门就不能静默视同没配）。`verifyTimeoutMs` 配验证时帽毫秒（缺省 120000）。编排定序：验证门先于危险闸——验证未过零闸决策记账。

档位与收口：`mode: draft`（缺省）收口评论贴分支 + 补丁（等人采信）；`mode: auto` 走危险闸预授权交付（push / 开 PR，`/danger approve` 签发、日成功帽缺省 10）——escalation 在场时降级不自动交付转人审。headless 会话审批被拒或写动作无策略表覆盖时收口 **needs-human** 转人审。

配置例（`~/.berry-agent/enabled.yaml`——core:issue 无 `configSchema` 声明，TUI `/plugins config` 表单不适用〔如实报「无声明配置面」〕；手编启用行后 `/reload` 生效）：

```yaml
plugins:
  - id: core:issue
    config:
      repos: ['owner/name'] # 必填——精确串轮询+匹配；含 * 的 glob 仅匹配面
      mode: draft # draft | auto（缺省 draft——全自动显式 opt-in）
      verifyCommand: 'npm test' # 交付验证门（可选——缺席不拦交付）
      verifyTimeoutMs: 120000 # 验证时帽毫秒（缺省 120000）
      # labels: ["bug"] # 可选白名单（空/缺省 = 该维不约束）
      # assignees: [] # 同上
      # perIssueBudgetMessages: 400 # 每 issue 消息帽（缺省 400）
      # baseBranch: main # 补丁基线（缺省 main）
      # maxDeliveriesPerDay: 10 # 交付日成功帽（缺省 10）
```

GitHub 凭证：host 域凭证 `github-token`（`/credentials add github-token <token>` 录入优先，`BERRY_AGENT_GITHUB_TOKEN` 回落）；webhook 签名密钥 `issue-webhook-secret`（同回落律，`BERRY_AGENT_ISSUE_WEBHOOK_SECRET`）。凭证缺席 = 件零装载。

### plugins 插件管理

```bash
berry plugins list             # 三分区装载态清单：启用（N）/ 失败（N）/ 禁用（N）——失败与禁用行各附原因
berry plugins check            # 装机面三色体检（只读——报告分绿/红/legacy/黄四段〔空段不渲染〕，退出码以红为轴：任红退 1 / 全绿退 0，黄与未声明不改码；空/缺席账本无可体检项退 0）
berry plugins install <ref>    # 装机（ref 自含源前缀，词法见下）
berry plugins uninstall <id>   # 卸载（双相：无 --confirm = 只读预览 / 加 = 执行；--data keep|purge 缺省 keep）
```

`install <ref>` 三源词法（**ref 单参自含源前缀——无前缀即用法错拒收，不猜默认源**）：

- `npm:<包名>[@<版本>]` —— npm 源（供应链护栏：钉版安装 + `--omit=dev` + min-release-age 静置窗）；`--min-release-age <分钟>` 旗标逐次覆盖 `BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE`（`0` = 显式关窗）；
- `git:<url>[#<ref>]` —— git 源（`#<ref>` 钉定 commit/tag/branch）；
- `local:<绝对路径>` —— 本地目录（开发态免发布直装）。

**装机两步制（install ≠ 启用）**：`install` 只做装机落账 + 事件词汇收割，插件此时**尚未装载**——启用必须第二步显式 mount：

```bash
berry plugins mount <id>      # 「下次启动装载生效」只归属 mount 后——CLI 短命进程不装配装载器；
                              # 宿主运行中则会话内 /reload（或 TUI /plugins mount <id>）即时生效
```

`install` 成功尾行即附该第二步命令（可直接复制执行）；`update` 不改启用态（`enabled.yaml` 不动，已 mount 的插件更新后照常装载）。

装机失败拒 `PLUGIN_INSTALL_FAILED`（含护栏拒与坏 ref 形）；卸载拒 `PLUGIN_UNINSTALL_REFUSED`（装机账本损坏等拒写防覆盖形）。

写侧六动词执行面全在场：装机动词（`install`/`update`）走 npm 钉版安装（供应链护栏），行级动词（`mount`/`unmount`/`toggle`）编辑 `enabled.yaml` 启用行，`uninstall` 走双相清算（四段幂等 + 审计落账）；配置表单 `config <id>`（TUI 会话内 `/plugins config <id>`）按插件 `configSchema` 逐字段问答——非 secret 值整值替换写入行 `config`、secret 值入凭证盒（`plugin:<id>/config:<key>`）不落 yaml，值等于缺省源不落行（行是覆盖仓不烙缺省），取消整次放弃零写盘。`enabled.yaml` 仍是启用面的底层真源（手编与命令同链可审计——boot 装载序 diff 补播）；`--no-plugins` 安全模式跳过全部插件装载（core: 与用户插件都不装）——坏插件锁死启动时的自救位。

开发态免装机试跑走 `--plugin-file`；写插件与生命周期证明矩阵（testkit）见[插件开发指南](./plugin-development.md)——仓内随包附两形模板（`examples/minimal-code-plugin` 代码插件 / `examples/pure-skill-pack` 纯技能包）。

### marketplace 市场聚合

外源市场仓的**只读聚合消费层**——`npm` 仍是主市场，市场仓只提供目录聚合（catalog）；一切装机动作塌缩为一次既有三源装机（供应链护栏全继承），不引入第四分发源。零源出厂：不预置任何市场，装不装、装哪个源全归用户。

```bash
berry marketplace add <source>        # 添加市场源（local 目录 / git 仓 / https catalog JSON）
berry marketplace list                # 已添加源清单（各附缓存时点与 commit 锚）
berry marketplace discover [<市场名>] # 条目聚合呈现（寻址形 name@market + 版本 + 描述；缓存过龄触发时点惰性刷新——鲜缓存零网络）
berry marketplace install <name@市场名>  # 装机（恒走既有 plugins install 四件套——只装不启，启用仍走 mount）
berry marketplace uninstall <name@市场名> # 卸载（双相旗标全继承 plugins uninstall：--confirm / --data keep|purge）
berry marketplace update [<市场名>]   # 手动刷新源缓存（up-to-date 即报不动；变化 = 整目录换血）
berry marketplace upgrade [<name@市场名>] # 按最新 catalog 对拍换装（忠实于市场目录的「拉最新」）
berry marketplace remove <市场名>     # 移除源（连同缓存目录清理；已装插件不受影响——账本仍在）
```

`add <source>` 四类源形：本地目录（`./`、`~/`、`/` 开头路径）/ git 仓 URL（`github.com/<owner>/<repo>` 短手可省协议）/ `git@` ssh 形 / https 直指 catalog JSON。marketplace 兼容目录约定（`.omp-plugin` / `.claude-plugin` 双路径读序）——catalog 坏形整仓拒、单条目坏形跳过并报行。

**刷新语义（auto-update 不存在）**：源缓存 24h 过线时 `discover`（呈现）与 `upgrade`（对拍）在触发时点惰性回源刷新（鲜缓存零网络；刷新失败降级 stale 照用不阻塞——离线 OK）；立即无条件刷新走手动 `update`（刷缓存），装机物换装唯经 `upgrade`——加载器永不自动安装。`upgrade` 与 `plugins update` 语义分立：前者对拍市场目录最新条目、后者忠于装机账本里的 ref。

**TUI 选装副屏 `/marketplace`**：TUI 会话内的市场消费面（与 CLI 八动词同服务面单源——回执呈面板尾区）：`↑↓` 移动 · `enter` 选装/卸载（未装条目 = 装机——回执尾行自带 mount 第二步指路；已装条目 = 双相卸载：先呈核查清单回执、再三选裁决〔取消 / 保留数据卸载 / 连数据目录清卸〕）· `u` 换装（mp-4 单件点名语义）· `r` 刷新（触发整源强制刷新——即 CLI `update` 动词**恒回源强制重取**，鲜缓存亦重取，非 `discover` 的 TTL 惰性腿）· `q`/`esc` 返回。长动作 busy 单槽（在飞期动作键锁定 + 二次发起诚实拒），busy 行与回执跨开屏持久——`enter` 收屏后动作继续在飞，重开 `/marketplace` 可见结算回执；装机面变更成功自动链重载（会话运行中排队、run 收场后执行）。源管理（`add`/`remove`）与开屏行集保持零网络（缓存即真相——首次源目录须经 CLI `add` 落缓存后才在面板可见）。

对已装市场条目重复 `install` = **换血重装**（同 `name@market` 溯源自动顶替旧装机条目并清旧树，非报错拒绝）；缓存换血原子（先备新树后整体替换，半拷贝永不复用）。远程抓取走与宿主 web 面同源的 SSRF/DNS 钉死防线（私网拒、重定向逐跳复检、超时与响应大小帽）。

## 环境变量

前缀一律 `BERRY_AGENT_*`：

| 变量                                   | 作用                                                                                                                         | 缺省                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `BERRY_AGENT_MODEL`                    | 覆盖缺省模型                                                                                                                 | `anthropic/claude-sonnet-5` |
| `BERRY_AGENT_DATA_DIR`                 | 数据目录                                                                                                                     | `~/.berry-agent`            |
| `BERRY_AGENT_DB_PATH`                  | 库文件路径（独立梯子——重定向库文件而不动数据目录）                                                                           | `<数据目录>/sessions.db`    |
| `BERRY_AGENT_LOG_LEVEL`                | 日志级别：error / warn / info / debug / silent                                                                               | `info`                      |
| `BERRY_AGENT_SKIP_UPDATE_CHECK`        | TUI 启动版本检查关断（置值即关——关掉即零网络包；手动通道 `/upgrade` 与 `berry upgrade` 不受辖）                              | 未设（检查开）              |
| `BERRY_AGENT_BASH_PATH`                | bash 工具可执行路径（缺失 fail-loud）                                                                                        | PATH 发现序                 |
| `BERRY_AGENT_FD_PATH`                  | `@` 文件补全的 fd 可执行路径（保留位——全库 fuzzy 发现挂真实需求再裁，当前仅内置遍历，设置无效）                              | —                           |
| `BERRY_AGENT_BROWSER_PATH`             | 浏览器引擎可执行路径                                                                                                         | 引擎发现序                  |
| `BERRY_AGENT_BIN`                      | scheduler 子进程 spawn 的宿主 bin 真值（cron 行单源）                                                                        | `berry`（PATH 名解析）      |
| `BERRY_AGENT_CRON`                     | cron 可选后端开关/载体                                                                                                       | 进程内挂钟                  |
| `BERRY_AGENT_GIT_PATH`                 | worktree 工具 git 可执行路径（保留位——装配侧未接，当前设置无效）                                                             | PATH 发现序                 |
| `BERRY_AGENT_SDK_TOKEN`                | serve `--daemon` 线协议面 TCP 侧鉴权 token（`--sdk-host` 非回环必配）                                                        | 缺省不开 TCP 侧             |
| `BERRY_AGENT_SDK_PORT`                 | daemon SDK 面端口 env 补位（`--sdk-port` 旗标缺席时生效；`0..65535` 整数——`0` = 内核指派端口放行，越界/坏值 fail-loud 拒启） | 旗标缺席即不开              |
| `BERRY_AGENT_SDK_HOST`                 | daemon SDK 面绑定地址 env 补位（`--sdk-host` 旗标缺席时生效；非回环值同样必配 token）                                        | `127.0.0.1`                 |
| `BERRY_AGENT_GITHUB_TOKEN`             | core:issue 件 GitHub 凭证（`/credentials` 录入优先，本变量为回落）                                                           | 缺席                        |
| `BERRY_AGENT_ISSUE_WEBHOOK_SECRET`     | core:issue 件 webhook 签名密钥（同回落律）                                                                                   | 缺席                        |
| `BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE`   | 插件装机供应链护栏：npm 源最小发布龄分钟数（`0` = 关窗不查）                                                                 | 1440                        |
| `BERRY_AGENT_LLM_IDLE_TIMEOUT_MS`      | LLM 流层空闲帽毫秒数（流停滞主防线——流上无产出超帽即断；`0` = 显式关只剩编排层时滞帽；非法值 fail-loud 拒启）                | 300000                      |
| `BERRY_AGENT_SESSION_STALL_TIMEOUT_MS` | 编排层会话时滞帽毫秒数（流停滞纵深防线——run 级无进展超帽收口；`0` = 显式关；非法值 fail-loud 拒启）                          | 900000                      |
| `BERRY_AGENT_MAX_CONCURRENT_RUNS`      | 宿主级 run 并发帽（lane 帽——正整数必需，坏值 fail-loud 拒启；steer/inject 不经闸）                                           | 16                          |
| `BERRY_AGENT_MAX_CONCURRENT_SUBAGENTS` | 单父在飞子代理扇出帽（per-父会话内存位——正整数必需，坏值 fail-loud 拒启；满帽排队非拒收，one-shot 与后台同池同帽）           | 8                           |
| `BERRY_AGENT_BACKGROUND_BUDGET_TOKENS` | 当日后台道 token 日池限额（后台 run 记账对照面；非负整数字串，`0` = 显式关池，坏值 fail-loud 拒启；前台花销照入账不进闸门）  | 4000000                     |

`BERRY_AGENT_LOG_LEVEL` 另支持**逗号分隔 per-module 语法**（如 `info,session:debug`）：每条目按**最右一个冒号**切分模块名与级别（模块名含冒号可表达——`core:memory:debug` 意为模块 `core:memory` 开 debug，段内冒号不是分隔符）；模块名按**前缀匹配**生效（`session` 命中 `session` 与 `session:*` 全体），多条目前缀同时命中取最长；不带模块名的条目设全局级（全局 `silent` 压倒一切 per-module 条目）；无效条目 stderr 警告后跳过（视同未设）。

## 遥测立场

**默认零数据外传（零遥测）**——无使用统计、无崩溃上报。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词）+ TUI 交互启动一次有界只读版本检查（只读 GET dist-tags、上行零字节、24h 节流、`BERRY_AGENT_SKIP_UPDATE_CHECK` 置值即关、headless/daemon 形零 fire——07 §8.5 第 6 条），此外零。若未来加任何回传，将按四段式公告（Why / How / What / How to disable）披露且默认值反转视为破坏性变更。

## 技能与记忆

- **技能**：SKILL.md 双层结构（frontmatter + 正文），六位发现层（项目 `.agents/skills/` > 用户 `~/.berry-agent/skills/` > 跨库 `~/.agents/skills`、`~/.claude/skills` > 插件 > 出厂〔`<包根>/skills/` 随包四件：`coding-persona` 编码人设、`plugins-quickstart` 插件速写入门、`goal-unattended` 无人值守续跑、`memory-tools` 记忆工具用法——用户/项目层同名技能恒压过出厂件〕）；对话中渐进披露（常驻清单一技能一块——name/description/location 三位），深读由模型工具 `load_skill` 按名装载——具名通道，与 `read` 按 location 直读等价，另承两细化：`section` 给祖先路径（"A > B" 式）只装命中节（标题按层级重建）、`mode` 按词表行级过滤正文（词表 = 待装内容自身「强度表行 ∩ 带引号示例行」双形交集推导）；报错不猜——name 未命中复用 `SKILLS_NOT_FOUND` 指路清单、节未命中列全部可寻址节、同名歧义列候选带行号、mode 不在词表拒列词表（词表空则原样装载就地注明）；回执为具名技能块（与 `/skill:<name>` 显式激活同形同源）；`disable-model-invocation` 件不经此通道（拒载并指路显式激活）；`skill_manage` 工具可创建/修补；
- **子代理**：声明式 `agents/*.md`（frontmatter 六键 name/description/tools/requires/skills/model + 正文即系统提示），发现层镜像技能位 1-4（项目 `.agents/agents/` > 用户 `~/.berry-agent/agents/` > 跨库 `~/.agents/agents`、`~/.claude/agents` > 插件声明目录）；装载即物化为静态工具 `agent_<name>`（层序即信任序、first-wins 撞名）；模型面另有通用 `agent` 工具按名路由；后台收场结算通知携子会话指针行（「子会话 X（N 条消息）」——收果可回查）；单父在飞扇出帽默认 8（`BERRY_AGENT_MAX_CONCURRENT_SUBAGENTS` 可调——满帽排队不拒收）；
- **记忆**：跨会话持久条目（偏好、约定、教训），常驻简报 + 按需检索两路注入；`/memory` 副屏轻管理（活体/冻结/终态三分区——冻结切换、忘掉、恢复、导出）；`/memory-export` `/memory-import` 明文迁移；
- **环境自省**：模型工具面含 `session_status`——当前会话状态、整形后可见工具清单与高危面门态快照三段（只读，供模型自省工作环境）；
- **插件生命周期与压缩回归**：模型工具面含插件生命周期族八件——只读三件 `plugins_list` / `events_query` / `plugin_uninstall_inspect` + 写类五件 `plugin_install` / `plugin_mount` / `plugin_unmount` / `plugin_toggle` / `plugin_update`（写类走审批对自动执法；装载生效回执指路 `/reload`——模型面不自动链重载）；及 `ccr_retrieve`（压缩归档原文检索——会话压缩折叠后按 hash 取回原文段，压缩可逆）；
- **用量观测**：模型工具面含 `obs_query`——小时/日桶聚合查询（`metric=usage` 为 LLM token 用量：input/output 主计费桶与 cache 桶分列、token 原始值不折算货币；`hit_rate` = 缓存命中率派生列 `cacheRead/(input+cacheRead+cacheWrite)` 桶内聚合比值，`n/a` = 桶内无 token 流）。

## 下一步

- [插件开发指南](./plugin-development.md)——写第一个插件；
- [运维手册](./operations.md)——数据目录、备份、故障排查。
