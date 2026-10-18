/**
 * 剪贴板图片件单测（TUI 剪贴板图片直贴批——35 池件 2 + 39 轮
 * normalize_pasted_path 变体面）。
 *
 * 覆盖：平台矩阵计划（SSH 跳过/darwin/linux 双窗/win32 空集）；读器候选逐试
 * （假执行器——零真子进程纪律：darwin 临时文件路成/败两形 + 临时目录用后即删、
 * stdout 路成/空两形、次候选回落、执行器异常静默）；缺省执行器超时帽（注入
 * 假 spawn——零真子进程）；占位行分拆（独占计/剥/边界换行收敛/非独占不剥）；
 * 路径变体面判定（绝对路径/file:// URL/四族扩展名/相对与 ~ 拒/多行拒/含空格
 * 放行）；读载荷（在场读/缺席/非四族/字节帽/空文件）。
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  clipboardImageReadUnsupportedReason,
  CLIPBOARD_IMAGE_UNSUPPORTED_TEXT,
  COMPOSER_IMAGE_PLACEHOLDER,
  createClipboardImageReader,
  createDefaultClipboardCommandRunner,
  pastedImagePath,
  planClipboardImageReads,
  readImageFilePayload,
  splitImageMarkerLines,
  type ClipboardCommandRunner,
} from './clipboard-image.js';

/** 最小 PNG 魔数载荷（本层不做魔数核验——受理链侧另有执法；此处只认字节往返） */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

/** 假执行器便捷构造（零真子进程——回执受控） */
const fakeRunner = (impl: (command: string, args: readonly string[]) => Promise<{ ok: boolean; stdout: Buffer }>) =>
  vi.fn(impl) as unknown as ClipboardCommandRunner & { mock: ReturnType<typeof vi.fn> };

describe('剪贴板图片读取计划（平台矩阵纯函数）', () => {
  it('SSH 会话跳过——剪贴板属客户端本地机（写侧 planNativeClipboard 同判）', () => {
    expect(planClipboardImageReads({ SSH_TTY: '/dev/pts/0' }, 'darwin')).toEqual([]);
    expect(planClipboardImageReads({ SSH_CONNECTION: '1.2.3.4' }, 'linux')).toEqual([]);
  });

  it('darwin → osascript 临时文件路单候选', () => {
    const plans = planClipboardImageReads({}, 'darwin');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ command: 'osascript', route: 'tempfile' });
  });

  it('linux WAYLAND → wl-paste + xclip 回落次候选；X11 → xclip 单候选；双缺席 → 空集', () => {
    const wayland = planClipboardImageReads({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux');
    expect(wayland.map((plan) => plan.command)).toEqual(['wl-paste', 'xclip']);
    expect(wayland[0]).toMatchObject({ args: ['--type', 'image/png'], route: 'stdout' });
    const x11 = planClipboardImageReads({ DISPLAY: ':0' }, 'linux');
    expect(x11.map((plan) => plan.command)).toEqual(['xclip']);
    expect(x11[0]).toMatchObject({ route: 'stdout' });
    expect(planClipboardImageReads({}, 'linux')).toEqual([]);
  });

  it('win32 → 空集（PowerShell 路挂账未采）', () => {
    expect(planClipboardImageReads({}, 'win32')).toEqual([]);
  });
});

