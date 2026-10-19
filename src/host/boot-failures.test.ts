/**
 * host/boot-failures 单元测试——启动失败点名账本三函数。
 *
 * fs 全注入（内存 Map——账本是诊断面非真相源，读改写路径纯逻辑可测）；
 * 坏 JSON/坏形视同空账本（宁空勿炸——残缺不拦启动序）。
 *
 * 75 轮件4 追加：账本写面编辑锁（RMW 跨进程互斥）+ 原子写（tmp pid 后缀 +
 * rename）——交错/锁忙/原子形用例（rename 钩子嵌套交错技术，同
 * plugin-market/add.test.ts 74 轮先例）。
 */
import { describe, expect, it, vi } from 'vitest';

import { clearBootFailure, readBootFailures, recordBootFailure } from './boot-failures.js';
import type { BootFailureDoc, BootFailuresFs } from './boot-failures.js';
import type { EditLockFs, EditLockOptions } from '../../plugins/exec/index.js';

/* ---------------- 锁重试短帽缝（76 轮件6——passthrough 单点包裹） ---------------- */

/**
 * 文件级 passthrough vi.mock：spread 全真导出 + withEditLock 原样转发，唯一
 * 差别 = 末参注入重试短帽（1ms × 2，经 76 轮件6 重试常量注入面）——零行为
 * 替身：锁协议（O_EXCL 取锁 / pid 判活破锁 / 超限拒 / finally 释放）全真身，
 * 仅锁忙重试等待从缺省 100ms × 20（约 2.1s 真等）缩至毫秒级——本文件锁忙
 * 形用例（活 pid 锁在场）不再真烧全额等待帽。host 写者族签名无 options 透
 * 传位（规范只定形原语面），故文件级截获（59 轮 native-clipboard 裁量同形）。
 */
vi.mock('../../plugins/exec/edit-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../plugins/exec/edit-lock.js')>();
  return {
    ...actual,
    withEditLock: <T>(fs: EditLockFs, targetPath: string, body: () => T, options?: EditLockOptions) =>
      actual.withEditLock<T>(fs, targetPath, body, { ...options, retryIntervalMs: 1, maxAttempts: 2 }),
  };
});

/** 账本路径速记（内存假路径——内存 fs 上锁/写全可测） */
const PATH = '/boot-failures.json';

/**
 * 内存 fs 速记（锁/原子写四腿全内存实现——openExclusive 单发探测、
 * rename 缺席抛 ENOENT 形同真盘语义）。
 */
