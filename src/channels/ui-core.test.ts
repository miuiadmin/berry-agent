/**
 * UiCore 直接单测（07 §4.3 通道核编排——批 10a 至今经组合根 channels.test.ts
 * 覆盖降级链主路/竞速/FIFO；本件补组合根未达的单元边界：能力双重校验防御位
 * （组合根假后端恒全实现，声明缺实现分支零覆盖）/ once 收口不复活 / widgetOf
 * 观察面 / 审批族异常折保守值与竞速腿 / 零 capable no-op）。
 */
import { describe, expect, it } from 'vitest';
import { UiCore } from './ui-core.js';
import { AskQueue } from './ask-queue.js';
import type { ApprovalAskAnswer, UiBackend, UiCapabilities } from './types.js';

/** 可控 promise（后端问询的手动应答位） */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 记录形问询（消息 + 内部 signal + 手动应答柄） */
interface AskEntry<T> {
  readonly message: string;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

/** 全能假后端（能力可覆写；问询记录 + 手动应答；select 非本件消费面省略） */
function fakeBackend(id: string, capsOverride?: Partial<UiCapabilities>) {
  const capabilities: UiCapabilities = {
    notify: true,
    confirm: true,
    select: true,
    input: true,
    approval: true,
    setStatus: true,
    setWidget: true,
    ...capsOverride,
  };
  const confirmAsks: AskEntry<boolean>[] = [];
  const inputAsks: AskEntry<string>[] = [];
  const approvalAsks: AskEntry<ApprovalAskAnswer>[] = [];
  const statusCalls: { sessionId: string; status: string }[] = [];
  const notified: string[] = [];
  const backend: UiBackend<never> = {
    id,
    capabilities,
    hasAudience: () => true,
    notify: (message) => {
      notified.push(message);
    },
    confirm: (message, opts) => {
      const d = deferred<boolean>();
      confirmAsks.push({ message, signal: opts?.signal, ...d });
      return d.promise;
    },
    input: (message, opts) => {
      const d = deferred<string>();
      inputAsks.push({ message, signal: opts?.signal, ...d });
      return d.promise;
    },
    askApproval: (request, opts) => {
      const d = deferred<ApprovalAskAnswer>();
      approvalAsks.push({ message: request.summary, signal: opts?.signal, ...d });
      return d.promise;
    },
    setStatus: (sessionId, status) => {
      statusCalls.push({ sessionId, status });
    },
    setWidget: () => {},
  };
  return { backend, confirmAsks, inputAsks, approvalAsks, statusCalls, notified };
}

/** 造核：直接持 AskQueue 与后端数组（绕经 channels 组合根的单元视角） */
function makeCore(backends: UiBackend<never>[], onApprovalAlways?: (entry: string) => void) {
  return new UiCore(() => backends, new AskQueue(), onApprovalAlways);
}

describe('能力双重校验（防后端声明能力而缺实现——防御位）', () => {
  it('声明 confirm=true 但方法缺位：不吃直路，降级 input (y/n) 形', async () => {
    const b = fakeBackend('lying');
    (b.backend as unknown as { confirm?: unknown }).confirm = undefined; // 声明在、实现在缺
    const ui = makeCore([b.backend]);
    const p = ui.confirm('s1', '做吗？');
    expect(b.confirmAsks).toEqual([]); // 直路未被吃
    expect(b.inputAsks[0]?.message).toContain('做吗？ (y/n)');
    b.inputAsks[0]?.resolve('yes');
    expect(await p).toBe(true);
  });

  it('同链纵深：input 声明缺位 → notify 化保守值（无人可答 fail-closed）', async () => {
    const b = fakeBackend('lying2');
    (b.backend as unknown as { confirm?: unknown }).confirm = undefined;
    (b.backend as unknown as { input?: unknown }).input = undefined;
    const ui = makeCore([b.backend]);
    expect(await ui.input('s1', '名字？')).toBe('');
    expect(b.notified).toEqual(['名字？']);
  });
});

describe('ask 编舞单元边界', () => {
  it('once 收口不复活：首答落定后迟到 abort 不变值（外部 signal 经核折入 finish）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const ac = new AbortController();
    const p = ui.confirm('s1', 'Q', { signal: ac.signal });
    b.confirmAsks[0]?.resolve(true);
    expect(await p).toBe(true);
    ac.abort(); // 迟到 abort——finish 已 once
    expect(await p).toBe(true);
    expect(ui.pending('s1')).toEqual([]); // settled 幂等不双出队
  });

  it('审批呈现异常折保守值 cancel（fail-closed——组合根只测过 confirm 族异常）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    b.approvalAsks[0]?.reject(new Error('backend crash'));
    expect(await p).toBe('cancel');
  });

  it('审批多后端竞速先答先得、败腿经内部 signal 撤销（04 §9 跨入口竞速同链）', async () => {
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web');
    const ui = makeCore([b1.backend, b2.backend]);
    const p = ui.askApproval('s1', { summary: '删文件' });
    b2.approvalAsks[0]?.resolve('reject');
    expect(await p).toBe('reject');
    expect(b1.approvalAsks[0]?.signal?.aborted).toBe(true);
  });
});

describe('widget 槽与状态面观察位', () => {
  it('widgetOf 单槽语义：后写胜前写、null 清空、未知会话 null（repaint 载荷消费面）', () => {
    const ui = makeCore([]);
    ui.setWidget('s1', { kind: 'a' });
    expect(ui.widgetOf('s1')).toEqual({ node: { kind: 'a' } });
    ui.setWidget('s1', { kind: 'b' });
    expect(ui.widgetOf('s1')).toEqual({ node: { kind: 'b' } });
    ui.setWidget('s1', null);
    expect(ui.widgetOf('s1')).toBeNull();
    expect(ui.widgetOf('nobody')).toBeNull();
  });

  it('setStatus 零 capable 后端 no-op 不抛（缺席面静默——扇出过滤位）', () => {
    const b = fakeBackend('web', { setStatus: false });
    const ui = makeCore([b.backend]);
    expect(() => ui.setStatus('s1', '思考中')).not.toThrow();
    expect(b.statusCalls).toEqual([]);
  });
});
