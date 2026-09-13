/**
 * load_skill 工具测试（06 §11.5(a) 按需拉取模——具名通道）。
 *
 * 锁点：全文回执与激活包装同形同源 / 节命中按层级重建标题 / 未命中列候选、
 * 歧义带行号（报错不猜）/ mode 双形词表过滤（词表空原样注明、不在词表拒列
 * 词表）/ SKILLS_NOT_FOUND 复用 / disable-model-invocation 拒载指路显式通道。
 */
import { describe, expect, it } from 'vitest';
import { createLoadSkillTool } from './load.js';
import { createSkillsRegistry } from './registry.js';
import { formatSkillInvocation } from './render.js';
import type { ProviderScan, Skill, SkillsProvider } from './types.js';

/** 静态扫描 provider（纯内存技能注入——零 FS） */
function staticProvider(skills: readonly Skill[]): SkillsProvider {
  const scan = async (): Promise<ProviderScan> => ({ skills, diagnostics: [] });
  return { id: 'static', roots: [], scan };
}

/** 造注册表（注入技能集后 refresh 落快照） */
async function registryOf(skills: readonly Skill[]): Promise<ReturnType<typeof createSkillsRegistry>> {
  const registry = createSkillsRegistry();
  registry.registerProvider(staticProvider(skills));
  await registry.refresh();
  return registry;
}

/** 技能桩（可覆写） */
function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'demo',
    description: '演示技能',
    filePath: '/w/.agents/skills/demo/SKILL.md',
    baseDir: '/w/.agents/skills/demo',
    providerId: 'project',
    content:
      '# 总则\n\n通用规则。\n\n# 模式\n\n| **Lite** | 快 |\n| **Full** | 全 |\n\n- lite: "轻跑示例"\n- full: "全跑示例"\n\n收尾。',
    disableModelInvocation: false,
    sections: [],
    ...overrides,
  };
}

/** 执行工具并断言非错误回执文本 */
async function runText(tool: ReturnType<typeof createLoadSkillTool>, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute(args, { toolCallId: 'c1' });
  expect(result.isError).toBeFalsy();
  return (result.content[0] as { type: 'text'; text: string }).text;
}

/** 执行工具并断言错误回执文本（文本回执不 throw——模型可读可自纠） */
async function runError(tool: ReturnType<typeof createLoadSkillTool>, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute(args, { toolCallId: 'c1' });
  expect(result.isError).toBe(true);
  return (result.content[0] as { type: 'text'; text: string }).text;
}

describe('load_skill 全文装载', () => {
  it('全文回执与显式激活包装同形同源（具名块机器单源）', async () => {
    const s = skill();
    const tool = createLoadSkillTool({ registry: await registryOf([s]) });
    const text = await runText(tool, { name: 'demo' });
    expect(text).toBe(formatSkillInvocation(s)); // (b) 无参激活形 ≡ (a) 全文回执
    expect(text).toContain('<skill name="demo" location="/w/.agents/skills/demo/SKILL.md">');
    expect(text).toContain('引用相对路径以 /w/.agents/skills/demo 为根解析。');
    expect(text).toContain('| **Full** | 全 |');
  });

  it('name 未命中复用 SKILLS_NOT_FOUND——回执指路清单不内联', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runError(tool, { name: 'nope' });
    expect(text).toContain('[SKILLS_NOT_FOUND]');
    expect(text).toContain('nope');
    expect(text).toContain('<available_skills>');
  });

  it('disable-model-invocation 件拒载并指路用户显式通道', async () => {
    const tool = createLoadSkillTool({
      registry: await registryOf([skill({ disableModelInvocation: true })]),
    });
    const text = await runError(tool, { name: 'demo' });
    expect(text).toContain('disable-model-invocation');
    expect(text).toContain('/skill:demo');
  });
});

describe('load_skill 节级寻址', () => {
  it('节命中——按层级重建标题行 + 节正文', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runText(tool, { name: 'demo', section: '模式' });
    expect(text).toContain('# 模式');
    expect(text).toContain('| **Lite** | 快 |');
    expect(text).not.toContain('# 总则');
    expect(text).not.toContain('通用规则');
  });

  it('嵌套节命中——祖先层号自 level−1 递降（跳级下限 1）', async () => {
    const s = skill({
      content: '# A\n\na 正文\n\n### C\nc 正文\n',
    });
    const tool = createLoadSkillTool({ registry: await registryOf([s]) });
    const text = await runText(tool, { name: 'demo', section: 'A > C' });
    expect(text).toContain('# A');
    expect(text).toContain('### C');
    expect(text).toContain('c 正文');
  });

  it('节未命中——列全部可寻址 path（指路而非裸拒）', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runError(tool, { name: 'demo', section: '不存在' });
    expect(text).toContain('未命中');
    expect(text).toContain('- 总则');
    expect(text).toContain('- 模式');
  });

  it('节歧义——列命中项带行号（报错不猜）', async () => {
    const s = skill({ content: '# 同名\n\n一\n\n# 其他\n\nx\n\n# 同名\n\n二\n' });
    const tool = createLoadSkillTool({ registry: await registryOf([s]) });
    const text = await runError(tool, { name: 'demo', section: '同名' });
    expect(text).toContain('歧义');
    expect(text).toMatch(/同名（L\d）/);
  });
});

describe('load_skill 行级过滤', () => {
  it('mode 命中词表——只保留当前模式行（普通规则行原样）', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runText(tool, { name: 'demo', mode: 'lite' });
    expect(text).toContain('- lite: "轻跑示例"');
    expect(text).not.toContain('| **Full** |');
    expect(text).not.toContain('- full:');
    expect(text).toContain('收尾。'); // 非模式行原样保留
  });

  it('mode 大小写与空白归一（与 filterSkillBody 比对同源）', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runText(tool, { name: 'demo', mode: '  Lite ' });
    expect(text).toContain('| **Lite** | 快 |');
    expect(text).not.toContain('| **Full** |');
  });

  it('词表空（单形在场不入词表）——原样回执 + 就地注明', async () => {
    const s = skill({
      content: '# 表\n\n| **Version** | 1 |\n\n普通规则行。\n',
    });
    const tool = createLoadSkillTool({ registry: await registryOf([s]) });
    const text = await runText(tool, { name: 'demo', mode: 'version' });
    expect(text).toContain('未推导出模式词表');
    expect(text).toContain('未生效');
    expect(text).toContain('| **Version** | 1 |'); // 原样（单形不入词表防误杀）
  });

  it('mode 不在词表——拒并列词表', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    const text = await runError(tool, { name: 'demo', mode: 'ultra' });
    expect(text).toContain('不在词表');
    expect(text).toContain('lite');
    expect(text).toContain('full');
  });

  it('mode + section 组合——词表随节重推导（推导域 = 待回执内容自身）', async () => {
    const tool = createLoadSkillTool({ registry: await registryOf([skill()]) });
    // 「总则」节无双形标签 → 词表空 → 原样 + 注明（诚实无操作非拒）
    const text = await runText(tool, { name: 'demo', section: '总则', mode: 'lite' });
    expect(text).toContain('未推导出模式词表');
    expect(text).toContain('通用规则。');
    // 「模式」节有双形标签 → 词表非空 → 正常过滤
    const filtered = await runText(tool, { name: 'demo', section: '模式', mode: 'lite' });
    expect(filtered).toContain('- lite: "轻跑示例"');
    expect(filtered).not.toContain('| **Full** |');
  });
});
