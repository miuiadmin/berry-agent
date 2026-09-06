/**
 * frontmatter 解析与单文件装载测试（06 §11.2/§11.3 护栏①——纯逻辑零 FS）。
 *
 * 装载层宽容度语义锁：校验失败一律警告 + 处置（截断/丢弃/跳过）不抛——坏文件
 * 不炸装载；唯一拒载 = description 缺席（清单行依据）与 frontmatter 不可解析。
 */
import { describe, expect, it } from 'vitest';
import { loadSkillFromText, parseSkillFrontmatter, validateSkillName } from './frontmatter.js';
import { SKILL_DESCRIPTION_MAX, SKILL_PROVENANCE_MEMORIES_MAX } from './types.js';

/** 标准好形全文（name 与父目录同名） */
const GOOD = (extra = ''): string =>
  `---\nname: demo\ndescription: 演示技能\n${extra}---\n\n正文首段。\n\n## 用法\n\n步骤一。\n`;

describe('parseSkillFrontmatter 解析', () => {
  /** 标准好形正文（闭合 --- 后空行 + 正文——pi 物化形） */
  const GOOD_BODY = '\n正文首段。\n\n## 用法\n\n步骤一。\n';

  it('标准形——frontmatter 映射 + 正文 + bodyStart 锚', () => {
    const parsed = parseSkillFrontmatter(GOOD());
    expect('error' in parsed).toBe(false);
    if (!('error' in parsed)) {
      expect(parsed.frontmatter['name']).toBe('demo');
      expect(parsed.frontmatter['description']).toBe('演示技能');
      expect(parsed.body.startsWith('\n正文首段。')).toBe(true);
      // bodyStart 必须精确落在闭合行换行之后（patch 替换域锚——回归锁）
      expect(GOOD().slice(parsed.bodyStart)).toBe(parsed.body);
    }
  });

  it('BOM 剥离（U+FEFF——charCode 判不嵌字面量）', () => {
    const bom = String.fromCodePoint(0xfeff);
    const parsed = parseSkillFrontmatter(bom + GOOD());
    expect('error' in parsed).toBe(false);
  });

  it('CRLF/CR 统一 LF（bodyStart 在归一化坐标上）', () => {
    const crlf = GOOD().replace(/\n/g, '\r\n');
    const parsed = parseSkillFrontmatter(crlf);
    expect('error' in parsed).toBe(false);
    if (!('error' in parsed)) {
      expect(parsed.body).toBe(GOOD_BODY);
    }
  });

  it('未闭合 frontmatter → 错误', () => {
    const parsed = parseSkillFrontmatter('---\nname: demo\n');
    expect('error' in parsed).toBe(true);
  });

  it('坏 YAML → 错误', () => {
    const parsed = parseSkillFrontmatter('---\nname: [unclosed\n---\n\n正文\n');
    expect('error' in parsed).toBe(true);
  });

  it('非映射（数组顶层）→ 错误', () => {
    const parsed = parseSkillFrontmatter('---\n- a\n- b\n---\n\n正文\n');
    expect('error' in parsed).toBe(true);
  });

  it('空 frontmatter（--- 紧邻 ---）→ 空映射非错误、正文保留（description 判在装载层）', () => {
    const parsed = parseSkillFrontmatter('---\n---\n\n正文\n');
    expect('error' in parsed).toBe(false);
    if (!('error' in parsed)) {
      expect(parsed.frontmatter).toEqual({});
      expect(parsed.body).toBe('\n正文\n');
    }
  });

  it('字面 null 头 → 空映射续走、正文保留', () => {
    const parsed = parseSkillFrontmatter('---\nnull\n---\n\n正文\n');
    expect('error' in parsed).toBe(false);
    if (!('error' in parsed)) {
      expect(parsed.frontmatter).toEqual({});
      expect(parsed.body).toBe('\n正文\n');
    }
  });
});

describe('validateSkillName 词法', () => {
  it('合法名过', () => {
    expect(validateSkillName('demo')).toEqual([]);
    expect(validateSkillName('plugins-quickstart')).toEqual([]);
    expect(validateSkillName('a1-b2')).toEqual([]);
  });
  it('超长/大写/首尾连字符/连续连字符各报', () => {
    expect(validateSkillName('a'.repeat(65))).toHaveLength(1);
    expect(validateSkillName('Demo')).toHaveLength(1);
    expect(validateSkillName('-demo')).toHaveLength(1);
    expect(validateSkillName('demo-')).toHaveLength(1);
    expect(validateSkillName('de--mo')).toHaveLength(1);
  });
});

