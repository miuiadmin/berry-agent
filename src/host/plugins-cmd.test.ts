/**
 * host/plugins-cmd 子命令族测试——list 同构装载 / check 纯只读骨架 / 写侧
 * 六动词真链 e2e（07 §5 命令族语义；成熟度缺口 #10 装机面落码批写真身）。
 *
 * list 走 assembly 公共段（memory 同构诊断形——与 dump-config 同一合成代码
 * 路径）；check 零装配直读装机账本；写侧动词走 local fixture 真链——install
 * 真收割 → mount/toggle/unmount 行编辑 → uninstall 双相（inspect/execute），
 * spawn 注假件零真网络、Persistence 真开 tmp 数据目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { runPluginsEntry } from './plugins-cmd.js';
import type { CorePluginReference } from './loader.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';
import { Persistence, createAuditFace } from '../persist/index.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录速记 */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 输出面速记（捕获行族） */
function capture(): { out: string[]; err: string[]; writeOut: (t: string) => void; writeErr: (t: string) => void } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, writeOut: (t) => void out.push(t), writeErr: (t) => void err.push(t) };
}

describe('plugins list——同构装载态清单（三分区）', () => {
  it('三分区齐活：core 件启用 + disabled 覆盖行入禁用区 + 磁盘行无账本入失败区', async () => {
    const dir = tmpDir('plug-list-3zone-');
    // core:two 被 enabled.yaml disabled 行覆盖（overlay 字段级后写胜出）；
    // user-x 磁盘行无装机账本——两路失败/禁用各有来源
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: core:two\n    disabled: true\n  - id: user-x\n');
    const one: CorePluginReference = { name: 'one', apply: async () => undefined };
    const two: CorePluginReference = { name: 'two', apply: async () => undefined };
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, corePlugins: [one, two], ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('启用（1）：');
    expect(text).toContain('core:one');
    expect(text).toContain('禁用（1）：');
    expect(text).toContain('core:two');
    expect(text).toContain('disabled（启用行禁用位）'); // 禁用 reason 字面量（loader 真源）
    expect(text).toContain('失败（1）：');
    expect(text).toContain('user-x');
    expect(text).toContain('装机账本无此 id'); // 失败行诊断信息透出
  });

  it('启用行双目录段：report 带 skillDirs+agentDirs → id→技能目录→子代理目录三段同现（与 TUI renderList 5a11f3c 同源形——两面同源承诺 CLI 侧补执法）', async () => {
    const dir = tmpDir('plug-list-dualdirs-');
    const io = capture();
    // 声明式目录（loader.ts:395-396——core 行声明基 = 宿主包根，resolveDeclaredDirs
    // 只 resolve 不查在场；此前本面零 agentDirs/技能目录断言，上批已知洞核实属实）
    const dual: CorePluginReference = {
      name: 'dual',
      skills: ['skills/fixture-skill-a'],
      agents: ['agents/fixture-agent-b'],
      apply: async () => undefined,
    };
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, corePlugins: [dual], ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    // 段序锁：整行正则（id → 技能目录 → 子代理目录，两空格分隔同 TUI 串形）
    expect(text).toMatch(/^  core:dual  技能目录：.+skills\/fixture-skill-a  子代理目录：.+agents\/fixture-agent-b$/m);
  });

  it('条件段缺席形：只 skillDirs → 无子代理目录段；两目录俱缺 → 裸 id 行（空清单不带尾注段）', async () => {
    const dir = tmpDir('plug-list-segabsent-');
    const io = capture();
    const skillOnly: CorePluginReference = {
      name: 'skillonly',
      skills: ['skills/fixture-only-skill'],
      apply: async () => undefined,
    };
    const bare: CorePluginReference = { name: 'bare', apply: async () => undefined };
    const code = await runPluginsEntry(
      { sub: 'list' },
      { version: 'x', dataDir: dir, corePlugins: [skillOnly, bare], ...io },
    );
    expect(code).toBe(0);
    const text = io.out.join('\n');
    // 只技能目录：行含技能段且整行无子代理目录段（缺席不造空段）
    expect(text).toMatch(/^  core:skillonly  技能目录：.+skills\/fixture-only-skill$/m);
    expect(text).not.toMatch(/^  core:skillonly.*子代理目录/m);
    // 俱缺：裸 id 行（长度 0 条件段两段皆不出现）
    expect(text).toMatch(/^  core:bare$/m);
    expect(text).toMatch(/启用（2）：/);
  });

  it('dataDir 缺省走 env 梯子：BERRY_AGENT_DATA_DIR 下磁盘行照呈（obs-c 回归锁——修前 list 恒读 ~/.berry-agent 致装机行三区皆隐）', async () => {
    // 2026-09-13 可观测性批 obs-c：真模型六轮实机实证——装+mount 后 list 只呈
    // 16 core 件。根因 = list 对 options.dataDir 条件展开（undefined 时省略）而
    // 其他五动词同律 `?? resolveDataDir()`——env 梯子由此断线，memory 诊断形
    // dataDir=null 整跳 enabled.yaml。本锁：不传 options.dataDir、只设 env，
    // 磁盘行必须照常呈现（修前必红——enabled.yaml 被无视、只呈 core 册）
    const dir = tmpDir('plug-list-envdir-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: user-env-x\n');
    const one: CorePluginReference = { name: 'one', apply: async () => undefined };
    const io = capture();
    const prev = process.env.BERRY_AGENT_DATA_DIR;
    process.env.BERRY_AGENT_DATA_DIR = dir;
    try {
      const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', corePlugins: [one], ...io });
      expect(code).toBe(0);
      const text = io.out.join('\n');
      expect(text).toContain('user-env-x'); // env 位磁盘行照呈——失败区（装机账本无此 id）
      expect(text).toContain('装机账本无此 id');
      expect(text).toContain('失败（1）：');
    } finally {
      if (prev === undefined) delete process.env.BERRY_AGENT_DATA_DIR;
      else process.env.BERRY_AGENT_DATA_DIR = prev;
    }
  });

  it('缺省装载形：空目录 = core 内置态全装（批 19a—19e——exec/web/skills/memory/subagent/scheduler/mcp/browser/lsp/goal/checkpoint/sdk/webui/obs/issue 十五件 + c-3 credentials 增席十六件齐册，清单缺席）', async () => {
    const dir = tmpDir('plug-list-empty-');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    // core 注册表非空（十六件入册）——装载态集成回归锁（件数随逐纵切笔增长）
    expect(text).toContain('启用（16）：');
    expect(text).toContain('core:exec');
    expect(text).toContain('core:web');
    expect(text).toContain('core:skills');
    expect(text).toContain('core:memory');
    expect(text).toContain('core:subagent');
    expect(text).toContain('core:scheduler');
    expect(text).toContain('core:mcp');
    expect(text).toContain('core:browser');
    expect(text).toContain('core:lsp');
    expect(text).toContain('core:goal');
    expect(text).toContain('core:checkpoint');
    expect(text).toContain('core:sdk');
    expect(text).toContain('core:webui');
    expect(text).toContain('core:obs');
    expect(text).toContain('core:issue');
    expect(text).toContain('core:credentials');
    expect(text).toContain('失败（0）：');
    expect(text).toContain('禁用（0）：');
  });

  it('装配失败档透传：坏形清单退 1 + stderr 启动失败', async () => {
    const dir = tmpDir('plug-list-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('启动失败');
  });
});

describe('plugins check——三色体检面真身（03 §8.9 ag 批：绿/红 + legacy 未声明 + 黄槽遥测直查）', () => {
  /**
   * 宿主 apiVersion 真源（runCheck 同文件同源直读仓库根 package.json——
   * 与 main.ts readVersion 同文件；测试动态取值不断言硬编码号，apiVersion
   * 翻号日本测试族零改笔照跑）
   */
  const hostApi = (
    JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { apiVersion: string }
  ).apiVersion;

  /** local 形装机 fixture：真目录 + package.json（berryAgent.api 块随参——undefined = 未声明形） */
  function checkFixturePlugin(name: string, api: Record<string, unknown> | undefined): string {
    const dir = join(tmpdir(), `berry-check-${name}-${process.pid}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const berryAgent: Record<string, unknown> = api === undefined ? {} : { api };
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name, version: '1.0.0', main: 'index.js', berryAgent }, null, 2)}\n`,
    );
    return dir;
  }

  /** 真形账本条目（数组形——writeLedger 单一规范形；local 源 installPath 绝对） */
  function entryOf(id: string, installPath: string): Record<string, unknown> {
    return {
      id,
      source: 'local',
      ref: `local:${installPath}`,
      installedAt: '2026-09-14T00:00:00.000Z',
      installPath,
      declaredEvents: [],
    };
  }

  /** 落账本速记（数组形 JSON） */
  function writeLedger(dir: string, entries: readonly Record<string, unknown>[]): void {
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'ledger.json'), `${JSON.stringify(entries, null, 2)}\n`);
  }

  it('账本缺席 = 零装机无可体检项（exit 0——「无断裂」成立）', async () => {
    const dir = tmpDir('plug-check-absent-');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('无可体检项');
  });

  it('账本为空对象 = 同缺席（exit 0）', async () => {
    const dir = tmpDir('plug-check-empty-');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'ledger.json'), '{}');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('无可体检项');
  });

  it('账本非空·绿腿：min ≤ 宿主 → 通过行 + 钳制注（target 高于宿主生效 target = min(宿主,target)）+ exit 0〔ag 批真身——修前占位「尚未装配」exit 1 翻档〕', async () => {
    const dir = tmpDir('plug-check-green-');
    const plain = checkFixturePlugin('green-pkg', { minApiVersion: '1.0' });
    const clamped = checkFixturePlugin('clamp-pkg', { minApiVersion: '1.0', targetApiVersion: '2.0' });
    writeLedger(dir, [entryOf('green-pkg', plain), entryOf('clamp-pkg', clamped)]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // 全绿无断裂
    const text = io.out.join('\n');
    expect(text).toContain('绿（通过，2）');
    expect(text).toContain('green-pkg');
    expect(text).toContain('clamp-pkg');
    // 钳制注：target 2.0 高于宿主——生效 target = min(宿主, target) 行内注明
    expect(text).toContain('钳制');
    expect(text).toContain(`min(宿主 ${hostApi}, target 2.0) = ${hostApi}`);
    // 无红/未声明/黄段（空段不渲染——断言锚段头形防与汇总行计数词撞）+ 汇总行
    expect(text).not.toContain('断裂，');
    expect(text).not.toContain('未声明，');
    expect(text).not.toContain('用废弃（遥测');
    expect(text).toContain(`宿主 apiVersion ${hostApi}`);
  });

  it('账本非空·红腿：min 高于宿主 → 断裂行三段消息 + 三值矩阵行 + exit 1（绿红并存汇总两计）', async () => {
    const dir = tmpDir('plug-check-red-');
    const green = checkFixturePlugin('mix-green-pkg', { minApiVersion: '1.0' });
    const red = checkFixturePlugin('red-pkg', { minApiVersion: '99.0' });
    writeLedger(dir, [entryOf('mix-green-pkg', green), entryOf('red-pkg', red)]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1); // 任红 = 1
    const text = io.out.join('\n');
    expect(text).toContain('红（断裂，1）');
    expect(text).toContain('绿（通过，1）'); // 绿红并存两段各计
    // 三段消息：expected（min 声明）/ actual（宿主版本）/ 升级指引——adjudicateApiGate 出口 1 消息直呈
    expect(text).toContain('minApiVersion 99.0');
    expect(text).toContain('低于地板');
    expect(text).toContain('升级指引');
    // 三值矩阵行：min / target / 宿主（target 缺省 = min 粘性锚）
    expect(text).toContain(`版本矩阵：min 99.0 / target 99.0 / 宿主 ${hostApi}`);
    // 汇总行断裂计数
    expect(text).toContain('断裂 1');
  });

  it('legacy 腿：api 块缺席 → 未声明行单列不计断裂 + 补声明提示 + exit 0（点火前与装载门出口 4 容忍态同口径）', async () => {
    const dir = tmpDir('plug-check-legacy-');
    const legacy = checkFixturePlugin('legacy-pkg', undefined);
    writeLedger(dir, [entryOf('legacy-pkg', legacy)]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // legacy 不改退出码
    const text = io.out.join('\n');
    expect(text).toContain('legacy-pkg');
    expect(text).toContain('api 块未声明');
    expect(text).toContain('补声明');
    expect(text).not.toContain('断裂，'); // 未声明非断裂
    expect(text).toContain('未声明 1'); // 汇总计数在场
  });

  it('黄腿空集：durable plugin/deprecation-used 直查零事件 → 无黄行（§8.7 obs 禁用降级路径正道形——直查驱动非聚合依赖；sessions.db 缺席零开库）', async () => {
    const dir = tmpDir('plug-check-yellow-empty-');
    const green = checkFixturePlugin('yellow-empty-pkg', { minApiVersion: '1.0' });
    writeLedger(dir, [entryOf('yellow-empty-pkg', green)]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('绿（通过，1）'); // 主面（绿/红）照常出报告
    expect(text).not.toContain('用废弃（遥测'); // 直查空集 = 无黄行（v1 写点延迟触发——结构性空集；断言锚段头防与汇总计数词撞）
    expect(existsSync(join(dir, 'sessions.db'))).toBe(false); // 纯只读纪律：库缺席不开库不造文件
  });

  it('黄腿在场：sessions.db 有 plugin/deprecation-used 事件 → 已装件黄行计数 + 已卸件残遥测不入矩阵 + 黄不改退出码', async () => {
    const dir = tmpDir('plug-check-yellow-hit-');
    const green = checkFixturePlugin('yellow-hit-pkg', { minApiVersion: '1.0' });
    writeLedger(dir, [entryOf('yellow-hit-pkg', green)]);
    // 库在场 + 直写 durable 事件（store.writeEvents 原始面——写点延迟触发期的
    // 遥测仿真；载荷键 pluginId = §8.7「插件 id + DEP 编号」读侧约定）
    const seed = Persistence.open({
      dataDir: dir,
      dbPath: join(dir, 'sessions.db'),
      migrations: HOST_MIGRATION_TAIL,
      warn: () => undefined,
    });
    const now = Date.now();
    // 写序约束：同会话 seq 连续递增（writeEvents 单事务内逐条校验）
    const depEvent = (seq: number, pluginId: string) => ({
      sessionId: 'seed-session',
      event: { type: 'plugin/deprecation-used', seq, time: now, data: { pluginId } },
      registration: {
        origin: 'conversation' as const,
        parentId: undefined,
        seedLength: 0,
        title: undefined,
        workspaceRoot: undefined,
      },
    });
    try {
      seed.store.writeEvents([depEvent(0, 'yellow-hit-pkg'), depEvent(1, 'yellow-hit-pkg'), depEvent(2, 'gone-pkg')]);
    } finally {
      await seed.close();
    }
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // 黄腿不改退出码（恒以红为轴）
    const text = io.out.join('\n');
    expect(text).toContain('用废弃（遥测 plugin/deprecation-used，1）：'); // 段头计数 = 件数（黄行 1 件）
    expect(text).toContain('yellow-hit-pkg  2 笔'); // 同件两笔聚合计数
    expect(text).not.toContain('gone-pkg'); // 已卸件残遥测不进已装矩阵
    expect(text).toContain('绿（通过，1）'); // 绿面照常
    expect(text).toContain('用废弃 1'); // 汇总计数
  });

  it('悬空装机记录：installPath 无 package.json → 断裂行（fail-closed 拒猜）+ exit 1；坏账本（键映射形值坏形）→ 拒体检 exit 1', async () => {
    const dir = tmpDir('plug-check-dangling-');
    writeLedger(dir, [entryOf('ghost-pkg', join(dir, 'no-such-dir'))]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1);
    const text = io.out.join('\n');
    expect(text).toContain('红（断裂，1）');
    expect(text).toContain('ghost-pkg');
    expect(text).toContain('不可读'); // 悬空记录 = 无法判定兼容面——红族直呈不静默
    // 坏账本：键映射形值坏形（readLedger 拒因同源）——拒体检不猜
    const dir2 = tmpDir('plug-check-badledger-');
    mkdirSync(join(dir2, 'plugins'), { recursive: true });
    writeFileSync(join(dir2, 'plugins', 'ledger.json'), '{"plugins":{"user-x":{"installPath":"/tmp/x"}}}');
    const io2 = capture();
    expect(await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir2, ...io2 })).toBe(1);
    expect(io2.err.join('\n')).toContain('装机账本损坏');
  });

  it('清单坏形红：可读 package.json 缺 berryAgent 字段 → 断裂行「清单坏形」+ exit 1（boot 装载同判据拒载——check 面同真相归红）', async () => {
    const dir = tmpDir('plug-check-badshape-');
    // 可读 JSON 但非插件包形（无 berryAgent 字段——parseManifest 判据同源）：
    // 覆盖「悬空/坏 JSON 之外」的第三红族——清单在而坏形
    const bad = join(tmpdir(), `berry-check-badshape-${process.pid}`);
    dirs.push(bad);
    mkdirSync(bad, { recursive: true });
    writeFileSync(
      join(bad, 'package.json'),
      `${JSON.stringify({ name: 'badshape-pkg', version: '1.0.0', main: 'index.js' }, null, 2)}\n`,
    );
    writeLedger(dir, [entryOf('badshape-pkg', bad)]);
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1); // 坏清单归红族——fail-closed 拒猜
    const text = io.out.join('\n');
    expect(text).toContain('红（断裂，1）');
    expect(text).toContain('badshape-pkg');
    expect(text).toContain('清单坏形');
    expect(text).toContain('无 berryAgent 字段'); // parseManifest 消息直呈（判据单源）
  });

  it('黄腿降级（库不可开）：sessions.db 垃圾字节 → warn 遥测库不可开 + 绿行照常 + exit 0（§8.7 降级承诺——黄腿不可用不拖垮主面）', async () => {
    const dir = tmpDir('plug-check-depdb-');
    const green = checkFixturePlugin('depdb-pkg', { minApiVersion: '1.0' });
    writeLedger(dir, [entryOf('depdb-pkg', green)]);
    // 非空库文件但非 SQLite 形（垃圾字节）——Persistence.open fail-loud，
    // collectDeprecationUsed 捕获降级：warn + 黄腿缺席 + 绿/红主面照常
    writeFileSync(join(dir, 'sessions.db'), 'this is not a sqlite database — garbage bytes payload');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // 退出码恒以红为轴——黄腿降级不改码
    const text = io.out.join('\n');
    expect(text).toContain('绿（通过，1）'); // 主面照常出报告
    expect(text).not.toContain('用废弃（遥测'); // 黄腿缺席（空段不渲染）
    const err = io.err.join('\n');
    expect(err).toContain('用废弃遥测库不可开'); // 降级 warn 在场（可见不静默）
    expect(err).toContain('本报告不含黄腿面');
  });

  it('未知插件桶：载荷缺 pluginId 键的 deprecation 事件 → 「(未知插件) N 笔」黄行在场（读侧宽容不丢计数——§8.7 写点延迟触发期仿真）', async () => {
    const dir = tmpDir('plug-check-unknownpid-');
    const green = checkFixturePlugin('unkpid-pkg', { minApiVersion: '1.0' });
    writeLedger(dir, [entryOf('unkpid-pkg', green)]);
    // 直写 durable 事件（store.writeEvents 原始面）：载荷无 pluginId 键（历史
    // 形/写点演进期载荷）——读侧归「(未知插件)」桶保计数
    const seed = Persistence.open({
      dataDir: dir,
      dbPath: join(dir, 'sessions.db'),
      migrations: HOST_MIGRATION_TAIL,
      warn: () => undefined,
    });
    const now = Date.now();
    try {
      seed.store.writeEvents([
        {
          sessionId: 'seed-session',
          event: { type: 'plugin/deprecation-used', seq: 0, time: now, data: { symbol: 'ctx.oldApi' } },
          registration: {
            origin: 'conversation' as const,
            parentId: undefined,
            seedLength: 0,
            title: undefined,
            workspaceRoot: undefined,
          },
        },
      ]);
    } finally {
      await seed.close();
    }
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0); // 黄腿不改退出码
    const text = io.out.join('\n');
    expect(text).toContain('用废弃（遥测 plugin/deprecation-used，1）：'); // 段头计数 = 件数（未知桶 1 件）
    expect(text).toContain('(未知插件)  1 笔'); // 宽容桶黄行在场（无 pluginId 不丢计数）
    expect(text).toContain('用废弃 1'); // 汇总计数在场
  });
});

