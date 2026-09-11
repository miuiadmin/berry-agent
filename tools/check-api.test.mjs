import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// 抽取器纯函数单元锁（同批工具件——测试 import 不触发 CLI〔直跑判定在〕）
import {
  scanTopLevelExports,
  firstPublicSentence,
  freeSymbolTier,
  assertApiBucketPartition,
  assertVirtualKeyCoverage,
  classifyFaceDiff,
  sliceInterfaceMembers,
  findExportedInterfaces,
  serializeSurface,
} from './extract-api-surface.mjs';
import { renderFaceDecls, declareKeysOf } from './generate-api-decls.mjs';
import { stripExperimentalSections } from './api-doc-sections.mjs';

/** 仓库根（测试文件位置上两级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 被测闸脚本 */
const CHECK_SCRIPT = join(REPO_ROOT, 'tools/check-api.mjs');
/** 提交位真快照（红绿证的干净基线输入） */
const REAL_SNAPSHOT = JSON.parse(readFileSync(join(REPO_ROOT, 'src/contracts/api-surface.json'), 'utf8'));
/** 夹具根（各腿独立子目录；收口统一清） */
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), 'check-api-test-'));

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

/**
 * 子进程跑 check-api（env 缝注入——与门禁同一进程形态，红绿证不绕闸）。
 * @param {Record<string, string>} env 附加 env（缝名 → 绝对路径）
 * @returns {{ status: number, out: string }} 退出码 + 合并输出（stdout+stderr）
 */
