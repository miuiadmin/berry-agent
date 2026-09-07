/**
 * obs_query 工具件测试（web/tool 同款 idiom——真服务直连、execute 直调；
 * 03 §10.8 obs_query 条款执法锚）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { createObsService } from './service.js';
import { createObsQueryTool } from './tool.js';
import type { ObsEventsFace, ObsService } from './types.js';

let dir: string;
let service: ObsService | null = null;
let nowMs: number;

/** 极简事件面（工具测试只需喂几发事件） */
class FixedEvents implements ObsEventsFace {
  constructor(private readonly rows: SessionEvent[]) {}
  queryEvents(): { events: SessionEvent[]; nextCursor: string | null } {
    return { events: this.rows, nextCursor: null };
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-obs-tool-test-'));
  nowMs = Date.UTC(2026, 8, 7, 9);
});

afterEach(() => {
  service?.dispose();
  service = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 事件快捷构造 */
function ev(type: string, time: number, data?: unknown): SessionEvent {
  return { type, seq: 1, time, data: data ?? {} } as SessionEvent;
}

/** 首内容块文本抽取（窄化联合——obs_query 回执恒文本单块） */
function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  const block = result.content[0]!;
  if (block.type !== 'text' || block.text === undefined) throw new Error('回执非文本块');
  return block.text;
}

/** 服务直连构造（零规则零自驱） */
function makeService(rows: SessionEvent[]): ObsService {
  service = createObsService({
    dbPath: join(dir, 'rollup.db'),
    events: new FixedEvents(rows),
    notify: { notify: () => {} },
    audience: { hasAudience: () => false },
    refreshMs: 0,
    clock: () => nowMs,
  });
  service.refresh();
  return service;
}

describe('obs_query 工具', () => {
  it('契约面：name/effect/schema 形（typebox 根 object）', () => {
    const tool = createObsQueryTool(makeService([]));
    expect(tool.name).toBe('obs_query');
    expect(tool.effect).toBe('read');
    expect(tool.parameters).toBeTypeOf('object');
  });

  it('events 指标：文本表格含桶 ISO·类型·计数', async () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const tool = createObsQueryTool(makeService([ev('user/message', h0 + 1000), ev('user/message', h0 + 2000)]));
    const result = await tool.execute({ granularity: 'hour' }, {} as never);
    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text).toContain('2026-09-07T08:00:00Z');
    expect(text).toContain('user/message');
    expect(text).toContain('count=2');
  });

  it('usage 指标：主计费桶与 cache 桶分列呈现', async () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const tool = createObsQueryTool(
      makeService([
        ev('llm/usage', h0 + 1000, {
          callId: 'c1',
          model: 'm',
          usage: { input: 60, output: 40, cacheRead: 5, cacheWrite: 6 },
        }),
      ]),
    );
    const result = await tool.execute({ granularity: 'hour', metric: 'usage' }, {} as never);
    const text = textOf(result);
    expect(text).toContain('main(in+out)=100');
    expect(text).toContain('cache_read=5');
    expect(text).toContain('cache_write=6');
    // token 原始值——不折算货币（无 $ 字样）
    expect(text.includes('$')).toBe(false);
  });

  it('空窗口：诚实空回执（不造零行）', async () => {
    const tool = createObsQueryTool(makeService([]));
    const result = await tool.execute({ granularity: 'day' }, {} as never);
    expect(textOf(result)).toContain('无聚合行');
  });

  it('服务已 dispose：isError 数据面携 OBS_ 码前缀', async () => {
    const svc = makeService([]);
    const tool = createObsQueryTool(svc);
    svc.dispose();
    const result = await tool.execute({ granularity: 'hour' }, {} as never);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[OBS_DB_OPEN_FAILED]');
  });
});
