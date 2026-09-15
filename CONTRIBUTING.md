# 贡献指南

> **EN TL;DR**: PRs target the `dev` branch (not `main`). Open an issue first
> for anything touching base interfaces or admission/safety logic. Make the
> four gates green locally. PR description: motivation / changes / test
> evidence. English contributions are welcome — the maintainer translates
> before merge. AI-assisted work is fine with disclosure (see below).

感谢关注 berry-agent 的建设。本文是贡献流程与工程纪律的入口；开发环境细节见[开发指南](./docs/development.md)。

## 改动分级（先对号，再动手）

不同级别的改动，前置讨论重量不同——级越高越要先谈：

| 级  | 改动类型                                             | 前置要求                                                                              |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| L1  | 错字修正、文档改进、测试补充                         | 直接提 PR                                                                             |
| L2  | 插件域内增强（`core:` 域件内部，不改公开接口）       | 先开 issue 简述意图                                                                   |
| L3  | 基座接口改动（新扩展点/钩子/事件词汇/错误码/API 面） | 先开 issue 讨论边界，达成一致再动手                                                   |
| L4  | 判据面改动（准入、安全、审批、沙箱一类宿主裁决权）   | 同 L3，且默认预期是「不收」——本仓理念：基座强在接口，能力长在插件；判据面属宿主裁决权 |

新能力默认以**插件**形态表达而非扩基座。拿不准级别的，先开 issue 问。

## 流程

1. 开 issue（bug 报告带诊断信息：`berry --version`、数据目录 `crash.log` 末行、stderr 原文）；
2. fork + 特性分支；
3. 实现——遵循[开发指南](./docs/development.md)的工程约定；
4. 四门禁全绿：

   ```bash
   npm run typecheck && npm test && npm run lint:topology && npm run format:check
   ```

5. PR 一律打 **`dev`** 分支（`main` 为稳定门面，只随发布快进——打错分支维护者会请你改目标）；
6. PR 描述四段式（模板已内置）：动机 / 改动面 / 测试证据 / 自检清单。

## 工程纪律（硬规则——PR 评审逐条执行）

- **契约先行**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **模块边界**：28 席单向 DAG，跨模块只走对方公开面（`index.ts` / `types.ts` / `events.ts` 三名）；`lint:topology` 执法；
- **注释中文、标识符英文**：新写代码充分中文注释（写「为什么」）。英文注释的 PR 也可接受——合并前维护者统一翻译；
- **命名去品牌化**：代码标识符禁品牌词（允许位：package.json name/keywords、bin 命令、UI 文案/文档标题、对外声明值位如 `BERRY_AGENT_*`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update；
- **测试**：mock 只停在模型层，其余全真；修 bug 必带回归锁（修复前该测试红）；禁断言 AI 生成的具体文本内容；测试零真网络；
- **提交**：一个逻辑完整的变更 = 一次 commit，完成即提交不积攒；逐文件点名 `git add`、慎用 `git add -A`。

## AI 辅助贡献政策（温和披露制）

本仓不禁止 AI 辅助开发——但要求两件事（PR 自检清单两勾）：

1. **通读负责**：提交者须通读自己 PR 的全部改动并对内容负责——「AI 生成的代码我没看过」不是可接受的状态；
2. **用途披露**：在 PR 中注明 AI 辅助的用途与范围（如「AI 起草、人工审改」/「AI 生成测试夹具」）。纯人工完成写「无」即可。

## 安全

漏洞披露走 GitHub private vulnerability reporting（仓库 Security 标签页）——不走公开 issue。第三方依赖漏洞请报上游。

## 行为准则

对事不对人；技术分歧以契约、公开文档与代码事实为准；不确定的先问再动手。
