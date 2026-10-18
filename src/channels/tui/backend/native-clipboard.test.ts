/**
 * 原生剪贴板腿纯函数件单测（挖掘 40 轮件 A——平台矩阵计划函数直测；
 * env 以字面量注入 + platform 显式传参零真环境依赖）；真身工厂
 * createDefaultNativeClipboardSpawn 的确认形帽经 vi.mock 定向单点覆盖
 * （59 轮件 D-1——node:child_process 截获桩默认透传真身，零真进程
 * 纪律不破）；分派编舞集成锁在 tui-backend.test.ts 件 A describe 经
 * seam 桩测分派。
 */
import { describe, expect, it, vi } from 'vitest';
import { createDefaultNativeClipboardSpawn, planNativeClipboard } from './native-clipboard.js';

/**
 * 定向单点桩（59 轮件 D-1 回归锁）：vi.mock 截获 node:child_process——
 * spawnSync/spawn 默认透传真身（既有用例与生产行为零变），帽锁用例以
 * mockImplementationOnce 定向覆写即弃（当笔消费即还原委托形——断言红态
 * 也不泄漏给后续用例）。vi.hoisted 共享柄：mock 工厂注册位与用例断言位
 * 持同一 mock 实例（工厂内不能引用外部变量的提升律绕道）。
 */
const { spawnStub, spawnSyncStub, realChildProcess } = vi.hoisted(() => {
  // 真身寄存位（mock 工厂 importOriginal 后回填——委托闭包调时解析）
  const realChildProcess: {
    spawnSync?: (...invoke: unknown[]) => unknown;
    spawn?: (...invoke: unknown[]) => unknown;
  } = {};
  const spawnSyncStub = vi.fn((...invoke: unknown[]) => realChildProcess.spawnSync!(...invoke));
  const spawnStub = vi.fn((...invoke: unknown[]) => realChildProcess.spawn!(...invoke));
  return { spawnSyncStub, spawnStub, realChildProcess };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  // 双转型只过类型关（@types 重载面 vs 宽松委托形）——运行期即真身引用
  realChildProcess.spawnSync = actual.spawnSync as unknown as (...invoke: unknown[]) => unknown;
  realChildProcess.spawn = actual.spawn as unknown as (...invoke: unknown[]) => unknown;
  return { ...actual, spawnSync: spawnSyncStub, spawn: spawnStub };
});

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

describe('createDefaultNativeClipboardSpawn 确认形帽（59 轮件 D-1——spawnSync 同步阻塞事件循环，无帽悬挂即 TUI 整屏冻结）', () => {
  it('击杀通道锁：确认形 spawnSync 必带 5s 帽 + SIGKILL 强杀（现状无帽——悬挂子进程无人杀）', () => {
    // 定向覆写即弃：回执按 status 0 放行（本 it 锁的是第三参帽通道非回执分诊）
    spawnSyncStub.mockImplementationOnce(() => ({ status: 0, stdout: '', stderr: '' }));
    const nativeSpawn = createDefaultNativeClipboardSpawn();
    const r = nativeSpawn({ command: 'pbcopy', args: [] }, 'hi');
    expect(r).toBe('ok');
    // 通道锁（58 轮件③ 击杀通道锁同形）：spawnSync 唯有 timeout 在场才到点
    // 杀（原生层点火——JS 线程同步阻塞不影响其计时）；killSignal=SIGKILL 非
    // SIGTERM（悬挂子进程可忽略 SIGTERM——tools/spawn-sync-cap.mjs 头注同律）
    expect(spawnSyncStub).toHaveBeenCalledTimes(1);
    expect(spawnSyncStub.mock.calls[0]![2]).toMatchObject({ timeout: 5_000, killSignal: 'SIGKILL' });
  });

  it('帽点到即诚实失败：ETIMEDOUT 形回执（status null + error 在场）→ failed 落穿终端介导', () => {
    // spawnSync 超时真形：子进程被杀 → status null、error.code=ETIMEDOUT
    spawnSyncStub.mockImplementationOnce(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawnSync pbcopy ETIMEDOUT'),
    }));
    const nativeSpawn = createDefaultNativeClipboardSpawn();
    // 帽点走既有 'failed' 返路（error 在场判据）——不静默终态，调用方落穿三层原序
    expect(nativeSpawn({ command: 'xclip', args: ['-selection', 'clipboard'] }, 'hi')).toBe('failed');
  });

  it('wl-copy detach 形不受累：不经 spawnSync（帽不辖）——spawn detach 尽力 ok', () => {
    // detach 形子进程对象最小假件：stdin 三面 + unref（生产只消费这四柄）
    const fakeChild = {
      stdin: {
        on: () => undefined,
        write: () => true,
        end: () => undefined,
      },
      unref: () => undefined,
    };
    spawnStub.mockImplementationOnce(() => fakeChild);
    const nativeSpawn = createDefaultNativeClipboardSpawn();
    expect(nativeSpawn({ command: 'wl-copy', args: [] }, 'hi')).toBe('ok');
    expect(spawnSyncStub).not.toHaveBeenCalled(); // 分立注释的锁面：帽只辖确认形 spawnSync
  });
});
