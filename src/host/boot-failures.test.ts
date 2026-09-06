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

  it('顶层坏形（failures 非对象）视同空', () => {
    const fs = memFs({ '/boot-failures.json': JSON.stringify({ failures: 'nope' }) });
    expect(readBootFailures('/boot-failures.json', fs)).toEqual({ failures: {} });
  });
});

describe('recordBootFailure 记账', () => {
  it('首记 count=1；再记同 id count 累加 + version 就地刷新', () => {
    const fs = memFs();
    const first = recordBootFailure('/boot-failures.json', 'plug-a', '1.0.0', fs);
    expect(first.failures['plug-a']).toEqual({ version: '1.0.0', count: 1 });
    const second = recordBootFailure('/boot-failures.json', 'plug-a', '2.0.0', fs);
    expect(second.failures['plug-a']).toEqual({ version: '2.0.0', count: 2 }); // 版本刷新为本次
  });

  it('他行保留（读改写整账本不丢行）', () => {
    const fs = memFs({
      '/boot-failures.json': JSON.stringify({ failures: { other: { version: '0.9.0', count: 5 } } }),
    });
    const doc = recordBootFailure('/boot-failures.json', 'plug-a', '1.0.0', fs);
    expect(doc.failures['other']).toEqual({ version: '0.9.0', count: 5 });
    expect(doc.failures['plug-a']).toEqual({ version: '1.0.0', count: 1 });
  });

  it('落盘形 = 单 JSON 对象（人读可改——诊断面友好）', () => {
    const fs = memFs();
    recordBootFailure('/boot-failures.json', 'plug-a', '1.0.0', fs);
    const written = fs.files.get('/boot-failures.json') ?? '';
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written)).toEqual({ failures: { 'plug-a': { version: '1.0.0', count: 1 } } });
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
