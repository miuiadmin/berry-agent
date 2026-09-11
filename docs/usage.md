# 使用指南

本文自包含覆盖 berry-agent 的安装、入口命令族、TUI 操作与环境变量。架构背景见[架构总览](./architecture.md)。

> 状态：`0.1.0-alpha.1`。命令族中标注「尚未装配」的动词会诚实报错退出（解析与旗标面已就绪，执行面随后续版本接入）——不含糊、不静默。包尚未在 npm 首发：安装路一/路二待首发后可用，路三源码构建即时可用。

## 安装

要求 Node.js ≥ 24。三路任选。

**路一：安装脚本（推荐新用户）**——两段式，先落盘再执行：

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/install.sh
sh install.sh
```

> 不要写成 `curl … | sh` 管道直灌：连接中段断裂时 shell 会执行半截脚本。
> 脚本依次做：Node ≥ 24 检查 → `npm install -g berry-agent` → `berry-agent --version` 验证 → 欢迎横幅；失败时给出排查建议（权限 / 网络）。

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

缺省模型 `anthropic/claude-sonnet-5`（pi-ai 直连；凭证按 provider 生态变量供给）。

```bash
export ANTHROPIC_API_KEY=sk-...   # 凭证按 provider 生态变量供给
export BERRY_AGENT_MODEL=anthropic/claude-opus-5   # 或覆盖任意已注册 provider/model
```

## 入口命令族

```
berry-agent [命令] [旗标]
```

| 命令                | 作用                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| （无参）            | TUI 主入口：直进对话                                                                                                                                                                      |
| `run "<message>"`   | 单次执行：一轮对话 → stdout 输出结果                                                                                                                                                      |
| `serve`             | 常驻宿主（stdio JSONL；另有 `serve status` / `serve stop` 管理动词）                                                                                                                      |
| `mcp`               | MCP server 包装形态                                                                                                                                                                       |
| `dump-config`       | 打印实际生效装配（诊断）                                                                                                                                                                  |
| `plugins <sub>`     | 插件生命周期八动词全在场：`list` / `check` 只读，`install` / `uninstall` / `mount` / `unmount` / `toggle` / `update` 写侧（npm 源含钉版安装 + `--omit=dev` + min-release-age 供应链护栏） |
| `sessions <sub>`    | 会话管理：`list` / `resume <id>` / `fork <id>` / `search <query>` / `reindex`                                                                                                             |
| `credentials <sub>` | 凭证管理：`add <name> <value>` / `list` / `rm <name>`（`--namespace <ns>` 指定域；oauth 授权流仅在 TUI `/credentials`）                                                                   |
| `doors <sub>`       | 开门制门态只读：`list`（开/关编辑走 TUI `/doors open\|close`）                                                                                                                            |
| `upgrade`           | 升级维护动词（尚未装配）                                                                                                                                                                  |

退出码三态：**0** 成功（含诚实空——空清单/零命中非失败）/ **1** 执行失败 / **2** 环境态误用（用法错、TUI 在非交互环境）。

通用旗标：`--help` / `--version` 全入口收；`--debug`（日志提级）主入口族收（无参 TUI / `run` / `serve` / `dump-config`）——子命令族（plugins/sessions/credentials/doors/mcp）不设此旗标，传入即用法错退 2。`--port <n>` TUI / run / serve / dump-config 收（dump-config 忽略不起监听）；`--no-plugins` 安全模式不入自动化入口 serve / mcp。

### 快捷别名（可选）

官方命令名固定为 `berry-agent`。想要更短的敲法，在 shell 配置里自行设别名——个人配置，不随包安装、不影响升级：

```bash
echo "alias berry='berry-agent'" >> ~/.zshrc     # bash 用 ~/.bashrc；重开终端生效
```

npm 全局安装之前的源码形态，可先指向仓库构建产物：

```bash
alias berry='node /path/to/berry-agent/dist/host/main.js'
```

### TUI（无参启动）

无参启动按当前目录取最新会话——有则续接、无则新建。入口旗标：`--port <n>`（开统一 HTTP 面——Web 界面与程序调用族同面）、`--no-plugins`（安全模式）、`--debug`。

| 键       | 作用                                                  |
| -------- | ----------------------------------------------------- |
| `Enter`  | 提交输入                                              |
| `Ctrl+C` | 打断模型运行中回合 / 撤销审批提问                     |
| `Ctrl+D` | 空框退出                                              |
| `@`      | 文件路径补全（工作区根锚定；`@"带空格 路径"` 引号形） |
| `/`      | 命令补全（注册命令表）                                |

TUI 内建命令（随插件装载动态扩展）：`/plugins`（插件装机管理——list/check/install/uninstall/mount/unmount/toggle/update，写动词成功尾自动链重载）、`/reload`（热重载——会话运行中自动排队、run 收场后执行；回执含新代工具面 diff）、`/danger`（危险工具闸人面——`approve [ttlDays]` 签发 consent / `status` 运维呈单）、`/doors`（开门制人面——`list` 高危面门态清单〔闭门附同源 reason〕/ `open <capability>`、`close <capability>` 进程级门段编辑；授予双源 = 插件行 `opens` 位 + `doors` 段，任一含即门开——CLI 侧另有 `berry-agent doors list` 只读形）、`/approval`（审批分档人面——`status` 当前 sandbox 档与审批 policy〔值 + 四层来源〕/ `entries` 工具策略表活体全列 / `explain <tool> [pattern]` 真裁决干跑〔与守门行同源命中标注〕/ `preset <conservative|balanced|open>` 预设写盘〔settings.json 两键 + open 档七条建议集 append，下次启动生效〕），`/history`（副屏会话回看）、`/rewind`（边界快照回卷）、`/goal`（目标续跑管理）、`/tick`（定时任务手动推进）、`/browser install`（浏览器引擎安装）、`/credentials`（凭证管理——add/list/rm 与 oauth 授权流）、`/memory`（记忆管理面副屏——f 冻结切换 / d 忘掉〔confirm 两段式〕/ r 恢复 / e 导出 / Tab 筛选循环全部→活体→冻结→终态；memory 件装载时注册、通道不支持时降级提示）、`/memory-export` `/memory-import`（记忆导入导出）等。

### run 单次执行

```bash
berry-agent run "解释这段代码的作用"
berry-agent run --continue "继续刚才的话题"          # 取当前目录最新会话续接
berry-agent run --session <id> "继续指定会话"         # 按 id 续接
berry-agent run --fork "从这里分叉另起一路"           # 边界快照分叉后续跑
berry-agent run --ephemeral "一次性问题，零落盘"       # 零落盘单发
berry-agent run --read-only "只读分析这个仓库"         # 只读沙箱单发
berry-agent run --preset open "重构这个模块"           # 权限预设逐次生效（open 档）
```

run 旗标族：

| 旗标                                            | 作用                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--output-format <text\|json\|stream>`          | 输出三档（缺省 text）                                                                                                |
| `--output-last-message <file>`                  | 末条 assistant 文本原子写文件                                                                                        |
| `--ephemeral`                                   | 零落盘单发（与续接族/`--tick`/`--background` 互斥）                                                                  |
| `--max-turns <n>`                               | turn 数帽（到帽收场如实标 truncated）                                                                                |
| `--session <id>` / `--continue` / `--fork [id]` | 续接族三选一（互斥）                                                                                                 |
| `--read-only`                                   | read-only 沙箱单发                                                                                                   |
| `--preset <conservative\|balanced\|open>`       | 权限预设逐次生效不写盘（两旋钮：sandbox 档 + 审批 policy；与 `--read-only` 互斥；持久切换走 TUI `/approval preset`） |
| `--tick <名>`                                   | 到点触发载体：按名读定时任务行自跑其提示词（与 message 位置参数互斥）                                                |
| `--background`                                  | 后台道预算记账入口                                                                                                   |
| `--no-delta`                                    | 线面退订流式增量                                                                                                     |

