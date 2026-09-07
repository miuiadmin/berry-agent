/**
 * 批 18c-5 周期路 review 测试——转录纪律（文本两腿/机器源滤除/tool 面不转录）
 * + JSON 三试（直取/围栏/平衡段/垃圾）+ runMemoryReview 编排全 outcome 面
 * （empty/budget/parse/error/ran）+ 按条丢弃（schema 败/secret 入库拒）+
 * 溯源（sourceSeq 命中取该行/缺席与越窗回落锚）+ exact 合并管线复用。
 *
 * LLM 全桩（计划注入式——零真网络）；dao 用真库（ingest 合并管线参与断言）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { parseJsonPayload, runMemoryReview, transcribeForReview } from './review.js';
import type { MemoryLlmFace } from './types.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;
const warn = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-review-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移链+DAO（一 setup 一库文件） */
function openDao(): MemoryDao {
  store = openStore({
    dbPath: join(dir, `test-${++dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn,
    newId: () => `m${++idSeq}`,
  });
}

/** 事件信封便捷构造 */
function ev(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: nowMs, data };
}

/** LLM 桩（reply = complete 回的文本；throws = complete 抛；affordable = 预算闸） */
function llmStub(opts: { reply?: string; throws?: boolean; affordable?: boolean } = {}): {
  face: MemoryLlmFace;
  prompts: string[];
  systemPrompts: string[];
} {
  const prompts: string[] = [];
  const systemPrompts: string[] = [];
  const face: MemoryLlmFace = {
    async complete(req) {
      prompts.push(req.messages[0]!.content);
      if (req.systemPrompt !== undefined) systemPrompts.push(req.systemPrompt);
      if (opts.throws) throw new Error('llm down');
      return { message: { content: opts.reply ?? '[]' } };
    },
    canAfford: () => opts.affordable ?? true,
  };
  return { face, prompts, systemPrompts };
}

/** 真会话形事件窗（user/assistant 两腿 + tool 面与机器源面各掺一笔） */
function sampleWindow(): SessionEvent[] {
  return [
    ev('user/message', 1, { content: '帮我把测试跑起来' }),
    ev('assistant/message', 2, {
      content: [
        { type: 'text', text: '好的' },
        { type: 'tool_use', id: 't1' },
      ],
    }),
    ev('tool/call', 3, { name: 'exec', args: { cmd: 'npm test' } }),
    ev('tool/result', 4, { callId: 't1', ok: true }),
    ev('assistant/message', 5, { content: [{ type: 'text', text: '测试全绿' }] }),
    ev('user/message', 6, { content: '以后跑测试前先跑 typecheck', source: undefined }),
    ev('user/message', 7, { content: '压缩摘要载体', source: 'compaction' }), // 机器源——不入审阅面
    ev('turn/end', 8, {}),
  ];
}

describe('transcribeForReview（转录纪律——只文本面两腿）', () => {
  it('user/assistant 两腿转录（string 直取/块数组拼 text 块）；tool 面/turn 面不转录', () => {
    const t = transcribeForReview(sampleWindow());
    expect(t.items).toEqual([
      { seq: 1, role: 'user', text: '帮我把测试跑起来' },
      { seq: 2, role: 'assistant', text: '好的' },
      { seq: 5, role: 'assistant', text: '测试全绿' },
      { seq: 6, role: 'user', text: '以后跑测试前先跑 typecheck' },
    ]);
    expect(t.anchorSeq).toBe(1); // 首转录行
    expect([...t.seqs]).toEqual([1, 2, 5, 6]);
    // tool 输出面（seq 3/4）绝不出现在文本面——防敏感工具输出进 LLM prompt
    expect(t.items.some((i) => i.seq === 3 || i.seq === 4)).toBe(false);
  });

  it('机器源滤除：compaction/plugin:* 载体跳过；channel:* 与缺省入检', () => {
    const t = transcribeForReview([
      ev('user/message', 1, { content: '压缩载体', source: 'compaction' }),
      ev('user/message', 2, { content: '插件注入', source: 'plugin:webui' }),
      ev('user/message', 3, { content: '通道来话', source: 'channel:telegram' }),
      ev('user/message', 4, { content: '真人敲的' }),
      ev('user/message', 5, { content: [{ type: 'image', url: 'x' }] }),
    ]);
    expect(t.items).toEqual([
      { seq: 3, role: 'user', text: '通道来话' },
      { seq: 4, role: 'user', text: '真人敲的' },
    ]); // 无文本行（纯图像）不入
  });

  it('空窗 → 空 items + anchorSeq null（runMemoryReview 的 skipped-empty 前置）', () => {
    const t = transcribeForReview([ev('tool/call', 1, { name: 'exec' }), ev('turn/end', 2, {})]);
    expect(t.items).toEqual([]);
    expect(t.anchorSeq).toBeNull();
  });
});

describe('parseJsonPayload（JSON 三试）', () => {
  it('试一直取', () => {
    expect(parseJsonPayload('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonPayload('[{"kind":"fact"}]')).toEqual([{ kind: 'fact' }]);
  });

  it('试二剥代码围栏（```json / ``` 两形）', () => {
    expect(parseJsonPayload('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
    expect(parseJsonPayload('看这是结果：\n```\n[{"a":1}]\n```\n以上')).toEqual([{ a: 1 }]);
  });

  it('试三首平衡段（模型前后缀闲话包裹；字符串内括号跳越）', () => {
    expect(parseJsonPayload('好的，结果如下 {"kind":"fact","summary":"说 {花括号}"} 请查收')).toEqual({
      kind: 'fact',
      summary: '说 {花括号}',
    });
    expect(parseJsonPayload('前缀 [1, 2, {"b":"}]"}] 后缀')).toEqual([1, 2, { b: '}]' }]);
  });

  it('三试皆败 → null', () => {
    expect(parseJsonPayload('完全不是 JSON')).toBeNull();
    expect(parseJsonPayload('')).toBeNull();
    expect(parseJsonPayload('{"unterminated": true')).toBeNull(); // 不配平
  });
});

describe('runMemoryReview（编排全 outcome 面）', () => {
  it('skipped-empty：窗内无转录行——零 LLM 调用', async () => {
    const dao = openDao();
    const { face, prompts } = llmStub({ reply: '[{"kind":"fact","summary":"s","content":"c"}]' });
    const r = await runMemoryReview({ dao, llm: face }, 's1', [ev('tool/call', 1, { name: 'exec' })]);
    expect(r).toEqual({ outcome: 'skipped-empty', extracted: 0, discarded: 0 });
    expect(prompts).toHaveLength(0);
  });

  it('skipped-budget：canAfford 拒——零 LLM 调用', async () => {
    const dao = openDao();
    const { face, prompts } = llmStub({ affordable: false });
    const r = await runMemoryReview({ dao, llm: face }, 's1', sampleWindow());
    expect(r).toEqual({ outcome: 'skipped-budget', extracted: 0, discarded: 0 });
    expect(prompts).toHaveLength(0);
  });

  it('skipped-error：complete 抛——warn 观测面不反噬', async () => {
    const dao = openDao();
    const { face } = llmStub({ throws: true });
    const r = await runMemoryReview({ dao, llm: face, warn }, 's1', sampleWindow());
    expect(r).toEqual({ outcome: 'skipped-error', extracted: 0, discarded: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('skipped-parse：回复整体非 JSON 数组（闲话/坏形对象）', async () => {
    const dao = openDao();
    for (const reply of ['我认为没有值得提取的记忆', '{"items":[]}', '["数组但', 'null']) {
      const { face } = llmStub({ reply });
      const r = await runMemoryReview({ dao, llm: face }, 's1', sampleWindow());
      expect(r).toEqual({ outcome: 'skipped-parse', extracted: 0, discarded: 0 });
    }
  });

  it('ran：受理入库 owner 恒 global + 置信度缺省 0.6 + sourceSeq 命中取该行/缺席回落锚', async () => {
    const dao = openDao();
    const reply = JSON.stringify([
      { kind: 'convention', summary: '测试前先 typecheck', content: '跑测试前先跑 typecheck', sourceSeq: 6 },
      { kind: 'fact', summary: '测试已全绿', content: '本轮测试全绿通过' }, // 缺 sourceSeq → 回落锚 seq=1
    ]);
    const { face, prompts } = llmStub({ reply });
    const r = await runMemoryReview({ dao, llm: face }, 'sess-A', sampleWindow());
    expect(r).toEqual({ outcome: 'ran', extracted: 2, discarded: 0 });
    expect(prompts[0]).toContain('sess-A');
    expect(prompts[0]).toContain('[seq=6 user]');
    const visible = dao.listVisible();
    expect(visible).toHaveLength(2);
    const hit = visible.find((m) => m.kind === 'convention')!;
    expect(hit.ownerKey).toBe('global');
    expect(hit.confidence).toBe(0.6); // 缺省
    expect(hit.sourceRefs).toEqual([{ sessionId: 'sess-A', seq: 6 }]); // 指认位
    const anchored = visible.find((m) => m.kind === 'fact')!;
    expect(anchored.sourceRefs).toEqual([{ sessionId: 'sess-A', seq: 1 }]); // 回落锚
  });

  it('sourceSeq 越窗（幻觉）回落锚；confidence 透传', async () => {
    const dao = openDao();
    const reply = JSON.stringify([
      { kind: 'insight', summary: '越窗指认', content: '幻觉指认 999', confidence: 0.9, sourceSeq: 999 },
    ]);
    const { face } = llmStub({ reply });
    await runMemoryReview({ dao, llm: face }, 's1', sampleWindow());
    const row = dao.listVisible()[0]!;
    expect(row.sourceRefs).toEqual([{ sessionId: 's1', seq: 1 }]); // 锚
    expect(row.confidence).toBe(0.9);
  });

  it('按条丢弃不弃批：集外 kind / 未知字段 / 坏形 / secret 入库拒——好条照收', async () => {
    const dao = openDao();
    const secret = `sk-${'a'.repeat(30)}`; // openai-style-key 形
    const reply = JSON.stringify([
      { kind: 'correction', summary: '集外 kind', content: 'correction 是即时路专有' }, // 五类闭集外
      { kind: 'fact', summary: '未知字段', content: '带 extra 字段', extra: true },
      '不是对象',
      { kind: 'fact', summary: 'secret 面', content: `密钥是 ${secret} 别存` }, // Value.Check 过形、入库写前扫描拒
      { kind: 'preference', summary: '好条一条', content: '用户偏好 pnpm', confidence: 0.8 },
    ]);
    const { face } = llmStub({ reply });
    const r = await runMemoryReview({ dao, llm: face }, 's1', sampleWindow());
    expect(r).toEqual({ outcome: 'ran', extracted: 1, discarded: 4 });
    expect(dao.listVisible()).toHaveLength(1);
    expect(dao.listVisible()[0]!.summary).toBe('好条一条');
  });

  it('双同条 exact 合并：同内容两条 → 单行 evidence 2（ingest 合并管线复用——零旁路）', async () => {
    const dao = openDao();
    const item = { kind: 'fact', summary: '同一知识', content: 'vitest 是测试框架', sourceSeq: 1 };
    const { face } = llmStub({ reply: JSON.stringify([item, item]) });
    const r = await runMemoryReview({ dao, llm: face }, 's1', sampleWindow());
    expect(r).toEqual({ outcome: 'ran', extracted: 2, discarded: 0 });
    expect(dao.listVisible()).toHaveLength(1); // exact 分支吸收
    expect(dao.listVisible()[0]!.evidenceCount).toBe(2);
  });
});
