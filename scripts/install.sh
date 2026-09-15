#!/bin/sh
# berry-agent 安装脚本（两段式第二段——先落盘再执行）。
#
# 用法（两段式——禁管道直灌）：
#   curl -fsSL -o install.sh https://raw.githubusercontent.com/miuiadmin/berry-agent/main/scripts/install.sh
#   sh install.sh
# 不要写成 `curl … | sh`：连接中段断裂时 shell 会执行半截脚本。
#
# 编舞：Node >= 24 检查 → npm 全局安装 → 双代名验证（berry / berry-agent
# ——新名优先旧名回落）→ 欢迎横幅（引实测就位命令名）；失败出口给排查建议
# （镜像建议保持中性——不钦点具体镜像源）。
# 用户可见文案一律英文（W8 装机文案批——安装脚本是公开仓对外第一面）；
# 代码注释留中文。
set -eu

# ---------- 工具函数 ----------
warn() { printf '%s\n' "$*" >&2; }
die() { warn "Error: $*"; exit 1; }

# ---------- Node >= 24 检查 ----------
if ! command -v node >/dev/null 2>&1; then
  die "node not found. Install Node.js 24+ first (https://nodejs.org/ or your system package manager)"
fi
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 24 ]; then
  die "Node version too old (current $(node --version), need >= 24). Upgrade at https://nodejs.org/"
fi
if ! command -v npm >/dev/null 2>&1; then
  die "npm not found. npm ships with the standard Node.js distribution - check your Node installation"
fi

# ---------- npm 全局安装 ----------
printf '==> Installing berry-agent (npm global)...\n'
if ! npm install -g berry-agent; then
  warn ''
  warn 'npm global install failed. Common causes and self-service fixes:'
  warn '  - Insufficient permissions: prefer a Node version manager such as nvm or volta'
  warn '    (the global prefix stays in user land, no sudo needed), or see the official'
  warn '    npm docs on changing the global install prefix'
  warn '  - Restricted network: set a registry you trust via `npm config set registry <registry>` and retry'
  exit 1
fi

# ---------- 安装验证 ----------
printf '==> Verifying installation...\n'
# 兼容两代命令名（与 uninstall.sh 同款语义）：改裁前的装机 bin 名是
# berry-agent——registry 已发布版仍以旧名链出；升级到 bin 换代版本后
# npm 自动换链为 berry。新名优先、旧名回落，过渡期两代装机都验证得过。
# cmd 钉住实测就位的命令名——横幅同引（验证段双代语义贯穿到快速上手，
# 旧名装机不被指去敲不存在的 berry 命令）。
if version=$(berry --version 2>/dev/null); then
  cmd=berry
  printf '==> Ready: berry %s\n' "$version"
elif version=$(berry-agent --version 2>/dev/null); then
  cmd=berry-agent
  printf '==> Ready: berry-agent %s (legacy command name - upgrading to a post-rename release relinks it to berry)\n' "$version"
else
  die "Install finished but verification failed (neither berry nor berry-agent --version returned). Try reopening your terminal (PATH refresh) and rerun; if it still fails, open a repo issue with the full script output"
fi

# ---------- 欢迎横幅 ----------
printf '\n'
printf '  %s installed.\n' "$cmd"
printf '\n'
printf '  Quick start:\n'
printf '    %-22s %s\n' "$cmd" 'jump into the TUI chat - just say what you need'
printf '    %-22s %s\n' "$cmd --help" 'all commands and flags'
printf '    Docs: https://github.com/miuiadmin/berry-agent#readme\n'
printf '\n'
printf '  First launch creates the data directory ~/.berry-agent/ (relocatable via BERRY_AGENT_DATA_DIR).\n'
printf '\n'
