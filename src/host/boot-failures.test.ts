/**
 * host/boot-failures 单元测试——启动失败点名账本三函数。
 *
 * fs 全注入（内存 Map——账本是诊断面非真相源，读改写路径纯逻辑可测）；
 * 坏 JSON/坏形视同空账本（宁空勿炸——残缺不拦启动序）。
 */
import { describe, expect, it } from 'vitest';

import { clearBootFailure, readBootFailures, recordBootFailure } from './boot-failures.js';
import type { BootFailuresFs } from './boot-failures.js';

/** 内存 fs 速记 */
function memFs(initial: Record<string, string> = {}): BootFailuresFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, text) => {
      files.set(path, text);
    },
  };
}

describe('readBootFailures', () => {
  it('缺席 = 空账本', () => {
    const fs = memFs();
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({ failures: {} });
  });

  it('坏 JSON 视同空（宁空勿炸）', () => {
    const fs = memFs({ '/boot-failures.json': '{oops' });
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({ failures: {} });
  });

  it('坏形条目跳过、好条目保留（逐条形状执法）', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({
        failures: {
          'good-plug': { version: '1.0.0', count: 2 },
          badCount: { version: '1.0.0', count: 'three' }, // count 非数
          badVersion: { count: 1 }, // version 缺席
          nullEntry: null,
        },
      }),
    });
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({
      failures: { 'good-plug': { version: '1.0.0', count: 2 } },
    });
  });

  it('obs-a 扩形字段携带：lastError/lastFailedAt 字符串在场即带出、非字符串静默剥除', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({
        failures: {
          'new-shape': {
            version: '1.0.0',
            count: 2,
            lastError: '[PLUGIN_APPLY_FAILED] apply 崩了',
            lastFailedAt: '2026-09-13T00:00:00.000Z',
          },
          // 旧形条目（obs-a 前落账）——两字段缺席容错读不迁移
          'old-shape': { version: '0.9.0', count: 7 },
          badError: { version: '1.0.0', count: 1, lastError: 42, lastFailedAt: true },
        },
      }),
    });
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({
      failures: {
        'new-shape': {
          version: '1.0.0',
          count: 2,
          lastError: '[PLUGIN_APPLY_FAILED] apply 崩了',
          lastFailedAt: '2026-09-13T00:00:00.000Z',
        },
        'old-shape': { version: '0.9.0', count: 7 },
        badError: { version: '1.0.0', count: 1 },
      },
    });
  });

  it('顶层坏形（failures 非对象）视同空', () => {
    const fs = memFs({ '/boot-failures.json': JSON.stringify({ failures: 'nope' }) });
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({ failures: {} });
  });
});

describe('recordBootFailure 记账', () => {
  it('首记 count=1；再记同 id count 累加 + version 就地刷新 + lastError 刷新为本次（obs-a）', () => {
    const fs = memFs();
    const first = recordBootFailure(
      '/boot-failures.json',
      'plug-a',
      '1.0.0',
      { code: 'PLUGIN_APPLY_FAILED', message: '甲报文' },
      fs,
    );
    expect(first.failures['plug-a']).toEqual({
      version: '1.0.0',
      count: 1,
      lastError: '[PLUGIN_APPLY_FAILED] 甲报文',
      lastFailedAt: expect.any(String),
    });
    const second = recordBootFailure(
      '/boot-failures.json',
      'plug-a',
      '2.0.0',
      { code: 'PLUGIN_LOAD_FAILED', message: '乙报文' },
      fs,
    );
    expect(second.failures['plug-a']).toEqual({
      version: '2.0.0', // 版本刷新为本次
      count: 2,
      lastError: '[PLUGIN_LOAD_FAILED] 乙报文', // 错误文本刷新为最近一次
      lastFailedAt: expect.any(String),
    });
    // lastFailedAt 是 ISO 时点（可被 Date.parse 复原）
    expect(Number.isFinite(Date.parse(String(second.failures['plug-a']?.lastFailedAt)))).toBe(true);
  });

  it('lastError 帽 500 字符（[码] 报文 合成后截断——防账本膨胀）', () => {
    const fs = memFs();
    const doc = recordBootFailure(
      '/boot-failures.json',
      'plug-long',
      '1.0.0',
      { code: 'PLUGIN_APPLY_FAILED', message: 'x'.repeat(2_000) },
      fs,
    );
    const entry = doc.failures['plug-long'];
    expect(entry?.lastError).toHaveLength(500);
    expect(entry?.lastError?.startsWith('[PLUGIN_APPLY_FAILED] ')).toBe(true);
  });

  it('旧形遗留账本续记：prev 无 lastError 照常累加（缺席容错——无迁移读改写）', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({ failures: { 'plug-a': { version: '1.0.0', count: 5 } } }),
    });
    const doc = recordBootFailure(
      '/boot-failures.json',
      'plug-a',
      '1.0.0',
      { code: 'PLUGIN_APPLY_FAILED', message: 'm' },
      fs,
    );
    expect(doc.failures['plug-a']).toEqual({
      version: '1.0.0',
      count: 6, // 旧形 count 续接
      lastError: '[PLUGIN_APPLY_FAILED] m',
      lastFailedAt: expect.any(String),
    });
  });

  it('他行保留（读改写整账本不丢行）', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({ failures: { other: { version: '0.9.0', count: 5 } } }),
    });
    const doc = recordBootFailure(
      '/boot-failures.json',
      'plug-a',
      '1.0.0',
      { code: 'PLUGIN_APPLY_FAILED', message: 'm' },
      fs,
    );
    expect(doc.failures['other']).toEqual({ version: '0.9.0', count: 5 });
    expect(doc.failures['plug-a']?.count).toBe(1);
  });

  it('落盘形 = 单 JSON 对象（人读可改——诊断面友好）', () => {
    const fs = memFs();
    recordBootFailure('/boot-failures.json', 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    const written = fs.files.get('/boot-failures.json') ?? '';
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written).failures['plug-a']).toMatchObject({
      version: '1.0.0',
      count: 1,
      lastError: '[PLUGIN_APPLY_FAILED] m',
    });
  });
});