`--output-schema` 尚未实现：显式传入即用法错退 2（不静默忽略）。

裸 `--` 之后的 argv 全字面（正当以 `--` 起头的消息内容保真送达）；未识别 `--` 词一律用法错退 2——防旗标语义静默并进消息正文送模型。

### sessions 会话管理

```bash
berry-agent sessions list              # 清单：id/标题/时间/血缘（updated 倒序，帽 100）
berry-agent sessions resume <id>       # 按 id 续接后进 TUI（与无参 TUI 的按目录取最新互补）
berry-agent sessions fork <id>         # 边界快照分叉（种子事件随种子走）
berry-agent sessions search "关键词"    # 跨会话全文检索（bm25 序，输出 id/标题/#seq/切窗摘录）
berry-agent sessions reindex           # 全文索引全量重建（派生物不修不补——重建即修复）
```

读腿（list/search/reindex）零装配直开库——不开运行时、不占单活跃机标记；`fork` 与 `run --fork` 同机（钩子保真）；`resume` 在非交互环境退 2 并指引改 `run --session`。

### credentials 凭证管理

```bash
berry-agent credentials add github-token ghp_...                        # 录入 host 域（core:issue 件消费——同名即生效）
berry-agent credentials add api-key secret... --namespace plugin:my-plugin   # 录入插件域（插件经 ctx.secrets 读自域）
berry-agent credentials list                                            # 全域列示——域/名/来源/更新时间
berry-agent credentials rm github-token                                 # 撤销（删除唯一路径）
```

