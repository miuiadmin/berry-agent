/**
 * host/doors-cmd 开门制人面命令件测试（03 §4.6 /doors 人面命令——g-2）。
 *
 * 覆盖四块：parseDoorsArgv（TUI 裸 argv 解析律）、runDoorsCommand（list
 * 双源呈现 + open/close 段编辑 + 幂等 + 值域拒 + memory 形写动词拒）、
 * runDoorsEntry（CLI 面语义拒退 1 + list 只读受理）、editDoorsSegment 经
 * 由命令面的往返保真（行原样携带/段缺席造段/收口显式空段——深 cover 归
 * plugin-store.test.ts）。
 *
 * fs 全内存注入（plugin-store.test.ts memFs 同形）；禁断言 AI 生成文本——
 * 本件全人面文案，断言锚子串非全句比对。
 */
import { describe, expect, it } from 'vitest';

import { editDoorsSegment } from './plugin-store.js';
import type { PluginStoreFs } from './plugin-store.js';
import { parseDoorsArgv, runDoorsCommand, runDoorsEntry } from './doors-cmd.js';
import { enabledYamlPath } from './manifest.js';

/** 内存 fs（plugin-store.test.ts memFs 同形——doors 段编辑只触 read/write/rename） */
function memFs(initial: Record<string, string> = {}): PluginStoreFs {
  const files = new Map(Object.entries(initial));
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, text) => void files.set(path, text),
    rename: (from, to) => {
      const text = files.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    mkdir: () => undefined,
    rm: () => undefined,
    readdir: () => null,
    size: () => null,
  };
}

/** 写初始 enabled.yaml（两源分立样例：行 opens 插件道 + doors 段模型道） */
const SEED_TWO_SOURCES = [
  'plugins:',
  '  - id: acme-widgets',
  '    opens:',
  '      - sdk.register-route',
  '  - id: ghost-tools',
  '    disabled: true',
  '    opens:',
  '      - channels.ui-backend',
  'doors:',
  '  - sessions.observe-cross',
].join('\n');

describe('parseDoorsArgv（TUI 裸 argv 解析律）', () => {
  it('三动词全形', () => {
    expect(parseDoorsArgv(['list'])).toEqual({ ok: true, sub: { sub: 'list' } });
    expect(parseDoorsArgv(['open', 'sessions.control-cross'])).toEqual({
      ok: true,
      sub: { sub: 'open', door: 'sessions.control-cross' },
    });
    expect(parseDoorsArgv(['close', 'sessions.observe-cross'])).toEqual({
      ok: true,
      sub: { sub: 'close', door: 'sessions.observe-cross' },
    });
  });

  it('缺子命令/旗标拒/arity 错/未知动词', () => {
    expect(parseDoorsArgv([]).ok).toBe(false);
    expect(parseDoorsArgv(['--x']).ok).toBe(false);
    expect(parseDoorsArgv(['list', 'x']).ok).toBe(false);
    expect(parseDoorsArgv(['open']).ok).toBe(false);
    expect(parseDoorsArgv(['open', 'a', 'b']).ok).toBe(false);
    expect(parseDoorsArgv(['bogus']).ok).toBe(false);
  });
});

describe('runDoorsCommand·list（六枚全清单 + 双源呈现）', () => {
  it('两源样例：六枚清单 + 行 opens 分组（禁用行标注）+ doors 段行 + 闭门 reason 单源', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const outcome = runDoorsCommand({ sub: 'list' }, { dataDir: '/data', fs });
    expect(outcome.ok).toBe(true);
    // 六枚全清单（USER_GRANTABLE_CAPABILITIES 单源投影）
    expect(outcome.text).toContain('channels.ui-backend=');
    expect(outcome.text).toContain('sdk.register-route=');
    expect(outcome.text).toContain('triggers.start-run=');
    expect(outcome.text).toContain('credentials.read-cross=');
    expect(outcome.text).toContain('sessions.observe-cross=open（doors 段——进程级）');
    expect(outcome.text).toContain('sessions.control-cross=closed——');
    // 行 opens：启用行开门 + 禁用行授予面在场标注
    expect(outcome.text).toContain('sdk.register-route=open（行 opens：acme-widgets）');
    expect(outcome.text).toContain('ghost-tools: channels.ui-backend（已禁用——授予实效收回）');
    // doors 段进程级行（排序形）
    expect(outcome.text).toContain('sessions.observe-cross');
  });

  it('空文件首启形：双源皆空诚实呈现（行 opens 无 + 段缺席 = 空集）', () => {
    const outcome = runDoorsCommand({ sub: 'list' }, { dataDir: '/data', fs: memFs() });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('（无——未有任何插件行开位）');
    expect(outcome.text).toContain('（段缺席 = 空集）');
    expect(outcome.text).toContain('closed——'); // 六枚全闭（附单源 reason）
  });

  it('显式空段辨段缺席（parseDoorsPresence 往返保真——呈现分立两形）', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: 'plugins: []\ndoors: []' });
    const outcome = runDoorsCommand({ sub: 'list' }, { dataDir: '/data', fs });
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('（显式空段 = 空集）');
  });

  it('坏清单 → ok:false 带修复指引（文件面真相不虚构）', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: '{oops' });
    const outcome = runDoorsCommand({ sub: 'list' }, { dataDir: '/data', fs });
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain('损坏');
  });
});

