# 使用指南

本文自包含覆盖 berry-agent 的安装、入口命令族、TUI 操作与环境变量。架构背景见[架构总览](./architecture.md)。

> 状态：`0.1.0-alpha`。命令族中标注「尚未装配」的动词会诚实报错退出（解析与旗标面已就绪，执行面随后续版本接入）——不含糊、不静默。包尚未在 npm 首发：安装路一/路二待首发后可用，路三源码构建即时可用。

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

| 命令                | 作用                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| （无参）            | TUI 主入口：直进对话                                                                                                    |
| `run "<message>"`   | 单次执行：一轮对话 → stdout 输出结果                                                                                    |
| `serve`             | 常驻宿主（stdio JSONL；另有 `serve status` / `serve stop` 管理动词）                                                    |
| `mcp`               | MCP server 包装形态                                                                                                     |
| `dump-config`       | 打印实际生效装配（诊断）                                                                                                |
| `plugins <sub>`     | 插件生命周期：`list` 在场；`install/uninstall/mount/unmount/toggle/update/check` 中 `check` 只读、写侧六动词尚未装配    |
| `sessions <sub>`    | 会话管理：`list` / `resume <id>` / `fork <id>` / `search <query>` / `reindex`                                           |
| `credentials <sub>` | 凭证管理：`add <name> <value>` / `list` / `rm <name>`（`--namespace <ns>` 指定域；oauth 授权流仅在 TUI `/credentials`） |
| `upgrade`           | 升级维护动词（尚未装配）                                                                                                |

退出码三态：**0** 成功（含诚实空——空清单/零命中非失败）/ **1** 执行失败 / **2** 环境态误用（用法错、TUI 在非交互环境）。

通用旗标：`--help` / `--version` / `--debug`（日志提级）全入口收；`--port <n>` TUI / run / serve / dump-config 收（dump-config 忽略不起监听）；`--no-plugins` 安全模式不入自动化入口 serve / mcp。

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

TUI 内建命令（随插件装载动态扩展）：`/history`（副屏会话回看）、`/rewind`（边界快照回卷）、`/goal`（目标续跑管理）、`/tick`（定时任务手动推进）、`/browser install`（浏览器引擎安装）、`/credentials`（凭证管理——add/list/rm 与 oauth 授权流）、`/memory-export` `/memory-import`（记忆导入导出）等。

### run 单次执行

```bash
berry-agent run "解释这段代码的作用"
berry-agent run --continue "继续刚才的话题"          # 取当前目录最新会话续接
berry-agent run --session <id> "继续指定会话"         # 按 id 续接
berry-agent run --fork "从这里分叉另起一路"           # 边界快照分叉后续跑
berry-agent run --ephemeral "一次性问题，零落盘"       # 零落盘单发
berry-agent run --read-only "只读分析这个仓库"         # 只读沙箱单发
```

run 旗标族：

| 旗标                                            | 作用                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `--output-format <text\|json\|stream>`          | 输出三档（缺省 text）                                                 |
| `--output-last-message <file>`                  | 末条 assistant 文本原子写文件                                         |
| `--ephemeral`                                   | 零落盘单发（与续接族/`--tick`/`--background` 互斥）                   |
| `--max-turns <n>`                               | turn 数帽（到帽收场如实标 truncated）                                 |
| `--session <id>` / `--continue` / `--fork [id]` | 续接族三选一（互斥）                                                  |
| `--read-only`                                   | read-only 沙箱单发                                                    |
| `--tick <名>`                                   | 到点触发载体：按名读定时任务行自跑其提示词（与 message 位置参数互斥） |
| `--background`                                  | 后台道预算记账入口                                                    |
| `--no-delta`                                    | 线面退订流式增量                                                      |

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
```

写侧六动词（`install`/`uninstall`/`mount`/`unmount`/`toggle`/`update`）解析与旗标面已就绪、执行面尚未装配。当前启用面由数据目录 `enabled.yaml` 直接管理（见[运维手册](./operations.md#启用清单-enabledyaml)）；`--no-plugins` 安全模式跳过全部插件装载（core: 与用户插件都不装）——坏插件锁死启动时的自救位。

## 环境变量

前缀一律 `BERRY_AGENT_*`：

| 变量                               | 作用                                                                  | 缺省                        |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------------- |
| `BERRY_AGENT_MODEL`                | 覆盖缺省模型                                                          | `anthropic/claude-sonnet-5` |
| `BERRY_AGENT_DATA_DIR`             | 数据目录                                                              | `~/.berry-agent`            |
| `BERRY_AGENT_DB_PATH`              | 库文件路径（独立梯子——重定向库文件而不动数据目录）                    | `<数据目录>/sessions.db`    |
| `BERRY_AGENT_LOG_LEVEL`            | 日志级别：error / warn / info / debug / silent                        | `info`                      |
| `BERRY_AGENT_BASH_PATH`            | bash 工具可执行路径（缺失 fail-loud）                                 | PATH 发现序                 |
| `BERRY_AGENT_FD_PATH`              | `@` 文件补全的 fd 可执行路径（缺失退化内置遍历）                      | PATH 发现序                 |
| `BERRY_AGENT_BROWSER_PATH`         | 浏览器引擎可执行路径                                                  | 引擎发现序                  |
| `BERRY_AGENT_BIN`                  | scheduler 子进程 spawn 的宿主 bin 真值（cron 行单源）                 | 进程自身路径推导            |
| `BERRY_AGENT_CRON`                 | cron 可选后端开关/载体                                                | 进程内挂钟                  |
| `BERRY_AGENT_GIT_PATH`             | worktree 工具 git 可执行路径                                          | PATH 发现序                 |
| `BERRY_AGENT_SDK_TOKEN`            | serve `--daemon` 线协议面 TCP 侧鉴权 token（`--sdk-host` 非回环必配） | 缺省不开 TCP 侧             |
| `BERRY_AGENT_GITHUB_TOKEN`         | core:issue 件 GitHub 凭证（`/credentials` 录入优先，本变量为回落）    | 缺席                        |
| `BERRY_AGENT_ISSUE_WEBHOOK_SECRET` | core:issue 件 webhook 签名密钥（同回落律）                            | 缺席                        |

## 遥测立场

**默认不发任何网络包**——无使用统计、无崩溃上报、无版本检查。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词），此外零。若未来加任何回传，将按四段式公告（Why / How / What / How to disable）披露且默认值反转视为破坏性变更。

## 技能与记忆

- **技能**：SKILL.md 双层结构（frontmatter + 正文），六位发现层（项目 `.agents/skills/` > 用户 `~/.berry-agent/skills/` > 跨库 `~/.agents/skills`、`~/.claude/skills` > 插件 > 出厂）；对话中渐进披露，`skill_manage` 工具可创建/修补；
- **记忆**：跨会话持久条目（偏好、约定、教训），常驻简报 + 按需检索两路注入；`/memory-export` `/memory-import` 明文迁移。

## 下一步

- [插件开发指南](./plugin-development.md)——写第一个插件；
- [运维手册](./operations.md)——数据目录、备份、故障排查。
