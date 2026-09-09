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
import { realpathSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import {
  assertInsideInstallSubtree,
  assertInsidePluginData,
  editDoorsSegment,
  installPathForGit,
  installPathForLocal,
  installPathForNpm,
  mountRow,
  pluginDataDir,
  readEnabledRowsForEdit,
  readLedger,
  removeLedgerEntry,
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
});

describe('装机账本写侧（条目数组形单源）', () => {
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