describe('plugins 写侧六动词——local fixture 真链 e2e（装机面落码批 #10）', () => {
  /** local fixture 插件（default-export 入口 + events 导出——install 收割真跑） */
  function localFixturePlugin(name: string): string {
    const dir = join(tmpdir(), `berry-cmd-fixture-${name}-${process.pid}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name, version: '1.0.0', main: 'index.js', berryAgent: {} }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, 'index.js'),
      `export const events = ['demo/event-a'];\nexport default function apply() {}\n`,
    );
    return dir;
  }

  it('全链：install 真收割 → mount → toggle → unmount → uninstall inspect → execute', async () => {
    const dir = tmpDir('plug-write-chain-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const fixture = localFixturePlugin('chain-pkg');

    // install：local 直引真收割 + 落账
    expect(await runPluginsEntry({ sub: 'install', ref: `local:${fixture}` }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('已装机：chain-pkg');
    // 两步制文案（W8 装机文案批）：装机成功尾行给出具体启用第二步命令（装机 ≠ 启用）
    expect(io.out.join('\n')).toContain('装机 ≠ 启用');
    expect(io.out.join('\n')).toContain('berry plugins mount chain-pkg');
    const ledger = JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as { id: string }[];
    expect(ledger.map((e) => e.id)).toEqual(['chain-pkg']);

    // mount：装机在场过前置查 → 启用行落盘
    expect(await runPluginsEntry({ sub: 'mount', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('chain-pkg');

    // toggle：翻禁用 → 再翻回
    expect(await runPluginsEntry({ sub: 'toggle', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('disabled: true');
    expect(await runPluginsEntry({ sub: 'toggle', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).not.toContain('disabled');

    // unmount：删行保装机
    expect(await runPluginsEntry({ sub: 'unmount', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).not.toContain('chain-pkg');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(1);

    // uninstall 无 --confirm = inspect 只读报告（exit 0）
    io.out.length = 0;
    expect(await runPluginsEntry({ sub: 'uninstall', id: 'chain-pkg', confirm: false }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('卸载预检');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(1); // 只读

    // uninstall --confirm = execute 四段清算
    io.out.length = 0;
    expect(await runPluginsEntry({ sub: 'uninstall', id: 'chain-pkg', confirm: true }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('已卸载');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(0);
    // local 直引：用户 fixture 目录不删
    expect(existsSync(join(fixture, 'index.js'))).toBe(true);
  });

  it('--data 单独在场（无 --confirm）即拒退 1——execute 载荷不静默猜', async () => {
    const dir = tmpDir('plug-write-data-alone-');
    const io = capture();
    const code = await runPluginsEntry(
      { sub: 'uninstall', id: 'x', confirm: false, dataAction: 'purge' },
      { version: 'x', dataDir: dir, ...io },
    );
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('--confirm 同场');
  });

  it('mount 前置两查：坏 id 词法拒；未装机 id 拒（防 brick 下次 boot 读侧）', async () => {
    const dir = tmpDir('plug-write-mount-gate-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const bad = (await runPluginsEntry({ sub: 'mount', id: 'Bad_Id' }, opts)) as number;
    expect(bad).toBe(1);
    expect(io.err.join('\n')).toContain('词法违例');
    io.err.length = 0;
    expect(await runPluginsEntry({ sub: 'mount', id: 'not-installed' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('未装机');
    expect(existsSync(join(dir, 'enabled.yaml'))).toBe(false); // 拒路径零落盘
  });

  it('install ref 坏形（无源前缀）退 1 呈词法指路；update 查无退 1', async () => {
    const dir = tmpDir('plug-write-badref-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    expect(await runPluginsEntry({ sub: 'install', ref: 'bare-pkg' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('源前缀');
    io.err.length = 0;
    expect(await runPluginsEntry({ sub: 'update', id: 'ghost' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('未装机');
  });
  // npm 执行器失败档/argv 族由 plugin-install.test.ts 假 spawn 覆盖（零真网络纪律）
});

describe('生命周期归因账 CLI 真库落账（audit 落账批——lifecycleAuditOf 惰性开库真身）', () => {
  /** local fixture 速记（本 describe 独立命名空间防撞前 describe 账本） */
  function auditFixture(name: string): string {
    const dir = join(tmpdir(), `berry-cmd-audit-${name}-${process.pid}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name, version: '1.0.0', main: 'index.js', berryAgent: {} }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, 'index.js'),
      `export const events = ['demo/event-a'];\nexport default function apply() {}\n`,
    );
    return dir;
  }

  /** 读侧：CLI 同款开库形态取 audit_events 全词形（升序 = 执行序） */
  async function auditCallsOf(dir: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
    const persistence = Persistence.open({
      dataDir: dir,
      dbPath: join(dir, 'sessions.db'), // 显式随 dataDir（CLI 语义同形）
      migrations: HOST_MIGRATION_TAIL,
      warn: () => undefined,
    });
    try {
      const face = createAuditFace(persistence.store.sqlite());
      return [...face.listRecent()].reverse().map((r) => ({ type: r.type, data: r.data }));
    } finally {
      await persistence.close();
    }
  }

  it('四动词全链真库五笔（词序 = 执行序）：installed → mounted → toggled 双态 → unmounted', async () => {
    const dir = tmpDir('plug-audit-chain-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const fixture = auditFixture('audit-chain-pkg');
    expect(await runPluginsEntry({ sub: 'install', ref: `local:${fixture}` }, opts)).toBe(0);
    expect(await runPluginsEntry({ sub: 'mount', id: 'audit-chain-pkg' }, opts)).toBe(0);
    expect(await runPluginsEntry({ sub: 'toggle', id: 'audit-chain-pkg' }, opts)).toBe(0);
    expect(await runPluginsEntry({ sub: 'toggle', id: 'audit-chain-pkg' }, opts)).toBe(0);
    expect(await runPluginsEntry({ sub: 'unmount', id: 'audit-chain-pkg' }, opts)).toBe(0);
    expect(await auditCallsOf(dir)).toEqual([
      { type: 'plugin/installed', data: { id: 'audit-chain-pkg', source: 'local', version: '1.0.0' } },
      { type: 'plugin/mounted', data: { id: 'audit-chain-pkg' } },
      { type: 'plugin/toggled', data: { id: 'audit-chain-pkg', disabled: true } },
      { type: 'plugin/toggled', data: { id: 'audit-chain-pkg', disabled: false } },
      { type: 'plugin/unmounted', data: { id: 'audit-chain-pkg' } },
    ]);
  });

  it('update local no-op 零新笔（源直引无变更不造账）', async () => {
    const dir = tmpDir('plug-audit-noop-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const fixture = auditFixture('audit-noop-pkg');
    expect(await runPluginsEntry({ sub: 'install', ref: `local:${fixture}` }, opts)).toBe(0);
    expect(await runPluginsEntry({ sub: 'update', id: 'audit-noop-pkg' }, opts)).toBe(0);
    const calls = await auditCallsOf(dir);
    expect(calls).toHaveLength(1); // 只有 installed 一笔
    expect(calls[0]!.type).toBe('plugin/installed');
  });

  it('失败/只读路径零开库：mount 前置拒与 check 后 sessions.db 缺席（惰性开库——sink 未调即未开）', async () => {
    const dir = tmpDir('plug-audit-lazy-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    expect(await runPluginsEntry({ sub: 'mount', id: 'not-installed' }, opts)).toBe(1);
    expect(await runPluginsEntry({ sub: 'check' }, opts)).toBe(0);
    expect(existsSync(join(dir, 'sessions.db'))).toBe(false); // 零动词成功 = 零开库
  });

  it('库随 --data-dir：动词与 uninstall execute 的库都开在 dataDir 下（dbPath 显式映射回归锁——修前库恒开 env 梯子位）', async () => {
    const dir = tmpDir('plug-audit-dbpath-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const fixture = auditFixture('audit-dbpath-pkg');
    expect(await runPluginsEntry({ sub: 'install', ref: `local:${fixture}` }, opts)).toBe(0);
    expect(existsSync(join(dir, 'sessions.db'))).toBe(true); // 动词成功即开库——且在 dataDir 下
    expect(await runPluginsEntry({ sub: 'mount', id: 'audit-dbpath-pkg' }, opts)).toBe(0);
    // uninstall execute（第四段落 plugin/uninstalled——audit_events 载体，
    // 装机面落码批已先行；CLI 人面无会话恒此载体，与五词同面并列成族）
    expect(await runPluginsEntry({ sub: 'uninstall', id: 'audit-dbpath-pkg', confirm: true }, opts)).toBe(0);
    expect(existsSync(join(dir, 'sessions.db'))).toBe(true);
    // 库内 audit 面三笔在场（installed + mounted + uninstalled）——读侧同 dbPath 断言往返
    const calls = await auditCallsOf(dir);
    expect(calls.map((c) => c.type)).toEqual(['plugin/installed', 'plugin/mounted', 'plugin/uninstalled']);
  });
});
