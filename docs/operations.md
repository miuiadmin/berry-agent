# 运维手册

本文面向部署与维护 berry-agent 的使用者：数据目录、备份恢复、启用清单、常驻宿主管理、故障排查。使用面见[使用指南](./usage.md)。

## 数据目录

缺省 `~/.berry-agent/`，`BERRY_AGENT_DATA_DIR` 可整体重定位：

| 路径                  | 内容           | 说明                                                                                                                                                                                                                                                                  |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions.db`         | 主库（SQLite） | 会话/事件/FTS/记忆/定时任务/目标全在这一个文件；0600 权限自检修复。`BERRY_AGENT_DB_PATH` 三级梯子可独立重定向（重定向库文件不动数据目录其余件）                                                                                                                       |
| `secret.key`          | 加密钥         | 凭证加密钥——**与主库同备份或都不备**（钥失配即旧凭证不可解）                                                                                                                                                                                                          |
| `active.json`         | 单活跃机标记   | `{ pid, startedAt }`；启动即写，pid 死自动接管                                                                                                                                                                                                                        |
| `enabled.yaml`        | 启用清单       | 插件启用面（见[下文](#启用清单-enabledyaml)）                                                                                                                                                                                                                         |
| `plugins/ledger.json` | 装机账本       | 装了什么（与 enabled.yaml「要什么」两账两名对仗）                                                                                                                                                                                                                     |
| `plugins/<id>/`       | 装机树         | 磁盘插件包体                                                                                                                                                                                                                                                          |
| `skills/`             | 用户技能层     | SKILL.md 目录（六位发现层第二位）                                                                                                                                                                                                                                     |
| `agents/`             | 用户子代理层   | frontmatter 子代理定义目录（四位子代理发现层第二位）                                                                                                                                                                                                                  |
| `tool-policy.json`    | 工具策略表     | 审批选 always 的工具+参数条目持久回写 + 用户手写 `deny` 主权硬拒条目（用户资产，非配置）；更名前的旧审批清单文件在场时自动升格读入、旧文件留置不动（机器永不写旧名）                                                                                                  |
| `data/obs/rollup.db`  | 观测自管库     | core:obs 派生观测数据（可删——重建即恢复）                                                                                                                                                                                                                             |
| `crash.log`           | 崩溃取证       | 崩溃路径先写一行再退；排障第一站                                                                                                                                                                                                                                      |
| `serve/`              | 常驻宿主足迹   | daemon 形三件：`daemon.pid`（pid 登记——status/stop 消费）/ `daemon.sock`（unix sock 缺省接入点）/ `daemon.log`（stderr 重定向日志——**daemon 形自动生成 token 的明文披露位**，敏感读集成员）；目录常态可缺席、`berry serve --daemon` 启动才建、`berry serve stop` 清除 |

## 备份与恢复

冷备（推荐——退出所有进程后）：

```bash
# 停常驻宿主（如在场）
berry serve stop

# 整目录打包（主库 + 密钥 + 清单 + 技能一次全备）
tar czf berry-agent-backup.tar.gz -C ~ .berry-agent
```

恢复 = 解包回原位。单活跃机标记 `active.json` 无需保真——恢复后首启若报「已有活跃进程」，确认无真进程在跑即重启自接管。

只备份对话历史：`sessions.db` 单文件即全量（事件流 + FTS 索引 + 投影派生物全在内库）。**不要**在进程运行中热拷贝 SQLite 文件——可能拷到撕裂态。

## 启用清单 enabled.yaml

```yaml
plugins:
  - id: my-plugin
    config: { ... } # 可选，按插件 manifest config 判据校验
    disabled: true # 可选，行级禁用
    opens: [...] # 可选，高危面开门授予集（默认全关）
