---
name: 问题报告
about: 报告一个可复现的 bug（行为与预期不符）
labels: ['bug']
title: ''
---

## 环境

- berry-agent 版本（`berry-agent --version` 的输出）：
- 操作系统（macOS / Linux 发行版 + 版本）：
- Node 版本（`node --version` 的输出）：
- 安装方式（npm 全局 / 安装脚本 / 源码构建）：

## 复现步骤

从干净状态开始，逐步写出你做了什么：

1.
2.

## 期望行为

（你认为应该发生什么）

## 实际行为

（实际发生了什么——报错原文直接粘贴，不要转述）

## 诊断信息（可选，但能显著加快定位）

1. 用调试级日志重跑一次，把输出贴在下面：

   ```bash
   BERRY_AGENT_LOG_LEVEL=debug berry-agent <你的命令>
   ```

2. 数据目录（缺省 `~/.berry-agent/`，可用 `BERRY_AGENT_DATA_DIR` 重定位）
   中的报错现场：如有 `enabled.yaml` 手改历史或插件刚装/刚卸，请一并说明；
3. 涉及插件时：`berry-agent plugins` 的输出（装载态清单）。
