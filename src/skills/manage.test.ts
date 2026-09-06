/**
 * skill_manage 工具测试（06 §12.1——list/create/patch 三动词全链；真 FS 临时
 * 工作区 + 标准层 registry）。
 *
 * 判据回归锁重点：①同名盘上判据——坏 frontmatter 文件不入册（get() 隐身）但
 * create 仍亮拒（只查在册名会静默毁文件）；②patch 替换域限 frontmatter 之后
 * （find 串只在 frontmatter 出现 = 正文域零匹配拒）；③replace 字面写出
 * （$& 家族不展开）。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillManageTool } from './manage.js';
import { createSkillsRegistry } from './registry.js';
import { createDirProvider } from './discovery.js';
import type { SkillsRegistry } from './registry.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

/** 测试装配：临时工作区 + project 层 registry + manage 工具 */
interface Fixture {
  readonly ws: string;
  readonly userDir: string;
  readonly registry: SkillsRegistry;
  readonly tool: ReturnType<typeof createSkillManageTool>;
}

async function setup(): Promise<Fixture> {
  const ws = await mkdtemp(join(tmpdir(), 'berry-manage-ws-'));
  const userDir = await mkdtemp(join(tmpdir(), 'berry-manage-user-'));
  cleanups.push(ws, userDir);
  await mkdir(join(ws, '.agents', 'skills'), { recursive: true });
  await mkdir(join(userDir, 'skills'), { recursive: true });
  const registry = createSkillsRegistry();
  registry.registerProvider(
    createDirProvider({ id: 'project', roots: [join(ws, '.agents', 'skills')], writable: true }),
  );
  registry.registerProvider(createDirProvider({ id: 'user', roots: [join(userDir, 'skills')] }));
  await registry.refresh();
  const tool = createSkillManageTool({
    registry,
    workspaceRoot: () => ws,
    writableRoots: () => [ws],
  });
  return { ws, userDir, registry, tool };
}

/** 便捷执行 */
async function run(tool: Fixture['tool'], args: Record<string, unknown>) {
  return tool.execute(args, { toolCallId: 'test' });
}

