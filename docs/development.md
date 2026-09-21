# 开发指南

> **EN TL;DR**: You need Node.js ≥ 24 (aggressive mainline tracking — LTS-only
> users cannot install yet). The full suite is ~345 test files / 6000+ cases
> (counts drift with each batch — CI is the source of truth) and takes a few
> minutes on a normal laptop; CI covers Linux and macOS only,
> Windows is untested. Make the four gates green before every PR, and target
> the `dev` branch (`main` is the stable release line). Two vocabulary rules:
> extensions are called plugins (never "app"), and lifecycle verbs are
> install / uninstall / mount / unmount / toggle / update. Chinese comments
> are required; English comments are acceptable — the maintainer translates
> before merge. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the change-tier
> guide and the AI-assistance disclosure policy.

本文面向 berry-agent 仓库贡献者：环境搭建、四门禁、工程约定、测试纪律。使用面见[使用指南](./usage.md)，架构见[架构总览](./architecture.md)。

## 环境搭建

要求 Node.js ≥ 24。版本钉位单源：根 `.nvmrc`（内容 `24`）——`nvm use` 直接对齐；CI 全部 setup-node（十二处——`ci.yml` 十 + `golden-refresh.yml`/`release.yml` 各一）一律 `node-version-file: .nvmrc` 读同源。`engines` 的 `>=24` 是**安装下限**，CI 实测面钉 24.x——换大版本时只改 `.nvmrc` 一处。

**为什么 ≥24**：本仓随主流运行时激进跟进——跟踪当期主线版本、及时采用新语言与运行时特性，而不是等 LTS 排期。代价如实写明：仍在旧 LTS 线上的环境暂不可安装，属已知取舍而非疏漏。

**平台支持**：CI 实测面 = Linux + macOS 双 OS。Windows 未测——`better-sqlite3` 原生模块在 Windows 侧的编译链未验证过，不承诺可装可跑；欢迎带诊断信息的 Windows issue，但修复不排优先级。

**测试规模预期**：全量测试约 345 个测试文件、6000+ 用例（数字随批漂移——以 CI 实测为准）——普通开发机（近几年主流配置的笔记本）本地全量数分钟；CI 在双 OS 上各完整跑一遍。

```bash
git clone https://github.com/miuiadmin/berry-agent.git
cd berry-agent
npm install
```

## 四门禁（提交前全绿）

```bash
npm run typecheck       # 门禁一：tsc --noEmit（root + SDK 包测试配置 + webui 客户端三段）
npm test                # 门禁二：vitest run
npm run lint:topology   # 门禁三：模块 DAG 边表 + API 治理面 + 词汇查项门禁
npm run format:check    # 门禁四：prettier 检查
```

```bash
npm run format          # prettier 写入（写后如再手编须重读文件）
npm run build           # 构建链：webui（vite）→ tsc 直出 dist/ → API 声明快照 → 溯源戳（build-meta）
npm run build:sdk       # SDK 包独立构建（packages/berry-agent-sdk）
```

注意构建链序制：**禁止单独倒跑 `build:webui`**（vite `emptyOutDir` 会抹掉 tsc 产物——必须整链 `npm run build`）。

## CI 红归因对轨（本地复现哪个 job 红了）

CI（`.github/workflows/ci.yml`）各 job 与本地命令对照——CI 红先在此表对号，本地复现定位，不开盲盒：

| CI job                                   | 本地对轨命令                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| repo-files（配套面在场锁）               | 逐件 `[ -s <文件> ]`（六件清单见 ci.yml repo-files 步——SECURITY.md / CODEOWNERS / issue 模板三件 / PR 模板）                |
| install-script（语法 + 文案 + 真跑装机） | `sh -n scripts/install.sh` + 管道直灌 grep（正则见 ci.yml 同名步）                                                          |
| audit                                    | `npm audit --omit=dev`                                                                                                      |
| release-drill                            | `npm run release -- --dry-run` + `npm run release:sdk -- --dry-run`（CI 形另含临时 bump——本地直跑即近似）                |
| typecheck / lint / format                | 同名 npm script（`npm run typecheck` / `npm run lint:topology` / `npm run format:check`）                                   |
| test（ubuntu 腿）                        | `npm test`（macOS 腿本地即本机平台）                                                                                        |
| coverage                                 | `npx vitest run --coverage`                                                                                                 |
| soak（nightly 19:23 UTC + 手动）         | `node tools/soak.mjs --rounds 3 --mode quick --kill-exercise --rss-budget-mb 384 --unattended`（与 ci.yml soak 步同款单源） |
| flaky-probe（nightly 双跑腿）            | 同 commit 连跑两次 `npm test`——任一红即 CI 同款告警形                                                                       |
| coverage-weekly（周一序列留档）          | `npx vitest run --coverage`（读 `coverage/coverage-summary.json` 三百分比）                                                 |