function memFs(initial: Record<string, string> = {}): BootFailuresFs & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, text) => {
      files.set(path, text);
    },
    // O_EXCL 探测：在场 = false（EEXIST 折档）；建成 = true
    openExclusive: (path, text) => {
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    },
    // 删单文件（缺席静默——force 语义同真盘桩）
    unlink: (path) => {
      files.delete(path);
    },
    // 内存无目录概念——no-op
    mkdir: () => undefined,
    // rename：源缺席抛（ENOENT 同义——半写探测腿保真）
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: no such file, rename '${from}'`);
      files.set(to, text);
      files.delete(from);
    },
  };
}

describe('readBootFailures', () => {
  it('缺席 = 空账本', () => {
    const fs = memFs();
    expect(readBootFailures(PATH, fs)).toEqual({ failures: {} });
  });

  it('坏 JSON 视同空（宁空勿炸）', () => {
    const fs = memFs({ [PATH]: '{oops' });
    expect(readBootFailures(PATH, fs)).toEqual({ failures: {} });
  });

  it('坏形条目跳过、好条目保留（逐条形状执法）', () => {
    const fs = memFs({
      [PATH]: JSON.stringify({
        failures: {
          'good-plug': { version: '1.0.0', count: 2 },
          badCount: { version: '1.0.0', count: 'three' }, // count 非数
          badVersion: { count: 1 }, // version 缺席
          nullEntry: null,
        },
      }),
    });
    expect(readBootFailures(PATH, fs)).toEqual({
      failures: { 'good-plug': { version: '1.0.0', count: 2 } },
    });
  });

  it('obs-a 扩形字段携带：lastError/lastFailedAt 字符串在场即带出、非字符串静默剥除', () => {
    const fs = memFs({
      [PATH]: JSON.stringify({
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
    expect(readBootFailures(PATH, fs)).toEqual({
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
    const fs = memFs({ [PATH]: JSON.stringify({ failures: 'nope' }) });
    expect(readBootFailures(PATH, fs)).toEqual({ failures: {} });
  });
});

describe('recordBootFailure 记账', () => {
  it('首记 count=1；再记同 id count 累加 + version 就地刷新 + lastError 刷新为本次（obs-a）', () => {
    const fs = memFs();
    const first = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '甲报文' }, fs);
    expect(first.failures['plug-a']).toEqual({
      version: '1.0.0',
      count: 1,
      lastError: '[PLUGIN_APPLY_FAILED] 甲报文',
      lastFailedAt: expect.any(String),
    });
    const second = recordBootFailure(PATH, 'plug-a', '2.0.0', { code: 'PLUGIN_LOAD_FAILED', message: '乙报文' }, fs);
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
      PATH,
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
      [PATH]: JSON.stringify({ failures: { 'plug-a': { version: '1.0.0', count: 5 } } }),
    });
    const doc = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    expect(doc.failures['plug-a']).toEqual({
      version: '1.0.0',
      count: 6, // 旧形 count 续接
      lastError: '[PLUGIN_APPLY_FAILED] m',
      lastFailedAt: expect.any(String),
    });
  });

  it('他行保留（读改写整账本不丢行）', () => {
    const fs = memFs({
      [PATH]: JSON.stringify({ failures: { other: { version: '0.9.0', count: 5 } } }),
    });
    const doc = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    expect(doc.failures['other']).toEqual({ version: '0.9.0', count: 5 });
    expect(doc.failures['plug-a']?.count).toBe(1);
  });

  it('落盘形 = 单 JSON 对象（人读可改——诊断面友好）', () => {
    const fs = memFs();
    recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    const written = fs.files.get(PATH) ?? '';
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
      [PATH]: JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 3 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    const doc = clearBootFailure(PATH, 'plug-a', fs);
    expect(doc.failures).toEqual({ other: { version: '0.9.0', count: 1 } });
  });

  it('缺席 id 幂等（空操作不炸）', () => {
    const fs = memFs();
    const doc = clearBootFailure(PATH, 'absent', fs);
    expect(doc.failures).toEqual({});
  });
});

/** 写侧抛错 fs（读侧内存 Map——写失败守卫用例：模拟 EACCES/EROFS/ENOSPC；锁四腿内存正常形） */
function throwingWriteFs(initial: Record<string, string> = {}): BootFailuresFs {
  const base = memFs(initial);
  return {
    ...base,
    write: () => {
      throw new Error('EACCES: permission denied, open boot-failures.json');
    },
  };
}

describe('写侧守卫（宁丢账不炸启动——与读侧「宁空勿炸：账本是诊断面非真相源」对齐）', () => {
  it('recordBootFailure 写失败吞掉不炸——返回内存计算值（count 照累加）', () => {
    const fs = throwingWriteFs();
    // 修前红：fs.write 抛错直穿函数体——启动序内裸 fs 错误整启炸
    const doc = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    expect(doc.failures['plug-a']).toMatchObject({ version: '1.0.0', count: 1 });
  });

  it('clearBootFailure 写失败吞掉不炸——返回清名后账面（他行保留）', () => {
    const fs = throwingWriteFs({
      [PATH]: JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 2 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    const doc = clearBootFailure(PATH, 'plug-a', fs);
    expect(doc.failures).toEqual({ other: { version: '0.9.0', count: 1 } });
  });

  it('clearBootFailure 条目缺席即跳写（fs.write 零调用——消正常 boot 每 activated 插件的无条件重写）', () => {
    let writes = 0;
    const base = memFs();
    const fs: BootFailuresFs = {
      ...base,
      write: (path, text) => {
        writes += 1;
        base.write(path, text);
      },
    };
    const doc = clearBootFailure(PATH, 'absent', fs);
    expect(doc.failures).toEqual({});
    // 修前红：缺席条目也整账本重写（writes = 1）——正常 boot 对每个已装载插件
    // 各写一次盘的纯放大面
    expect(writes).toBe(0);
  });

  it('条目在场照写（清名本职不变——跳写只针对缺席条目）', () => {
    const fs = memFs({
      [PATH]: JSON.stringify({
        failures: { 'plug-a': { version: '1.0.0', count: 2 }, other: { version: '0.9.0', count: 1 } },
      }),
    });
    clearBootFailure(PATH, 'plug-a', fs);
    expect(JSON.parse(fs.files.get(PATH) ?? '').failures).toEqual({
      other: { version: '0.9.0', count: 1 },
    });
  });
});

/* ---------------- 账本写面编辑锁 + 原子写（03 §5.7 75 轮件4——修前红区） ---------------- */

/**
 * 修前形：recordBootFailure/clearBootFailure 皆「读账本→改→writeFileSync 直写
 * 整文件」RMW 无锁无原子——写者两端（活宿主 boot + 无标记诊断装配 plugins
 * list/dump-config 起真 dataDir 照跑 boot 序）并存交错时后写者以陈旧读整覆
 * 写先写者（跨 boot 续账丢档/点名被清）；且直写非原子（半写窗他进程读折空账）。
 * 修后形：两动词「读→改→写回」整段入编辑锁（锁内重读施增量）+ tmp（pid 后
 * 缀）+rename 原子写；锁忙/写失败同折既有吞错降级律（不炸启动序）。
 */
describe('账本写面编辑锁（75 轮件4：RMW 整段互斥 + 原子写）', () => {
  it('并发 record 交错：A 落盘窗内 B 嵌入 → B 锁忙降级零写（A 的账不丢）；锁释放后 B 重放两笔俱在——修前红：B 无锁直写「成功」却遭 A 覆写吞没（一笔丢）', () => {
    const base = memFs();
    // 交错注入：A 的原子写 rename 位（tmp→账本终名）钩入 B 的完整 record
    // （全同步——嵌套调用即真实交错序；同进程嵌套无自持锁豁免，B 必超限拒）
    let armed = true;
    let bWrites = 0; // B 的落盘腿计数（直写或 tmp 写皆计）——修后 B 锁忙零达
    let nested: BootFailureDoc | null = null;
    const racing: BootFailuresFs = {
      ...base,
      write: (path, text) => {
        // 交错注入：A 的 tmp 写完成后、rename 终名前钩入 B 的完整 record
        //（全同步——嵌套调用即真实交错序；同进程嵌套无自持锁豁免，B 必超限拒）
        if (armed && (path === PATH || path.endsWith(`.tmp-${process.pid}`))) {
          armed = false;
          // B 的 fs：读写同底 Map（真实交错视图像）+ write 计数探针
          const bFs: BootFailuresFs = {
            ...base,
            write: (p, t) => {
              bWrites += 1;
              return base.write(p, t);
            },
          };
          nested = recordBootFailure(PATH, 'plug-b', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '乙' }, bFs);
        }
        return base.write(path, text);
      },
    };
    const aDoc = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '甲' }, racing);
    // A 恒成功落账（B 的嵌入不搅局 A 的临界段）
    expect(aDoc.failures['plug-a']).toMatchObject({ version: '1.0.0', count: 1 });
    expect(nested).not.toBeNull();
    // 修后：B 锁忙降级零写（不无锁写）；修前红：B 无锁直写落盘（= 1）且终态
    // 只剩 A 的账——B 的记账被 A 的写回覆写吞没（丢更新面全暴露）
    expect(bWrites).toBe(0);
    // 终态账本：A 的账在场（锁内重读增量——A 不持锁外旧读）
    const afterA = JSON.parse(base.files.get(PATH) ?? '{}') as { failures: Record<string, unknown> };
    expect(afterA.failures['plug-a']).toBeDefined();
    expect(afterA.failures['plug-b']).toBeUndefined(); // B 被拒未写成（诚实拒非静默吞）
    // 锁已释放（A 的 finally unlink）——B 重放：锁内重读到 A 的账 → 两笔俱在
    const replay = recordBootFailure(PATH, 'plug-b', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '乙' }, base);
    expect(replay.failures['plug-a']).toBeDefined();
    expect(replay.failures['plug-b']).toMatchObject({ version: '1.0.0', count: 1 });
  });

  it('clear×record 交错：A 清名落盘窗内 B 嵌入记账 → B 锁忙降级零写（A 的清名不丢）；B 重放续账——修前红：B 的 count 累加被 A 覆写吞没（续账断裂）', () => {
    const base = memFs({
      [PATH]: JSON.stringify({
        failures: { 'plug-x': { version: '1.0.0', count: 2 }, 'plug-y': { version: '1.0.0', count: 1 } },
      }),
    });
    let armed = true;
    let bWrites = 0;
    let nested: BootFailureDoc | null = null;
    const racing: BootFailuresFs = {
      ...base,
      write: (path, text) => {
        // 同 record 交错用例：A 的 tmp 写完成后、rename 终名前钩入 B
        if (armed && (path === PATH || path.endsWith(`.tmp-${process.pid}`))) {
          armed = false;
          const bFs: BootFailuresFs = {
            ...base,
            write: (p, t) => {
              bWrites += 1;
              return base.write(p, t);
            },
          };
          nested = recordBootFailure(PATH, 'plug-y', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '乙' }, bFs);
        }
        return base.write(path, text);
      },
    };
    const aDoc = clearBootFailure(PATH, 'plug-x', racing);
    // A 清名不丢：x 抹、y 原样（count 未被 B 的陈旧读覆写回 2——续账不断裂）
    expect(aDoc.failures['plug-x']).toBeUndefined();
    expect(aDoc.failures['plug-y']).toMatchObject({ version: '1.0.0', count: 1 });
    // 修后 B 锁忙零写；修前红：B 直写「成功」（= 1）却整盘被 A 覆写吞没
    expect(bWrites).toBe(0);
    expect(nested).not.toBeNull();
    // B 重放：锁内重读到 A 的清名后账面 → y 续账 count 2
    const replay = recordBootFailure(PATH, 'plug-y', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: '乙' }, base);
    expect(replay.failures['plug-y']).toMatchObject({ version: '1.0.0', count: 2 });
    expect(replay.failures['plug-x']).toBeUndefined();
  });

  it('锁忙吞错降级：活 pid 锁在场 → record 吞锁拒不炸启动序、账本字节不动、返回内存计算值——修前红：无锁直写成功（账本被改）', () => {
    const seed = JSON.stringify({ failures: { other: { version: '0.9.0', count: 5 } } });
    const fs = memFs({ [PATH]: seed, [`${PATH}.lock`]: `${process.pid}\n` });
    const doc = recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    // 降级返回内存计算值（他行照携——横幅/清单呈现不受牵连）
    expect(doc.failures['plug-a']).toMatchObject({ version: '1.0.0', count: 1 });
    expect(doc.failures['other']).toBeDefined();
    // 账本字节不动（锁拒绝绝不退化为无锁写——宁丢本笔记账不丢他进程更新）
    expect(fs.files.get(PATH)).toBe(seed);
  });

  it('锁忙吞错降级（clear 腿）：活 pid 锁在场 → clear 吞锁拒不炸、账本字节不动、返回清名后内存账面', () => {
    const seed = JSON.stringify({ failures: { other: { version: '0.9.0', count: 5 } } });
    const fs = memFs({ [PATH]: seed, [`${PATH}.lock`]: `${process.pid}\n` });
    const cleared = clearBootFailure(PATH, 'other', fs);
    expect(cleared.failures['other']).toBeUndefined();
    expect(fs.files.get(PATH)).toBe(seed);
  });

  it('落盘原子形：tmp（pid 后缀）+ rename 终名——写后无 tmp 残留（半写窗他进程读不折空账）；锁文件收尾清场', () => {
    const base = memFs();
    const renames: [string, string][] = [];
    const fs: BootFailuresFs = {
      ...base,
      rename: (from, to) => {
        renames.push([from, to]);
        return base.rename(from, to);
      },
    };
    recordBootFailure(PATH, 'plug-a', '1.0.0', { code: 'PLUGIN_APPLY_FAILED', message: 'm' }, fs);
    // rename 对恰一：tmp = <账本>.tmp-<pid> → 终名（同目录同卷原子性 + 并行写者 tmp 互不踩）
    expect(renames).toEqual([[`${PATH}.tmp-${process.pid}`, PATH]]);
    // 终名在、tmp 与锁文件皆无残留（锁 finally 释放）
    expect([...base.files.keys()].filter((k) => k.includes('.tmp-') || k.endsWith('.lock'))).toEqual([]);
    expect(JSON.parse(base.files.get(PATH) ?? '{}').failures['plug-a']).toMatchObject({ count: 1 });
  });
});
