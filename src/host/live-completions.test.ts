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