**Linux-only 红的本地复现谱**（macOS 开发机复现 CI ubuntu 面——bwrap 真跑腿/平台分支）：

```bash
docker run --rm -it -v "$PWD":/repo -w /repo node:24 bash
# 容器内：装 bwrap + 放行 userns（与 CI 装腿同源——Ubuntu 24.04 起 AppArmor
# 默认限制非特权 userns，bwrap 建命名空间会被拒；CI runner VM 一次性环境
# 无虞，本机容器同理）
apt-get update && apt-get install -y bubblewrap
sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 || true
npm ci && npm test
```

（seccomp/apparmor 注记：某些 Docker 桌面版默认 seccomp 配置挡 `clone(CLONE_NEWUSER)`——若 bwrap 报 `Operation not permitted`，须在 Docker Desktop 设置里放宽 seccomp 或换 `--security-opt seccomp=unconfined` 起容器；这是宿主容器面约束，不是本仓测试缺陷。）

## 依赖更新 PR 处置（Dependabot）

Dependabot 周检自动开更新 PR（`.github/dependabot.yml`——dev 依赖与 actions 引用整组收拢，生产依赖单开）。处置纪律：

- **minor/patch 组 PR**：门禁绿即合并——批内清不积攒（与人工 PR 同一提交纪律：完成即处置）；
- **major 升级 SOP**（无论组内单开）：
  1. 读 changelog / release notes——确认破坏面与迁移步骤；
  2. 全量四门禁 `npm run typecheck && npm test && npm run lint:topology && npm run format:check`；
  3. 动到原生模块（`better-sqlite3`）或沙箱链（bwrap 相关）的，走上一节 docker Linux 复现谱真跑一遍 ubuntu 面；
  4. 有破坏面的（API 改形、配置换代）在 PR 里写迁移说明再合，不在门禁绿后闷头合；
- **积压巡检**：每周清点一次 Dependabot PR 队列——超两周未处置的升级呈维护者拍优先级（积压本身是信号：要么分组没圈住噪音面，要么升级链条有未解依赖冲突）。

## 模块拓扑（DAG 律）

全仓 28 席模块单向 DAG，边表真源在 `tools/check-topology.mjs`（`MODULE_EDGES`）。执法面：

- 相对导入只走边表白名单——未声明边红、声明未用死边红（**双向执法**）；
- 裸导入白名单**两账分离**（产码账 / 测试账——测试需求不给产码白名单续命）；
- 公开面收敛：跨模块只走对方 `index.ts` / `types.ts` / `events.ts` 三名；
- 「N 模块」宣称 ≡ 边表实数（计数锚——数字漂移即红）。

两条硬边界常踩：`better-sqlite3` 只准出现在 `persist`；`agent` 不 import `llm`（loop 只认 StreamFn 签名）。新增跨模块消费先查边表、再改边表（新席入册）。

## 仓库布局

```
src/
  contracts/    全仓共享契约（事件词汇、错误基类、工具/通道类型）——零依赖
  context/      作用域容器
  session/      会话域（SessionManager）
  agent/        模型对话域
  llm/          模型运行时（provider 注册表、faux 测试 provider）
  persist/      SQLite 持久化（迁移框架、durable 事件、FTS、aux 库）
  tools/        工具注册表
  safety/       安全判据面（沙箱、审批、tool-policy 策略表）
  compaction/   上下文压缩
  channels/     呈现通道核（信封路由 + TUI 引擎件族全套）
  conversation/ 对话组合域（driver、三通道路由、todo）
  host/         装配根（CLI、运行时、插件装载、五入口）
  <16 个 core: 插件域>  exec skills web scheduler goal subagent checkpoint
                        memory mcp lsp browser webui sdk obs issue credentials
packages/
  berry-agent-sdk/      类型化 SDK 客户端包（stdio/HTTP 两传输）
tools/                  门禁检查器族（check-topology / check-api / emit-api-decls）
docs/                   公开文档面（本五册）
```

## 工程约定

- **注释中文、标识符英文**：所有新写代码充分中文注释（JSDoc + 关键分支行内——写「为什么」不写「是什么」）。中文注释是硬要求；非中文使用者可提交英文注释，合并前维护者统一翻译落定。
- **命名去品牌化**：代码标识符禁品牌词。品牌词只允许出现在 package.json name/keywords、bin 命令名、UI 文案/文档标题、对外声明值位（`~/.berry-agent`、`BERRY_AGENT_*`、`berry-agent-plugin` keyword、虚拟主键 `berry-agent`、值位 magic/格式串三件——memory 导出 `berry-agent-memory`、会话导入 `berry-agent/session`、cron marker `# berry-agent:<名>`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update；
- **env 前缀**：一律 `BERRY_AGENT_*`；
- **提交**：commit 粒度——一个逻辑变更一批即可，合并时维护者 squash 整形；本地怎么分批不做要求。

