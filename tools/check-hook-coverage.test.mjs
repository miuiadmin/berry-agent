import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 活词派发覆盖率锁守护炮自测（07 篇 §7.4 #10 env 根缝惯例——CHECK_HOOK_
// COVERAGE_ROOT 注入夹具根逐形验红；净树腿不注 env 走真仓验绿）。

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_SCRIPT = join(REPO_ROOT, 'tools', 'check-hook-coverage.mjs');

/** @type {string[]} 本套夹具根（afterAll 统一清场） */
const tmpRoots = [];

/**
 * 造夹具根：files 相对路径 → 内容（父目录自动建）。
 * @param {string} name 夹具名（进 mkdtemp 前缀）
 * @param {Record<string, string>} files 相对路径 → 文件内容
 * @returns {string} 夹具根绝对路径
 */
function fixture(name, files) {
  const root = mkdtempSync(join(tmpdir(), `hookcov-${name}-`));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return root;
}

/**
 * 跑锁（env 根缝注入夹具根；缺省走真仓）。
 * @param {string | null} root 夹具根（null = 真仓净树腿）
 * @returns {{ status: number | null, out: string }}
 */
function runCheck(root) {
  const r = spawnSync(process.execPath, [CHECK_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(root ? { CHECK_HOOK_COVERAGE_ROOT: root } : {}) },
    encoding: 'utf8',
  });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 词汇表真源夹具内容（5 词迷你闭集——活词 3 + 保留词 2） */
const vocabOf = (/** @type {{ name: string, mode: string }[]} */ entries) =>
  'export const PLUGIN_HOOK_VOCABULARY = [\n' +
  entries.map((e) => `  { name: '${e.name}', mode: '${e.mode}' },`).join('\n') +
  '\n];\n';

const BASE_VOCAB = vocabOf([
  { name: 'lit/word', mode: 'emit' },
  { name: 'const_word', mode: 'waterfall' },
  { name: 'agent_evt', mode: 'emit' },
  { name: 'res_word', mode: 'emit' },
  { name: 'res_two', mode: 'serial' },
]);

/** docs 两栏表夹具内容（宣称句 + 两栏表头计数对拍腿一并覆盖） */
const docsOf = (
  /** @type {{ active: string, activeCount: number, reserved: string, reservedCount: number, claim: number }} */ o,
) =>
  `# t\n\n钩子词是 ${o.claim} 词固定闭集。\n\n#### 活词（${o.activeCount}）\n\n` +
  '| 钩子 | 模式 | 宿主侧发射位 |\n| --- | --- | --- |\n' +
  o.active +
  '\n\n#### 保留词（' +
  o.reservedCount +
  '——发射位未落，订阅静默）\n\n| 钩子 | 模式 | 状态 |\n| --- | --- | --- |\n' +
  o.reserved +
  '\n';

const ACTIVE_ROWS =
  '| `lit/word` | emit | `src/host/emit-site.ts` — 字面形位 |\n' +
  '| `const_word` | waterfall | `src/tools/p.ts` — 常量形位 |\n' +
  '| `agent_evt` | emit | `src/agent/loop.ts` — 源点形位 |';

const RESERVED_ROWS = '| `res_word` | emit | 位未落 |\n| `res_two` | serial | 位未落 |';

/** 净基线夹具文件面（三形证据各一 + 两保留词零证据） */
function baseFiles() {
  return {
    'src/host/plugin-context.ts': BASE_VOCAB,
    'docs/plugin-development.md': docsOf({
      active: ACTIVE_ROWS,
      activeCount: 3,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    }),
    // 字面形证据：裸 dispatch.emit 首参字符串
    'src/host/emit-site.ts': "void dispatch.emit('lit/word', { ok: true });\n",
    // 契约常量形两腿：常量声明 + 泛型参用法位
    'src/contracts/c.ts': "export const CONST_WORD_EVENT = 'const_word';\n",
    'src/tools/p.ts': 'await dispatch.waterfall<GateInput>(CONST_WORD_EVENT, input);\n',
    // agent 域源点形证据：emit({ type: '词' })
    'src/agent/loop.ts': "emit({ type: 'agent_evt' });\n",
  };
}

