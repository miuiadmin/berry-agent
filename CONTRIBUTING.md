# 贡献指南

感谢关注 berry-agent 的建设。本文是贡献流程与工程纪律的入口；开发环境细节见[开发指南](./docs/development.md)。

## 贡献什么

- **问题修复**：带复现描述的 issue 优先——修 bug 必带回归锁测试（修复前必红）；
- **官方插件域内增强**：15 个 `core:` 件各自成域，先读该域件头注（每件头注即该域设计真源摘要）；
- **新能力**：默认以**插件**形态表达而非扩基座——「基座强在接口，能力长在插件」，判据面（准入/安全）属宿主裁决权，接口面属插件表达域。基座改动需先开 issue 讨论边界；
- **文档**：`docs/` 五册与代码同步维护、自包含。

## 流程

1. 开 issue（bug 报告带诊断信息：`berry-agent --version`、数据目录 `crash.log` 末行、stderr 原文）；
2. fork + 特性分支；
3. 实现——遵循下方工程纪律；
4. 四门禁全绿：

   ```bash
   npm run typecheck && npm test && npm run lint:topology && npm run format:check
   ```

5. PR 描述含：动机 / 改动面 / 测试证据（新增或变更的测试点名）。

## 工程纪律（硬规则）

- **契约先行**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **模块边界**：27 席单向 DAG，跨模块只走对方公开面（`index.ts` / `types.ts` / `events.ts` 三名）；`lint:topology` 执法——改边表先于改导入；
- **注释中文、标识符英文**：新写代码充分中文注释（JSDoc + 关键分支行内——写「为什么」）；
- **命名去品牌化**：代码标识符禁品牌词（允许位：package.json name/keywords、bin 命令、UI 文案/文档标题、对外声明值位如 `BERRY_AGENT_*`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update；
- **测试**：mock 只停在模型层（faux provider / 脚本化 streamFn），其余全真；禁止断言 AI 生成的具体文本内容；测试零真网络；
- **提交**：一个逻辑完整的变更 = 一次 commit，完成即提交不积攒；逐文件点名 `git add`、慎用 `git add -A`；commit 前核 `git status` 无未登记残留。

## 安全

漏洞披露走 GitHub private vulnerability reporting（仓库 Security 标签页）——不走公开 issue。第三方依赖漏洞请报上游。

## 行为准则

对事不对人；技术分歧以契约、规范与代码事实为准；不确定的先问再动手。
