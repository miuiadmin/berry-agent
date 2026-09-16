/**
 * host/plugin-market/classify 测试——源分类五规则序（§9.6 源清单与缓存节；
 * adopt omp classifySource 形）+ github 短手展开 + `~/` 展开纯函数。
 */
import { describe, expect, it } from 'vitest';

import { classifyMarketplaceSource, expandGitUri, expandHomePath, githubShorthandToUrl } from './classify.js';

describe('源分类五规则序（首中即胜——协议/模式检查先于路径检查）', () => {
  it('规则 1：https/http + .json 尾 → url', () => {
    expect(classifyMarketplaceSource('https://example.com/cat.json')).toEqual({ ok: true, sourceType: 'url' });
    expect(classifyMarketplaceSource('http://example.com/cat.json')).toEqual({ ok: true, sourceType: 'url' });
  });

  it('规则 1：https/http 非 .json 尾 → git（含坏 URL 串兜底 git）', () => {
    expect(classifyMarketplaceSource('https://github.com/owner/repo')).toEqual({ ok: true, sourceType: 'git' });
    expect(classifyMarketplaceSource('https://github.com/owner/repo.git')).toEqual({ ok: true, sourceType: 'git' });
    // URL 构造抛（https 空 host 形）→ 兜底 git（omp 同形）
    expect(classifyMarketplaceSource('https:///no-host/x')).toEqual({ ok: true, sourceType: 'git' });
  });

  it('规则 2：git@ / ssh:// → git（先于路径判——防 Windows 误判 local）', () => {
    expect(classifyMarketplaceSource('git@github.com:owner/repo.git')).toEqual({ ok: true, sourceType: 'git' });
    expect(classifyMarketplaceSource('ssh://git@github.com/owner/repo.git')).toEqual({ ok: true, sourceType: 'git' });
  });

  it('规则 3：owner/repo 短手恰一斜线 → github（大小写宽容）', () => {
    expect(classifyMarketplaceSource('owner/repo')).toEqual({ ok: true, sourceType: 'github' });
    expect(classifyMarketplaceSource('Owner/Repo.name-1')).toEqual({ ok: true, sourceType: 'github' });
  });

  it('规则 4/5：./ ~/ 绝对路径 → local', () => {
    expect(classifyMarketplaceSource('./fixtures/market')).toEqual({ ok: true, sourceType: 'local' });
    expect(classifyMarketplaceSource('~/marketplaces/official')).toEqual({ ok: true, sourceType: 'local' });
    expect(classifyMarketplaceSource('/abs/path/to/market')).toEqual({ ok: true, sourceType: 'local' });
  });

  it('不识形 fail-loud：报文指路两候选（./ 相对形 与 owner/repo 短手）', () => {
    const result = classifyMarketplaceSource('plainword');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('./');
    expect(result.message).toContain('owner/repo');
    // 多段斜线非 url 形同拒
    expect(classifyMarketplaceSource('owner/repo/extra').ok).toBe(false);
  });
});

describe('github 短手展开（owner/repo → 克隆 url）', () => {
  it('.git 尾标准形', () => {
    expect(githubShorthandToUrl('owner/repo')).toBe('https://github.com/owner/repo.git');
  });

  it('坏短手（多段/空/逃逸段）抛', () => {
    expect(() => githubShorthandToUrl('a/b/c')).toThrow();
    expect(() => githubShorthandToUrl('../evil')).toThrow();
    expect(() => githubShorthandToUrl('')).toThrow();
  });
});

describe('expandHomePath（~/ 展开——home 参数注入纯函数）', () => {
  it('~/ 前缀展开到 home 根', () => {
    expect(expandHomePath('~/markets/official', '/home/u')).toBe('/home/u/markets/official');
  });

  it('非 ~/ 前缀原样直通（含绝对与相对）', () => {
    expect(expandHomePath('/abs/x', '/home/u')).toBe('/abs/x');
    expect(expandHomePath('./rel', '/home/u')).toBe('./rel');
  });
});

describe('拒绝报文消毒（mp 收尾批 sec——拒文内插 raw 串剥控制字符，CLI 终端注入前置防线）', () => {
  it('expandGitUri 拒文不携 ESC/BEL/换行（空白词法拒——报文内插 raw uri）——修前红', () => {
    // 恶意 uri 带空白进词法拒 → 报文原样内插 raw（含 ESC/BEL）——构造位单出口消毒
    const result = expandGitUri('a b\u001b]0;pwned://c');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('\u001b');
      expect(result.message).not.toContain('\u0007');
      expect(result.message).not.toContain('\n');
    }
  });

  it('classifyMarketplaceSource 不识形拒文同律——修前红', () => {
    const result = classifyMarketplaceSource('\u001b]0;?pwned');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('\u001b');
      expect(result.message).not.toContain('\n');
    }
  });

  it('正常拒形报文语义不变（回归锚——消毒不吞指路词）', () => {
    const result = classifyMarketplaceSource('owner/repo/extra');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('./');
      expect(result.message).toContain('owner/repo');
    }
  });
});