function runCheck(env = {}) {
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 夹具子目录（惰性建） */
function fixtureDir(name) {
  const dir = join(FIXTURE_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('check-api 十查红绿证（spawn 全闸形态）', () => {
  it('净树恒绿（零问题静默过）', () => {
    const { status, out } = runCheck();
    expect(status).toBe(0);
    expect(out).toBe('');
  });

  it('查 1：快照漂移红（CHECK_API_SNAPSHOT 换片注入假条目）', () => {
    const dir = fixtureDir('check1');
    const tampered = {
      ...REAL_SNAPSHOT,
      exports: [
        ...REAL_SNAPSHOT.exports,
        {
          module: 'berry-agent',
          symbol: 'fabricatedForTest',
          kind: 'function',
          tier: 'stable',
          since: '1.0',
          desc: '测试注入假面',
        },
      ],
    };
    const path = join(dir, 'snapshot.json');
    writeFileSync(path, serializeSurface(tampered));
    const { status, out } = runCheck({ CHECK_API_SNAPSHOT: path });
    expect(status).toBe(1);
    expect(out).toContain('[查 1]');
    expect(out).toContain('fabricatedForTest');
  });

  it('查 2：怪 tier 与未来 since 双红（CHECK_API_SURFACE 注入面）', () => {
    const dir = fixtureDir('check2');
    const injected = {
      ...REAL_SNAPSHOT,
      exports: REAL_SNAPSHOT.exports.map((e, i) =>
        i === 0 ? { ...e, tier: 'bogus' } : i === 1 ? { ...e, since: '9.9' } : e,
      ),
    };
    const path = join(dir, 'surface.json');
    writeFileSync(path, JSON.stringify(injected));
    const { status, out } = runCheck({ CHECK_API_SURFACE: path });
    expect(status).toBe(1);
    // 注入面时查 1 整块跳过（drift 真值恒走真册）——断言不误伤
    expect(out).not.toContain('[查 1]');
    expect(out).toContain('[查 2]');
    expect(out).toContain('bogus');
    expect(out).toContain('since 9.9 > 当前 apiVersion');
  });

  it('查 3：DEP 注册簿行违规红（CHECK_API_DEPRECATIONS 换片）', () => {
    const dir = fixtureDir('check3');
    const path = join(dir, 'deprecations.json');
    // 窗口 1.0→1.1（不足 3 minor）+ symbol 不在面清单 + 注册行无码面标签——三红齐发
    writeFileSync(
      path,
      JSON.stringify([
        { dep: 'DEP-001', symbol: 'berry-agent::nope', introducedIn: '1.0', removalIn: '1.1', replacement: 'x' },
      ]),
    );
    const { status, out } = runCheck({ CHECK_API_DEPRECATIONS: path });
    expect(status).toBe(1);
    expect(out).toContain('[查 3]');
    expect(out).toContain('废弃窗不足');
    expect(out).toContain('不在面清单');
    expect(out).toContain('无对应 @deprecated JSDoc 标签');
  });

  it('查 9：面动号不动红（ignited 快照 + CHECK_API_ARCHIVES 夹具归档）', () => {
    const dir = fixtureDir('check9');
    // 当前快照换片为 ignited 纪元（查 9 纪元门开）；真快照 enforcement='pre-ignition'
    const ignitedPath = join(dir, 'snapshot-ignited.json');
    writeFileSync(ignitedPath, serializeSurface({ ...REAL_SNAPSHOT, enforcement: 'ignited' }));
    // 归档族：单归档面比当前少 2 条导出而 apiVersion 同 '1.0'——面动号不动正形态
    const archiveDir = join(dir, 'api', 'snapshots');
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, '0.0.1.json'),
      serializeSurface({ ...REAL_SNAPSHOT, exports: REAL_SNAPSHOT.exports.slice(0, -2) }),
    );
    const { status, out } = runCheck({ CHECK_API_SNAPSHOT: ignitedPath, CHECK_API_ARCHIVES: archiveDir });
    expect(status).toBe(1);
    expect(out).toContain('[查 9]');
    expect(out).toContain('面动号不动');
  });

  it('查 5：实验符号漏进稳定文档红 + 豁免节内合法（CHECK_API_SURFACE 注入 + CHECK_API_ROOT 夹具树）', () => {
    const dir = fixtureDir('check5');
    // 夹具树最小形（查 10 同款）：查 2 barrel 扫描无条件读 src/contracts/index.ts
    mkdirSync(join(dir, 'src', 'contracts'), { recursive: true });
    mkdirSync(join(dir, 'api-decls'), { recursive: true });
    writeFileSync(join(dir, 'src', 'contracts', 'index.ts'), 'export {};\n');
    // 注入面：单实验符号（模块含 '/' → keyRe 路径字面支同验）
    const surfacePath = join(dir, 'surface.json');
    writeFileSync(
      surfacePath,
      serializeSurface({
        ...REAL_SNAPSHOT,
        exports: [
          {
            module: 'berry-agent/x-demo',
            symbol: 'demoProbe',
            kind: 'function',
            tier: 'experimental',
            since: '1.0',
            desc: '夹具实验符号',
          },
        ],
      }),
    );
    // 双文档：outside 豁免节之外提及（红）；inside 提及全在 〔实验面〕 豁免节内（绿）
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs', 'outside.md'),
      ['# 稳定文档', '', '提及 demoProbe 与 berry-agent/x-demo。', ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'docs', 'inside.md'),
      [
        '# 另一册',
        '',
        '## 实验节',
        '',
        '〔实验面〕',
        '',
        '提及 demoProbe 与 berry-agent/x-demo——豁免节内合法。',
        '',
        '### 更深子节仍在豁免内',
        '',
        'demoProbe 再提。',
        '',
        '## 稳定节（收界后）',
        '',
        '此处干净。',
        '',
      ].join('\n'),
    );
    const { status, out } = runCheck({ CHECK_API_ROOT: dir, CHECK_API_SURFACE: surfacePath });
    expect(status).toBe(1);
    expect(out).toContain('[查 5]');
    expect(out).toContain('demoProbe');
    expect(out).toContain('outside.md');
    expect(out).not.toContain('inside.md'); // 豁免是定点开口——节内提及不红
  });

  it('查 10：夹具树公开产物指路知识域红（CHECK_API_ROOT 换树）', () => {
    const dir = fixtureDir('check10');
    // 夹具树最小形：查 2 barrel 扫描无条件读 src/contracts/index.ts——必须在场
    mkdirSync(join(dir, 'src', 'contracts'), { recursive: true });
    mkdirSync(join(dir, 'api-decls'), { recursive: true });
    writeFileSync(join(dir, 'src', 'contracts', 'index.ts'), 'export {};\n');
    // 文件面违规：随包分发件指路知识域
    writeFileSync(
      join(dir, 'api-decls', 'evil.d.ts'),
      '/** 见设计文档 03 篇 §1。 */\nexport declare const probe: number;\n',
    );
    // message 面双形态：API_TEST_1 实参区字面量指路（红）；API_TEST_2 注释指路
    // + 实参区模板插值干净（词法注释免疫 + 插值域协议锁）
    writeFileSync(
      join(dir, 'src', 'contracts', 'api-fixture.ts'),
      [
        '// 见设计文档——注释不是 message 面（词法免疫验证位）',
        'declare const API_TEST_1: string, API_TEST_2: string, flag: boolean, BaseError: new (c: string, m: string) => Error;',
        "if (flag) throw new BaseError(API_TEST_1, '见设计文档 03 篇');",
        "throw new BaseError(API_TEST_2, `前缀 ${'内插'} 干净消息`);",
        '',
      ].join('\n'),
    );
    const { status, out } = runCheck({ CHECK_API_ROOT: dir });
    expect(status).toBe(1);
    expect(out).toContain('[查 10]');
    expect(out).toContain('evil.d.ts');
    expect(out).toContain('API_TEST_1');
    // 注释免疫 + 干净实参：API_TEST_2 构造点不红（词法小扫描器只收实参区字面量）
    expect(out).not.toContain('API_TEST_2');
  });
});