## 契约先行与边界讨论

- **contract-first**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **边界讨论先行**：涉及宿主固定件行为、契约面（新扩展点/钩子）、事件词汇、错误码、API 面（L3），或新模块、新拓扑席位、边表新边、安全模型（L4）的改动，先在 issue 中就边界达成一致再动手——改动分级表见[贡献指南](../CONTRIBUTING.md#改动分级指南先对号再动手)；
- **「规范先行」是维护者侧流程**：触及设计边界（模块边界、事件词汇、错误码、API 面、预算护栏等规范覆盖行为）的改动，由维护者在内部规范侧完成先行批之后再收 PR。外部贡献不走也不需要走这套流程，以 issue 讨论为入口即可——L3/L4 周期较长属正常流程。

## 黑话翻译（读提交历史与源码时用得上）

- **「规范先行」「冷读闸」**（提交历史常见）：维护者内部设计治理流程的环节名，外部贡献者无需也无法参与；你的 PR 涉及时由维护者收口并在 PR 中说明。
- **「0X 篇 §Y」**（源码头注常见）：指内部设计规范（非公开文档）；以头注正文与 docs/ 公开文档为准即可。

## 测试纪律

- **分层**：单元纯逻辑 → 组合根全栈；
- **mock 只停在模型层**：faux provider / 脚本化 streamFn，其余全真（真库、真装载、真装配）；
- 禁止 mock 中间层后断言高层模块（假信心）；
- 禁止断言 AI 生成的具体文本内容；
- **修 bug 必带回归锁**（修复前必红）；
- 测试零真网络——网络面用注入 fetchImpl/假面；
- **失真源登记**：环境与 mock 面的已知非误报源/失真源登记在案（本节下册 + 件级条目记相关测试文件头注）——「这个红是环境的不是代码的」「这个绿是 mock 造的」两类知识须可查，新增失真源随发现随登记。

### 已知测试基建事实（失真源登记册——一行一源：现象 + 根因 + 判别法）

- vitest setup 每测试文件钉 `BERRY_AGENT_DATA_DIR` 到临时根：同文件内所有无显式 `dbPath` 的开库**共享同一库文件**（跨文件隔离、文件内共享）——全局断言（无 workspace 过滤的 list/search）必须显式 `dbPath` 隔离或按 workspaceRoot 作用域化；
- `Persistence.open({ dataDir })` **不重定位库文件**——库文件路径走 `resolveDatabasePath()` 三级梯子（`BERRY_AGENT_DB_PATH` > `<数据目录>/sessions.db` > `~/.berry-agent/sessions.db`），`dataDir` 只锚定 secret.key 等数据目录内文件；
- vitest 吞 console——调试走 `appendFileSync` 到 `/tmp`（判别法：测试内 console.log 静默 ≠ 未执行）；
- faux provider **恒实算 usage** 覆写脚本值——usage 断言按实算结果写，不按脚本注入值写；
- exec spawn 截尾测试满载偶发 flake（单跑恒绿）——观察项：全量跑红时先单跑复核再定位；
- tmux e2e `/themes` esc 收屏腿 ubuntu 慢机偶发 25s 帽红（失败 dump 尾恒见 DA1 应答残段 `^[[?1;2;4c` 泄屏——迟答防御律 ca7027c 修复面外的相位形）——判别法：rerun `--failed` 绿即定谳抖动（本地 macOS 干净树绿佐证）；再红才深挖引擎 CSI 迟答相位；
- nightly flaky-probe 双跑腿（CI `flaky-probe` job，label `flaky-nightly` issue 告警）：同 commit 推送 CI 绿而夜间双跑任一红 = 抖动信号（非回归定论）——处置序：先本地 `npm test` 单跑复核（登记册各行逐源判别）再定位；两次全绿的 commit 即 close 告警 issue；
- macOS 开发机是 BSD grep/sed（不支持 GNU 的 `\|` 交替等）——仓内脚本与手工排查用 `grep -E`/`perl -pi -e`，勿照搬 GNU 语法。

## API 治理面

公开 API 面（插件作者可见的导出面）受机器执法：快照真源 `src/contracts/api-surface.json`，`npm run lint:topology` 链中的 `tools/check-api.mjs` 将快照与代码抽取真值比对——**面漂移当场红**；`api-decls/` 派生声明与 `dist/api/` 随包产物同理（生成物 drift 另有一查）。

**tier 三档**——每个公开符号必带 tier 标注：

| tier           | 含义                                                          |
| -------------- | ------------------------------------------------------------- |
| `stable`       | 稳定面——兼容性承诺在身，破坏性变更须走废弃登记而非直接改      |
| `experimental` | 实验面——不承诺兼容、可无预告移除（现役 = testkit 测试工具域） |
| `deprecated`   | 已废弃面——新代码禁用，登记移除坐标后按版次摘除（现役为零）    |

**since 坐标**——每个符号带 `since`（入册时的宿主 `apiVersion` 版本号），与废弃面的移除坐标共用一套版本坐标系；「面动号不动」是执法不变式：公开面变更须随批提版本号。

**改公开面标准三步**（漏任一步 check-api 即红）：

1. 改码（公开根直导出的 tier/description 从声明点 JSDoc 收割——标签别漏写）；
2. 再生快照：`node tools/extract-api-surface.mjs --write`；
3. 再生声明：`npm run build`（`emit-api-decls` 随 build 尾段产 `dist/api/` 与 `api-decls` 派生 `.d.ts`）。

## 发布流程（维护者）

发布机器 = `tools/release.mjs`（六道契约编舞——门禁前置 / registry 探测 / 构建验收与安装冒烟 / publish 单点 / dist-tag 终态断言 / 尾件 git tag）。执行形三分（`resolveReleaseForm` 单源解析：`--local-publish` 旗标 > env `BERRY_AGENT_RELEASE_MODE=ci` > 包描述符 `publishMode` 缺省）：

| 执行形                                                   | 谁跑                         | 语义                                                                                                                                            |
| -------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 本机触发腿（双包缺省）                                   | 维护者本机 `npm run release` / `npm run release:sdk` | 预检 → 打 tag push 交棒 → 轮询 CI run → registry 复探收口 → preview 期本机 `dist-tag set latest` → 终态复断。本机零 publish                     |
| CI 发布腿（`.github/workflows/release.yml`）             | tag `v*` / `sdk-v*` push 触发 | OIDC 免令牌免 2FA publish；契约 5 只读断言 `next`、契约 6 只校验既有 tag；链尾归档当版 API 面快照挂该版 GitHub Release（assets——版本化 API 史；归档步仅主包，SDK run 跳过） |
| 令牌全本地旧序（`--local-publish` 显式应急）             | 本机 npm 凭证                | 六道契约原序全本地                                                                                                                              |

常规发版（主包）：改 `package.json` version → commit → `npm run release`——脚本完成交棒、等待 CI（gh CLI 轮询，30 分钟帽）、收口与 latest 挪位，全绿即发版完成。SDK：改 `packages/berry-agent-sdk/package.json` version → `npm run release:sdk`——同一条编舞（交棒 `sdk-v*` tag、CI OIDC publish、本机 latest 挪位），差异全在包描述符。

- **演习两形**：
  - 发布机器演习：`npm run release -- --dry-run`（CI 等待段不在演习射程——恒投影令牌道旧序）；
  - release 工作流文件改动预演：改 `.github/workflows/release.yml` 的 PR，合流前在 Actions → release → Run workflow（ref=`dev`、tag=最新已发 tag）跑一次 dispatch 演习位——同 tag 重跑走幂等空转复验形（发布契约 6 只校验既有 tag 不重发），验证改动后的工作流链路本身可走通；run 链接附 PR（自检清单有对应勾位）。
- **失败恢复（交棒后 CI 红）**：删远端与本地 tag → 修 commit → 重新交棒；树无恙的环境偶发红可 GitHub UI re-run failed jobs；
- **tag 保护**：`v*` / `sdk-v*` 创建/删除限 admin/维护者（push ruleset）——tag 即发布触发器，推 tag ≈ 发布。

## 贡献流程

1. 按改动分级（[贡献指南](../CONTRIBUTING.md#改动分级指南先对号再动手)）确认前置要求——L3/L4 先开 issue 讨论边界（周期较长属正常流程）；
2. fork + 分支；
3. 改动前读相关模块头注（每件头注即该域的设计真源摘要；头注中「0X 篇 §Y」指内部规范，以头注正文为准）；
4. 四门禁全绿；
5. PR 一律打 **`dev`** 分支——`main` 为稳定发布线，只随发布快进；描述四段式：动机 / 改动面 / 测试证据 / 自检清单（含 AI 辅助披露）。

**AI 辅助**：不禁止 AI 辅助开发，人类必须是责任主体——PR 自检清单两勾（通读负责 + 用途披露），纯 AI 生成且未经人审的 PR 直接关闭；政策全文见[贡献指南](../CONTRIBUTING.md#ai-辅助贡献政策温和披露制)。

行为准则：对事不对人；技术分歧以契约、公开文档与代码事实为准；不确定的先问再动手。
