/**
 * host/plugin-store 装机面写侧存储件测试（成熟度缺口 #10 装机面落码批 10a）。
 *
 * 覆盖四块：账本 CRUD（宽容两式读/条目数组形写/原子写无 tmp 残留/upsert 后见
 * 胜出/坏账本拒写）、enabled.yaml 行编辑（mount 撞名/unmount core 指路/toggle
 * 三态翻转字段保形）、installPath 三源推导（scoped 嵌套/git 分层/坏 url 拒）、
 * 清算双路径断言（装机子树/数据子目录两防线的界内界外全域）。
 *
 * fs 全内存注入（真盘语义的 Map 形还原——测试零真盘零 spawn）。
 */
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { readEnabledRows } from './plugin-boot.js';
import { enabledYamlPath } from './manifest.js';
import {
  assertInsideInstallSubtree,
  assertInsidePluginData,
  createPluginStoreFs,
  editDoorsSegment,
  installPathForGit,
  installPathForLocal,
  installPathForNpm,
  isInstallStructurePath,
  ledgerPath,
  mountRow,
  pluginDataDir,
  readEnabledRowsForEdit,
  readLedger,
  removeLedgerEntry,
  setRowConfig,
  toggleRow,
  unmountRow,
  upsertLedgerEntry,
  writeLedger,
} from './plugin-store.js';
import type { LifecycleAuditSink, PluginLedgerEntry, PluginStoreFs } from './plugin-store.js';

/** 内存 fs（文件树 Map 形——目录隐含于路径前缀，size 按字节量合计） */
function memFs(initial: Record<string, string> = {}): PluginStoreFs {
  const files = new Map(Object.entries(initial));
  const isUnder = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    mkdir: () => undefined, // 内存形目录隐含——no-op
    rm: (path) => {
      for (const key of [...files.keys()]) if (isUnder(key, path)) files.delete(key);
    },
    readdir: (path) => {
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(`${path}/`)) names.add(key.slice(path.length + 1).split('/')[0]!);
      }
      return names.size === 0 ? null : [...names];
    },
    size: (path) => {
      let total = 0;
      let hit = false;
      for (const [key, text] of files) {
        if (isUnder(key, path)) {
          total += Buffer.byteLength(text, 'utf8');
          hit = true;
        }
      }
      return hit ? total : null;
    },
    // O_EXCL 探测内存形（Map has/set——在场折 false 建成折 true）
    openExclusive: (path, text) => {
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    },
    unlink: (path) => void files.delete(path),
  };
}

/** 读侧窄化帮手（好账本取 entries；坏账本路径另有 ok 面断言） */
function ledgerEntriesOf(dataDir: string, fs: PluginStoreFs): readonly PluginLedgerEntry[] {
  const read = readLedger(dataDir, fs);
  if (!read.ok) throw new Error(`坏账本：${read.reason}`);
  return read.entries;
}

/** 样例条目速记（字段面按源裁剪） */
function entry(overrides: Partial<PluginLedgerEntry> & { readonly id: string }): PluginLedgerEntry {
  return {
    source: 'npm',
    ref: `npm:${overrides.id}`,
    installedAt: '2026-09-09T00:00:00.000Z',
    installPath: `plugins/node_modules/${overrides.id}`,
    declaredEvents: [],
    ...overrides,
  };
}

