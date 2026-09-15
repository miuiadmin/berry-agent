# 贡献指南

> **EN TL;DR**: Start from the four-tier change guide below, then fork a
> branch. PRs always target the `dev` branch — `main` is the stable release
> line. Make the four gates green locally before opening a PR. Two vocabulary
> rules: extensions are called plugins (never "app"), and lifecycle verbs are
> install / uninstall / mount / unmount / toggle / update. Chinese comments
> are required in code; English comments are acceptable — the maintainer
> translates before merge. AI-assisted contributions are welcome with
> disclosure; a human must own every change.

感谢关注 berry-agent 的建设。本文是贡献流程与工程纪律的入口；开发环境细节见[开发指南](./docs/development.md)。

## 改动分级指南（先对号，再动手）

不同级别的改动，前置讨论重量不同——级越高越要先谈。宿主固定件与 `core:` 插件域的全景划分见[架构总览](./docs/architecture.md)；拿不准级别的，先开 issue 问。

| 级  | 改动类型                                                             | 流程                                                             | 预期节奏                                                   |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| L1  | 文档改进、独立小 bug、测试补充                                       | 直接提 PR（bug 修复建议先带诊断信息开 issue，便于复现）          | 快——正常评审通过即合并                                     |
| L2  | `core:` 插件域内改动（域内行为增强，不改插件对外契约面）             | 直接提 PR；拿不准是否触及契约面的，先开 issue 问一句             | 快——正常评审通过即合并                                     |
| L3  | 宿主固定件行为、契约面（新扩展点/钩子）、事件词汇、错误码、API 面    | **issue-first**：先开 issue 描述意图，讨论达成一致再动手          | 偏慢——需先经维护者内部设计批（见下节），周期较长属正常流程 |
| L4  | 新模块、新拓扑席位、边表新边、安全模型（沙箱/审批/准入等宿主裁决权） | 先开 issue——默认由维护者收口主导设计，外部贡献者以 issue 讨论参与 | 慢——设计定形后才收实现 PR                                  |

新能力默认以**插件**形态表达而非扩基座——本仓理念：基座强在接口，能力长在插件。

### 「规范先行」与外部贡献的关系

本仓内部有一套「规范先行」设计治理流程（设计文档先于代码、独立冷读评审）。**外部贡献不走这套流程，也无需了解它**：

- 触及设计边界——模块边界、事件词汇、错误码、API 面、预算护栏等规范覆盖行为——的改动（即上表 L3/L4），先开 issue；由维护者在内部规范侧完成先行批之后再收 PR；
- 这意味着 L3/L4 的 PR 周期较长（数天到数周），**属正常流程而非被冷落**；L1/L2 无此环节，按常规节奏评审。

## 黑话翻译（读提交历史与源码时用得上）

- **「规范先行」「冷读闸」**（提交历史常见）：维护者内部设计治理流程的环节名，外部贡献者无需也无法参与；你的 PR 涉及时由维护者收口并在 PR 中说明。
- **「0X 篇 §Y」**（源码头注常见）：指内部设计规范（非公开文档）；以头注正文与 [docs/](./docs/) 公开文档为准即可。

## 流程

1. 开 issue（bug 报告带诊断信息：`berry --version`、数据目录 `crash.log` 末行、stderr 原文；L3/L4 把讨论重点放在边界与取舍上）；
2. fork + 特性分支；
3. 实现——遵循[开发指南](./docs/development.md)的工程约定；
4. 四门禁全绿：

   ```bash
   npm run typecheck && npm test && npm run lint:topology && npm run format:check
   ```

5. PR 一律打 **`dev`** 分支——`main` 为稳定发布线，只随发布快进（打错分支维护者会请你改目标）；
6. PR 描述四段式（模板已内置）：动机 / 改动面 / 测试证据 / 自检清单。

## 工程纪律（硬规则——PR 评审逐条执行）

- **契约先行**：新模块先定义契约（types / 错误码 / 事件词汇 + 测试），再写实现；
- **模块边界**：28 席单向 DAG，跨模块只走对方公开面（`index.ts` / `types.ts` / `events.ts` 三名）；`lint:topology` 执法；
- **注释中文、标识符英文**：中文注释是硬要求；非中文使用者可提交英文注释，合并前维护者统一翻译落定（写「为什么」不写「是什么」）；
- **命名去品牌化**：代码标识符禁品牌词（允许位：package.json name/keywords、bin 命令、UI 文案/文档标题、对外声明值位如 `BERRY_AGENT_*`）；
- **词汇**：扩展单位一律叫「插件」（plugin）——「应用/app」是禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update；
- **测试**：mock 只停在模型层，其余全真；修 bug 必带回归锁（修复前该测试红）；禁断言 AI 生成的具体文本内容；测试零真网络；
- **提交**：commit 粒度——一个逻辑变更一批即可，合并时维护者 squash 整形；本地怎么分批不做要求。

## AI 辅助贡献政策（温和披露制）

本仓不禁止 AI 辅助开发，但**人类必须是责任主体**。要求两件事（PR 自检清单两勾）：

1. **通读负责**：提交者须通读自己 PR 的全部改动并对内容负责——「AI 生成的代码我没看过」不是可接受的状态；**纯 AI 生成且未经人审的 PR 直接关闭**；
2. **用途披露**：在 PR 中注明 AI 辅助的用途与范围（如「AI 起草、人工审改」/「AI 生成测试夹具」）。纯人工完成写「无」即可。

## 安全

漏洞披露走 GitHub private vulnerability reporting（仓库 Security 标签页）——不走公开 issue。第三方依赖漏洞请报上游。

## 行为准则

对事不对人；技术分歧以契约、公开文档与代码事实为准；不确定的先问再动手。
