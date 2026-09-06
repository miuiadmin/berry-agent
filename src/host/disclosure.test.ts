/**
 * host/disclosure 契约测试——环境披露段五件组装（04 §environment 披露段）。
 *
 * 渲染器纯函数逐路：恒三件在场 / git·插件行缺席省略 / 全缺 → null /
 * 插件计数行钉形「插件 N 个（启用 M · 失败 F）」。
 */
import { describe, expect, it } from 'vitest';

import { collectDate, collectPlatform, renderEnvironmentDisclosure } from './disclosure.js';

describe('renderEnvironmentDisclosure', () => {
  it('五件全在场 → 完整块（标签包裹 + 插件计数行钉形）', () => {
    const text = renderEnvironmentDisclosure({
      platform: 'darwin 27.0.0',
      cwd: '/repo',
      date: '2026-09-07',
      gitSummary: 'dev 3 脏',
      plugins: { total: 3, enabled: 2, failed: 1 },
    });
    expect(text).not.toBeNull();
    expect(text).toContain('<environment>');
    expect(text).toContain('- 平台: darwin 27.0.0');
    expect(text).toContain('- 工作目录: /repo');
    expect(text).toContain('- 日期: 2026-09-07');
    expect(text).toContain('- git: dev 3 脏');
    expect(text).toContain('- 插件: 3 个（启用 2 · 失败 1）'); // 04 篇钉形逐字
    expect(text).toContain('</environment>');
  });

  it('git/plugins 缺席（null/undefined）→ 行省略、块仍在', () => {
    const text = renderEnvironmentDisclosure({ platform: 'linux 6.1', cwd: '/w', date: '2026-09-07' });
    expect(text).not.toBeNull();
    expect(text).toContain('- 平台: linux 6.1');
    expect(text).not.toContain('- git:');
    expect(text).not.toContain('- 插件:');
  });

  it('gitSummary 空串 = 无摘要 → 行省略（与 null 同义）', () => {
    const text = renderEnvironmentDisclosure({ platform: 'linux 6.1', gitSummary: '' });
    expect(text).toContain('- 平台: linux 6.1'); // 块仍因恒件在场
    expect(text).not.toContain('- git:');
  });

  it('五件全缺席 → null（无披露段——注入面零强求）', () => {
    expect(renderEnvironmentDisclosure({})).toBeNull();
    expect(renderEnvironmentDisclosure({ gitSummary: null, plugins: null })).toBeNull();
  });
});

describe('采集助手', () => {
  it('collectPlatform：platform + release 拼接', () => {
    expect(collectPlatform(() => '6.1.0', 'linux')).toBe('linux 6.1.0');
  });

  it('collectDate：本地时区 YYYY-MM-DD（月日补零）', () => {
    // 2026-09-07 本地（月日个位数补零路径）
    expect(collectDate(() => new Date(2026, 8, 7))).toBe('2026-09-07');
    expect(collectDate(() => new Date(2026, 0, 31))).toBe('2026-01-31');
  });
});
