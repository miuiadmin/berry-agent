/**
 * 本地原生剪贴板腿纯函数件（挖掘 40 轮件 A——copyToClipboard 分诊第⓪层；
 * 07 §4.1 件 8 三层分诊括注第⓪层条款）。
 *
 * 对标 codex clipboard_copy.rs 分诊序：SSH 会话跳原生（原生剪贴板属远端
 * 机不可达）直走终端介导；本地会话原生优先（codex 用进程内 arboard 库，
 * berry 取子进程形——pbcopy/wl-copy/xclip/clip.exe，让子进程自管存活
 * 化解剪贴板所有权问题）。
 *
 * - **计划纯函数** planNativeClipboard：env + 平台 → 子进程计划或 null，
 *   零进程零副作用（探测形态 = env 判定非 which 探测——codex 同形）；
 * - **真身封装** createDefaultNativeClipboardSpawn：按计划命令分派
 *   spawnSync 确认形 / wl-copy detach 形——经装配 seam 注入（gitQuery 形：
 *   缺席 = 腿缺席零行为变，生产显式传真身）。
 *
 * 可测性：计划函数签名 platform 显式参数（生产 env 无平台信息——codex 是
 * 编译期 cfg 非 env；缺省参读 process.platform，测试显式传参控平台矩阵）；
 * 真身封装的 detach/确认分派以源码标记 + 桩注入面锁（MemoryTerminalIO
 * 零真进程纪律）。
 */
import { spawn, spawnSync } from 'node:child_process';

/** 原生剪贴板子进程计划（command + args——喂给 seam 真身或测试桩） */
export interface NativeClipboardPlan {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * 原生剪贴板腿执行器签名（装配 seam 形）：计划 + 文本 → 尽力回执。
 * 'ok' = 子进程面确认/尽力写出；'failed' = 确认失败——调用方落穿终端
 * 介导三层原序（失败不静默终态——writeClipboard 回执语义不变）。
 */
export type NativeClipboardSpawn = (plan: NativeClipboardPlan, text: string) => 'ok' | 'failed';

/** env 键型（进程 env 的只读子集面——测试桩注入受控形） */
type EnvLike = Record<string, string | undefined>;

/**
 * 平台矩阵计划：非 SSH 本地会话且矩阵命中 → 计划；否则 null（腿缺席）。
 *
 * 分诊序（07 §4.1 第⓪层条款）：
 * 1. **SSH 判定先于平台**——SSH_TTY/SSH_CONNECTION 任一在场 = SSH 会话
 *    （原生剪贴板属客户端本地机不可达——写远端机剪贴板用户不可见即反效）；
 * 2. darwin → pbcopy；
 * 3. linux + WAYLAND_DISPLAY → wl-copy（detach 形——见真身封装）；
 * 4. linux + DISPLAY → xclip -selection clipboard（缺 -selection 会写
 *    PRIMARY 选区而非系统剪贴板——X11 双选区陷阱）；
 * 5. win32 → clip.exe；
 * 6. 余（含 linux 双缺席）→ null。
 *
 * SSH 键与 WAYLAND_DISPLAY/DISPLAY 均调时读现值（调用方传 process.env
 * 当帧——与 TMUX/externalEditor 调时读同律）。WSL powershell.exe 腿
 * codex 有、首落不采（规范挂账）。
 */
export function planNativeClipboard(
  env: EnvLike,
  platform: NodeJS.Platform = process.platform,
): NativeClipboardPlan | null {
  // SSH 会话跳原生——codex 分诊序真源（clipboard_copy.rs 模块文档）
  if (env.SSH_TTY !== undefined || env.SSH_CONNECTION !== undefined) return null;
  if (platform === 'darwin') return { command: 'pbcopy', args: [] };
  if (platform === 'linux') {
    if (env.WAYLAND_DISPLAY !== undefined) return { command: 'wl-copy', args: [] };
    if (env.DISPLAY !== undefined) return { command: 'xclip', args: ['-selection', 'clipboard'] };
    return null; // 双显示服缺席——原生腿无处落
  }
  if (platform === 'win32') return { command: 'clip.exe', args: [] };
  return null; // 其余平台（aix/freebsd/…）矩阵外
}

/**
 * 生产真身封装（装配 seam 显式传入——backend 缺省缺席保测试基线零真进程）。
 *
 * 两形分派（按计划命令）：
 * - **wl-copy → detach 形**：spawn 后 unref 不等待——wl-copy 前台持选区
 *   不退出（剪贴板所有权机制），spawnSync 等退出码会永挂；detach 后子进程
 *   自管存活，写出尽力记账恒 'ok'（spawn 自身报错才 'failed'——确认不可
 *   得，detach 形语义即尽力）；stdin pipe 写入选区文本（≤64 KiB 选区帽
 *   同界，OS pipe 缓冲域内）、EPIPE 吞（子进程先退非错误面）。
 * - **pbcopy/xclip/clip.exe → 确认形**：spawnSync 喂 stdin、stdio 全
 *   ignore（抑子进程 stderr 污染屏面——TUI 原始终端模式下一行杂音即破相），
 *   error 缺席且 status 0 → 'ok'。
 */
export function createDefaultNativeClipboardSpawn(): NativeClipboardSpawn {
  return (plan, text) => {
    if (plan.command === 'wl-copy') {
      // detach 形：不等待退出——前台持选区不退出是 wl-copy 机制非挂死
      let spawned = true;
      try {
        const child = spawn(plan.command, plan.args, {
          stdio: ['pipe', 'ignore', 'ignore'],
          detached: true,
        });
        child.stdin.on('error', () => undefined); // EPIPE 吞——尽力写出语义
        child.stdin.write(text);
        child.stdin.end();
        child.unref(); // 脱离父进程生命周期——子进程自管存活
      } catch {
        spawned = false; // spawn 同步报错（如 ENOENT）——确认失败形
      }
      return spawned ? 'ok' : 'failed';
    }
    // 确认形：同步喂 stdin 看退出码（pbcopy/xclip/clip.exe 皆即写即退）
    const result = spawnSync(plan.command, plan.args, {
      input: text,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    return result.error === undefined && result.status === 0 ? 'ok' : 'failed';
  };
}
