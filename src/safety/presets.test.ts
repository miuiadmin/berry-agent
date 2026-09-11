/**
 * safety/presets 测试——权限预设打包纯数据半边（04 §9 定形块⑥·RP5——ap-3）。
 *
 * 覆盖四块：三档对拍（两旋钮值 + balanced=现状打包零变化）、建议集形状
 * （open 七条 = fs 两件工作区根前缀 + bash 五词干；conservative/balanced
 * 空集）、网络族排除（push/pull/fetch 恒不入集——§13 不因预设翻转）、
 * 机器条目形（decision 恒 allow 经正门草案两字段自证——无 reason/effect/
 * expiresAt 键）。
 */
import { describe, expect, it } from 'vitest';

import { APPROVAL_PRESETS, APPROVAL_PRESET_NAMES, approvalPresetOf, presetSuggestedEntries } from './presets.js';

describe('三档打包对拍（04 §9 ⑥定名——两旋钮静态单源）', () => {
  it('三档名册恰 conservative|balanced|open', () => {
    expect(APPROVAL_PRESET_NAMES).toEqual(['conservative', 'balanced', 'open']);
    expect(APPROVAL_PRESETS.map((p) => p.name)).toEqual([...APPROVAL_PRESET_NAMES]);
  });
  it('conservative = read-only + ask', () => {
    const preset = approvalPresetOf('conservative');
    expect(preset?.sandboxMode).toBe('read-only');
    expect(preset?.approvalPolicy).toBe('ask');
  });
  it('balanced = workspace-write + ask（缺省档 = 现状打包，零行为变化）', () => {
    const preset = approvalPresetOf('balanced');
    expect(preset?.sandboxMode).toBe('workspace-write');
    expect(preset?.approvalPolicy).toBe('ask');
  });
  it('open = workspace-write + ask（无静默审批不破——policy 闭集本无 yolo 档）', () => {
    const preset = approvalPresetOf('open');
    expect(preset?.sandboxMode).toBe('workspace-write');
    expect(preset?.approvalPolicy).toBe('ask');
  });
  it('未知名返 undefined（不抛——错误面归调用方）', () => {
    expect(approvalPresetOf('yolo')).toBeUndefined();
    expect(approvalPresetOf('')).toBeUndefined();
  });
  it('三档 description 均非空（人面呈现面）', () => {
    for (const preset of APPROVAL_PRESETS) expect(preset.description.length).toBeGreaterThan(0);
  });
});

describe('建议集展开（展开式非引用式——草案经写侧正门落盘）', () => {
  const root = '/workspace/demo';
  it('conservative/balanced 空集（零写入——切换不清不删既有条目）', () => {
    expect(presetSuggestedEntries('conservative', root)).toEqual([]);
    expect(presetSuggestedEntries('balanced', root)).toEqual([]);
  });
  it('open 七条：fs 两件工作区根前缀 + bash 五词干', () => {
    const drafts = presetSuggestedEntries('open', root);
    expect(drafts).toHaveLength(7);
    expect(drafts.filter((d) => d.tool === 'write')).toEqual([{ tool: 'write', pattern: root }]);
    expect(drafts.filter((d) => d.tool === 'edit')).toEqual([{ tool: 'edit', pattern: root }]);
    expect(drafts.filter((d) => d.tool === 'bash').map((d) => d.pattern)).toEqual([
      'git status',
      'git log',
      'git diff',
      'git show',
      'git branch',
    ]);
  });
  it('网络写动词族恒不入集（push/pull/fetch——§13 不因预设翻转，git push 恒走危险闸）', () => {
    const patterns = presetSuggestedEntries('open', root).map((d) => d.pattern);
    for (const banned of ['git push', 'git pull', 'git fetch', 'push', 'pull', 'fetch']) {
      expect(patterns).not.toContain(banned);
    }
  });
  it('机器草案形：恰两字段（tool/pattern——无 reason/effect/expiresAt 键）', () => {
    for (const draft of presetSuggestedEntries('open', root)) {
      expect(Object.keys(draft).sort()).toEqual(['pattern', 'tool']);
    }
  });
});
