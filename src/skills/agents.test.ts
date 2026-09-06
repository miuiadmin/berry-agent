/**
 * 声明式子代理解析层测试（06 §11.6）：frontmatter 全形/坏形处置逐条 +
 * 层扫描（扁平/排序/撞名/信任锚/realpath 去重）+ 标准层构造 + first-wins
 * 跨层合并。
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectAgentDefs, createAgentLayerProvider, createStandardAgentLayers, parseAgentDef } from './agents.js';
import { SKILL_DESCRIPTION_MAX } from './types.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agents-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 造层：写文件映射（相对名 → 内容） */
function writeLayer(root: string, files: Record<string, string>): string {
  mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), content);
  }
  return root;
}

/** 合法文件样例（可覆写字段；值为空串的键省略——name 缺席回落位用） */
function agentFile(fields: Record<string, string> = {}, body = '你是搜索专员。'): string {
  const fm = Object.entries({ description: '委派搜索专员', ...fields })
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return `---\n${fm}\n---\n${body}`;
}

describe('parseAgentDef frontmatter 处置', () => {
  it('全形：name/description/tools/requires/model + 正文即系统提示（原样保留）', () => {
    const raw = [
      '---',
      'name: researcher',
      'description: 深度调研员',
      'tools:',
      '  - grep',
      '  - web',
      'requires:',
      '  - lsp',
      'model: m1',
      '---',
      '你是调研员。',
      '多行正文保留缩进。',
    ].join('\n');
    const parsed = parseAgentDef(raw, { filePath: '/x/researcher.md' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed).toMatchObject({
      name: 'researcher',
      description: '深度调研员',
      tools: ['grep', 'web'],
      requires: ['lsp'],
      model: 'm1',
      systemPrompt: '你是调研员。\n多行正文保留缩进。',
      filePath: '/x/researcher.md',
    });
  });

  it('name 缺席回落文件基名（去 .md）', () => {
    const raw = '---\ndescription: 调研\n---\n正文';
    const parsed = parseAgentDef(raw, { filePath: '/x/deep-research.md' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.name).toBe('deep-research');
  });

  it('name 与基名不一致拒（身份键纪律——工具名与文件名不双名漂移）', () => {
    const parsed = parseAgentDef(agentFile({ name: 'other' }), { filePath: '/x/researcher.md' });
    expect('error' in parsed).toBe(true);
    if (!('error' in parsed)) return;
    expect(parsed.error).toContain('researcher');
  });

  it('name 词法违例拒（物化为工具名 agent_<name> 的词法安全面）', () => {
    const bad = parseAgentDef(agentFile({ name: 'Bad_Name' }), { filePath: '/x/Bad_Name.md' });
    expect('error' in bad).toBe(true);
    if (!('error' in bad)) return;
    expect(bad.error).toContain('非法字符');
  });

  it('description 缺席/空/非字符串拒（唯一硬条件）', () => {
    for (const fm of ['', 'description: ', 'description: 42']) {
      const raw = `---\n${fm}\n---\n正文`;
      const parsed = parseAgentDef(raw, { filePath: '/x/a.md' });
      expect('error' in parsed).toBe(true);
    }
  });

  it('description 超 1024 截断装载（清单行帽同技能律）', () => {
    const raw = agentFile({ description: 'x'.repeat(SKILL_DESCRIPTION_MAX + 10) });
    const parsed = parseAgentDef(raw, { filePath: '/x/a.md' });
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.description).toHaveLength(SKILL_DESCRIPTION_MAX);
  });

  it('tools/requires 非字符串数组拒；model 非字符串拒', () => {
    expect('error' in parseAgentDef('---\ndescription: d\ntools: grep\n---\nb', { filePath: '/x/a.md' })).toBe(true);
    expect(
      'error' in parseAgentDef('---\ndescription: d\ntools:\n  - grep\n  - 42\n---\nb', { filePath: '/x/a.md' }),
    ).toBe(true);
    expect('error' in parseAgentDef('---\ndescription: d\nrequires: lsp\n---\nb', { filePath: '/x/a.md' })).toBe(true);
    expect('error' in parseAgentDef('---\ndescription: d\nmodel: 42\n---\nb', { filePath: '/x/a.md' })).toBe(true);
  });

  it('正文空拒（正文即系统提示）；frontmatter 坏形拒；未采用字段静默忽略', () => {
    expect('error' in parseAgentDef('---\ndescription: d\n---\n  \n', { filePath: '/x/a.md' })).toBe(true);
    expect('error' in parseAgentDef('没有头的裸文件', { filePath: '/x/a.md' })).toBe(true);
    // 生态宽容：CC 形字段超集（license 等）可装载
    const eco = parseAgentDef('---\ndescription: d\nlicense: MIT\nunknown-key: {a: 1}\n---\n正文', {
      filePath: '/x/a.md',
    });
    expect('error' in eco).toBe(false);
  });
});

describe('createAgentLayerProvider 层扫描', () => {
  it('扁平扫 *.md（不递归子目录）；文件名排序确定装载序；坏文件跳过带诊断', async () => {
    const root = writeLayer(join(dir, 'l1'), {
      'b.md': agentFile({ description: 'B 员' }),
      'a.md': agentFile({ description: 'A 员' }),
      'bad.md': '---\n没有闭合\n',
      'ignore.txt': 'not an agent',
      'sub/c.md': agentFile(), // 子目录不递归——不应装载
    });
    const scan = await createAgentLayerProvider({ id: 't', roots: [root] }).scan();
    expect(scan.defs.map((def) => def.name)).toEqual(['a', 'b']);
    expect(scan.diagnostics).toHaveLength(1);
    expect(scan.diagnostics[0]).toMatchObject({ type: 'invalid-metadata' });
    expect(scan.diagnostics[0]!.path).toContain('bad.md');
  });

  it('同层撞名（双根同名文件）：后到跳过带 collision 诊断', async () => {
    const r1 = writeLayer(join(dir, 'r1'), { 'x.md': agentFile({ description: '第一位' }) });
    const r2 = writeLayer(join(dir, 'r2'), { 'x.md': agentFile({ description: '第二位' }) });
    const scan = await createAgentLayerProvider({ id: 'cross', roots: [r1, r2] }).scan();
    expect(scan.defs).toHaveLength(1);
    expect(scan.defs[0]!.description).toBe('第一位');
    expect(scan.diagnostics.some((d) => d.type === 'collision')).toBe(true);
  });

  it('realpath 去重：symlink 别名跨根同文件只载一次（静默）', async () => {
    const r1 = writeLayer(join(dir, 'real'), { 'x.md': agentFile() });
    const r2 = join(dir, 'alias');
    mkdirSync(r2, { recursive: true });
    symlinkSync(join(r1, 'x.md'), join(r2, 'x.md'));
    const scan = await createAgentLayerProvider({ id: 't', roots: [r1, r2] }).scan();
    expect(scan.defs).toHaveLength(1);
    expect(scan.diagnostics).toHaveLength(0);
  });

  it('trusted=false：空扫描 + 单诊断（装载不激活）', async () => {
    const root = writeLayer(join(dir, 'l'), { 'x.md': agentFile() });
    const provider = createAgentLayerProvider({ id: 'project', roots: [root], trusted: false });
    const scan = await provider.scan();
    expect(scan.defs).toHaveLength(0);
    expect(scan.diagnostics).toHaveLength(1);
    expect(scan.diagnostics[0]!.message).toContain('目录信任锚');
  });

  it('根目录缺席：空扫描零诊断', async () => {
    const scan = await createAgentLayerProvider({ id: 't', roots: [join(dir, 'nope')] }).scan();
    expect(scan.defs).toEqual([]);
    expect(scan.diagnostics).toEqual([]);
  });
});

describe('createStandardAgentLayers 标准层', () => {
  it('位 1-3 + 插件位；无出厂位（与技能差异：位 6 无）', () => {
    const providers = createStandardAgentLayers({
      cwd: dir,
      dataDir: join(dir, 'data'),
      homeDir: join(dir, 'home'),
      pluginLayers: [{ id: 'plugin-a', roots: [join(dir, 'p')] }],
    });
    expect(providers.map((p) => p.id)).toEqual(['project', 'user', 'cross-repo', 'plugin-a']);
    expect(providers[0]!.roots[0]).toBe(join(dir, '.agents', 'agents'));
    expect(providers[1]!.roots[0]).toBe(join(dir, 'data', 'agents'));
    expect(providers[2]!.roots).toEqual([
      join(dir, 'home', '.agents', 'agents'),
      join(dir, 'home', '.claude', 'agents'),
    ]);
  });

  it('trustedProject 透传 project 层', () => {
    const providers = createStandardAgentLayers({
      cwd: dir,
      dataDir: join(dir, 'data'),
      homeDir: join(dir, 'home'),
      trustedProject: false,
    });
    expect(providers[0]!.trusted).toBe(false);
  });
});

describe('collectAgentDefs 跨层合并', () => {
  it('first-wins：层序即信任序，project 恒压 user；后层同名静默压制', async () => {
    const p = writeLayer(join(dir, 'proj'), { 'x.md': agentFile({ description: 'project 版' }) });
    const u = writeLayer(join(dir, 'user'), {
      'x.md': agentFile({ description: 'user 版' }),
      'y.md': agentFile({ description: 'user 独有' }),
    });
    const collection = await collectAgentDefs([
      createAgentLayerProvider({ id: 'project', roots: [p] }),
      createAgentLayerProvider({ id: 'user', roots: [u] }),
    ]);
    expect(collection.defs.map((def) => def.name)).toEqual(['x', 'y']);
    expect(collection.defs[0]!.description).toBe('project 版');
    expect(collection.diagnostics).toHaveLength(0); // 跨层压制是装载日志非冲突面
  });

  it('诊断透传：坏文件诊断逐层收集', async () => {
    const p = writeLayer(join(dir, 'p'), { 'bad.md': '裸文件' });
    const collection = await collectAgentDefs([createAgentLayerProvider({ id: 't', roots: [p] })]);
    expect(collection.defs).toEqual([]);
    expect(collection.diagnostics).toHaveLength(1);
  });
});