- **值永不呈现**：录入回执与列示只含域/名/来源与时间——值只进加密存储（shell 历史里的 argv 仍属本机明文，敏感值建议改用 TUI `/credentials`）；
- 域形两态：`host`（宿主域——core: 出厂件消费，如 issue 件的 `github-token` / `issue-webhook-secret` 两名；缺省）与 `plugin:<id>`（插件域）；插件经 `ctx.secrets` 只读自己的域，跨域读需用户显式开门；

### doors 开门制门态只读

```bash
berry-agent doors list   # 高危面门态清单（闭门附同源 reason；授予双源分组呈现）
```

只读面——开/关动词 CLI 不受理（退 1），编辑走 TUI `/doors open <capability>` / `/doors close <capability>`（进程级 doors 段）；插件道开门走启用行 `opens` 位（两源任一含即门开）。

- **模型 API key 不入凭证盒**（v1）：模型凭证按 provider 生态变量供给（如 `ANTHROPIC_API_KEY`）——把模型 key `add` 进凭证盒不会生效；
- **静态凭证人面唯写** = 本命令族；oauth 授权流（device-code）仅在 TUI `/credentials oauth`——CLI 不设此动词；
- 零装配直开库（sessions 读腿同形）——不起运行时即用；退出码 0/1（用法错归解析层退 2）。

### serve 常驻宿主与自动化通道

```bash
berry-agent serve                    # 前台 stdio JSONL 线协议（SDK spawn 形态）
berry-agent serve --daemon           # 后台守护（unix sock 为缺省接入点）
berry-agent serve --daemon --port 7860        # 守护 + 统一 HTTP 面 TCP 侧开面
berry-agent serve --daemon --sdk-port 7870    # sdk 线协议面 TCP 侧（daemon 专属；前台形传入即退 2）
berry-agent serve --no-delta         # 线面退订流式增量（run/serve 共收）
berry-agent serve status             # 守护态查询（只读豁免——不占单活跃机）
berry-agent serve stop               # 停守护
```

`--sdk-host`（daemon 专属）指定线协议面绑定地址——**非回环值必配 `BERRY_AGENT_SDK_TOKEN`**（见环境变量表）。

配套生态：

- **npm SDK**：`npm install berry-agent-sdk`——类型化客户端，spawn stdio / 直连 HTTP 两传输；
- **MCP 包装**：`berry-agent mcp` 以 MCP server 形态暴露 `berry-agent` / `berry-agent-reply` 两工具，供任意 MCP 客户端接入；
- **`--port` 统一 HTTP 面**：SPA Web 界面 + `/api/*`（Web 界面族）+ `/v1/*`（程序调用族）三族同面，恒回环，token 鉴权（令牌仅启动 stderr 一次性显示）。

### plugins 插件管理

```bash
berry-agent plugins list             # 三分区清单：core: 内置 / 磁盘装机 / 装载失败
berry-agent plugins check            # 装机面体检（只读）
berry-agent plugins install <ref>    # 装机（ref 自含源前缀，词法见下）
berry-agent plugins uninstall <id>   # 卸载（双相：无 --confirm = 只读预览 / 加 = 执行；--data keep|purge 缺省 keep）
```

`install <ref>` 三源词法（**ref 单参自含源前缀——无前缀即用法错拒收，不猜默认源**）：

- `npm:<包名>[@<版本>]` —— npm 源（供应链护栏：钉版安装 + `--omit=dev` + min-release-age 静置窗）；`--min-release-age <分钟>` 旗标逐次覆盖 `BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE`（`0` = 显式关窗）；
- `git:<url>[#<ref>]` —— git 源（`#<ref>` 钉定 commit/tag/branch）；
- `local:<绝对路径>` —— 本地目录（开发态免发布直装）。

装机失败拒 `PLUGIN_INSTALL_FAILED`（含护栏拒与坏 ref 形）；卸载拒 `PLUGIN_UNINSTALL_REFUSED`（装机账本损坏等拒写防覆盖形）。

写侧六动词执行面全在场：装机动词（`install`/`update`）走 npm 钉版安装（供应链护栏），行级动词（`mount`/`unmount`/`toggle`）编辑 `enabled.yaml` 启用行，`uninstall` 走双相清算（四段幂等 + 审计落账）。`enabled.yaml` 仍是启用面的底层真源（手编与命令同链可审计——boot 装载序 diff 补播）；`--no-plugins` 安全模式跳过全部插件装载（core: 与用户插件都不装）——坏插件锁死启动时的自救位。