/** 落一枚技能文件（自动建目录） */
async function seedSkill(dir: string, name: string, content: string): Promise<string> {
  const filePath = join(dir, name, 'SKILL.md');
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

describe('skill_manage list', () => {
  it('空表——零件在册', async () => {
    const f = await setup();
    const result = await run(f.tool, { action: 'list' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('0 件');
  });

  it('列表行含名/层/路径/隐藏/溯源标记', async () => {
    const f = await setup();
    await seedSkill(
      join(f.ws, '.agents', 'skills'),
      'demo',
      '---\nname: demo\ndescription: 演示\nprovenance:\n  memories: [m1]\n---\n\n正文\n',
    );
    await seedSkill(
      join(f.userDir, 'skills'),
      'hid',
      '---\nname: hid\ndescription: 隐\ndisable-model-invocation: true\n---\n\n正文\n',
    );
    await f.registry.refresh();
    const result = await run(f.tool, { action: 'list' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('demo（project 层）');
    expect(text).toContain('溯源 1');
    expect(text).toContain('hid（user 层）');
    expect(text).toContain('[隐藏]');
  });
});

describe('skill_manage create', () => {
  it('全链成功——写盘真形（frontmatter 物化）+ 写后刷新入册', async () => {
    const f = await setup();
    const result = await run(f.tool, {
      action: 'create',
      name: 'new-skill',
      description: '新技能描述',
      body: '# 新技能\n\n用法正文。',
      provenance_memories: ['mem-1'],
    });
    expect(result.isError).toBeUndefined();
    const target = join(f.ws, '.agents', 'skills', 'new-skill', 'SKILL.md');
    const written = readFileSync(target, 'utf8');
    expect(written.startsWith('---\n')).toBe(true);
    expect(written).toContain('name: new-skill');
    expect(written).toContain('description: 新技能描述');
    expect(written).toContain('memories:\n    - mem-1');
    expect(written).toContain('---\n\n# 新技能\n\n用法正文。\n');
    // 写后自动刷新——立即 get 可见
    expect(f.registry.get('new-skill')?.providerId).toBe('project');
  });

  it('名字法违例 → SKILLS_NAME_INVALID', async () => {
    const f = await setup();
    const result = await run(f.tool, { action: 'create', name: 'Bad_Name', description: 'd', body: 'b' });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_NAME_INVALID');
  });

  it('description 缺席/超长、正文缺席 → SKILLS_CONTENT_INVALID', async () => {
    const f = await setup();
    const noDesc = await run(f.tool, { action: 'create', name: 'a', body: 'b' });
    expect((noDesc.content[0] as { text: string }).text).toContain('SKILLS_CONTENT_INVALID');
    const noBody = await run(f.tool, { action: 'create', name: 'a', description: 'd' });
    expect((noBody.content[0] as { text: string }).text).toContain('SKILLS_CONTENT_INVALID');
    const longDesc = await run(f.tool, {
      action: 'create',
      name: 'a',
      description: 'x'.repeat(1025),
      body: 'b',
    });
    expect((longDesc.content[0] as { text: string }).text).toContain('SKILLS_CONTENT_INVALID');
  });

  it('同名在册 → SKILLS_NAME_EXISTS 亮拒不覆写', async () => {
    const f = await setup();
    await run(f.tool, { action: 'create', name: 'dup', description: 'd', body: 'b' });
    const second = await run(f.tool, { action: 'create', name: 'dup', description: 'd2', body: 'b2' });
    expect((second.content[0] as { text: string }).text).toContain('SKILLS_NAME_EXISTS');
    expect(f.registry.get('dup')?.description).toBe('d'); // 首件未被动
  });

  it('同名盘上坏文件（不入册、get() 隐身）→ 仍亮拒——判据回归锁', async () => {
    const f = await setup();
    // 坏 frontmatter 文件：装载层拒载 → 不入册；但盘上占名
    await seedSkill(join(f.ws, '.agents', 'skills'), 'broken', 'no frontmatter\n');
    await f.registry.refresh();
    expect(f.registry.get('broken')).toBeUndefined(); // 前置：确不入册
    const result = await run(f.tool, { action: 'create', name: 'broken', description: 'd', body: 'b' });
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_NAME_EXISTS');
    expect(readFileSync(join(f.ws, '.agents', 'skills', 'broken', 'SKILL.md'), 'utf8')).toBe(
      'no frontmatter\n', // 坏文件未被覆盖
    );
  });

  it('写点不在可写根 → SKILLS_WRITE_ROOT_DENIED（read-only 档空根即拒）', async () => {
    const f = await setup();
    const readonlyTool = createSkillManageTool({
      registry: f.registry,
      workspaceRoot: () => f.ws,
      writableRoots: () => [],
    });
    const result = await run(readonlyTool, { action: 'create', name: 'x', description: 'd', body: 'b' });
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_WRITE_ROOT_DENIED');
  });
});

describe('skill_manage patch', () => {
  /** 落一枚可 patch 的 project 层技能 */
  async function seed(f: Fixture, name = 'demo', body = '正文甲段。\n\n正文乙段。\n'): Promise<string> {
    const filePath = join(f.ws, '.agents', 'skills', name, 'SKILL.md');
    await mkdir(join(f.ws, '.agents', 'skills', name), { recursive: true });
    await writeFile(filePath, `---\nname: ${name}\ndescription: d\n---\n\n${body}`, 'utf8');
    await f.registry.refresh();
    return filePath;
  }

  it('单点替换成功——写后刷新生效', async () => {
    const f = await setup();
    const filePath = await seed(f);
    const result = await run(f.tool, {
      action: 'patch',
      name: 'demo',
      find: '乙段',
      replace: '丙段',
    });
    expect(result.isError).toBeUndefined();
    const after = readFileSync(filePath, 'utf8');
    expect(after).toContain('正文丙段。');
    expect(after).toContain('name: demo'); // frontmatter 原样保留
    expect(f.registry.get('demo')?.content).toContain('丙段'); // 刷新后入册
  });

  it('不在册 → SKILLS_NOT_FOUND', async () => {
    const f = await setup();
    const result = await run(f.tool, { action: 'patch', name: 'ghost', find: 'a', replace: 'b' });
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_NOT_FOUND');
  });

  it('非 project 层（user 层）→ SKILLS_LAYER_READONLY 指路人面', async () => {
    const f = await setup();
    await seedSkill(join(f.userDir, 'skills'), 'userone', '---\nname: userone\ndescription: d\n---\n\n正文\n');
    await f.registry.refresh();
    const result = await run(f.tool, { action: 'patch', name: 'userone', find: '正文', replace: 'x' });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('SKILLS_LAYER_READONLY');
    expect(text).toContain('人面'); // 指路人面
  });

  it('替换域限 frontmatter 之后——find 串只在 frontmatter 出现 = 零匹配拒', async () => {
    const f = await setup();
    const filePath = await seed(f, 'demo', '正文段。\n');
    const result = await run(f.tool, {
      action: 'patch',
      name: 'demo',
      find: 'description', // 仅存在于 frontmatter
      replace: 'XX',
    });
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_PATCH_MATCH_INVALID');
    expect(readFileSync(filePath, 'utf8')).toContain('description: d'); // 未动
  });

  it('多匹配 → 拒（不猜改点）', async () => {
    const f = await setup();
    await seed(f, 'demo', '重复词。\n\n重复词。\n');
    const result = await run(f.tool, { action: 'patch', name: 'demo', find: '重复词', replace: 'X' });
    expect((result.content[0] as { text: string }).text).toContain('SKILLS_PATCH_MATCH_INVALID');
    expect((result.content[0] as { text: string }).text).toContain('2 处');
  });

  it('replace 字面写出——$& / $` 家族不展开', async () => {
    const f = await setup();
    const filePath = await seed(f, 'demo', '锚点词\n');
    await run(f.tool, { action: 'patch', name: 'demo', find: '锚点词', replace: "$&$`$'$$" });
    const after = readFileSync(filePath, 'utf8');
    expect(after).toContain("$&$`$'$$"); // 六个字符字面在场（$' 单引号转义形）
  });

  it('CRLF 归一化——整文件统一 LF 写回（校验域与替换域同坐标）', async () => {
    const f = await setup();
    const filePath = join(f.ws, '.agents', 'skills', 'crlf', 'SKILL.md');
    await mkdir(join(f.ws, '.agents', 'skills', 'crlf'), { recursive: true });
    await writeFile(filePath, '---\r\nname: crlf\r\ndescription: d\r\n---\r\n\r\nWindows 正文。\r\n', 'utf8');
    await f.registry.refresh();
    const result = await run(f.tool, { action: 'patch', name: 'crlf', find: 'Windows', replace: '归一' });
    expect(result.isError).toBeUndefined();
    const after = readFileSync(filePath, 'utf8');
    expect(after.includes('\r\n')).toBe(false); // 整文件归一化
    expect(after).toContain('归一 正文。');
  });
});
