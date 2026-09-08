#!/bin/sh
# berry-agent 安装脚本（两段式第二段——先落盘再执行）。
#
# 用法（两段式——禁管道直灌）：
#   curl -fsSL -o install.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/install.sh
#   sh install.sh
# 不要写成 `curl … | sh`：连接中段断裂时 shell 会执行半截脚本。
#
# 编舞：Node >= 24 检查 → npm 全局安装 → berry-agent --version 验证 →
# 欢迎横幅；失败出口给排查建议（镜像建议保持中性——不钦点具体镜像源）。
set -eu

# ---------- 工具函数 ----------
warn() { printf '%s\n' "$*" >&2; }
die() { warn "错误：$*"; exit 1; }

# ---------- Node >= 24 检查 ----------
if ! command -v node >/dev/null 2>&1; then
  die "未找到 node——请先安装 Node.js 24+（https://nodejs.org/ 或你的系统包管理器）"
fi
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 24 ]; then
  die "Node 版本过低（当前 $(node --version)，需要 >= 24）——请升级：https://nodejs.org/"
fi
if ! command -v npm >/dev/null 2>&1; then
  die "未找到 npm——Node.js 标准发行版自带 npm，请检查 Node 安装"
fi

# ---------- npm 全局安装 ----------
printf '==> 安装 berry-agent（npm 全局）……\n'
if ! npm install -g berry-agent; then
  warn ''
  warn 'npm 全局安装失败。常见原因与自助排查：'
  warn '  - 权限不足：建议改用 nvm / volta 等 Node 版本管理器（全局目录落在用户域，免提权），'
  warn '    或参考 npm 官方文档处理全局安装前缀问题'
  warn '  - 网络受限：可用 npm config set registry <你信任的镜像源> 配置后重试'
  exit 1
fi

# ---------- 安装验证 ----------
printf '==> 验证安装……\n'
if ! version=$(berry-agent --version 2>/dev/null); then
  die "安装完成但验证失败（berry-agent --version 未正常返回）——请重开终端后重试（PATH 刷新）；仍失败请到仓库 issue 报告并附本脚本全部输出"
fi
printf '==> 已就位：berry-agent %s\n' "$version"

# ---------- 欢迎横幅 ----------
printf '\n'
printf '  berry-agent 已安装。\n'
printf '\n'
printf '  快速上手：\n'
printf '    berry-agent            直接进入 TUI 对话（说需求即可）\n'
printf '    berry-agent --help     全部命令与旗标\n'
printf '    文档：https://github.com/miuiadmin/berry-agent#readme\n'
printf '\n'
printf '  首次启动自动创建数据目录 ~/.berry-agent/（BERRY_AGENT_DATA_DIR 可重定位）。\n'
printf '\n'
