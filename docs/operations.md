# 运维手册

本文面向部署与维护 berry-agent 的使用者：数据目录、备份恢复、启用清单、常驻宿主管理、故障排查。使用面见[使用指南](./usage.md)。

## 数据目录

缺省 `~/.berry-agent/`，`BERRY_AGENT_DATA_DIR` 可整体重定位：

| 路径                  | 内容             | 说明                                                                                                                                            |
| --------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessions.db`         | 主库（SQLite）   | 会话/事件/FTS/记忆/定时任务/目标全在这一个文件；0600 权限自检修复。`BERRY_AGENT_DB_PATH` 三级梯子可独立重定向（重定向库文件不动数据目录其余件） |
| `secret.key`          | 加密钥           | 凭证加密钥——**与主库同备份或都不备**（钥失配即旧凭证不可解）                                                                                    |
| `active.json`         | 单活跃机标记     | `{ pid, startedAt }`；启动即写，pid 死自动接管                                                                                                  |
| `enabled.yaml`        | 启用清单         | 插件启用面（见[下文](#启用清单-enabledyaml)）                                                                                                   |
| `plugins/ledger.json` | 装机账本         | 装了什么（与 enabled.yaml「要什么」两账两名对仗）                                                                                               |
| `plugins/<id>/`       | 装机树           | 磁盘插件包体                                                                                                                                    |
| `skills/`             | 用户技能层       | SKILL.md 目录（六位发现层第二位）                                                                                                               |
| `allowlist.json`      | 审批 always 清单 | 审批选 always 的工具+参数指纹持久回写（用户资产，非配置）                                                                                       |
| `data/obs/rollup.db`  | 观测自管库       | core:obs 派生观测数据（可删——重建即恢复）                                                                                                       |
| `crash.log`           | 崩溃取证         | 崩溃路径先写一行再退；排障第一站                                                                                                                |

## 备份与恢复

冷备（推荐——退出所有进程后）：

```bash
# 停常驻宿主（如在场）
berry-agent serve stop

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

- **缺席 = 全 core: 内置态**：首启零文件零负担，官方 16 件默认全启；
- **损坏 = fail-loud 拒启**：报错附修复指引；删除该文件即回全内置态；
- 用户行与 `core:` 同名行字段级后写胜出（可禁用单个官方件或覆盖其 config）。

## 常驻宿主管理

```bash
berry-agent serve --daemon     # 后台守护（unix sock 缺省接入点；--port / --sdk-port 开 TCP 面）
berry-agent serve status       # 态查询（只读豁免——不占单活跃机）
berry-agent serve stop         # 停守护
```

守护猝死不需要人工清标记——活跃标记随进程亡，下次启动 pid 判死后自动接管。

## 故障排查

### 启动报「数据目录已有活跃进程」

单活跃机执法：同一数据目录同一时刻恰一活跃进程。处置序：

1. `berry-agent serve status` 看是否真有守护在场；
2. 确认报错中的 pid 是否存活（`ps -p <pid>`）；
3. pid 已死 → 直接重启（自动接管，无需清标记）；
4. 确需双实例并存 → 用 `BERRY_AGENT_DATA_DIR` 分离数据目录。

### TUI 起不来（疑似坏插件）

```bash
berry-agent --no-plugins     # 安全模式：core: 与用户插件全跳过
```

起来后修复 enabled.yaml（删坏行或整文件回内置态），再正常启动。

### 崩溃排查

看数据目录 `crash.log` 末行（时戳 + 错误描述）。崩溃取证在退出前同步写入——有此档即崩溃路径，无此档的失败是干净退出档（配置/环境问题，见 stderr 文案）。

### 会话检索结果异常/缺失

FTS 索引是派生物（不修不补）：

```bash
berry-agent sessions reindex   # 全量重建即修复
```

### 模型调用失败

- 凭证按 provider 生态变量供给（如 `ANTHROPIC_API_KEY`）——数据目录内 `secret.key`（0600）为加密钥本体；
- `BERRY_AGENT_MODEL` 覆盖缺省模型——值须是已注册 provider 的合法 `provider/model` 形；
- 缺省解析 anthropic 档——faux-only/自定义 provider 运行时必须显式点名模型。

### Web 面连不上

- `--port` 面恒回环（127.0.0.1）——远程访问需自行加 SSH 隧道，进程不绑非回环；
- 访问令牌仅启动 stderr **一次性**显示；丢失即重启进程重新生成；
- `core:webui` 件被禁用时面仍开但 `/api/*` 404（SDK 程序调用面 `/v1/*` 不受累）。

### 数据库升级降级

主库迁移链只进不退：**新版本进程开旧库自动迁移；旧版本进程开新库拒绝启动**（降级运行保护）。跨大版本回退前先备份。

## 遥测立场

**默认不发任何网络包**——无使用统计、无崩溃上报、无版本检查（不探测新版本）。出厂网络面 = 凭证供给的模型调用 + 用户显式动作（fetch 工具 / `--port` 开面 / 插件装机与更新 / upgrade 维护动词），此外零。若未来加任何回传：上线前按四段式模板公告（Why this exists / How it works / What data is collected / How to disable it）；默认值反转视为破坏性变更；disable 通道真实有效（关掉即零网络包，机器可验证）。