describe('clearBootFailure 清名', () => {
  it('装载成功即清名、他行保留', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 3 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    const doc = clearBootFailure('/boot-failures.json', 'plug-a', fs);
    expect(doc.failures).toEqual({ other: { version: '0.9.0', count: 1 } });
  });

  it('缺席 id 幂等（空操作不炸）', () => {
    const fs = memFs();
    const doc = clearBootFailure('/boot-failures.json', 'absent', fs);
    expect(doc.failures).toEqual({});
  });
});

/** 写侧抛错 fs（读侧内存 Map——写失败守卫用例：模拟 EACCES/EROFS/ENOSPC） */
function throwingWriteFs(initial: Record<string, string> = {}): BootFailuresFs {
  const files = new Map(Object.entries(initial));
  return {
    read: (path) => files.get(path) ?? null,
    write: () => {
      throw new Error('EACCES: permission denied, open boot-failures.json');
    },
  };
}

describe('写侧守卫（宁丢账不炸启动——与读侧「宁空勿炸：账本是诊断面非真相源」对齐）', () => {
  it('recordBootFailure 写失败吞掉不炸——返回内存计算值（count 照累加）', () => {
    const fs = throwingWriteFs();
    // 修前红：fs.write 抛错直穿函数体——启动序内裸 fs 错误整启炸
    const doc = recordBootFailure(
      '/boot-failures.json',
      'plug-a',
      '1.0.0',
      { code: 'PLUGIN_APPLY_FAILED', message: 'm' },
      fs,
    );
    expect(doc.failures['plug-a']).toMatchObject({ version: '1.0.0', count: 1 });
  });

  it('clearBootFailure 写失败吞掉不炸——返回清名后账面（他行保留）', () => {
    const fs = throwingWriteFs({
      '/boot-failures.json': JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 2 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    const doc = clearBootFailure('/boot-failures.json', 'plug-a', fs);
    expect(doc.failures).toEqual({ other: { version: '0.9.0', count: 1 } });
  });

  it('clearBootFailure 条目缺席即跳写（fs.write 零调用——消正常 boot 每 activated 插件的无条件重写）', () => {
    let writes = 0;
    const fs: BootFailuresFs = {
      read: () => null,
      write: () => {
        writes += 1;
      },
    };
    const doc = clearBootFailure('/boot-failures.json', 'absent', fs);
    expect(doc.failures).toEqual({});
    // 修前红：缺席条目也整账本重写（writes = 1）——正常 boot 对每个已装载插件
    // 各写一次盘的纯放大面
    expect(writes).toBe(0);
  });

  it('条目在场照写（清名本职不变——跳写只针对缺席条目）', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 2 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    clearBootFailure('/boot-failures.json', 'plug-a', fs);
    expect(JSON.parse(fs.files.get('/boot-failures.json') ?? '').failures).toEqual({
      other: { version: '0.9.0', count: 1 },
    });
  });
});