describe('装机账本读侧（宽容两式）', () => {
  it('缺席 = 空账本（首启零文件）', () => {
    expect(readLedger('/data', memFs())).toEqual({ ok: true, entries: [] });
  });

  it('条目数组形直读 + 键映射形同读（历史文件兼容面）', () => {
    const arrayForm = JSON.stringify([entry({ id: 'a' }), entry({ id: 'b' })]);
    const mapForm = JSON.stringify({ a: entry({ id: 'a' }), b: entry({ id: 'b' }) });
    expect(ledgerEntriesOf('/data', memFs({ '/data/plugins/ledger.json': arrayForm })).map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
    expect(ledgerEntriesOf('/data', memFs({ '/data/plugins/ledger.json': mapForm })).map((e) => e.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('坏 JSON / 顶层标量 / 条目缺必填字段 = invalid（写侧拒写防覆盖的判据面）', () => {
    expect(readLedger('/data', memFs({ '/data/plugins/ledger.json': '{oops' })).ok).toBe(false);
    expect(readLedger('/data', memFs({ '/data/plugins/ledger.json': '42' })).ok).toBe(false);
    const noPath = JSON.stringify([{ id: 'a', source: 'npm', ref: 'npm:a', installedAt: 't' }]); // 缺 installPath
    expect(readLedger('/data', memFs({ '/data/plugins/ledger.json': noPath })).ok).toBe(false);
  });

  it('同 id 去重后见胜出（手编残影容错）', () => {
    const dup = JSON.stringify([entry({ id: 'a', ref: 'npm:a@1' }), entry({ id: 'a', ref: 'npm:a@2' })]);
    const read = readLedger('/data', memFs({ '/data/plugins/ledger.json': dup }));
    expect(read.ok && read.entries).toHaveLength(1);
    expect(read.ok && read.entries[0]!.ref).toBe('npm:a@2');
  });

  it('手编坏形 inject（非数组/数组掺非串）= 宽容消毒不整账本 invalid（66 轮件G——视零 inject 排序）', () => {
    // 非数组形：整条目照读、inject 位折 undefined（不 invalid——与 declaredEvents
    // 非数组折 [] 同宽容档，坏形不吞装机真相）
    const rawNotArray = JSON.stringify([{ ...entry({ id: 'a' }), inject: 'oops' } as unknown as PluginLedgerEntry]);
    const readA = readLedger('/data', memFs({ '/data/plugins/ledger.json': rawNotArray }));
    expect(readA.ok).toBe(true);
    expect(readA.ok && readA.entries[0]!.inject).toBeUndefined();
    // 数组掺非串：滤后保真（declaredEvents 消毒同形——逐项 string 才留）
    const rawMixed = JSON.stringify([{ ...entry({ id: 'b' }), inject: ['svc-x', 7] } as unknown as PluginLedgerEntry]);
    const readB = readLedger('/data', memFs({ '/data/plugins/ledger.json': rawMixed }));
    expect(readB.ok && readB.entries[0]!.inject).toEqual(['svc-x']);
  });
});

describe('装机账本写侧（条目数组形单源）', () => {
  it('inject 预收割位读写往返保真（66 轮件G——§5.4 排序信号跨重启载体）', () => {
    const fs = memFs();
    writeLedger('/data', [entry({ id: 'a', inject: ['svc-x', 'svc-y'] })], fs);
    // 写侧入账 → 读侧（checkEntryShape 重建）携带——往返不丢位
    const entries = ledgerEntriesOf('/data', fs);
    expect(entries[0]!.inject).toEqual(['svc-x', 'svc-y']);
  });

  it('writeLedger 恒出数组形 + 原子写无 tmp 残留', () => {
    const fs = memFs();
    writeLedger('/data', [entry({ id: 'a' })], fs);
    const written = fs.read('/data/plugins/ledger.json')!;
    expect(Array.isArray(JSON.parse(written))).toBe(true);
    expect(written.endsWith('\n')).toBe(true); // 尾换行（POSIX 文本惯例）
    expect(fs.read('/data/plugins/ledger.json.tmp-1')).toBeNull(); // rename 已清 tmp
  });

  it('upsert：新条目尾追加；同 id 后见胜出（install/update 共用）', () => {
    const fs = memFs();
    upsertLedgerEntry('/data', entry({ id: 'a', version: '1.0.0' }), fs);
    upsertLedgerEntry('/data', entry({ id: 'b' }), fs);
    upsertLedgerEntry('/data', entry({ id: 'a', version: '2.0.0' }), fs);
    const read = readLedger('/data', fs);
    expect(read.ok && read.entries.map((e) => e.id)).toEqual(['b', 'a']); // 保序尾追加
    expect(read.ok && read.entries[1]!.version).toBe('2.0.0');
  });

  it('upsert/remove 对坏账本 fail-loud 拒写（不覆盖装机真相）', () => {
    const bad = memFs({ '/data/plugins/ledger.json': '{oops' });
    expect(() => upsertLedgerEntry('/data', entry({ id: 'a' }), bad)).toThrowError(BaseError);
    expect(() => removeLedgerEntry('/data', 'a', bad)).toThrowError(BaseError);
    expect(bad.read('/data/plugins/ledger.json')).toBe('{oops'); // 原文未动
  });

  it('remove：删条目幂等（查无 = no-op）', () => {
    const fs = memFs();
    upsertLedgerEntry('/data', entry({ id: 'a' }), fs);
    removeLedgerEntry('/data', 'a', fs);
    expect(ledgerEntriesOf('/data', fs)).toHaveLength(0);
    expect(() => removeLedgerEntry('/data', 'a', fs)).not.toThrow();
  });
});

describe('enabled.yaml 行编辑', () => {
  it('mount：append 行；撞名拒（改配置 = unmount 后重 mount）', () => {
    const fs = memFs();
    expect(mountRow('/data', 'user-x', undefined, fs).ok).toBe(true);
    expect(mountRow('/data', 'user-x', undefined, fs).ok).toBe(false); // 撞名
    const rows = readEnabledRowsForEdit('/data', fs);
    expect(rows.ok && rows.rows.map((r) => r.id)).toEqual(['user-x']);
  });

  it('mount core: id 合法（overlay 覆盖内置默认态主用例）', () => {
    const fs = memFs();
    expect(mountRow('/data', 'core:webui', undefined, fs).ok).toBe(true);
    expect(readEnabledRowsForEdit('/data', fs).ok).toBe(true); // core: 行过行校验
  });

  it('unmount：删行保装机；core: 行不在场指路 toggle；用户 id 幂等', () => {
    const fs = memFs();
    mountRow('/data', 'user-x', undefined, fs);
    expect(unmountRow('/data', 'user-x', fs).ok).toBe(true);
    expect(unmountRow('/data', 'user-x', fs).ok).toBe(true); // 幂等（已不在启用面）
    expect(unmountRow('/data', 'core:webui', fs).ok).toBe(false); // 内置全启无行可删
    expect(unmountRow('/data', 'core:webui', fs)).toMatchObject({ ok: false });
  });

  it('toggle 三态：不在场写 disabled 行 → 翻启用保字段 → 再禁用保字段', () => {
    const fs = memFs();
    // 行不在场：写 {id, disabled: true}（disable 内置 core: 件主路径）
    expect(toggleRow('/data', 'core:webui', fs).ok).toBe(true);
    let rows = readEnabledRowsForEdit('/data', fs);
    expect(rows.ok && rows.rows).toEqual([{ id: 'core:webui', disabled: true }]);
    // 再 toggle：回启用（行保场、旗标撤）
    expect(toggleRow('/data', 'core:webui', fs).ok).toBe(true);
    rows = readEnabledRowsForEdit('/data', fs);
    expect(rows.ok && rows.rows).toEqual([{ id: 'core:webui' }]);
    // 用户行带 config/opens 字段翻转保形
    const fs2 = memFs({ '/data/enabled.yaml': 'plugins:\n  - id: user-x\n    config:\n      k: 1\n' });
    expect(toggleRow('/data', 'user-x', fs2).ok).toBe(true);
    let rows2 = readEnabledRowsForEdit('/data', fs2);
    expect(rows2.ok && rows2.rows[0]).toEqual({ id: 'user-x', config: { k: 1 }, disabled: true });
    expect(toggleRow('/data', 'user-x', fs2).ok).toBe(true);
    rows2 = readEnabledRowsForEdit('/data', fs2);
    expect(rows2.ok && rows2.rows[0]).toEqual({ id: 'user-x', config: { k: 1 } });
  });

  it('toggle 造新行 id 词法闸：坏词法诚实拒不写盘不落账（防坏行落盘 brick 下次 boot 读侧）', () => {
    const fs = memFs();
    let audits = 0;
    const result = toggleRow('/data', 'Bad_Id', fs, () => void audits++);
    expect(result.ok).toBe(false); // 修前红：坏词法 id 写盘成功 ok:true
    if (!result.ok) expect(result.message).toContain('格式不对');
    expect(fs.read('/data/enabled.yaml')).toBeNull(); // 修前红：坏行已落盘
    expect(audits).toBe(0); // 拒路径无变更不造账（修前红：成功尾已落 plugin/toggled）
    // brick 链判据反证（本闸防的终局）：坏行一旦落盘，boot 读侧同判据 fail-loud 拒启
    const poisoned = memFs({ '/data/enabled.yaml': 'plugins:\n  - id: Bad_Id\n    disabled: true\n' });
    let code = '';
    try {
      readEnabledRows('/data', poisoned);
    } catch (err) {
      code = err instanceof BaseError ? err.code : '';
    }
    expect(code).toBe('PLUGIN_ROW_INVALID');
    // 好词法两形回归锚：core: 前缀 overlay / 用户词法造行不受闸影响
    const good = memFs();
    expect(toggleRow('/data', 'core:webui', good).ok).toBe(true);
    expect(toggleRow('/data', 'user-x', good).ok).toBe(true);
    const read = readEnabledRowsForEdit('/data', good);
    expect(read.ok && read.rows.map((r) => r.id)).toEqual(['core:webui', 'user-x']);
  });

  it('读侧：缺席 = 空集；坏 yaml/坏行 = fail-loud result 面（CLI 呈修复指引）', () => {
    expect(readEnabledRowsForEdit('/data', memFs()).ok).toBe(true);
    const badYaml = memFs({ '/data/enabled.yaml': 'plugins: [ Oops' });
    expect(readEnabledRowsForEdit('/data', badYaml).ok).toBe(false);
    const badRow = memFs({ '/data/enabled.yaml': 'plugins:\n  - id: x\n    bogus: 1\n' });
    expect(readEnabledRowsForEdit('/data', badRow).ok).toBe(false);
  });
});

describe('doors 段往返保真（03 §5.3 行编辑与段编辑全文件形状往返保真律——开门制扩展批）', () => {
  /** 预置带 doors 段的清单（回归锁前置——三动词均须过本形不改写段） */
  const SEEDED = 'plugins:\n  - id: user-x\ndoors:\n  - sessions.observe-cross\n';

  it('mount 行编辑腿载 doors 段往返（静默抹段 = 静默收回授予，结构性禁止）', () => {
    const fs = memFs({ '/data/enabled.yaml': SEEDED });
    expect(mountRow('/data', 'user-y', undefined, fs).ok).toBe(true);
    const text = fs.read('/data/enabled.yaml') ?? '';
    expect(text).toContain('doors:');
    expect(text).toContain('sessions.observe-cross');
    const read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.observe-cross']);
  });

  it('unmount/toggle 同律往返（删行/翻旗标不动段）', () => {
    const fs = memFs({ '/data/enabled.yaml': SEEDED });
    expect(unmountRow('/data', 'user-x', fs).ok).toBe(true);
    expect(readEnabledRowsForEdit('/data', fs).ok).toEqual(true);
    let read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.observe-cross']);
    expect(toggleRow('/data', 'user-x', fs).ok).toBe(true);
    read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.observe-cross']);
  });

  it('双枚段全量往返（两门同开形）', () => {
    const fs = memFs({
      '/data/enabled.yaml':
        'plugins:\n  - id: user-x\ndoors:\n  - sessions.observe-cross\n  - sessions.control-cross\n',
    });
    expect(mountRow('/data', 'user-y', undefined, fs).ok).toBe(true);
    const read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.observe-cross', 'sessions.control-cross']);
  });

  it('显式空段保真（doors: [] 编辑后仍写回显式空段）+ 段缺席不凭空造段', () => {
    // 显式空段：用户手编形状原样保真
    const fs = memFs({ '/data/enabled.yaml': 'plugins: []\ndoors: []\n' });
    expect(mountRow('/data', 'user-y', undefined, fs).ok).toBe(true);
    expect(fs.read('/data/enabled.yaml')).toContain('doors: []');
    // 段缺席：不凭空造段
    const fs2 = memFs({ '/data/enabled.yaml': 'plugins: []\n' });
    expect(mountRow('/data', 'user-y', undefined, fs2).ok).toBe(true);
    const read = readEnabledRowsForEdit('/data', fs2);
    expect(read.ok && read.doors).toBeUndefined();
  });

  it('坏 doors 段读侧拒（行编辑腿 fail-loud——段坏形不静默过）', () => {
    const fs = memFs({ '/data/enabled.yaml': 'plugins: []\ndoors:\n  - channels.ui-backend\n' });
    expect(mountRow('/data', 'user-y', undefined, fs).ok).toBe(false); // 值域外拒——edit 读侧同判据
  });
});

describe('editDoorsSegment 段编辑腿（03 §4.6 /doors 人面命令的编辑通道——g-2）', () => {
  /** 段缺席首启形 + 行在场（往返保真的段编辑方向：只动段不动行） */
  const SEEDED = 'plugins:\n  - id: user-x\n    config:\n      k: v\n';

  it('open 造段 + 行原样携带（只动段不动行——config 等字段保形）', () => {
    const fs = memFs({ '/data/enabled.yaml': SEEDED });
    expect(editDoorsSegment('/data', { verb: 'open', door: 'sessions.observe-cross' }, fs).ok).toBe(true);
    const read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.observe-cross']); // 段缺席 → 造段
    expect(read.ok && read.rows[0]).toMatchObject({ id: 'user-x', config: { k: 'v' } }); // 行字段保形
  });

  it('值域拒：DOORS_SEGMENT_V1_DOMAIN 外（含插件道四枚高危面）拒绝式', () => {
    const fs = memFs({ '/data/enabled.yaml': SEEDED });
    for (const door of [
      'channels.ui-backend',
      'sdk.register-route',
      'triggers.start-run',
      'credentials.read-cross',
      'bogus',
    ]) {
      const result = editDoorsSegment('/data', { verb: 'open', door }, fs);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toContain('值域');
    }
    expect(fs.read('/data/enabled.yaml')).toBe(SEEDED); // 拒路径文件原封
  });

  it('幂等两向：open 已开 / close 未开（含段缺席）= no-op 不写不落账', () => {
    const fs = memFs({ '/data/enabled.yaml': 'plugins: []\ndoors:\n  - sessions.observe-cross\n' });
    let sinkCalls = 0;
    // close 未开位（control-cross 不在段）
    expect(editDoorsSegment('/data', { verb: 'close', door: 'sessions.control-cross' }, fs, () => sinkCalls++).ok).toBe(
      true,
    );
    // open 已开位（observe-cross 在段）
    expect(editDoorsSegment('/data', { verb: 'open', door: 'sessions.observe-cross' }, fs, () => sinkCalls++).ok).toBe(
      true,
    );
    expect(sinkCalls).toBe(0);
    expect(fs.read('/data/enabled.yaml')).toContain('sessions.observe-cross'); // 文件原封
    // 段缺席 + close = 天然幂等（现集空不含任何位），不造段
    const fs2 = memFs({ '/data/enabled.yaml': SEEDED });
    expect(editDoorsSegment('/data', { verb: 'close', door: 'sessions.observe-cross' }, fs2).ok).toBe(true);
    expect(fs2.read('/data/enabled.yaml')).toBe(SEEDED);
  });

  it('close 收口 = 显式空段 doors: []（03 §4.6 撤位收口形）+ 成功尾 sink 排序快照', () => {
    const fs = memFs({ '/data/enabled.yaml': 'plugins: []\ndoors:\n  - sessions.observe-cross\n' });
    const seen: (readonly string[])[] = [];
    expect(
      editDoorsSegment('/data', { verb: 'close', door: 'sessions.observe-cross' }, fs, (d) => void seen.push(d)).ok,
    ).toBe(true);
    expect(seen).toEqual([[]]);
    expect(fs.read('/data/enabled.yaml')).toContain('doors: []');
  });

  it('写回排序稳态形：手编逆序段在首编辑后归一（与审计快照排序形一致）', () => {
    const fs = memFs({
      // 手编逆序（control 在前、observe 在后——字母序相反）
      '/data/enabled.yaml': 'plugins: []\ndoors:\n  - sessions.control-cross\n  - sessions.observe-cross\n',
    });
    const seen: (readonly string[])[] = [];
    const result = editDoorsSegment('/data', { verb: 'close', door: 'sessions.observe-cross' }, fs, (d) => {
      seen.push(d);
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([['sessions.control-cross']]); // 剩余集排序形（单元素平凡序——两枚 case 见 doors-cmd.test）
    const read = readEnabledRowsForEdit('/data', fs);
    expect(read.ok && read.doors).toEqual(['sessions.control-cross']);
    // 两枚齐在场编辑（open 造第三位无第三枚——改 close 后再 open 回补，验双枚排序）
    expect(editDoorsSegment('/data', { verb: 'open', door: 'sessions.observe-cross' }, fs).ok).toBe(true);
    const read2 = readEnabledRowsForEdit('/data', fs);
    expect(read2.ok && read2.doors).toEqual(['sessions.control-cross', 'sessions.observe-cross']); // 字母序稳态
  });
});

describe('生命周期归因账落词（05 §1.1 audit 落账批——成功尾 sink 三动词）', () => {
  /** sink 收集器（词形断言面——type + data 全录） */
  function collector(): {
    readonly calls: Array<{ readonly type: string; readonly data: Record<string, unknown> }>;
    readonly sink: LifecycleAuditSink;
  } {
    const calls: Array<{ type: string; data: Record<string, unknown> }> = [];
    return { calls, sink: (type, data) => void calls.push({ type, data }) };
  }

  it('mount 成功尾落 plugin/mounted {id}（core: overlay 行同落——本账含 core:）；撞名拒零调', () => {
    const fs = memFs();
    const ok = collector();
    expect(mountRow('/data', 'user-x', undefined, fs, ok.sink).ok).toBe(true);
    expect(ok.calls).toEqual([{ type: 'plugin/mounted', data: { id: 'user-x' } }]);
    // 撞名拒 = 无变更不造账
    const dup = collector();
    expect(mountRow('/data', 'user-x', undefined, fs, dup.sink).ok).toBe(false);
    expect(dup.calls).toEqual([]);
    // core: overlay 同落（与 opens diff 排除 core: 分立）
    const core = collector();
    expect(mountRow('/data', 'core:webui', undefined, fs, core.sink).ok).toBe(true);
    expect(core.calls).toEqual([{ type: 'plugin/mounted', data: { id: 'core:webui' } }]);
  });

  it('unmount 真删行落 plugin/unmounted {id}；幂等跳过与 core: 拒零调（无变更不造账）', () => {
    const fs = memFs({ '/data/enabled.yaml': 'plugins:\n  - id: user-x\n' });
    const hit = collector();
    expect(unmountRow('/data', 'user-x', fs, hit.sink).ok).toBe(true);
    expect(hit.calls).toEqual([{ type: 'plugin/unmounted', data: { id: 'user-x' } }]);
    const idem = collector();
    expect(unmountRow('/data', 'user-x', fs, idem.sink).ok).toBe(true); // 幂等（已不在启用面）
    expect(idem.calls).toEqual([]);
    const core = collector();
    expect(unmountRow('/data', 'core:webui', fs, core.sink).ok).toBe(false); // 内置态不可删
    expect(core.calls).toEqual([]);
  });

  it('toggle 落 plugin/toggled {id, disabled 终态双态}——三景：不在场 true / 禁用→false / 启用→true', () => {
    const fs = memFs();
    const first = collector();
    expect(toggleRow('/data', 'core:webui', fs, first.sink).ok).toBe(true);
    expect(first.calls).toEqual([{ type: 'plugin/toggled', data: { id: 'core:webui', disabled: true } }]);
    const second = collector();
    expect(toggleRow('/data', 'core:webui', fs, second.sink).ok).toBe(true); // 翻回启用
    expect(second.calls).toEqual([{ type: 'plugin/toggled', data: { id: 'core:webui', disabled: false } }]);
    const third = collector();
    expect(toggleRow('/data', 'core:webui', fs, third.sink).ok).toBe(true); // 再禁用
    expect(third.calls).toEqual([{ type: 'plugin/toggled', data: { id: 'core:webui', disabled: true } }]);
  });

  it('sink 缺席 = 零落账零异常（库件单机可用——CLI 面注入真身）', () => {
    const fs = memFs();
    expect(mountRow('/data', 'user-x', undefined, fs).ok).toBe(true);
    expect(toggleRow('/data', 'user-x', fs).ok).toBe(true);
    expect(unmountRow('/data', 'user-x', fs).ok).toBe(true);
  });
});

describe('setRowConfig 行 config 整值替换（ix-3b/c 表单腿写盘点）', () => {
  const sink: LifecycleAuditSink = () => undefined;

  it('行在场：config 整值替换 + disabled/opens/doors 段全保真', () => {
    const dir = '/dd-setrow';
    const fs = memFs({
      [`${dir}/enabled.yaml`]: [
        'plugins:',
        '  - id: demo',
        '    disabled: true',
        "    opens: ['sdk.register-route']",
        'doors:',
        '  - sessions.observe-cross',
        '',
      ].join('\n'),
    });
    const result = setRowConfig(dir, 'demo', { mode: 'fast' }, fs);
    expect(result.ok).toBe(true);
    const read = readEnabledRowsForEdit(dir, fs);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.rows).toEqual([
        { id: 'demo', config: { mode: 'fast' }, disabled: true, opens: ['sdk.register-route'] },
      ]);
      expect(read.doors).toEqual(['sessions.observe-cross']); // 静默抹段 = 静默收回用户授予
    }
  });

  it('行不在场：core: overlay 新行合法（表单可预编待启用行）；用户 id 拒（先 mount）', () => {
    const dir = '/dd-setrow-new';
    const fs = memFs();
    const core = setRowConfig(dir, 'core:exec', { limit: 5 }, fs);
    expect(core.ok).toBe(true);
    const read = readEnabledRowsForEdit(dir, fs);
    if (read.ok) expect(read.rows).toEqual([{ id: 'core:exec', config: { limit: 5 } }]);

    const user = setRowConfig(dir, 'demo', { a: 1 }, fs);
    expect(user.ok).toBe(false);
    if (!user.ok) expect(user.message).toContain('先走 /plugins mount');
  });

  it('setRowConfig 造新行 id 词法闸：坏词法 core: 后段诚实拒不写盘（toggleRow 同判据——写侧造行通律）', () => {
    const dir = '/dd-setrow-lex';
    const fs = memFs();
    const result = setRowConfig(dir, 'core:Bad_Id', { k: 1 }, fs);
    expect(result.ok).toBe(false); // 修前红：坏词法 id 过 core: 前缀闸即写盘 ok:true
    if (!result.ok) expect(result.message).toContain('格式不对');
    expect(fs.read(`${dir}/enabled.yaml`)).toBeNull(); // 修前红：坏行已落盘——brick 下次 boot 读侧
    // 好词法回归锚：合法 core: 后段照常造 overlay 行（本闸不伤表单预编主路）
    const good = memFs();
    expect(setRowConfig('/dd-setrow-lex-ok', 'core:exec', { limit: 5 }, good).ok).toBe(true);
  });

  it('config 非对象拒（防御位——表单腿产物恒对象）；整值替换非合并（旧键不残留）', () => {
    const dir = '/dd-setrow-guard';
    const fs = memFs();
    expect(setRowConfig(dir, 'demo', 'flat', fs).ok).toBe(false);
    expect(setRowConfig(dir, 'demo', [1], fs).ok).toBe(false);
    mountRow(dir, 'demo', { old: 1, keep: 2 }, fs, sink);
    const result = setRowConfig(dir, 'demo', { keep: 2 }, fs);
    expect(result.ok).toBe(true);
    const read = readEnabledRowsForEdit(dir, fs);
    if (read.ok) expect(read.rows[0]!.config).toEqual({ keep: 2 }); // old 键随整值替换消失
  });
});

describe('installPath 三源推导（§5.4 表示法单源）', () => {
  it('npm：普通包/scoped 包照包名原形嵌套', () => {
    expect(installPathForNpm('acme-widgets')).toBe(`plugins${'/'}node_modules/acme-widgets`);
    expect(installPathForNpm('@scope/pkg')).toBe(`plugins/node_modules/@scope/pkg`);
  });

  it('git：https 形剥 scheme + .git 尾缀 + 分层防撞名；scp 形不受理（坏形拒）', () => {
    expect(installPathForGit('https://github.com/octocat/hello.git')).toBe('plugins/git/github.com/octocat/hello');
    expect(installPathForGit('https://gitlab.com/grp/sub/deep.git')).toBe('plugins/git/gitlab.com/grp/deep'); // 多段取首段+尾段 repo（中段弃）
    expect(() => installPathForGit('git@github.com:octocat/hello.git')).toThrowError(BaseError); // scp 形非受理词法
  });

  it('git 坏形拒（段不足/空段）', () => {
    expect(() => installPathForGit('https://github.com/onlyone')).toThrowError(BaseError);
    expect(() => installPathForGit('https://')).toThrowError(BaseError);
  });

  it('git 点段穿越拒（§9.6 布局段四处全验——段值 `.`/`..` 拒，join 内折不得吞父树）', () => {
    // 攻击形：url 拆段后 host/首段/repo 任一段值 `..` → join 内折出 plugins/ 本身
    // （如 https://evil.com/../.. → 'plugins'）——direct 落位 rm 递归即整 plugins/ 树抹除面
    expect(() => installPathForGit('https://evil.com/../..')).toThrowError(BaseError);
    expect(() => installPathForGit('https://evil.com/../repo.git')).toThrowError(BaseError); // 首段 ..
    expect(() => installPathForGit('https://../owner/repo.git')).toThrowError(BaseError); // host 段 ..
    expect(() => installPathForGit('https://evil.com/owner/..')).toThrowError(BaseError); // repo 段 ..
    expect(() => installPathForGit('https://evil.com/./repo.git')).toThrowError(BaseError); // 首段 . 同律
    // 正常形不受影响（回归锚——段值恒非点形）
    expect(installPathForGit('https://github.com/octocat/hello.git')).toBe('plugins/git/github.com/octocat/hello');
  });

  it('local：绝对路径 canonical 化（realpath 归一——符号链随平台解析，断言落在段折叠语义上）', () => {
    expect(installPathForLocal('/tmp/a/b/../c')).toMatch(/\/a\/c$/); // b/.. 折叠
    const abs = realpathSync('/tmp'); // 平台真值（macOS /private/tmp）
    expect(installPathForLocal('/tmp/a/./c//d')).toBe(`${abs}/a/c/d`); // 连斜杠/当前段归一
  });
});

describe('清算双路径断言（§5.5 段②③防线）', () => {
  it('装机子树：树内/恰等树根合法；树外/父目录拒', () => {
    const dataDir = '/data';
    expect(() => assertInsideInstallSubtree(dataDir, '/data/plugins/node_modules/x')).not.toThrow();
    expect(() => assertInsideInstallSubtree(dataDir, '/data/plugins')).not.toThrow(); // 恰等树根（幂等空树形）
    expect(() => assertInsideInstallSubtree(dataDir, '/data/other')).toThrowError(BaseError);
    expect(() => assertInsideInstallSubtree(dataDir, '/data')).toThrowError(BaseError); // 数据目录本身不是删除目标
  });

  it('数据子目录：本插件 own/其内合法；兄弟插件/数据根拒', () => {
    expect(() => assertInsidePluginData('/data', 'x', '/data/data/x')).not.toThrow();
    expect(() => assertInsidePluginData('/data', 'x', '/data/data/x/deep/file')).not.toThrow();
    expect(() => assertInsidePluginData('/data', 'x', '/data/data/y')).toThrowError(BaseError); // 兄弟插件域
    expect(() => assertInsidePluginData('/data', 'x', '/data/data')).toThrowError(BaseError); // 数据根整体
  });

  it('pluginDataDir 构造（purge 物理动作唯一合法目标）', () => {
    expect(pluginDataDir('/data', 'x')).toBe('/data/data/x');
  });
});

describe('装机树结构位判定（isInstallStructurePath——删除腿窄防线单源，install 回滚跳 rm / uninstall 段② 拒清算两腿共用）', () => {
  it('三结构位命中：树根 / npm 分区根 / 市场分区根（词法内折形同判——resolve 归一）', () => {
    const dataDir = '/data';
    expect(isInstallStructurePath(dataDir, '/data/plugins')).toBe(true); // 子树根本身
    expect(isInstallStructurePath(dataDir, '/data/plugins/node_modules')).toBe(true); // npm 分区根
    expect(isInstallStructurePath(dataDir, '/data/plugins/market')).toBe(true); // 市场分区根
    // 词法内折形（手改账本 './'/'..' 混写）——resolve 归一后同判
    expect(isInstallStructurePath(dataDir, '/data/plugins/./')).toBe(true);
    expect(isInstallStructurePath(dataDir, '/data/plugins/node_modules/x/..')).toBe(true);
  });

  it('非结构位不误伤：分区根内包目录 / 树外路径 / market 子目录', () => {
    expect(isInstallStructurePath('/data', '/data/plugins/node_modules/some-pkg')).toBe(false);
    expect(isInstallStructurePath('/data', '/data/plugins/git/host/org/repo')).toBe(false);
    expect(isInstallStructurePath('/data', '/data/plugins/market/some-copy')).toBe(false);
    expect(isInstallStructurePath('/data', '/data/other')).toBe(false);
  });
});

describe('defaultStoreFs 读侧错误码分档（ENOENT 静默缺席 / 其余点名 warn 再降级——与 plugin-boot defaultFs 同律）', () => {
  /** 本 describe 真盘 tmp（例外位：缺省实现即真盘——内存 fs 测不到错误码分档） */
  const realDirs: string[] = [];
  afterAll(() => {
    for (const dir of realDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('ENOENT = 缺席语义静默折 null（零 warn——readLedger「缺席 = 空账本」条款的消费面不受扰）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(createPluginStoreFs().read(join(tmpdir(), 'berry-no-such-ledger-test.json'))).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('非 ENOENT 读错（目录当文件读 = EISDIR）→ 点名 warn 后仍折 null（不炸 CLI 短命进程）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'berry-storefs-eisdir-'));
    realDirs.push(dir);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // 修前红：读侧 catch-all 一律静默折 null——权限坏与文件缺席不可区分，
      // 装机账本/启用清单静默按空处理、已装插件全部消失零线索
      expect(createPluginStoreFs().read(dir)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain(dir); // 坏路径点名（定位面）
      expect(message).toContain('EISDIR'); // 错误码点名
      expect(message).toContain('按空处理'); // 后果直白（装机记录/启用清单面）
    } finally {
      warn.mockRestore();
    }
  });
});

describe('敏感产物落盘 0600 纵深档（05 §6.6——60 轮 L2 批扩列）：atomicWrite 单形连带两消费', () => {
  /** 本 describe 真盘 tmp（例外位：mode 断言须真盘 statSync——内存 Map 形无属位） */
  const realDirs: string[] = [];
  afterAll(() => {
    for (const dir of realDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('ledger.json 与 enabled.yaml 的 tmp 写位 mode 随 rename 承袭终名（per-caller mode 分叉不作）', () => {
    // 修前红：缺省实现 write 是裸 writeFileSync(path, text) 无 mode——缺省
    // 0666 & ~umask（钉 022 下即 0644）。enabled.yaml 行内 config 无「不得含
    // 鉴权材料」定性护栏、可含第三方服务凭证；ledger.json 是装机溯源账——
    // 05 §6.6 纵深档族建即 0600：两文件同经 atomicWrite 单形连带（分叉不
    // 作），mode 落 tmp 写位、随 rename 承袭终名；「建即」辖建时点，在场
    // 旧文件不追溯。钉宽 umask 防 CI 窄 umask（077）下修前形恰好 0600 假绿；
    // 修后显式 0600 位不受 umask 放宽。
    const dir = mkdtempSync(join(tmpdir(), 'berry-store-mode-'));
    realDirs.push(dir);
    const prevUmask = process.umask(0o022);
    try {
      const fs = createPluginStoreFs(); // 缺省真盘实现（真装配写路径）
      upsertLedgerEntry(dir, entry({ id: 'a' }), fs);
      expect(mountRow(dir, 'a', { token: 'third-party-secret' }, fs).ok).toBe(true);
      expect(statSync(ledgerPath(dir)).mode & 0o777).toBe(0o600);
      expect(statSync(enabledYamlPath(dir)).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
  });
});

describe('编辑面跨进程互斥（03 §5.3 73 轮批注——RMW 丢更新防护：lockfile 包住读-改-写全程）', () => {
  /** 启用清单锁路径速记（与实现位 `${enabledYamlPath}.lock` 同名段） */
  const YAML_LOCK = '/data/enabled.yaml.lock';
  /** 账本锁路径速记 */
  const LEDGER_LOCK = '/data/plugins/ledger.json.lock';
  /**
   * 判死必真 pid（超出任何 OS pid 空间上界——Linux pid_max 帽 2^22、macOS
   * 更小；process.kill 信号 0 探测恒 ESRCH 折死，无「碰巧活着」竞态）
   */
  const DEAD_PID = 999_999_999;

  /** 探测计数 fs（包一层 openExclusive 计数——断言「取没取锁/等了几轮」） */
  function probingFs(base: PluginStoreFs): PluginStoreFs & { readonly probes: () => number } {
    let probes = 0;
    return {
      ...base,
      probes: () => probes,
      openExclusive: (path, text) => {
        probes += 1;
        return base.openExclusive(path, text);
      },
    };
  }

  it('修前红锚：锁在场（活 pid 持锁）→ mount 应有界等待，对方释放后续行——不等待立即写盘即丢更新面', () => {
    const fs = probingFs(memFs({ [YAML_LOCK]: `${process.pid}\n` })); // 持锁者 = 本进程 pid（判活真）
    // 持锁-后释放形：首探在场折 false（memFs 锁文件在场自然 EEXIST）；等待一轮
    // 后对方释放（探测前删锁），再探建成——模拟「A 持锁写入中 → A 完成退出」
    const heldThenReleased: PluginStoreFs = {
      ...fs,
      openExclusive: (path, text) => {
        if (path === YAML_LOCK && fs.probes() === 1) fs.unlink(YAML_LOCK); // 首探已过 → 释放窗内对方清锁
        return fs.openExclusive(path, text);
      },
    };
    const result = mountRow('/data', 'user-x', undefined, heldThenReleased);
    expect(result.ok).toBe(true); // 等待后取得锁、写入成功
    expect(heldThenReleased.read('/data/enabled.yaml')).toContain('user-x'); // 行已落盘
    expect(heldThenReleased.read(YAML_LOCK)).toBeNull(); // 用后清场（释放无残锁）
    expect(fs.probes()).toBe(2); // 修前红：0——修前 mount 不取锁不等待，首探即写
  });

  it('死 pid 残锁 stale 破锁：崩溃残锁（pid 判死）自动清障后写入——互斥不可被残锁永久堵死', () => {
    const fs = probingFs(memFs({ [YAML_LOCK]: `${DEAD_PID}\n` })); // 崩溃残锁（持锁者已死）
    const result = mountRow('/data', 'user-x', undefined, fs);
    expect(result.ok).toBe(true); // 破锁后续行
    expect(fs.read('/data/enabled.yaml')).toContain('user-x');
    expect(fs.read(YAML_LOCK)).toBeNull(); // 修前红：残锁原封在场（'999999999\n'）
    expect(fs.probes()).toBeGreaterThanOrEqual(2); // 修前红：0——修前不探测不清障
  });

  it('超限 fail-loud 拒写：活 pid 持锁不放 → 重试超限拒写不静默（宁拒服务不丢数据）', () => {
    const fs = probingFs(memFs({ [YAML_LOCK]: `${process.pid}\n` }));
    const foreverHeld: PluginStoreFs = { ...fs, openExclusive: () => false }; // 恒在场不释放
    const result = mountRow('/data', 'user-x', undefined, foreverHeld);
    expect(result.ok).toBe(false); // 修前红：true——修前无锁立即写盘成功
    if (!result.ok) {
      expect(result.message).toContain(YAML_LOCK); // 拒文带锁路径（定位面）
      expect(result.message).toContain('超限');
    }
    expect(fs.read('/data/enabled.yaml')).toBeNull(); // 拒路径零写入（数据面原封）
  });

  it('正常路径：编辑动词取锁恰一笔、用后清场零残锁（enabled.yaml 与 ledger 两载体同律）', () => {
    const yamlFs = probingFs(memFs());
    expect(mountRow('/data', 'user-x', undefined, yamlFs).ok).toBe(true);
    expect(yamlFs.probes()).toBe(1); // 修前红：0
    expect(yamlFs.read(YAML_LOCK)).toBeNull();
    const ledgerFs = probingFs(memFs());
    upsertLedgerEntry('/data', entry({ id: 'a' }), ledgerFs);
    expect(ledgerFs.probes()).toBe(1); // 修前红：0——账本追加腿同律同治
    expect(ledgerFs.read(LEDGER_LOCK)).toBeNull();
    // 账本腿死 pid 残锁同判：破锁后撤账可写
    const stale = probingFs(memFs({ [LEDGER_LOCK]: `${DEAD_PID}\n` }));
    expect(() => removeLedgerEntry('/data', 'a', stale)).not.toThrow();
    expect(stale.read(LEDGER_LOCK)).toBeNull();
  });

  it('doors 段编辑：值域拒与幂等 no-op 不取锁（先判幂等再取锁——无变更无丢更新面）；真变更取锁', () => {
    const fs = probingFs(memFs({ '/data/enabled.yaml': 'plugins: []\ndoors:\n  - sessions.observe-cross\n' }));
    // 值域拒：零 IO 零锁
    expect(editDoorsSegment('/data', { verb: 'open', door: 'bogus' }, fs).ok).toBe(false);
    expect(fs.probes()).toBe(0);
    // 幂等 no-op（open 已开位）：不写文件即无丢更新面——不占编辑锁
    expect(editDoorsSegment('/data', { verb: 'open', door: 'sessions.observe-cross' }, fs).ok).toBe(true);
    expect(fs.probes()).toBe(0);
    // 真变更（close 已开位）：取锁
    expect(editDoorsSegment('/data', { verb: 'close', door: 'sessions.observe-cross' }, fs).ok).toBe(true);
    expect(fs.probes()).toBe(1); // 修前红：0
    expect(fs.read(YAML_LOCK)).toBeNull();
    expect(fs.read('/data/enabled.yaml')).toContain('doors: []');
  });
});
