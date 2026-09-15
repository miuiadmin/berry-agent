<!--
EN TL;DR: Please target the `dev` branch (not `main`). Describe motivation /
changes / test evidence below. Chinese is the working language of this repo;
English is fine too — the maintainer translates before merge. See CONTRIBUTING.md.
-->

<!-- 中文为本仓工作语言；英文提交亦可——合并前由维护者翻译（决策于 CONTRIBUTING「对外协议」）。 -->

## 动机

<!-- 为什么改？关联 issue 编号（有则填 #N，bug 修复须先有带诊断信息的 issue） -->

## 改动面

<!-- 改了哪些模块/文件？请以模块边界视角描述（跨模块只走对方公开面 index/types/events）；
     涉及基座接口/判据面的改动，须先有 issue 讨论记录再动手 -->

## 测试证据

<!-- 新增或变更的测试点名（修 bug 必带回归锁：修复前红、修复后绿）；四门禁本地全绿输出贴末行：

     npm run typecheck && npm test && npm run lint:topology && npm run format:check
-->

## 自检清单

- [ ] 本 PR 目标分支是 `dev`（不是 `main`——`main` 为稳定门面，只随发布快进）
- [ ] 四门禁本地全绿（typecheck / test / lint:topology / format:check）
- [ ] 若修 bug：带回归锁测试；若新模块：先契约（types/错误码/事件词汇 + 测试）再实现
- [ ] 新写代码中文注释、标识符英文；未引入禁用词（扩展单位一律「插件 plugin」，「应用/app」为禁用词；生命周期动词 install/uninstall/mount/unmount/toggle/update）
- [ ] **我已通读本 PR 的全部改动，并对其内容负责**
- [ ] 本 PR 的创作使用了 AI 辅助——在此注明用途与范围（纯人工完成则不勾，并在下一行写「无」）

<!-- AI 辅助注记（用途/范围或「无」）： -->
