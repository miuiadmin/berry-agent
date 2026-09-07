/**
 * 引擎发现序测试（03 §10.3——四步发现 + 显式误配 fail-loud + 诚实缺席）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { discoverEngine } from './discover.js';
import type { BrowserFsFace } from './types.js';

/** 内存文件面（路径集 = 存在的普通文件） */
function fakeFs(files: readonly string[]): BrowserFsFace {
  const set = new Set(files);
  return {
    access: async (path) => {
      if (!set.has(path)) throw new Error(`ENOENT: ${path}`);
    },
    readFile: async (path, _encoding) => {
      if (path.endsWith('ledger.json') && set.has(path)) return ledgerRaw ?? '';
      throw new Error(`ENOENT: ${path}`);
    },
    writeFile: async () => {},
    mkdir: async () => {},
    readdir: async () => [],
    stat: async (path) => {
      if (!set.has(path)) throw new Error(`ENOENT: ${path}`);
      return { isFile: () => true };
    },
    unlink: async () => {},
  };
}

let ledgerRaw: string | undefined;

/** 发现序入参组装（_ 前缀键 = 测试专用品，不进 discoverEngine 签名） */
interface DepsInput {
  readonly files?: readonly string[];
  readonly env?: (name: string) => string | undefined;
  readonly platform?: NodeJS.Platform;
  readonly executablePath?: string;
}

function deps(input: DepsInput = {}): Parameters<typeof discoverEngine>[0] {
  return {
    fs: fakeFs(input.files ?? []),
    readEnv: input.env ?? (() => undefined),
    platform: input.platform ?? 'darwin',
    homeDir: '/Users/tester',
    dataDir: '/data',
    ...(input.executablePath !== undefined ? { executablePath: input.executablePath } : {}),
  };
}

describe('① 显式覆盖（config 优先于 env）', () => {
  it('config executablePath 命中（source=config）', async () => {
    const r = await discoverEngine(deps({ files: ['/opt/chrome'], executablePath: '/opt/chrome' }));
    expect(r).toEqual({ path: '/opt/chrome', source: 'config' });
  });

  it('env BERRY_AGENT_BROWSER_PATH 命中（config 缺席时）', async () => {
    const r = await discoverEngine(deps({ files: ['/env/chrome'], env: () => '/env/chrome' }));
    expect(r).toEqual({ path: '/env/chrome', source: 'env' });
  });

  it('config 在场时 env 不参与（config 优先——行面覆盖环境面）', async () => {
    const r = await discoverEngine(
      deps({ files: ['/cfg/chrome'], executablePath: '/cfg/chrome', env: () => '/env/chrome' }),
    );
    expect(r.source).toBe('config');
  });

  it('显式路径缺席 fail-loud：BROWSER_ENGINE_NOT_FOUND 指名（不静默回退系统位）', async () => {
    const r = discoverEngine(
      deps({ files: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], executablePath: '/typo/chrome' }),
    );
    await expect(r).rejects.toSatisfy(
      (err: unknown) => err instanceof BaseError && err.code === 'BROWSER_ENGINE_NOT_FOUND',
    );
    await expect(r).rejects.toThrow('/typo/chrome');
  });
});

describe('② 知名位 + PATH', () => {
  it('macOS 系统级知名位命中', async () => {
    const r = await discoverEngine(deps({ files: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] }));
    expect(r).toEqual({ path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', source: 'wellknown' });
  });

  it('macOS 用户级知名位（homeDir）命中', async () => {
    const user = '/Users/tester/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const r = await discoverEngine(deps({ files: [user] }));
    expect(r.source).toBe('wellknown');
    expect(r.path).toBe(user);
  });

  it('Linux 知名位族命中（chromium 形）', async () => {
    const r = await discoverEngine(deps({ platform: 'linux', files: ['/usr/bin/chromium'] }));
    expect(r).toEqual({ path: '/usr/bin/chromium', source: 'wellknown' });
  });

  it('win32 知名位 v1 诚实缺席（空表直落 PATH 腿）', async () => {
    const r = await discoverEngine(
      deps({ platform: 'win32', files: ['C:/Apps/chrome.exe'], env: (n) => (n === 'PATH' ? 'C:/Apps' : undefined) }),
    );
    expect(r).toEqual({ path: 'C:/Apps/chrome.exe', source: 'path' });
  });

  it('PATH 探测命中（目录尾斜杠归一）', async () => {
    const r = await discoverEngine(
      deps({
        platform: 'linux',
        files: ['/opt/bin/google-chrome-stable'],
        env: (n) => (n === 'PATH' ? '/usr/local/bin:/opt/bin/' : undefined),
      }),
    );
    expect(r).toEqual({ path: '/opt/bin/google-chrome-stable', source: 'path' });
  });

  it('PATH 多目录按序扫描（首目录命中即止）', async () => {
    const r = await discoverEngine(
      deps({
        platform: 'linux',
        files: ['/a/chromium', '/b/chromium'],
        env: (n) => (n === 'PATH' ? '/a:/b' : undefined),
      }),
    );
    expect(r.path).toBe('/a/chromium');
  });
});

describe('③ 数据目录专用引擎（/browser install 产物）', () => {
  it('账本在 + 可执行在 → source=dataDir', async () => {
    ledgerRaw = JSON.stringify({ version: '131.0.6778.0', executableRel: 'chrome-linux64/chrome', zipSha256: 'aa' });
    try {
      const r = await discoverEngine(
        deps({
          platform: 'linux',
          files: ['/data/browser/engine/ledger.json', '/data/browser/engine/chrome-linux64/chrome'],
        }),
      );
      expect(r).toEqual({ path: '/data/browser/engine/chrome-linux64/chrome', source: 'dataDir' });
    } finally {
      ledgerRaw = undefined;
    }
  });

  it('账本坏 JSON / executableRel 缺席 → 静默落第④步（install 未跑即无引擎）', async () => {
    ledgerRaw = '{oops';
    try {
      await expect(
        discoverEngine(deps({ platform: 'linux', files: ['/data/browser/engine/ledger.json'] })),
      ).rejects.toSatisfy((err: unknown) => err instanceof BaseError && err.code === 'BROWSER_ENGINE_NOT_FOUND');
    } finally {
      ledgerRaw = undefined;
    }
  });

  it('账本指名的可执行缺席 → 不命中（半截安装不认账）', async () => {
    ledgerRaw = JSON.stringify({ executableRel: 'chrome-linux64/chrome' });
    try {
      await expect(
        discoverEngine(deps({ platform: 'linux', files: ['/data/browser/engine/ledger.json'] })),
      ).rejects.toSatisfy((err: unknown) => err instanceof BaseError && err.code === 'BROWSER_ENGINE_NOT_FOUND');
    } finally {
      ledgerRaw = undefined;
    }
  });
});

describe('④ 诚实缺席', () => {
  it('全缺席：BROWSER_ENGINE_NOT_FOUND 附三选一安装指引（不自动下载）', async () => {
    const err = await discoverEngine(deps({ platform: 'linux' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('BROWSER_ENGINE_NOT_FOUND');
    expect((err as BaseError).message).toContain('/browser install');
    expect((err as BaseError).message).toContain('BERRY_AGENT_BROWSER_PATH');
  });
});
