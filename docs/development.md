# 开发指南

本文面向 berry-agent 仓库贡献者：环境搭建、四门禁、工程约定、测试纪律。使用面见[使用指南](./usage.md)，架构见[架构总览](./architecture.md)。

## 环境搭建

要求 Node.js ≥ 24。

```bash
git clone https://github.com/miuiadmin/berry-agent.git
cd berry-agent
npm install
```

## 四门禁（提交前全绿）

```bash
npm run typecheck       # 门禁一：tsc --noEmit（root + SDK 包测试配置 + webui 客户端三段）
npm test                # 门禁二：vitest run
npm run lint:topology   # 门禁三：模块 DAG 边表 + API 治理面门禁
npm run format:check    # 门禁四：prettier 检查
```

```bash
npm run format          # prettier 写入（写后如再手编须重读文件）
npm run build           # 构建链：webui（vite）→ tsc 直出 dist/ → API 声明快照
npm run build:sdk       # SDK 包独立构建（packages/berry-agent-sdk）
```

注意构建链序制：**禁止单独倒跑 `build:webui`**（vite `emptyOutDir` 会抹掉 tsc 产物——必须整链 `npm run build`）。

## 模块拓扑（DAG 律）

全仓 27 席模块单向 DAG，边表真源在 `tools/check-topology.mjs`（`MODULE_EDGES`）。执法面：

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
  safety/       安全判据面（沙箱、审批、allowlist）
  compaction/   上下文压缩
  channels/     呈现通道核（信封路由 + TUI 引擎件族全套）
  conversation/ 对话组合域（driver、三通道路由、todo）
  host/         装配根（CLI、运行时、插件装载、五入口）
  <15 个 core: 插件域>  exec skills web scheduler goal subagent checkpoint
                        memory mcp lsp browser webui sdk obs issue
packages/
  berry-agent-sdk/      类型化 SDK 客户端包（stdio/HTTP 两传输）
tools/                  门禁检查器族（check-topology / check-api / emit-api-decls）
docs/                   公开文档面（本五册）
```

## 工程约定

- **注释中文、标识符英文**：所有新写代码充分中文注释（JSDoc + 关键分支行内——写「为什么」不写「是什么」）；
- **命名去品牌化**：代码标识符禁品牌词。品牌词只允许出现在 package.json name/keywords、bin 命令名、UI 文案/文档标题、对外声明值位（`~/.berry-agent`、`BERRY_AGENT_*`、`berry-agent-plugin` keyword、虚拟主键 `berry-agent`、magic 串 `berry-agent:host`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update；
- **env 前缀**：一律 `BERRY_AGENT_*`；
- **提交**：一个逻辑完整的变更 = 一次 commit，完成即提交不积攒；逐文件点名 `git add`、慎用 `git add -A`；commit 前核 `git status` 无未登记残留。

## 契约先行与文档先行

- **contract-first**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **文档先行**：凡改动规范已覆盖的行为（模块职责、事件词汇、错误码、API 面、预算护栏……），先改规范篇章再落码，commit 标题注明「规范先行」；规范没写的先补规范再写代码。

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
- macOS 开发机是 BSD grep/sed（不支持 GNU 的 `\|` 交替等）——仓内脚本与手工排查用 `grep -E`/`perl -pi -e`，勿照搬 GNU 语法。

## API 治理面

`tools/check-api.mjs` 执法 API 面快照（`emit-api-decls` 随 build 链再生）——公开面变更须随批同步快照；apiVersion 语义与破坏性变更立场见[架构总览](./architecture.md)。

## 贡献流程

1. fork + 分支；
2. 改动前读相关模块头注（每件头注即该域的设计真源摘要）；
3. 四门禁全绿；
4. PR 描述含：动机 / 改动面 / 测试证据（新增或变更的测试点名）。

行为准则：对事不对人；技术分歧以规范与代码事实为准；不确定的先问再动手。