describe('读链平台支持回执（56 轮件 1a——win32 空集显式化）', () => {
  it('win32 → 显式回执词（spawn 前即知不支持——非静默空集）', () => {
    expect(clipboardImageReadUnsupportedReason({}, 'win32')).toBe(CLIPBOARD_IMAGE_UNSUPPORTED_TEXT);
  });

  it('darwin/linux → null（走读链四静默形域——含无显示服的「无命令」静默形）', () => {
    expect(clipboardImageReadUnsupportedReason({}, 'darwin')).toBeNull();
    expect(clipboardImageReadUnsupportedReason({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBeNull();
    expect(clipboardImageReadUnsupportedReason({}, 'linux')).toBeNull(); // 空集计划 = 无命令静默形
  });

  it('SSH 判先于 win32：SSH 会话维持静默（客户端本地机不可达——非本机能力缺席不回执）', () => {
    expect(clipboardImageReadUnsupportedReason({ SSH_TTY: '/dev/pts/0' }, 'win32')).toBeNull();
    expect(clipboardImageReadUnsupportedReason({ SSH_CONNECTION: '1.2.3.4' }, 'win32')).toBeNull();
  });
});

describe('剪贴板图片读器（假执行器——零真子进程）', () => {
  /** osascript 三段脚本里解析临时文件路径（POSIX file "<path>" 形） */
  const pathFromOsascriptArgs = (args: readonly string[]): string => {
    const match = /POSIX file "(.*)"/.exec(args[1] ?? '');
    if (match === null) throw new Error('osascript args 未含 POSIX file 路径');
    return match[1]!;
  };

  it('darwin 临时文件路成功形：假执行器落盘 PNG → base64 载荷 + 临时目录用后即删', async () => {
    const run = fakeRunner(async (_command, args) => {
      const file = pathFromOsascriptArgs(args);
      writeFileSync(file, PNG_BYTES); // 假 osascript 效果：剪贴板图已写入临时文件
      return { ok: true, stdout: Buffer.alloc(0) };
    });
    const reader = createClipboardImageReader(run, {}, 'darwin');
    const payload = await reader();
    // 载荷往返：base64 原文 + image/png 声明
    expect(payload).not.toBeNull();
    expect(payload?.data).toBe(PNG_BYTES.toString('base64'));
    expect(payload?.mimeType).toBe('image/png');
    const calls = (run as unknown as { mock: { calls: [string, readonly string[]][] } }).mock.calls;
    expect(calls[0]![0]).toBe('osascript');
    expect(existsSync(dirname(pathFromOsascriptArgs(calls[0]![1])))).toBe(false); // 用后即删（成功路）
  });

  it('darwin 剪贴板无图（osascript 非零退出）→ null + 临时目录仍删（失败路不残留）', async () => {
    let seenDir = '';
    const run = fakeRunner(async (_command, args) => {
      seenDir = dirname(pathFromOsascriptArgs(args));
      return { ok: false, stdout: Buffer.alloc(0) };
    });
    const reader = createClipboardImageReader(run, {}, 'darwin');
    await expect(reader()).resolves.toBeNull();
    expect(existsSync(seenDir)).toBe(false); // 用后即删（失败路同律）
  });

  it('linux stdout 路成功形：退出码 0 + 非空 stdout → base64 载荷；空 stdout → null（无图静默）', async () => {
    const ok = createClipboardImageReader(
      fakeRunner(async () => ({ ok: true, stdout: PNG_BYTES })),
      { WAYLAND_DISPLAY: 'wayland-0' },
      'linux',
    );
    await expect(ok()).resolves.toEqual({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
    const empty = createClipboardImageReader(
      fakeRunner(async () => ({ ok: true, stdout: Buffer.alloc(0) })),
      { WAYLAND_DISPLAY: 'wayland-0' },
      'linux',
    );
    await expect(empty()).resolves.toBeNull();
  });

  it('次候选回落：wl-paste 失败（ENOENT 形）→ xclip 接手成功', async () => {
    const commands: string[] = [];
    const run = fakeRunner(async (command) => {
      commands.push(command);
      return command === 'wl-paste' ? { ok: false, stdout: Buffer.alloc(0) } : { ok: true, stdout: PNG_BYTES };
    });
    const reader = createClipboardImageReader(run, { WAYLAND_DISPLAY: 'wayland-0' }, 'linux');
    await expect(reader()).resolves.toEqual({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
    expect(commands).toEqual(['wl-paste', 'xclip']);
  });

  it('执行器异常面同静默：全候选抛错 → null（缝契约四静默形兜底位）', async () => {
    const run = fakeRunner(async () => {
      throw new Error('boom');
    });
    const reader = createClipboardImageReader(run, { WAYLAND_DISPLAY: 'wayland-0' }, 'linux');
    await expect(reader()).resolves.toBeNull();
  });
});

describe('缺省执行器超时帽（注入假 spawn——零真子进程）', () => {
  it('2s 帽缺省参可见 + 超时 SIGKILL → close 非零 → ok:false', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.kill = vi.fn(() => {
      child.emit('close', null, 'SIGKILL'); // kill 后子进程终结（信号形退出码 null ≠ 0）
    });
    const spawnFn = vi.fn(() => child);
    const run = createDefaultClipboardCommandRunner(
      20,
      spawnFn as unknown as typeof import('node:child_process').spawn,
    );
    const pending = run('some-clipboard-tool', []);
    await new Promise((resolve) => setTimeout(resolve, 60)); // 越过 20ms 帽
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.stdout).toHaveLength(0);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('正常退出形：退出码 0 + stdout 收集 → ok:true', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    child.stdout = new EventEmitter();
    const spawnFn = vi.fn(() => child);
    const run = createDefaultClipboardCommandRunner(
      1000,
      spawnFn as unknown as typeof import('node:child_process').spawn,
    );
    const pending = run('xclip', ['-o']);
    child.stdout.emit('data', PNG_BYTES.subarray(0, 6));
    child.stdout.emit('data', PNG_BYTES.subarray(6));
    child.emit('close', 0, null);
    await expect(pending).resolves.toEqual({ ok: true, stdout: PNG_BYTES });
  });
});

describe('darwin 读链 spawn 注入桩（56 轮件 1f·gateD 两枚——argv/临时文件面 + 报错腿零残留）', () => {
  /** osascript 三段脚本里解析临时文件路径（POSIX file "<path>" 形——argv[1] 首段脚本） */
  const pathFromArgs = (args: readonly string[]): string => {
    const match = /POSIX file "(.*)"/.exec(args[1] ?? '');
    if (match === null) throw new Error('osascript args 未含 POSIX file 路径');
    return match[1]!;
  };

  /** 假子进程（EventEmitter 面——error/close 消费位与 kill 兜底；零真子进程纪律） */
  const fakeChild = (): EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> } => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: ReturnType<typeof vi.fn> };
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    return child;
  };

  it('成功腿：spawn argv = osascript 三段脚本（«class PNGf» 写段 + 临时文件路径）→ 载荷 + 临时目录用后即删', async () => {
    const spawnFn = vi.fn((_command: string, args: readonly string[]) => {
      const child = fakeChild();
      // 假 osascript 效果：把剪贴板 PNG 写入脚本内临时文件路径（监听器接挂后微任务位兑现）
      queueMicrotask(() => {
        writeFileSync(pathFromArgs(args), PNG_BYTES);
        child.emit('close', 0, null);
      });
      return child;
    });
    const reader = createClipboardImageReader(
      createDefaultClipboardCommandRunner(2000, spawnFn as unknown as typeof import('node:child_process').spawn),
      {},
      'darwin',
    );
    await expect(reader()).resolves.toEqual({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
    // spawn 注入桩断 argv（gateD 枚一）：命令 + 三段脚本（-e 交替）+ «class PNGf» 写段
    const calls = (spawnFn as unknown as { mock: { calls: [string, readonly string[]][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    const [command, args] = calls[0]!;
    expect(command).toBe('osascript');
    expect(args).toHaveLength(6); // -e ×3 + 三段脚本
    expect(args[0]).toBe('-e');
    expect(args[2]).toBe('-e');
    expect(args[4]).toBe('-e');
    expect(args[1]).toContain('open for access POSIX file'); // 临时文件路径锚（首段开写）
    expect(args[3]).toContain('«class PNGf»'); // 剪贴板 PNG 取图写段（核心段）
    expect(args[5]).toBe('close access theFile'); // 末段收文件柄
    expect(pathFromArgs(args)).toMatch(/clip-[^/]+[/\\]clipboard\.png$/); // 临时文件路径形（中性前缀 + 固定名）
    expect(existsSync(dirname(pathFromArgs(args)))).toBe(false); // 用后即删（成功路零残留）
  });

  it('报错腿·spawn 异常（error 事件——ENOENT 形）：静默拒 null + 临时目录零残留', async () => {
    let seenDir = '';
    const spawnFn = vi.fn((_command: string, args: readonly string[]) => {
      const child = fakeChild();
      seenDir = dirname(pathFromArgs(args));
      queueMicrotask(() => child.emit('error', new Error('spawn osascript ENOENT')));
      return child;
    });
    const reader = createClipboardImageReader(
      createDefaultClipboardCommandRunner(2000, spawnFn as unknown as typeof import('node:child_process').spawn),
      {},
      'darwin',
    );
    await expect(reader()).resolves.toBeNull(); // 静默拒（四静默形合流——零弹错由调用方位锁）
    expect(existsSync(seenDir)).toBe(false); // 临时目录零残留（失败路同删）
  });

  it('报错腿·子进程非零退（剪贴板无图形）：静默拒 null + 临时目录零残留', async () => {
    let seenDir = '';
    const spawnFn = vi.fn((_command: string, args: readonly string[]) => {
      const child = fakeChild();
      seenDir = dirname(pathFromArgs(args));
      queueMicrotask(() => child.emit('close', 1, null)); // osascript 非零退出（无图/脚本失败）
      return child;
    });
    const reader = createClipboardImageReader(
      createDefaultClipboardCommandRunner(2000, spawnFn as unknown as typeof import('node:child_process').spawn),
      {},
      'darwin',
    );
    await expect(reader()).resolves.toBeNull();
    expect(existsSync(seenDir)).toBe(false);
  });
});

describe('占位行分拆（提交期附图数判定真源）', () => {
  it('独占占位行计 + 全数剥除；非独占形（行内有字）不计不剥', () => {
    expect(splitImageMarkerLines(COMPOSER_IMAGE_PLACEHOLDER)).toEqual({ text: '', markerCount: 1 });
    expect(splitImageMarkerLines(`hello\n${COMPOSER_IMAGE_PLACEHOLDER}\nworld`)).toEqual({
      text: 'hello\nworld',
      markerCount: 1,
    });
    expect(splitImageMarkerLines(`看 ${COMPOSER_IMAGE_PLACEHOLDER} 图`)).toEqual({
      text: `看 ${COMPOSER_IMAGE_PLACEHOLDER} 图`,
      markerCount: 0,
    });
  });

  it('边界换行收敛：剥行后首尾空行归零、内部空行保留', () => {
    expect(splitImageMarkerLines(`${COMPOSER_IMAGE_PLACEHOLDER}\nhello`)).toEqual({ text: 'hello', markerCount: 1 });
    expect(splitImageMarkerLines(`hello\n${COMPOSER_IMAGE_PLACEHOLDER}`)).toEqual({ text: 'hello', markerCount: 1 });
    expect(splitImageMarkerLines(`${COMPOSER_IMAGE_PLACEHOLDER}\n${COMPOSER_IMAGE_PLACEHOLDER}`)).toEqual({
      text: '',
      markerCount: 2,
    });
    expect(splitImageMarkerLines(`a\n\n${COMPOSER_IMAGE_PLACEHOLDER}\n\nb`)).toEqual({
      text: 'a\n\n\nb',
      markerCount: 1,
    });
  });

  it('行 trim 后恰等词面即独占（前后空白容忍）；无占位原文直通', () => {
    expect(splitImageMarkerLines(`  ${COMPOSER_IMAGE_PLACEHOLDER}  `)).toEqual({ text: '', markerCount: 1 });
    expect(splitImageMarkerLines('普通稿件')).toEqual({ text: '普通稿件', markerCount: 0 });
  });
});

describe('路径变体面判定（normalize_pasted_path）', () => {
  it('绝对路径与 file:// URL 四族放行（大小写不敏感；尾随换行 trim）', () => {
    expect(pastedImagePath('/abs/img.png')).toBe('/abs/img.png');
    expect(pastedImagePath('/abs/img.jpeg')).toBe('/abs/img.jpeg');
    expect(pastedImagePath('/abs/img.JPG')).toBe('/abs/img.JPG');
    expect(pastedImagePath('/abs/img.webp\n')).toBe('/abs/img.webp\n'.trim());
    expect(pastedImagePath('file:///abs/img.gif')).toBe('/abs/img.gif');
    expect(pastedImagePath('FILE:///abs/img.gif')).toBe('/abs/img.gif');
  });

  it('macOS 含空格路径放行（存在性+扩展名双门足够——多词误报面保守拒在多行/相对形）', () => {
    expect(pastedImagePath('/Users/x/My File.png')).toBe('/Users/x/My File.png');
  });

  it('~ 短写展开（56 轮件 1b）：~/x.png → homedir 拼接（展开只用于读盘——返回值即读盘路径）', () => {
    expect(pastedImagePath('~/img.png')).toBe(join(homedir(), 'img.png'));
    // 含空格文件名照拼（macOS 常态——绝对路径腿同放行域）
    expect(pastedImagePath('~/My Shot.png')).toBe(join(homedir(), 'My Shot.png'));
    // 尾随换行 trim 同绝对路径腿
    expect(pastedImagePath('~/img.webp\n')).toBe(join(homedir(), 'img.webp'));
  });

  it('~ 族拒形：裸 ~（无扩展名）/ ~user 命名短写 / ~~ 前缀（保守域不展开）', () => {
    expect(pastedImagePath('~')).toBeNull(); // 展开后是目录——ext 门自拒
    expect(pastedImagePath('~/')).toBeNull();
    expect(pastedImagePath('~user/img.png')).toBeNull(); // 命名用户短写不展开
    expect(pastedImagePath('~~/img.png')).toBeNull();
  });

  it('拒形：相对路径 / 非四族扩展名 / 多行文本 / 空串', () => {
    expect(pastedImagePath('abs/img.png')).toBeNull();
    expect(pastedImagePath('/abs/img.txt')).toBeNull();
    expect(pastedImagePath('/abs/no-ext')).toBeNull();
    expect(pastedImagePath('/abs/a.png\n第二行')).toBeNull();
    expect(pastedImagePath('')).toBeNull();
    expect(pastedImagePath('   ')).toBeNull();
  });
});

describe('图片文件读载荷（真实 tmpdir 只读——readGitHead 同律非子进程面）', () => {
  it('在场 PNG 文件 → base64 载荷 + 声明 MIME', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-test-'));
    try {
      const file = join(dir, 'shot.png');
      writeFileSync(file, PNG_BYTES);
      expect(readImageFilePayload(file)).toEqual({ data: PNG_BYTES.toString('base64'), mimeType: 'image/png' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('缺席 / 非四族扩展名 / 空文件 / 目录形 → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-test-'));
    try {
      expect(readImageFilePayload(join(dir, 'absent.png'))).toBeNull();
      const txt = join(dir, 'note.txt');
      writeFileSync(txt, PNG_BYTES);
      expect(readImageFilePayload(txt)).toBeNull();
      const empty = join(dir, 'empty.png');
      writeFileSync(empty, Buffer.alloc(0));
      expect(readImageFilePayload(empty)).toBeNull();
      mkdirSync(join(dir, 'nested.png')); // 目录占用图片名——isFile 门拒
      expect(readImageFilePayload(join(dir, 'nested.png'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('字节帽预检：5MiB 越帽拒（受理链同值——防大文件读爆）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-test-'));
    try {
      const big = join(dir, 'big.png');
      writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1, 0x00));
      expect(readImageFilePayload(big)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