describe('抽取器纯函数单元锁', () => {
  it('scanTopLevelExports：声明形/转发形/直书花括形/default 红', () => {
    const src = [
      '/**',
      ' * 测试符号甲。',
      ' * @stable',
      ' */',
      'export function alpha(): void {}',
      'export const beta = 1;',
      'export { gamma as delta, type eps } from "./other.js";',
      'export type { zeta } from "./other.js";',
      'export * from "typebox";',
      'export { pkgThing } from "some-pkg";',
      'export { localThing };',
    ].join('\n');
    const r = scanTopLevelExports(src);
    // 标级载体：声明形带标签 → 标签；裸声明 → null；转发形不在 tags（rootTags 只收根本地直导出）
    expect(r.tags.get('alpha')).toBe('stable');
    expect(r.tags.get('beta')).toBeNull();
    expect(r.tags.has('delta')).toBe(false);
    // 直书花括形（无 from）＝本地声明形直导出——tags 收（null = 无标签，查 2 逐符号执法面）
    expect(r.tags.get('localThing')).toBeNull();
    // 名载体：声明形非转发；相对说明符具名转发（docs-only 递归域——forwarded
    // =false）；包说明符具名转发（typebox 族形）=true
    expect(r.names.get('alpha')).toEqual({ forwarded: false });
    expect(r.names.get('delta')).toEqual({ forwarded: false });
    expect(r.names.get('pkgThing')).toEqual({ forwarded: true });
    // 花括清单体解析：eps/zeta 同语句收名；type 前置形同体
    expect(r.names.has('eps')).toBe(true);
    expect(r.names.has('zeta')).toBe(true);
    // 星出/具名转发相对说明符载体
    expect(r.stars).toEqual(['typebox']);
    expect(r.namedSpecs).toEqual(['./other.js', './other.js']); // 去重不设——同目标双访问幂等
    // 声明关键字载体（API 参考分组真源）
    expect(r.kinds.get('alpha')).toBe('function');
    expect(r.kinds.get('beta')).toBe('const');
    // export default 是发射面漂移信号——fail-loud 不静默
    expect(() => scanTopLevelExports('export default 5;')).toThrow('export default');
  });

  it('firstPublicSentence：公开句滤知识域三支', () => {
    expect(firstPublicSentence('导出说明一句。第二句。')).toBe('导出说明一句');
    // 首句本身指路 → 整句丢弃退次句（机器兜底）
    expect(firstPublicSentence('见设计文档 03 篇。次句安全。')).toBe('次句安全');
    // 全句被滤 → undefined（调用方省略字段）
    expect(firstPublicSentence('见设计文档 03 篇。详见设计文档。')).toBeUndefined();
    // CJK 行接空格归一：汉字间空格是行折伪影
    expect(firstPublicSentence('中文 伪空格')).toBe('中文伪空格');
  });

  it('freeSymbolTier：转译形键级 / 声明形标签 / 缺标签 fail-loud', () => {
    // 转译形（rootTags 无键）——键级统治
    expect(freeSymbolTier(new Map(), { name: 'x', forwarded: true }, { tier: 'stable' })).toBe('stable');
    // 声明形直导出——JSDoc 标签统治
    expect(freeSymbolTier(new Map([['x', 'experimental']]), { name: 'x', forwarded: false }, { tier: 'stable' })).toBe(
      'experimental',
    );
    // 标签缺席 = 闸面漏洞——拒绝静默降级键级
    expect(() => freeSymbolTier(new Map([['x', null]]), { name: 'x', forwarded: false }, { tier: 'stable' })).toThrow(
      '无 @stable',
    );
  });

  it('assertApiBucketPartition：恰分桶过 + 三向违例红', () => {
    // 恰分桶：api.ts 名全落公开桶 ∪ 白名单
    expect(() => assertApiBucketPartition(['a', 'b'], ['a'], new Set(['b']))).not.toThrow();
    // ① 未分类：新顶层导出两桶皆不在
    expect(() => assertApiBucketPartition(['a', 'z'], ['a'], new Set(['b']))).toThrow('未分桶');
    // ② internal 漏桶：机制符号出现在公开根面
    expect(() => assertApiBucketPartition(['a', 'b'], ['a', 'b'], new Set(['b']))).toThrow('漏进公开桶');
    // ③ 白名单死名：api.ts 已无该名而白名单残留
    expect(() => assertApiBucketPartition(['a'], ['a'], new Set(['b']))).toThrow('白名单死名');
  });

  it('assertVirtualKeyCoverage：键表有而面无即炸', () => {
    expect(() =>
      assertVirtualKeyCoverage([{ key: 'berry-agent' }, { key: 'typebox' }], [{ module: 'berry-agent' }]),
    ).toThrow('typebox');
    expect(() =>
      assertVirtualKeyCoverage([{ key: 'berry-agent' }], [{ module: 'berry-agent' }, { module: 'typebox' }]),
    ).not.toThrow();
  });

  it('classifyFaceDiff：剥文档载荷判面变 + sig 单向不判 + tier 单列', () => {
    const prev = {
      exports: [
        { module: 'm', symbol: 'a', tier: 'stable', since: '1.0', sig: 'oldhash', desc: '旧文案' },
        { module: 'm', symbol: 'b', tier: 'stable', since: '1.0' },
      ],
      capabilities: [],
    };
    // a：desc 变（剥除不判）+ sig 旧有新无（单向剥挂不判）+ tier 变（单列）；b 移除；c 新增
    const next = {
      exports: [
        { module: 'm', symbol: 'a', tier: 'experimental', since: '1.0', desc: '新文案' },
        { module: 'm', symbol: 'c', tier: 'stable', since: '1.0' },
      ],
      capabilities: [],
    };
    const d = classifyFaceDiff(prev, next);
    expect(d.added).toEqual(['m::c']);
    expect(d.removed).toEqual(['m::b']);
    expect(d.reTiered).toEqual(['m::a']);
    expect(d.changed).toEqual([]);
    expect(d.capabilitiesChanged).toBe(false);
    // sig 双侧在场而不同 → changed；capabilities 变 → 独立旗
    const d2 = classifyFaceDiff(
      { exports: [{ module: 'm', symbol: 'a', tier: 'stable', since: '1.0', sig: 'h1' }], capabilities: [] },
      {
        exports: [{ module: 'm', symbol: 'a', tier: 'stable', since: '1.0', sig: 'h2' }],
        capabilities: [{ id: 'cap' }],
      },
    );
    expect(d2.changed).toEqual(['m::a']);
    expect(d2.capabilitiesChanged).toBe(true);
  });

  it('sliceInterfaceMembers：成员切片键序即声明序', () => {
    const body = '  /** 注释 */\n  open(path: string): void;\n  read(): string;';
    const m = sliceInterfaceMembers(body);
    expect([...m.keys()]).toEqual(['open', 'read']);
    expect(m.get('open')).toContain('open');
    expect(m.get('read')).toContain('string');
  });

  it('findExportedInterfaces：泛型接口 + barrel 再导出文件（预读括号回补）', () => {
    const src =
      'export interface Repo<T> {\n  get(key: string): T | undefined;\n}\nexport interface Plain { x: number }';
    const faces = findExportedInterfaces(src);
    expect([...faces.keys()].sort()).toEqual(['Plain', 'Repo']);
    expect(faces.get('Repo')).toContain('get');
    // 具名再导出（export { A } from './a.js'）与接口混排：修前预读吞 { 使深度
    // 永负、后续 interface 认定失明——回补后 B 正常收
    const barrelSrc = "export { A } from './a.js';\nexport interface B { y: number }";
    expect([...findExportedInterfaces(barrelSrc).keys()]).toEqual(['B']);
  });

  it('stripExperimentalSections：标记行起至同级标题豁免 + 句中字面不算标记', () => {
    const text = [
      '# 册',
      '',
      '句中〔实验面〕不算标记——保留扫描，probeOne 在此须仍可见。',
      '',
      '## 实验节',
      '',
      '〔实验面〕',
      '',
      'probeTwo 提及',
      '',
      '### 更深子节仍豁免',
      '',
      'probeThree 再提',
      '',
      '## 稳定节',
      '',
      'probeFour 节外',
      '',
    ].join('\n');
    const stripped = stripExperimentalSections(text);
    // 句中字面不触发豁免——该行保留
    expect(stripped).toContain('句中〔实验面〕不算标记');
    expect(stripped).toContain('probeOne');
    // 标记行起至同级（##）标题止：节内正文 + 更深子节标题全剥
    expect(stripped).not.toContain('probeTwo');
    expect(stripped).not.toContain('probeThree');
    expect(stripped).not.toContain('更深子节仍豁免');
    // 收界标题与其后正文回扫描面
    expect(stripped).toContain('## 稳定节');
    expect(stripped).toContain('probeFour');
  });
});

describe('Face 派生生成器单元锁', () => {
  it('renderFaceDecls：declare 行从快照域派生 + 零导出 fail-loud', () => {
    const out = renderFaceDecls({
      exports: [
        { module: 'berry-agent/llm', symbol: 'alpha' },
        { module: 'berry-agent/llm', symbol: 'beta' },
        { module: 'berry-agent', symbol: '别的域不进' },
      ],
    });
    const text = out.get('berry-agent-llm.d.ts');
    expect(text).toContain("export declare const alpha: Face['alpha'];");
    expect(text).toContain("export declare const beta: Face['beta'];");
    expect(text).not.toContain('别的域不进');
    // 恰一尾换行（生成物定格形态）
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    // 快照对应域零导出 = 快照漂移——fail-loud 指回抽取器
    expect(() => renderFaceDecls({ exports: [{ module: 'berry-agent', symbol: 'x' }] })).toThrow('零导出');
  });

  it('declareKeysOf：declare 行键集提取（emit 对账同源）', () => {
    expect(declareKeysOf('/** 头注 */\nexport declare const a: X;\nexport declare const b: Y;\n')).toEqual(['a', 'b']);
    expect(declareKeysOf('export const notDeclare = 1;')).toEqual([]);
  });
});
