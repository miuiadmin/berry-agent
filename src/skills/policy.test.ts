/**
 * 策略闸测试（06 §11.4 机器闸条款——正文中的文件指针必须可解析 + 文档策略
 * 机械可断言子集）。
 *
 * 三面：
 * ①指针闸本体——fixture 证明闸会咬（缺目标 → 违例清单非空；全在场 → 空）；
 * ②出厂技能目录在场时——全部 SKILL.md 可装载零诊断（目录缺席 = skipIf 不失
 *   信：07 出厂清单定名批落目录后此例自动生效）；
 * ③文档策略——公开文档面禁旧 env 前缀 `APP_*`（07 环境节：一律 BERRY_AGENT_*）
 *   与旧数据目录形 `~/.berry/`（须 `~/.berry-agent`）；2026-09-13 全面复盘对拍
 *   批增锁五面（审批旧名 allowlist 禁词 / effect 契约缺省 exec / llm 子键非
 *   保留位 / 使用册模型工具面名册 / 架构册副屏族与 CCR 职责——复盘发现
 *   1/9/14/17/18/21/22/31 的机械可断言子集）——语境依赖条文归人面审校，本闸
 *   只锁机械可断言子集（词表真源 02 §5.2）。
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

  it('禁审批旧名 allowlist（更名 tool-policy——2026-09-11 审批分档批；docs 面零合法用例）', async ({ skip }) => {
    const docs = await publicDocs();
    if (docs.length === 0) skip('无公开文档在场');
    for (const doc of docs) {
      const text = await readFile(doc, 'utf8');
      const hits = text.match(/allowlist/gi) ?? [];
      expect(hits, `${doc} 残留审批旧名 ${hits.join(', ')}——改 tool-policy`).toEqual([]);
    }
  });

  it('插件开发册 effect 契约对拍（三值 + 缺省 exec——04 §9 定形块②）', async ({ skip }) => {
    const path = 'docs/plugin-development.md';
    if (!existsSync(path)) skip('插件开发册缺席');
    const text = await readFile(path, 'utf8');
    // 缺省 exec（未知缺省最危律）必须在册；旧「'read'（缺省）」措辞即失真
    expect(text.includes('缺省 exec'), 'effect 缺省档失真——须明示缺省 exec').toBe(true);
    expect(text.includes("'read'（缺省）"), 'effect 缺省 read 旧契约残句').toBe(false);
  });

  it('插件开发册虚拟子键对拍（berry-agent/llm 已接 provider 窄面非保留位）', async ({ skip }) => {
    const path = 'docs/plugin-development.md';
    if (!existsSync(path)) skip('插件开发册缺席');
    const text = await readFile(path, 'utf8');
    expect(text.includes('两子键为保留位'), 'llm 子键保留位旧说残句（eco-1 已接 providerApiFace）').toBe(false);
  });

  it('使用册模型工具面名册对拍（plugin_* 八件 + ccr_retrieve 在场）', async ({ skip }) => {
    const path = 'docs/usage.md';
    if (!existsSync(path)) skip('使用册缺席');
    const text = await readFile(path, 'utf8');
    for (const tool of ['plugins_list', 'events_query', 'plugin_update', 'ccr_retrieve']) {
      expect(text.includes(tool), `使用册模型工具面缺 ${tool} 词条`).toBe(true);
    }
  });

  it('架构册副屏族与压缩职责对拍（/memory 副屏 + CCR 职责行在场）', async ({ skip }) => {
    const path = 'docs/architecture.md';
    if (!existsSync(path)) skip('架构册缺席');
    const text = await readFile(path, 'utf8');
    expect(text.includes('/memory'), '架构册副屏族漏 /memory').toBe(true);
    expect(text.includes('ccr_retrieve'), '架构册 compaction 职责行漏 CCR').toBe(true);
  });
});
