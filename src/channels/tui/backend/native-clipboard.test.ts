/**
 * 原生剪贴板腿纯函数件单测（挖掘 40 轮件 A——平台矩阵计划函数直测；
 * env 以字面量注入 + platform 显式传参零真环境依赖；真身工厂
 * createDefaultNativeClipboardSpawn 含真子进程不经单测面——集成锁在
 * tui-backend.test.ts 件 A describe 经 seam 桩测分派）。
 */
import { describe, expect, it } from 'vitest';
import { planNativeClipboard } from './native-clipboard.js';

describe('planNativeClipboard 平台矩阵（挖掘 40 轮件 A）', () => {
  it('SSH 判定先于平台：SSH_TTY/SSH_CONNECTION 任一在场 → null（原生剪贴板属本地机不可达）', () => {
    expect(planNativeClipboard({ SSH_TTY: '/dev/pts/0' }, 'darwin')).toBe(null);
    expect(planNativeClipboard({ SSH_CONNECTION: '1.2.3.4 5 6.7.8.9 10' }, 'win32')).toBe(null); // 平台无关跳原生
    // 双键均缺席 + darwin → 正常命中（对照组——SSH 缺席是原生腿前提）
    expect(planNativeClipboard({}, 'darwin')?.command).toBe('pbcopy');
  });

  it('darwin → pbcopy；win32 → clip.exe', () => {
    expect(planNativeClipboard({}, 'darwin')).toEqual({ command: 'pbcopy', args: [] });
    expect(planNativeClipboard({}, 'win32')).toEqual({ command: 'clip.exe', args: [] });
  });

  it('linux：WAYLAND_DISPLAY 优先 → wl-copy；缺席而 DISPLAY 在 → xclip -selection clipboard（X11 双选区陷阱——缺 -selection 写 PRIMARY）；双缺 → null', () => {
    expect(planNativeClipboard({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toEqual({
      command: 'wl-copy',
      args: [],
    });
    expect(planNativeClipboard({ WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, 'linux')?.command).toBe('wl-copy'); // wayland 优先序
    expect(planNativeClipboard({ DISPLAY: ':0' }, 'linux')).toEqual({
      command: 'xclip',
      args: ['-selection', 'clipboard'],
    });
    expect(planNativeClipboard({}, 'linux')).toBe(null); // 无显示服——原生腿无处落
  });

  it('矩阵外平台 → null（aix/freebsd/openbsd/sunos/android——矩阵面收窄防误配）', () => {
    for (const p of ['aix', 'freebsd', 'openbsd', 'sunos', 'android'] as const) {
      expect(planNativeClipboard({}, p)).toBe(null);
    }
  });
});