describe('loadSkillFromText 装载链', () => {
  const ctx = { filePath: '/w/.agents/skills/demo/SKILL.md', providerId: 'project' };

  it('好形装载——sections 骨架在场、content trim、隐藏旗 false', () => {
    const loaded = loadSkillFromText(GOOD(), ctx);
    expect(loaded.skill).toBeDefined();
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skill?.name).toBe('demo');
    expect(loaded.skill?.baseDir).toBe('/w/.agents/skills/demo');
    expect(loaded.skill?.disableModelInvocation).toBe(false);
    expect(loaded.skill?.sections.map((s) => s.path)).toEqual(['用法']);
  });

  it('description 缺席 → 拒载（唯一硬条件）+ invalid-metadata', () => {
    const loaded = loadSkillFromText('---\nname: demo\n---\n\n正文\n', ctx);
    expect(loaded.skill).toBeUndefined();
    expect(loaded.diagnostics[0]?.type).toBe('invalid-metadata');
    expect(loaded.diagnostics[0]?.message).toContain('description');
  });

  it('description 超 1024 → 截断装载 + 诊断注明已截断（护栏①）', () => {
    const long = 'x'.repeat(SKILL_DESCRIPTION_MAX + 10);
    const loaded = loadSkillFromText(`---\nname: demo\ndescription: ${long}\n---\n\n正文\n`, ctx);
    expect(loaded.skill?.description).toHaveLength(SKILL_DESCRIPTION_MAX);
    expect(loaded.diagnostics.some((d) => d.type === 'invalid-metadata' && d.message.includes('已截断'))).toBe(true);
  });

  it('name 缺席 → 回落父目录基名装载', () => {
    const loaded = loadSkillFromText('---\ndescription: 演示\n---\n\n正文\n', ctx);
    expect(loaded.skill?.name).toBe('demo');
  });

  it('name 词法违例与不同名 → 警告不拒载（name 是身份键不截断）', () => {
    const loaded = loadSkillFromText('---\nname: Demo\ndescription: 演示\n---\n\n正文\n', ctx);
    expect(loaded.skill?.name).toBe('Demo');
    const messages = loaded.diagnostics.map((d) => d.message).join('\n');
    expect(messages).toContain('非法字符');
    expect(messages).toContain('父目录不同名');
  });

  it('provenance 四形：好形留存 / 非对象拒 / memories 非串数组拒 / 超 50 拒——后三者丢弃+诊断', () => {
    const mk = (fm: string) => loadSkillFromText(`---\nname: demo\ndescription: d\n${fm}---\n\n正文\n`, ctx);
    expect(mk('provenance:\n  memories: [m1, m2]\n').skill?.provenance).toEqual({ memories: ['m1', 'm2'] });
    expect(mk('provenance: 42\n').skill?.provenance).toBeUndefined();
    expect(mk('provenance:\n  memories: [1, 2]\n').skill?.provenance).toBeUndefined();
    expect(
      mk(
        `provenance:\n  memories: [${Array.from({ length: SKILL_PROVENANCE_MEMORIES_MAX + 1 }, (_, i) => `m${i}`).join(', ')}]\n`,
      ).skill?.provenance,
    ).toBeUndefined();
    expect(mk('provenance: 42\n').diagnostics.some((d) => d.message.includes('provenance'))).toBe(true);
  });

  it('metadata 非对象 → 警告+丢弃；对象形留存', () => {
    const mk = (fm: string) => loadSkillFromText(`---\nname: demo\ndescription: d\n${fm}---\n\n正文\n`, ctx);
    expect(mk('metadata: [1]\n').skill?.metadata).toBeUndefined();
    expect(mk('metadata: [1]\n').diagnostics.some((d) => d.message.includes('metadata'))).toBe(true);
    expect(mk('metadata:\n  theme: dark\n').skill?.metadata).toEqual({ theme: 'dark' });
  });

  it('disable-model-invocation 严格 === true 判（字符串 true 不算）', () => {
    const strict = loadSkillFromText(GOOD('disable-model-invocation: true\n'), ctx);
    expect(strict.skill?.disableModelInvocation).toBe(true);
    const loose = loadSkillFromText(GOOD('disable-model-invocation: "true"\n'), ctx);
    expect(loose.skill?.disableModelInvocation).toBe(false);
  });

  it('未采用字段（license 等）静默忽略——不产诊断', () => {
    const loaded = loadSkillFromText(GOOD('license: MIT\nallowed-tools: [read]\n'), ctx);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.skill?.metadata).toBeUndefined();
  });
});
