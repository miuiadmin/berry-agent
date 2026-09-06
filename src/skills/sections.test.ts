/**
 * 渐进披露第三层细化三件测试（06 §11.3 细化①②③——纯逻辑零 FS）。
 *
 * 回归锁重点：fence 内 `#` 非标题（同字符闭栏——带 info 串的开栏行不闭栏）；
 * 空节 endLine = 标题行自身；findSkillSection 歧义报错不猜、未命中指路；
 * filterSkillBody 引号判据（普通规则行绝不误杀——ponytail 实测教训）。
 */
import { describe, expect, it } from 'vitest';
import { filterSkillBody, findSkillSection, splitSkillSections } from './sections.js';

describe('splitSkillSections 切节', () => {
  it('级别嵌套——祖先路径以 > 连接', () => {
    const body = '# Mode 3\n\n## Workflow\n\n步骤。\n\n## Checks\n\n检查。\n';
    const sections = splitSkillSections(body);
    expect(sections.map((s) => s.path)).toEqual(['Mode 3', 'Mode 3 > Workflow', 'Mode 3 > Checks']);
    expect(sections.map((s) => s.level)).toEqual([1, 2, 2]);
  });

  it('同级回退——H3 后遇 H2 只弹到 H2（H1 兄弟可并存）', () => {
    const body = '# A\n\n## B\n\n### C\n\n## D\n\ntext\n';
    const sections = splitSkillSections(body);
    expect(sections.map((s) => s.path)).toEqual(['A', 'A > B', 'A > B > C', 'A > D']);
  });

  it('行号区间——startLine/endLine 覆盖正文末行（空节 = 标题行自身）', () => {
    const body = '# A\nline1\nline2\n# B\n';
    const sections = splitSkillSections(body);
    const a = sections[0];
    const b = sections[1];
    expect(a?.startLine).toBe(1);
    expect(a?.endLine).toBe(3); // line2 是 1 起第 3 行——回归锁（曾恒塌缩为 startLine）
    expect(a?.body).toBe('line1\nline2');
    expect(b?.startLine).toBe(4);
    expect(b?.endLine).toBe(4); // 空节 = 标题行自身
    expect(b?.body).toBe('');
  });

  it('fence 内 # 非标题——且带 info 串的开栏行不闭栏（同字符闭栏）', () => {
    const body = '# A\n\n```js\n# not a heading\nconst x = 1;\n```\n\ntail\n';
    const sections = splitSkillSections(body);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toContain('# not a heading');
    expect(sections[0]?.body).toContain('tail');
  });

  it('~~~ 块内 ``` 行是内容不闭栏（同字符律双向）', () => {
    const body = '# A\n\n~~~\n```\ninside\n~~~\n\nafter\n';
    const sections = splitSkillSections(body);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.body).toContain('```\ninside');
  });

  it('首个标题前的引导文本不产节（不丢内容——正文随全文在场）', () => {
    const body = 'intro text\n\n# A\n\nbody\n';
    const sections = splitSkillSections(body);
    expect(sections.map((s) => s.path)).toEqual(['A']);
  });

  it('空正文 → 零节', () => {
    expect(splitSkillSections('')).toEqual([]);
    expect(splitSkillSections('纯文本无标题\n')).toEqual([]);
  });
});

describe('findSkillSection 节级寻址', () => {
  const body = '# Mode 3\n\n## Workflow\n\n步骤。\n\n## Notes\n\n注。\n';

  it('命中——返回节', () => {
    const found = findSkillSection(body, 'Mode 3 > Workflow');
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.section.body).toContain('步骤');
  });

  it('未命中——candidates 全部可寻址 path 指路', () => {
    const found = findSkillSection(body, 'Mode 9 > None');
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe('not-found');
      expect(found.candidates).toEqual(['Mode 3', 'Mode 3 > Workflow', 'Mode 3 > Notes']);
    }
  });

  it('歧义（同父同名兄弟）——报错不猜 + 候选带 L 行号', () => {
    const dup = '# A\n\n## Step\n\n一\n\n## Step\n\n二\n';
    const found = findSkillSection(dup, 'A > Step');
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.reason).toBe('ambiguous');
      expect(found.candidates).toHaveLength(2);
      expect(found.candidates[0]).toContain('L3');
      expect(found.candidates[1]).toContain('L7');
    }
  });
});

describe('filterSkillBody 行级过滤（ponytail 形）', () => {
  const modes = ['lite', 'full'];

  it('强度表行按模式裁剪——非当前模式的表行出局', () => {
    const body = '| **lite** | 快 |\n| **full** | 全 |\n| **other** | 他 |\n普通行\n';
    const filtered = filterSkillBody(body, { modes, active: 'lite' });
    expect(filtered).toContain('| **lite** | 快 |');
    expect(filtered).not.toContain('| **full** |');
    expect(filtered).toContain('| **other** | 他 |'); // 非模式词汇的表行原样保留
    expect(filtered).toContain('普通行');
  });

  it('带引号示例行按模式裁剪——引号是判据的一部分', () => {
    const body = '- lite: "fast mode"\n- full: "all mode"\n- plain: no quotes here\n';
    const filtered = filterSkillBody(body, { modes, active: 'full' });
    expect(filtered).toContain('- full: "all mode"');
    expect(filtered).not.toContain('- lite:');
    expect(filtered).toContain('- plain: no quotes here'); // 无引号 = 普通规则行绝不误杀
  });

  it('大小写与空白归一——标签 trim+小写比对', () => {
    const body = '| **Lite** | x |\n| **FULL** | y |\n';
    const filtered = filterSkillBody(body, { modes, active: 'full' });
    expect(filtered).not.toContain('Lite');
    expect(filtered).toContain('| **FULL** | y |');
  });

  it('无模式行正文原样往返', () => {
    const body = '# T\n\n- a: "quoted"\n';
    expect(filterSkillBody(body, { modes: [], active: 'x' })).toBe(body);
  });
});
