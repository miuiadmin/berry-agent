/**
 * tools/apply-patch 测试 — 解析面错误形态枚举 + Update 定位语义（04 §7 edit 段）。
 *
 * 纯逻辑单元（零 fs）：解析器与应用器都是纯函数。
 */
import { describe, it, expect } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { addLinesToContent, applyUpdateLines, parseApplyPatch } from './apply-patch.js';

/** 断言补丁面拒绝码（解析/定位失败统一 FS_PATCH_FAILED） */
function expectPatchError(fn: () => unknown, messageContains?: string): void {
  expect(fn).toThrow(BaseError);
  try {
    fn();
  } catch (err) {
    const e = err as BaseError;
    expect(e.code).toBe('FS_PATCH_FAILED');
    if (messageContains !== undefined) expect(e.message).toContain(messageContains);
  }
}

describe('parseApplyPatch（解析面）', () => {
  it('标准多段补丁解析为操作列表（Update/Add/Delete 三形）', () => {
    const ops = parseApplyPatch(
      [
        '*** Begin Patch',
        '*** Update File: a.ts',
        ' context line',
        '-old line',
        '+new line',
        '*** Add File: b.txt',
        '+hello',
        '+world',
        '*** Delete File: c.md',
        '*** End Patch',
      ].join('\n'),
    );
    expect(ops).toHaveLength(3);
    expect(ops[0]).toEqual({
      kind: 'update',
      path: 'a.ts',
      lines: [
        { tag: 'context', text: 'context line' },
        { tag: 'removed', text: 'old line' },
        { tag: 'added', text: 'new line' },
      ],
    });
    expect(ops[1]).toEqual({
      kind: 'add',
      path: 'b.txt',
      lines: [
        { tag: 'added', text: 'hello' },
        { tag: 'added', text: 'world' },
      ],
    });
    expect(ops[2]).toEqual({ kind: 'delete', path: 'c.md' });
  });

  it('首行非 Begin Patch → 拒', () => {
    expectPatchError(() => parseApplyPatch('*** End Patch'), 'Begin Patch');
  });

  it('末行非 End Patch → 拒', () => {
    expectPatchError(() => parseApplyPatch('*** Begin Patch\n*** Delete File: x'), 'End Patch');
  });

  it('空补丁（零文件操作段）→ 拒', () => {
    expectPatchError(() => parseApplyPatch('*** Begin Patch\n*** End Patch'), '不含任何文件操作段');
  });

  it('未知段指令 → 拒', () => {
    expectPatchError(() => parseApplyPatch('*** Begin Patch\n*** Rename File: a b\n*** End Patch'), '未知段指令');
  });

  it('段指令之前出现行内容 → 拒', () => {
    expectPatchError(() => parseApplyPatch('*** Begin Patch\n+stray\n*** End Patch'), '之前');
  });

  it('Delete File 段后出现行内容 → 拒', () => {
    expectPatchError(
      () => parseApplyPatch('*** Begin Patch\n*** Delete File: x\n+oops\n*** End Patch'),
      '不允许行内容',
    );
  });

  it('Add File 段内出现 "-" 删除行 → 拒', () => {
    expectPatchError(
      () => parseApplyPatch('*** Begin Patch\n*** Add File: x\n+a\n-b\n*** End Patch'),
      '不允许 "-" 删除行',
    );
  });

  it('Add File 无内容行 → 拒', () => {
    expectPatchError(() => parseApplyPatch('*** Begin Patch\n*** Add File: x\n*** End Patch'), '无内容行');
  });

  it('行首无标记（非 +/-/空格）→ 拒', () => {
    expectPatchError(
      () => parseApplyPatch('*** Begin Patch\n*** Update File: x\nbare line\n*** End Patch'),
      '无行首标记',
    );
  });

  it('裸空行按空上下文行宽容收', () => {
    const ops = parseApplyPatch(['*** Begin Patch', '*** Update File: x', ' a', '', '+b', '*** End Patch'].join('\n'));
    const first = ops[0]!;
    if (first.kind !== 'update') throw new Error('应解析为 update 段');
    expect(first.lines).toEqual([
      { tag: 'context', text: 'a' },
      { tag: 'context', text: '' },
      { tag: 'added', text: 'b' },
    ]);
  });

  it('中途多余 End Patch → 拒', () => {
    expectPatchError(
      () => parseApplyPatch('*** Begin Patch\n*** End Patch\n*** Delete File: x\n*** End Patch'),
      '多余',
    );
  });
});

describe('applyUpdateLines（Update 定位与应用）', () => {
  const ctx = [{ tag: 'context' as const, text: 'keep' }];
  const del = [{ tag: 'removed' as const, text: 'gone' }];

  it('context 锚定位替换：锚行保留、删除行移除、新增行落入', () => {
    const lines = [...ctx, ...del, { tag: 'added' as const, text: 'fresh' }];
    expect(applyUpdateLines('f', 'head\nkeep\ngone\ntail', lines)).toBe('head\nkeep\nfresh\ntail');
  });

  it('多个匹配点取首个出现处（贪心首匹配）', () => {
    const lines = [...del];
    expect(applyUpdateLines('f', 'gone\nX\ngone\ngone', [...lines, { tag: 'added', text: 'once' }])).toBe(
      'once\nX\ngone\ngone',
    );
  });

  it('锚不在场 → FS_PATCH_FAILED（定位失败，文件可能已被修改）', () => {
    expectPatchError(() => applyUpdateLines('f', 'other content', [{ tag: 'context', text: 'nope' }]), '定位失败');
  });

  it('行流全 added（无定位锚）→ 拒', () => {
    expectPatchError(() => applyUpdateLines('f', 'content', [{ tag: 'added', text: 'x' }]), '无法定位');
  });

  it('尾换行保形：原文以 \n 收尾 → 产物同以 \n 收尾', () => {
    // 锚行保留 + 新增行落入：a,keep,[z],c —— 尾 \n 保形
    expect(applyUpdateLines('f', 'a\nkeep\nc\n', [...ctx, { tag: 'added', text: 'z' }])).toBe('a\nkeep\nz\nc\n');
  });

  it('无尾换行形：原文不以 \n 收尾 → 产物同形', () => {
    expect(applyUpdateLines('f', 'a\nkeep\nc', [...ctx, { tag: 'added', text: 'z' }])).toBe('a\nkeep\nz\nc');
  });
});

describe('addLinesToContent（Add 行流 → 内容）', () => {
  it('全 added join + 尾换行', () => {
    expect(
      addLinesToContent([
        { tag: 'added', text: 'one' },
        { tag: 'added', text: 'two' },
      ]),
    ).toBe('one\ntwo\n');
  });

  it('空行流 → 空串', () => {
    expect(addLinesToContent([])).toBe('');
  });
});
