/**
 * host/live-completions 测试 — 活体值补全源（挂账解挂批 2026-09-15）。
 *
 * 覆盖：/plugins 四动词尾参位（装载面已受理集 = activated ∪ skipped 每查询
 * 现取）、/rewind preview|restore 尾参位（回退点清单异步形 R6 union 协议）、
 * 位外/null 回退（静态面不动）、依赖缺席诚实缺席、空清单诚实空。
 */
import { describe, expect, it } from 'vitest';
import { liveCommandArgumentItems, type LiveCompletionDeps } from './live-completions.js';

/** 装载面报告取值器速记（每查询现取——换代表即新投影的活体面） */
function reportDeps(activated: readonly string[], skipped: readonly string[] = []): LiveCompletionDeps {
  return {
    pluginReport: () => ({
      activated: activated.map((id) => ({ id })),
      skipped: skipped.map((id) => ({ id, reason: 'disabled' })),
    }),
  };
}

/** 回退点清单取值器速记（异步形——R6 union 协议 Promise 腿） */
function rewindDeps(ids: readonly string[]): LiveCompletionDeps {
  return { rewindManifests: () => Promise.resolve(ids.map((id) => ({ id }))) };
}

describe('liveCommandArgumentItems 插件 id 位（/plugins mount|unmount|toggle|config <id>）', () => {
  it('已受理集 = activated ∪ skipped 每查询现取（failed 不入可操作面）', () => {
    let activated = ['alpha', 'beta'];
    const deps = {
      pluginReport: () => ({
        activated: activated.map((id) => ({ id })),
        skipped: [{ id: 'gamma', reason: 'disabled（启用行禁用位）' }],
      }),
    };
    // 四动词同一位（mount/unmount/toggle/config 尾参位）
    for (const verb of ['mount', 'unmount', 'toggle', 'config']) {
      const items = liveCommandArgumentItems('plugins', '', [verb], deps);
      expect(items).not.toBeNull();
      expect((items as unknown as { label: string; replacement: string }[]).map((x) => x.replacement)).toEqual([
        'alpha ',
        'beta ',
        'gamma ',
      ]);
    }
    // 活体：换代（reload）后同位现取即新投影——不缓存
    activated = ['alpha'];
    const after = liveCommandArgumentItems('plugins', '', ['mount'], deps) as unknown as {
      replacement: string;
    }[];
    expect(after.map((x) => x.replacement)).toEqual(['alpha ', 'gamma ']);
  });

  it('fuzzy 过滤与静态面同判据（子序列 + 前缀命中）', () => {
    const items = liveCommandArgumentItems('plugins', 'al', ['mount'], reportDeps(['alpha', 'galaxy'])) as unknown as {
      label: string;
    }[];
    expect(items.map((x) => x.label)).toEqual(['alpha', 'galaxy']); // 均含子序列 al
    const prefixOnly = liveCommandArgumentItems(
      'plugins',
      'ga',
      ['config'],
      reportDeps(['alpha', 'galaxy']),
    ) as unknown as {
      label: string;
    }[];
    expect(prefixOnly.map((x) => x.label)).toEqual(['galaxy']);
  });

  it('位外形 null 回退静态面：子动词首参位 / list 尾参不补 / 非两命令 / 深位', () => {
    const deps = { ...reportDeps(['alpha']), ...rewindDeps(['r1']) };
    expect(liveCommandArgumentItems('plugins', 'mo', [], deps)).toBeNull(); // 首参子动词位归静态源
    expect(liveCommandArgumentItems('plugins', '', ['list'], deps)).toBeNull(); // list 无尾参
    expect(liveCommandArgumentItems('rewind', '', ['list'], deps)).toBeNull();
    expect(liveCommandArgumentItems('approval', '', ['preset'], deps)).toBeNull(); // 静态命令不在活体面
    expect(liveCommandArgumentItems('plugins', '', ['mount', 'x'], deps)).toBeNull(); // 深位不补
  });

  it('依赖缺席与空清单诚实空（缺席 null 归静态；受理空 [] 弹层不显）', () => {
    expect(liveCommandArgumentItems('plugins', '', ['mount'], {})).toBeNull(); // 报告源缺席 = 诚实缺席
    expect(liveCommandArgumentItems('plugins', '', ['mount'], reportDeps([]))).toEqual([]);
    expect(liveCommandArgumentItems('rewind', '', ['restore'], {})).toBeNull();
  });
});

