/**
 * 策略闸测试（06 §11.4 机器闸条款——正文中的文件指针必须可解析 + 文档策略
 * 机械可断言子集）。
 *
 * 三面：
 * ①指针闸本体——fixture 证明闸会咬（缺目标 → 违例清单非空；全在场 → 空）；
 * ②出厂技能目录在场时——全部 SKILL.md 可装载零诊断（目录缺席 = skipIf 不失
 *   信：07 出厂清单定名批落目录后此例自动生效）；
 * ③文档策略——公开文档面禁旧 env 前缀 `APP_*`（07 环境节：一律 BERRY_AGENT_*）
 *   与旧数据目录形 `~/.berry/`（须 `~/.berry-agent`）——语境依赖条文归人面
 *   审校，本闸只锁机械可断言子集（词表真源 02 §5.2）。
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveFactorySkillsDir, scanSkillsDir } from './discovery.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

/** Markdown 链接目标提取（相对路径形——http/锚点/绝对路径不入本闸） */
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/**
 * 指针闸：正文中的相对文件引用必须可解析（相对 baseDir）。
 * 返回违例清单（空 = 全可解析）。
 */
function checkPointersResolvable(body: string, baseDir: string): string[] {
  const violations: string[] = [];
  for (const match of body.matchAll(MD_LINK_RE)) {
    const target = match[1] ?? '';
    if (/^(https?:|#|\/|mailto:)/.test(target)) continue; // 外链/锚点/绝对路径不入闸
    if (!existsSync(join(baseDir, target))) {
      violations.push(`链接目标不存在：${target}（相对 ${baseDir}）`);
    }
  }
  return violations;
}

describe('指针可解析机器闸（06 §11.4）', () => {
  it('闸会咬——缺目标的引用进违例清单', async () => {
    const root = await mkdtemp(join(tmpdir(), 'berry-policy-bite-'));
    cleanups.push(root);
    const dir = join(root, 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: demo\ndescription: d\n---\n\n见 [详细步骤](references/steps.md) 与 [缺失件](references/missing.md)。\n',
      'utf8',
    );
    await mkdir(join(dir, 'references'), { recursive: true });
    await writeFile(join(dir, 'references', 'steps.md'), '# 步骤\n', 'utf8');
    const scan = await scanSkillsDir(root, { providerId: 'test' });
    const skill = scan.skills[0];
    expect(skill).toBeDefined();
    const violations = checkPointersResolvable(skill?.content ?? '', skill?.baseDir ?? dir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('missing.md');
  });

  it('全在场——违例清单为空；外链/锚点/绝对路径不入闸', async () => {
    const root = await mkdtemp(join(tmpdir(), 'berry-policy-clean-'));
    cleanups.push(root);
    await mkdir(join(root, 'sub'), { recursive: true });
    await writeFile(join(root, 'a.md'), '# a\n', 'utf8');
    await writeFile(join(root, 'sub', 'b.md'), '# b\n', 'utf8');
    const body = '见 [a](a.md) 与 [b](sub/b.md)；[外](https://x/y)、[锚](#sec)、[绝](/abs/x.md) 不查。\n';
    expect(checkPointersResolvable(body, root)).toEqual([]);
  });

  it('出厂技能目录在场时——全部 SKILL.md 可装载零诊断', async ({ skip }) => {
    const factoryDir = resolveFactorySkillsDir();
    if (!existsSync(factoryDir)) skip('出厂技能目录未落（07 出厂清单定名批挂账）——闸暂不适用');
    const scan = await scanSkillsDir(factoryDir, { providerId: 'factory' });
    expect(scan.skills.length).toBeGreaterThan(0);
    expect(scan.diagnostics).toEqual([]);
    // 出厂件正文指针同样过闸
    for (const skill of scan.skills) {
      expect(checkPointersResolvable(skill.content, skill.baseDir)).toEqual([]);
    }
  });
});

describe('文档策略闸（公开面机械子集）', () => {
  /** 收集在场公开文档（README 恒在；docs/ 随公开面批次建——缺席不扫） */
  async function publicDocs(): Promise<string[]> {
    const paths = ['README.md'];
    if (existsSync('docs')) {
      for (const entry of await readdir('docs', { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) paths.push(join('docs', entry.name));
      }
    }
    return paths.filter((p) => existsSync(p));
  }

  it('禁旧 env 前缀 APP_*（一律 BERRY_AGENT_*——07 环境节）', async ({ skip }) => {
    const docs = await publicDocs();
    if (docs.length === 0) skip('无公开文档在场');
    for (const doc of docs) {
      const text = await readFile(doc, 'utf8');
      const hits = text.match(/APP_[A-Z]+/g) ?? [];
      expect(hits, `${doc} 残留旧 env 前缀 ${hits.join(', ')}——改 BERRY_AGENT_*`).toEqual([]);
    }
  });

  it('禁旧数据目录形 ~/.berry/（须 ~/.berry-agent）', async ({ skip }) => {
    const docs = await publicDocs();
    if (docs.length === 0) skip('无公开文档在场');
    for (const doc of docs) {
      const text = await readFile(doc, 'utf8');
      // ~/.berry 后非 -agent 即旧形（~/.berry-agent 合法）
      const hits = text.match(/~\/\.berry(?!-agent)/g) ?? [];
      expect(hits, `${doc} 残留旧数据目录形 ${hits.join(', ')}`).toEqual([]);
    }
  });
});
