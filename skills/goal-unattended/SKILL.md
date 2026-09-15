---
name: goal-unattended
description: 无人值守续跑范式——/goal create 申报、todo 快照纪律（deferred/completed 必携字段）、goal_update 证据面、停滞与预算停靠的唤醒路径。
---

# goal-unattended（无人值守续跑范式）

goal = 本会话的无人值守延续：用户用 `/goal create` 申报目标后离开，系统按
schedule 到点自动拉起会话推进。本技能定形续跑轮里的标准动作与纪律。

## 申报面（用户侧命令——会话内执行）

```
/goal create <schedule 串> <objective 全文> [--write] [--budget <n>]
/goal wake <goalId>      # 手动起闹：停滞/预算双复位 + 挂钟复活
/goal approve <goalId>   # 人面批准 needsWrite（command 判据门放行链）
```

- `--write` 申报写权限（申报非授权——须用户 `/goal approve` 批准后 command
  判据门才可用）；`--budget <n>` 设本轮预算上限。
- 首跑 = schedule 首到点（create 不立即开跑）。

## 每轮标准动作

1. **读目标与上轮状态**：goal 目标全文 + todo 快照 + 上轮汇报（若在）。
2. **推进实质工作**（真正的编码/调查/验证——不是复述计划）。
3. **回写状态**：`todo` 快照 + `goal_update` 推进汇报。

## todo 快照纪律（全量快照——每次调用即整表换代）

- 条目 `status` 四值：`pending` / `in-progress` / `completed` / `deferred`。
- **deferred 必携 `resume_when`**：`after@<ISO>`（如 `after@2026-09-16T00:00:00Z`）
  或 `after@+<n>[mhd]`（相对时长）——到点前不进本轮视野。
- **completed 必携后继二择一**：`follow_up`（后续动作一句话）或
  `no_follow_up: true`——防「完成即失联」，二者皆缺即拒。
- 可选 `gate` 判据门三形：`{kind: 'command', command}`（exit 0 过门）/
  `{kind: 'files', paths}`（路径在场即过）/`{kind: 'diagnostics', files}`（诊断面）。
  gate 申报位 fail-closed：能力缺席（如执行面未装载）时申报即拒，
  不放行也不降级。

## goal_update 纪律（推进汇报 = 状态机转移）

- `completed` 终态**必须携带证据**（测试输出、验证命令结果、产出物路径）——
  证据面机器校验，空证即拒（`GOAL_TRANSITION_INVALID`）。
- 汇报写实质进展：本轮做了什么、验证了什么、下轮从哪接。禁止用复述目标
  冒充进展。

## 停滞与预算（两条硬停线）

- **停滞停**：连续 N 轮无实质进展即停并如实报告「卡在哪、缺什么输入」——
  空转烧轮次是被执法面，不是可选项。
- **预算停靠**：预算耗尽即挂钟行停、会话落 `paused`；日池回充后自动唤醒
  （无需人工干预）。手动复活走 `/goal wake <goalId>`（停滞/预算双复位）。

## 自检环（每轮收尾前过一遍）

- todo 快照是否覆盖全部条目（含未动的 pending——全量快照不允许只发改动项）？
- 新增 deferred 是否都带 resume_when？新增 completed 是否带 follow_up 或
  no_follow_up？
- 若宣称本轮完成实质步骤：证据是否已落在汇报里（而非「应该可以」）？
- 连续无进展时：是否已如实报停滞而不是继续空跑？