describe('liveCommandArgumentItems 回退点 id 位（/rewind preview|restore <id>）', () => {
  it('异步形（Promise 腿——R6 union 协议）：全 id 作 replacement、短形 label 呈现对齐 /rewind list', async () => {
    const outcome = liveCommandArgumentItems(
      'rewind',
      '',
      ['restore'],
      rewindDeps(['full-id-aaaaaaaa', 'full-id-bbbbbbbb']),
    );
    expect(outcome).toBeInstanceOf(Promise); // union 协议异步腿
    const items = (await outcome) as unknown as { label: string; replacement: string }[];
    expect(items.map((x) => x.replacement)).toEqual(['full-id-aaaaaaaa ', 'full-id-bbbbbbbb ']); // 全 id 尾空格（loadManifest 吃全 id）
    expect(items.map((x) => x.label)).toEqual(['full-id-…', 'full-id-…']); // 短形呈现（列表对齐——8 位截形）
  });

  it('preview 同位同源；help 位不补', async () => {
    const outcome = liveCommandArgumentItems('rewind', '', ['preview'], rewindDeps(['xyz-id']));
    const items = (await outcome) as unknown as { replacement: string }[];
    expect(items.map((x) => x.replacement)).toEqual(['xyz-id ']);
    expect(liveCommandArgumentItems('rewind', '', ['help'], rewindDeps(['xyz-id']))).toBeNull();
  });

  it('空清单诚实空（异步空）', async () => {
    const outcome = await liveCommandArgumentItems('rewind', '', ['restore'], rewindDeps([]));
    expect(outcome).toEqual([]);
  });
});

describe('liveCommandArgumentItems 会话 id 位（/export|/resume 首参——2026-10-01 自 tui-entry 装配闭包迁入）', () => {
  /** 会话清单取值器速记（manager 全量行结构子集形——id + 展示题两键） */
  function sessionDeps(
    rows: readonly { id: string; title?: string; firstQuestionSummary?: string }[],
  ): LiveCompletionDeps {
    return { sessionRows: () => rows };
  }

  const rows = [
    { id: 'sess-aaaaaaaaaa1', title: '显式题', firstQuestionSummary: '首问快照' },
    { id: 'short1', firstQuestionSummary: '快照兜底题' },
    { id: 'sess-aaaaaaaaaa3' }, // 两键全缺席——detail 不造行
  ];

  it('export 与 resume 同源同位：全 id replacement 尾空格 + 8 位截形 label + detail 合并单源', () => {
    for (const command of ['export', 'resume']) {
      const items = liveCommandArgumentItems(command, '', [], sessionDeps(rows)) as unknown as {
        label: string;
        detail?: string;
        replacement: string;
      }[];
      // 全 id 尾空格（导出/续接消费面吃全 id——label 才是截形）
      expect(items.map((x) => x.replacement)).toEqual(['sess-aaaaaaaaaa1 ', 'short1 ', 'sess-aaaaaaaaaa3 ']);
      // 8 位截形（与回退点 id 同判据）；短 id 原样
      expect(items.map((x) => x.label)).toEqual(['sess-aaa…', 'short1', 'sess-aaa…']);
      // detail = 展示题读路合并单源（05 §9 v13 分家③——显式题优先/快照兜底/缺席不造键）
      expect(items[0]!.detail).toBe('显式题');
      expect(items[1]!.detail).toBe('快照兜底题');
      expect('detail' in items[2]!).toBe(false);
    }
  });

  it('fuzzy 过滤 + 活体现取（清单换代即新投影——不缓存）', () => {
    let current: readonly { id: string; title?: string; firstQuestionSummary?: string }[] = rows;
    const deps = { sessionRows: () => current };
    const filtered = liveCommandArgumentItems('export', 'short', [], deps) as unknown as {
      replacement: string;
    }[];
    expect(filtered.map((x) => x.replacement)).toEqual(['short1 ']); // 子序列过滤
    current = [{ id: 'new-only', title: '换代' }];
    const after = liveCommandArgumentItems('resume', '', [], deps) as unknown as { replacement: string }[];
    expect(after.map((x) => x.replacement)).toEqual(['new-only ']); // 每查询现取
  });

  it('位外与缺席：深位/非两命令 null 归静态面；清单源缺席诚实缺席；空清单诚实空', () => {
    expect(liveCommandArgumentItems('export', 'x', ['leftover-arg'], sessionDeps(rows))).toBeNull(); // 深位（首参已定）不补
    expect(liveCommandArgumentItems('sessions', '', [], sessionDeps(rows))).toBeNull(); // 非两命令（/sessions 无尾参补全）
    expect(liveCommandArgumentItems('export', '', [], {})).toBeNull(); // 清单源缺席 = 诚实缺席
    expect(liveCommandArgumentItems('resume', '', [], sessionDeps([]))).toEqual([]); // 空清单诚实空
  });
});