describe('check-hook-coverage 守护炮（env 根缝夹具逐形验红）', () => {
  it('净基线夹具绿——三形证据齐、计数面打全', () => {
    const r = runCheck(fixture('base', baseFiles()));
    expect(r.status).toBe(0);
    expect(r.out).toContain('词汇 5 = 活词 3 + 保留词 2');
    expect(r.out).toContain('字面 1');
    expect(r.out).toContain('常量 1');
    expect(r.out).toContain('源点 1');
    expect(r.out).toContain('锚文件 3/3');
  });

  it('红形一（闭集缺失词）——词汇在册而 docs 两栏表缺席', () => {
    const files = baseFiles();
    files['src/host/plugin-context.ts'] = vocabOf([
      { name: 'lit/word', mode: 'emit' },
      { name: 'const_word', mode: 'waterfall' },
      { name: 'agent_evt', mode: 'emit' },
      { name: 'res_word', mode: 'emit' },
      { name: 'res_two', mode: 'serial' },
      { name: 'ghost_word', mode: 'emit' },
    ]);
    // 宣称句同步抬 6——隔离本红形（否则宣称句腿连带红，形不单点）
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS,
      activeCount: 3,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 6,
    });
    const r = runCheck(fixture('missing', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('ghost_word');
    expect(r.out).toContain('在册而 docs 两栏表缺席');
  });

  it('红形二（闭集多词）——docs 表词不在 PLUGIN_HOOK_VOCABULARY', () => {
    const files = baseFiles();
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS + '\n| `phantom` | emit | `src/host/emit-site.ts` — 无 |',
      activeCount: 4,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    });
    const r = runCheck(fixture('extra', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('phantom');
    expect(r.out).toContain('不在 PLUGIN_HOOK_VOCABULARY');
  });

  it('红形三（闭集重复）——同词跨活词/保留词两表双列', () => {
    const files = baseFiles();
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS,
      activeCount: 3,
      reserved: RESERVED_ROWS + '\n| `lit/word` | emit | 位未落 |',
      reservedCount: 3,
      claim: 5,
    });
    const r = runCheck(fixture('dup', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('lit/word');
    expect(r.out).toContain('重复出现 2 次');
  });

  it('红形四（模式不一致）——docs 模式列与词汇表 mode 分叉', () => {
    const files = baseFiles();
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS.replace('| `const_word` | waterfall |', '| `const_word` | serial |'),
      activeCount: 3,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    });
    const r = runCheck(fixture('mode', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('const_word');
    expect(r.out).toContain('模式 serial ≠ 词汇表 mode waterfall');
  });

  it('红形五（保留词有发射位）——码面已落发射而 docs 仍列保留词', () => {
    const files = baseFiles();
    files['src/host/emit-site.ts'] =
      "void dispatch.emit('lit/word', { ok: true });\nvoid dispatch.emit('res_word', {});\n";
    const r = runCheck(fixture('reserved-hit', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('保留词「res_word」');
    expect(r.out).toContain('应迁活词表');
  });

  it('红形六（活词零发射位）——全仓三形零证据', () => {
    const files = baseFiles();
    files['src/host/emit-site.ts'] = 'export {};\n';
    const r = runCheck(fixture('no-evidence', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('活词「lit/word」');
    expect(r.out).toContain('全仓零发射位证据');
  });

  it('红形七（锚文件不存在）——第三列模块路径解析不到在场文件', () => {
    const files = baseFiles();
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS.replace('`src/host/emit-site.ts`', '`src/host/nope.ts`'),
      activeCount: 3,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    });
    const r = runCheck(fixture('anchor-miss', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('锚文件不存在');
    expect(r.out).toContain('src/host/nope.ts');
  });

  it('红形八（锚内零证据）——锚文件在场但证据在别处（锚与发射位漂移）', () => {
    const files = baseFiles();
    // lit/word 证据仍在 emit-site.ts，但 docs 锚改指在场而无证据的 c.ts
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS.replace('`src/host/emit-site.ts`', '`src/contracts/c.ts`'),
      activeCount: 3,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    });
    const r = runCheck(fixture('anchor-drift', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('lit/word');
    expect(r.out).toContain('内零发射位证据');
    expect(r.out).toContain('src/host/emit-site.ts:1'); // 违规面点名真证据位——可定位
  });

  it('红形九（表头计数错）——活词表头计数与实际行数分叉', () => {
    const files = baseFiles();
    files['docs/plugin-development.md'] = docsOf({
      active: ACTIVE_ROWS,
      activeCount: 2,
      reserved: RESERVED_ROWS,
      reservedCount: 2,
      claim: 5,
    });
    const r = runCheck(fixture('count', files));
    expect(r.status).toBe(1);
    expect(r.out).toContain('活词表头计数 2 ≠ 实际行数 3');
  });

  it('反控腿——注释位伪证据不计（剥离器保字符串剥注释）', () => {
    const files = baseFiles();
    files['src/fake.ts'] = "// void dispatch.emit('res_word', {});\n/* void dispatch.emit('res_two', {}); */\n";
    const r = runCheck(fixture('comment-fake', files));
    expect(r.status).toBe(0);
  });

  it('反控腿——测试件证据不计（.test. 排除）', () => {
    const files = baseFiles();
    files['src/host/emit-site.test.ts'] = "void dispatch.emit('res_word', {});\n";
    const r = runCheck(fixture('test-fake', files));
    expect(r.status).toBe(0);
  });

  it('净树恒绿（真仓不注 env 根缝）', () => {
    const r = runCheck(null);
    expect(r.status).toBe(0);
    expect(r.out).toContain('check-hook-coverage 绿');
    expect(r.out).toContain('词汇 41');
  });
});

afterAll(() => {
  for (const root of tmpRoots) rmSync(root, { recursive: true, force: true });
});