describe('runDoorsCommand·open/close（段编辑腿 + 落账 seam + 幂等）', () => {
  it('open：写回段 + onDoorsUpdated 排序快照恰一次 + 生效时点回执', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const updates: (readonly string[])[] = [];
    const outcome = runDoorsCommand(
      { sub: 'open', door: 'sessions.control-cross' },
      {
        dataDir: '/data',
        fs,
        onDoorsUpdated: (doors) => void updates.push([...doors]),
      },
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain('已开门：sessions.control-cross');
    expect(outcome.text).toContain('门检即时生效');
    expect(updates).toEqual([['sessions.control-cross', 'sessions.observe-cross']]); // 排序快照恰一笔
    // 文件真相：两门齐开 + 行原样携带（往返保真）
    const text = fs.read(enabledYamlPath('/data')) ?? '';
    expect(text).toContain('id: acme-widgets');
    expect(text).toContain('sessions.observe-cross');
    expect(text).toContain('sessions.control-cross');
  });

  it('close 收口：撤位 + 空集写回显式空段 doors: []', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const updates: (readonly string[])[] = [];
    const outcome = runDoorsCommand(
      { sub: 'close', door: 'sessions.observe-cross' },
      { dataDir: '/data', fs, onDoorsUpdated: (doors) => void updates.push([...doors]) },
    );
    expect(outcome.ok).toBe(true);
    expect(updates).toEqual([[]]); // 空数组形收口（03 §4.6 撤位 doors:[] 收口）
    expect(fs.read(enabledYamlPath('/data')) ?? '').toContain('doors: []');
  });

  it('幂等：open 已开 / close 未开 = no-op 成功零落账零写', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const before = fs.read(enabledYamlPath('/data'));
    let sinkCalls = 0;
    const noopOpen = runDoorsCommand(
      { sub: 'open', door: 'sessions.observe-cross' }, // 已开
      { dataDir: '/data', fs, onDoorsUpdated: () => void sinkCalls++ },
    );
    const noopClose = runDoorsCommand(
      { sub: 'close', door: 'sessions.control-cross' }, // 未开
      { dataDir: '/data', fs, onDoorsUpdated: () => void sinkCalls++ },
    );
    expect(noopOpen.ok && noopClose.ok).toBe(true);
    expect(sinkCalls).toBe(0); // 无变更不造账
    expect(fs.read(enabledYamlPath('/data'))).toBe(before); // 文件原封
  });

  it('值域拒：doors 段值域外（插件道四枚）拒绝式——行 opens 位承载，不进段', () => {
    const fs = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    for (const door of ['channels.ui-backend', 'sdk.register-route', 'triggers.start-run', 'credentials.read-cross']) {
      const outcome = runDoorsCommand({ sub: 'open', door }, { dataDir: '/data', fs });
      expect(outcome.ok).toBe(false);
      expect(outcome.text).toContain('值域');
    }
    expect(fs.read(enabledYamlPath('/data'))).toContain('sessions.observe-cross'); // 拒路径文件原封
  });

  it('纯 memory 诊断形（dataDir null）：写动词拒、list 放行（/plugins 同律）', () => {
    const rejected = runDoorsCommand({ sub: 'open', door: 'sessions.observe-cross' }, { dataDir: null, fs: memFs() });
    expect(rejected.ok).toBe(false);
    expect(rejected.text).toContain('纯 memory 诊断形');
    const listable = runDoorsCommand({ sub: 'list' }, { dataDir: null, fs: memFs() });
    expect(listable.ok).toBe(true);
  });
});

describe('runDoorsEntry（CLI 面——list 受理 / 写动词语义拒）', () => {
  it('open/close 语义拒退 1：指路文件直编 + boot diff 记账（合法解析形非用法错）', async () => {
    for (const sub of [
      { sub: 'open' as const, door: 'sessions.observe-cross' },
      { sub: 'close' as const, door: 'sessions.control-cross' },
    ]) {
      const lines: string[] = [];
      const code = await runDoorsEntry(sub, { dataDir: '/data', writeOut: (t) => void lines.push(t) });
      expect(code).toBe(1);
      expect(lines.join('\n')).toContain('TUI /doors 专属');
      expect(lines.join('\n')).toContain("origin 'boot-diff'");
    }
  });

  it('list 零装配纯文件读：受理退 0、空目录诚实呈现', async () => {
    const lines: string[] = [];
    const code = await runDoorsEntry({ sub: 'list' }, { dataDir: '/data', writeOut: (t) => void lines.push(t) });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('sessions.observe-cross=closed');
  });
});

describe('editDoorsSegment 与命令面同源对拍（段编辑腿深 cover 归 plugin-store.test——此处锁接线面）', () => {
  it('直接调段编辑腿与命令面 open 同效（单源两入口不漂移）', () => {
    const viaCmd = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const viaStore = memFs({ [enabledYamlPath('/data')]: SEED_TWO_SOURCES });
    const updates: (readonly string[])[] = [];
    const outcome = runDoorsCommand(
      { sub: 'open', door: 'sessions.control-cross' },
      { dataDir: '/data', fs: viaCmd, onDoorsUpdated: (d) => void updates.push(d) },
    );
    let sink: readonly string[] | undefined;
    const result = editDoorsSegment('/data', { verb: 'open', door: 'sessions.control-cross' }, viaStore, (d) => {
      sink = d;
    });
    expect(outcome.ok && result.ok).toBe(true);
    expect(sink).toEqual(updates[0]);
    expect(viaStore.read(enabledYamlPath('/data'))).toBe(viaCmd.read(enabledYamlPath('/data')));
  });
});