```

- **缺席 = 全 core: 内置态**：首启零文件零负担，官方 16 件随包出厂、15 件默认全启（`core:issue` 需行配 `config` 才装载——见[使用指南](./usage.md)）；
- **损坏 = fail-loud 拒启**：报错附修复指引；删除该文件即回全内置态；
- 用户行与 `core:` 同名行字段级后写胜出（可禁用单个官方件或覆盖其 config）。

## 常驻宿主管理

```bash
berry serve --daemon     # 后台守护（unix sock 缺省接入点；--port / --sdk-port 开 TCP 面）
berry serve status       # 态查询（只读豁免——不占单活跃机）
berry serve stop         # 停守护
```

守护猝死不需要人工清标记——活跃标记随进程亡，下次启动 pid 判死后自动接管。

## 长跑 soak（仓库驱动器）

`tools/soak.mjs` 是入仓的长稳取证轨道：起真实 daemon → 逐轮打负载（对话 / read 工具 / bash 写动作三混合）→ 逐轮 RSS 采样 → 可选中段 kill -9 现场恢复演练 → 汇总表 + 机读 jsonl。全程自持离线：每次运行自铸独立临时数据目录（**绝不写真 `~/.berry-agent`**），模型走驱动器生成的本地 echo provider（Anthropic messages 协议脚本模型，零网络零凭证）——考的是宿主韧性，不是模型质量。

```bash
node tools/soak.mjs                                            # 缺省 3 轮 quick（CI 冒烟形）
node tools/soak.mjs --rounds 72 --mode long                    # 小时级节律（40s 轮间隔）
node tools/soak.mjs --rounds 8 --mode mixed --kill-exercise    # 三混合 + 中段 kill -9 恢复演练
node tools/soak.mjs --rounds 50 --rss-budget-mb 512            # 带 RSS 预算帽
node tools/soak.mjs --err-lines-cap 2                          # 放宽 daemon.log error 行帽（缺省 0 零容忍）
node tools/soak.mjs --rounds 3 --kill-exercise --rss-budget-mb 384 --unattended    # CI nightly 同款全形（含无人值守三腿）
node tools/soak.mjs --rounds 24 --drift-cap 2.5                # 收紧延迟漂移帽（缺省 3.0；0 = 关闭）
```

看什么指标：

- **轮次**：全轮 `ok` = durable 事件 `turn/end` 且 reason≠error（error 轮/超时轮都记 fail）；
- **RSS 首末与峰值**：泄漏判据——长窗净增长平或负为正常；kill 重启后的预热峰值是已知工作集常态（回落分钟级），汇总单列不计入预算；
- **kill 演练**（`--kill-exercise`）：pid+token 双换代、断点会话续接收场、durable 台账只增不减，三项全过才 PASS；
- **daemon.log error 行**：判收面——行数 ≤ `--err-lines-cap`（缺省帽 0：error 行增长即红，不再带病绿）；已知噪声源可传帽放宽；
- **seq 无洞**：收场逐会话校验 durable 事件 seq 从 0 起相邻差恰 1（与恢复测试的进程内不变式同源——中段丢条/序号断线由此拦，count-based 只增不减拦不住）；
- **无人值守三腿**（`--unattended`，研究档 C4'）：① 跨 tick 会话——echo 插件注册 every:1m 巡检行，前台全静默过 5min 静默窗后自治 fire，非驱动器会话收场 ok 计数 ≥1；② 跨压缩窗——专用会话打 460KB 填充轮（判据分母 = fallbackWindowTokens 200k 常量、当前轮足额入请求故单轮过阈）至 `compaction/start` 落账 ≥1 且压缩后续接轮 ok（双达标才计）；③ 跨停靠唤醒——本轨道未启用（budget 为装配期常量、进程内不可驱动至绿终态），`dockResumeOk` 恒 null 容忍；
- **延迟漂移**（`--drift-cap`，缺省 3.0）：末 1/3 逐轮 dt 中位数 ÷ 首 1/3 中位数 ≤ 帽——劣化趋势（如事件积压/投影重建变慢）由此拦；kill 重启预热轮剔样本；整数轮样本 <6 恒豁免（quick 三轮天然不执法，防 nightly 假红）。

预算含义：`--rss-budget-mb N` 是稳态 RSS 峰值帽，超帽退出码 1（CI nightly 防回归闸用——nightly 实接 384MB 帽，红时自动收割三件套现场并开 issue 告警）。退出码 0 = 七判据全绿（轮次 / 演练 / 预算 / error 行帽 / seq 无洞 / 无人值守三腿〔仅 `--unattended` 执法〕/ 延迟漂移〔样本足才执法〕）；1 = 任一失败。产物（每轮 jsonl + daemon.log + 临时数据目录路径）收场打印，留档不清理。

历史取证档（160 轮 / 11.95h 天级长跑、判收律沿革）存于维护者私有知识域、不随仓库分发——本驱动器即该证据的可复跑轨道化，判收口径与其同源。

## 故障排查

### 启动报「数据目录已有活跃进程」

单活跃机执法：同一数据目录同一时刻恰一活跃进程。处置序：

1. `berry serve status` 看是否真有守护在场；
2. 确认报错中的 pid 是否存活（`ps -p <pid>`）；
3. pid 已死 → 直接重启（自动接管，无需清标记）；
4. 确需双实例并存 → 用 `BERRY_AGENT_DATA_DIR` 分离数据目录。

### TUI 起不来（疑似坏插件）

```bash
berry --no-plugins     # 安全模式：core: 与用户插件全跳过
```

起来后修复 enabled.yaml（删坏行或整文件回内置态），再正常启动。

### 崩溃排查

看数据目录 `crash.log` 末行（时戳 + 错误描述）。崩溃取证在退出前同步写入——有此档即崩溃路径，无此档的失败是干净退出档（配置/环境问题，见 stderr 文案）。

### 会话检索结果异常/缺失

FTS 索引是派生物（不修不补）：

```bash
berry sessions reindex   # 全量重建即修复
```

### 模型调用失败

- 凭证按 provider 生态变量供给（如 `ANTHROPIC_API_KEY`）——数据目录内 `secret.key`（0600）为加密钥本体；
- `BERRY_AGENT_MODEL` 覆盖缺省模型——值须是已注册 provider 的合法 `provider/model` 形；
- 缺省解析 anthropic 档——faux-only/自定义 provider 运行时必须显式点名模型。

### Web 面连不上

- `--port` 面恒回环（127.0.0.1）——远程访问需自行加 SSH 隧道，进程不绑非回环；
- 访问令牌披露分两形：前台形（TUI `--port` / 前台 `serve`）启动 stderr **一次性**显示，丢失即重启进程重新生成；daemon 形（`serve --daemon`）token 落数据目录 `serve/daemon.log`（自动生成档唯一披露位——事后可查、不再复现）；
- `core:webui` 件被禁用时面仍开但 `/api/*` 404（SDK 程序调用面 `/v1/*` 不受累）。

### 数据库升级降级

主库迁移链只进不退：**新版本进程开旧库自动迁移；旧版本进程开新库拒绝启动**（降级运行保护）。跨大版本回退前先备份。

## 遥测立场

**默认零数据外传（零遥测）**——无使用统计、无崩溃上报。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词）+ **TUI 交互启动一次有界只读版本检查**（只读 GET dist-tags、上行零字节、24h 节流、`BERRY_AGENT_SKIP_UPDATE_CHECK` 置值即关、headless/daemon 形零 fire——07 §8.5 第 6 条），此外零。若未来加任何回传：上线前按四段式模板公告（Why this exists / How it works / What data is collected / How to disable it）；默认值反转视为破坏性变更；disable 通道真实有效（关掉即零网络包，机器可验证）。
