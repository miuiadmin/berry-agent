# AGENTS.md

> EN TL;DR: This file guides AI coding agents working in this repo. Chinese is
> the working language; comments in code are Chinese, identifiers are English.
> Always target the `dev` branch, and make the four gates green before you
> commit. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full protocol.

面向 AI 编码代理（与人类贡献者同规同门）：本仓工作语言中文，四门禁是硬闸，
以下纪律在 PR 评审中逐条执行。

## 常用命令

```bash
npm run typecheck       # tsc 三连——主 tsconfig + sdk 测试配置 + webui-client（门禁一）
npm test                # vitest run（门禁二）
npm run lint:topology   # 模块 DAG 边表 + API 快照门禁（门禁三）
npm run format:check    # prettier 检查（门禁四）
npm run format          # prettier 写入
npm run build           # 发布物复合链——webui (vite) + tsc 直出 dist/ + API 声明导出 + 溯源戳
```

四门禁提交前全绿。

## 工程纪律（硬规则——PR 评审逐条执行）

- **契约先行**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **模块边界**：28 席单向 DAG，跨模块只走对方公开面（`index.ts` / `types.ts` / `events.ts` 三名）；`lint:topology` 执法；better-sqlite3 只准出现在 persist；agent 不 import llm；
- **注释中文、标识符英文**：新写代码充分中文注释（JSDoc + 关键分支行内——写「为什么」）；
- **命名去品牌化**：代码标识符禁品牌词（允许位：package.json name/keywords、bin 命令、UI 文案/文档标题、对外声明值位如 `BERRY_AGENT_*`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update（enable/disable 弃用）；
- **测试**：mock 只停在模型层（faux provider / 脚本化 streamFn），其余全真；修 bug 必带回归锁（修复前该测试红）；禁断言 AI 生成的具体文本内容；测试零真网络；
- **提交**：一个逻辑完整的变更 = 一次 commit，完成即提交不积攒；逐文件点名 `git add`、慎用 `git add -A`；commit 前核 `git status` 无未登记残留。

## 贡献协议要点

- PR 一律打 **`dev`** 分支（`main` 为稳定门面，只随发布快进）；
- 涉及**基座接口 / 判据面（准入、安全）**的改动，先开 issue 讨论边界再动手——「基座强在接口，能力长在插件」；
- PR 描述四段式（动机 / 改动面 / 测试证据 / 自检清单），含 AI 辅助披露——见[贡献指南](./CONTRIBUTING.md)；开发环境细节见[开发指南](./docs/development.md)。
