#!/bin/sh
# berry-agent 卸载脚本。
#
# 用法（两段式——先落盘再执行）：
#   curl -fsSL -o uninstall.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/uninstall.sh
#   sh uninstall.sh
#
# 编舞：npm 全局卸载（源码形态打印指引）→ 数据目录清理（交互确认——
# 含记忆/会话历史/插件装机物，删除不可恢复；确认前提示先导出记忆）。
set -eu

# ---------- 工具函数 ----------
warn() { printf '%s\n' "$*" >&2; }

# ---------- 程序卸载 ----------
if command -v berry-agent >/dev/null 2>&1; then
  printf '==> 卸载 npm 全局包 berry-agent……\n'
  npm rm -g berry-agent
else
  warn '未发现 berry-agent 命令（跳过程序卸载）。'
fi
warn '源码形态安装：直接删除 clone 目录即可，无需本脚本。'

# ---------- 数据目录清理 ----------
data_dir=${BERRY_AGENT_DATA_DIR:-"$HOME/.berry-agent"}
if [ -d "$data_dir" ]; then
  warn ''
  warn "数据目录在场：$data_dir"
  warn '内含记忆、会话历史、插件装机物与凭证——删除不可恢复。'
  warn '如需保留记忆，请先启动 TUI 执行 /memory-export 导出后再继续。'
  printf '确认删除数据目录？[y/N] '
  read -r answer
  case "$answer" in
    y | Y)
      rm -rf "$data_dir"
      warn "已删除 $data_dir"
      ;;
    *)
      warn "已保留 $data_dir（稍后可手动删除）。"
      ;;
  esac
else
  warn "数据目录不在场：$data_dir（无需清理）。"
fi

printf '卸载完成。\n'