## 环境变量

前缀一律 `BERRY_AGENT_*`：

| 变量                                 | 作用                                                                                         | 缺省                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------- |
| `BERRY_AGENT_MODEL`                  | 覆盖缺省模型                                                                                 | `anthropic/claude-sonnet-5` |
| `BERRY_AGENT_DATA_DIR`               | 数据目录                                                                                     | `~/.berry-agent`            |
| `BERRY_AGENT_DB_PATH`                | 库文件路径（独立梯子——重定向库文件而不动数据目录）                                           | `<数据目录>/sessions.db`    |
| `BERRY_AGENT_LOG_LEVEL`              | 日志级别：error / warn / info / debug / silent                                               | `info`                      |
| `BERRY_AGENT_BASH_PATH`              | bash 工具可执行路径（缺失 fail-loud）                                                        | PATH 发现序                 |
| `BERRY_AGENT_FD_PATH`                | `@` 文件补全的 fd 可执行路径（保留位——fd 批未触，当前仅内置遍历，设置无效）                  | —                           |
| `BERRY_AGENT_BROWSER_PATH`           | 浏览器引擎可执行路径                                                                         | 引擎发现序                  |
| `BERRY_AGENT_BIN`                    | scheduler 子进程 spawn 的宿主 bin 真值（cron 行单源）                                        | 进程自身路径推导            |
| `BERRY_AGENT_CRON`                   | cron 可选后端开关/载体                                                                       | 进程内挂钟                  |
| `BERRY_AGENT_GIT_PATH`               | worktree 工具 git 可执行路径（保留位——装配侧未接，当前设置无效）                             | PATH 发现序                 |
| `BERRY_AGENT_SDK_TOKEN`              | serve `--daemon` 线协议面 TCP 侧鉴权 token（`--sdk-host` 非回环必配）                        | 缺省不开 TCP 侧             |
| `BERRY_AGENT_SDK_PORT`               | daemon SDK 面端口 env 补位（`--sdk-port` 旗标缺席时生效；非负整数字串，坏值 fail-loud 拒启） | 旗标缺席即不开              |
| `BERRY_AGENT_SDK_HOST`               | daemon SDK 面绑定地址 env 补位（`--sdk-host` 旗标缺席时生效；非回环值同样必配 token）        | `127.0.0.1`                 |
| `BERRY_AGENT_GITHUB_TOKEN`           | core:issue 件 GitHub 凭证（`/credentials` 录入优先，本变量为回落）                           | 缺席                        |
| `BERRY_AGENT_ISSUE_WEBHOOK_SECRET`   | core:issue 件 webhook 签名密钥（同回落律）                                                   | 缺席                        |
| `BERRY_AGENT_PLUGIN_MIN_RELEASE_AGE` | 插件装机供应链护栏：npm 源最小发布龄分钟数（`0` = 关窗不查）                                 | 1440                        |
| `BERRY_AGENT_MAX_CONCURRENT_RUNS`    | 宿主级 run 并发帽（lane 帽——正整数必需，坏值 fail-loud 拒启；steer/inject 不经闸）           | 16                          |

## 遥测立场

**默认不发任何网络包**——无使用统计、无崩溃上报、无版本检查。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词），此外零。若未来加任何回传，将按四段式公告（Why / How / What / How to disable）披露且默认值反转视为破坏性变更。

## 技能与记忆

- **技能**：SKILL.md 双层结构（frontmatter + 正文），六位发现层（项目 `.agents/skills/` > 用户 `~/.berry-agent/skills/` > 跨库 `~/.agents/skills`、`~/.claude/skills` > 插件 > 出厂）；对话中渐进披露，`skill_manage` 工具可创建/修补；
- **记忆**：跨会话持久条目（偏好、约定、教训），常驻简报 + 按需检索两路注入；`/memory` 副屏轻管理（活体/冻结/终态三分区——冻结切换、忘掉、恢复、导出）；`/memory-export` `/memory-import` 明文迁移；
- **环境自省**：模型工具面含 `session_status`——当前会话状态、整形后可见工具清单与高危面门态快照三段（只读，供模型自省工作环境）；
- **用量观测**：模型工具面含 `obs_query`——小时/日桶聚合查询（`metric=usage` 为 LLM token 用量：input/output 主计费桶与 cache 桶分列、token 原始值不折算货币；`hit_rate` = 缓存命中率派生列 `cacheRead/(input+cacheRead+cacheWrite)` 桶内聚合比值，`n/a` = 桶内无 token 流）。

## 下一步

- [插件开发指南](./plugin-development.md)——写第一个插件；
- [运维手册](./operations.md)——数据目录、备份、故障排查。
