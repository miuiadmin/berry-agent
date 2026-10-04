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
    askApproval: (_sessionId, request, opts) => {
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

  it('入参 signal 已中止：保守值直收 + 零呈现 + 队列零占用（修前红：只挂监听死挂——promise 永悬、浮层僵尸、后继问死排）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const ac = new AbortController();
    ac.abort(); // 先中止——bridgeApprovalSignal 同步 relay 的生产形（补扫 N1）
    const p = ui.confirm('s1', 'Q', { signal: ac.signal });
    expect(await p).toBe(false); // 保守值直收
    expect(b.confirmAsks.length).toBe(0); // 零呈现——不弹僵尸浮层
    expect(ui.pending('s1')).toEqual([]); // 队列零占用
    // 后继问正常起跑（队首未被死挂件占位）
    const p2 = ui.confirm('s1', 'Q2');
    expect(b.confirmAsks.length).toBe(1);
    b.confirmAsks[0]?.resolve(true);
    expect(await p2).toBe(true);
  });

  it('排队 ask 的外部 abort：只收自身保守值——ACTIVE 件不被误弹、本件不晋升呈现（修前红：settled 弹 ACTIVE 甲 + 乙以已中止 signal 晋升 start）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const p1 = ui.confirm('s1', '甲问'); // 甲：直晋 ACTIVE（confirm 直路在飞）
    const ac = new AbortController();
    const p2 = ui.input('s1', '乙问', { signal: ac.signal }); // 乙：pending 挂外部 signal
    expect(ui.pending('s1')).toEqual(['confirm', 'input']);
    let settled1 = false;
    void p1.then(() => {
      settled1 = true;
    });
    ac.abort(); // 乙的外部 abort——外部 signal 经核折入 finish（不直传后端）
    await expect(p2).resolves.toBe(''); // 乙保守值收场
    expect(settled1).toBe(false); // 甲 promise 仍悬（abort 不得替甲收场）
    expect(b.inputAsks.length).toBe(0); // 修前红①：乙被晋升 start 且以已中止 controller.signal 调 present——僵尸浮层源（N1 同族）
    expect(ui.pending('s1')).toEqual(['confirm', 'input']); // 修前红②：settled 弹掉 ACTIVE 甲——账面只剩被晋升的乙
    // 甲仍受队列治理：应答落定后队首出队、乙残位零呈现让位、后继照常起跑
    b.confirmAsks[0]?.resolve(true);
    expect(await p1).toBe(true);
    expect(b.inputAsks.length).toBe(0); // 乙残位晋升即让位——不出 present 直出队
    expect(ui.pending('s1')).toEqual([]);
    const p3 = ui.confirm('s1', '丙问');
    expect(b.confirmAsks.length).toBe(2); // 队列空闲——丙直晋队首
    b.confirmAsks[1]?.resolve(false);
    expect(await p3).toBe(false);
  });

  it('排队 ask 外部 abort 后 clearSession 仍能收口 ACTIVE 件（修前红：甲被 settled 弹出成账外孤儿——取消不可达、promise 永悬）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const p1 = ui.confirm('s1', '甲问');
    const ac = new AbortController();
    const p2 = ui.input('s1', '乙问', { signal: ac.signal });
    ac.abort();
    await expect(p2).resolves.toBe('');
    ui.closeSession('s1'); // 会话收口——在飞甲与残位乙都该被取消语义覆盖
    await expect(p1).resolves.toBe(false); // 修前红：甲不在账面——clearSession 取消不到它
    expect(ui.pending('s1')).toEqual([]);
  });

  it('present 同步抛错：先收口释放槽位再重抛同步异常（修前红：active 槽占用永不落定——后继问死排）', async () => {
    const b = fakeBackend('bad');
    let boom = true;
    b.backend.confirm = (): Promise<boolean> => {
      // 坏后端形：同步 throw（非 rejected promise）——present 调用点直接穿出
      if (boom) throw new Error('sync boom');
      return Promise.resolve(true);
    };
    const ui = makeCore([b.backend]);
    // 调用方契约不变（修后仍成立）：同步异常照抛回（enqueue 链穿出）
    expect(() => ui.confirm('s1', 'Q')).toThrow('sync boom');
    boom = false;
    // 修前红主证：AskQueue active 槽已占用且永不落定——pending 恒 ['confirm']
    expect(ui.pending('s1')).toEqual([]);
    // 修前红次证：后继健康 confirm 死排无呈现——修后正常起跑作答
    const p2 = ui.confirm('s1', 'Q2');
    expect(await p2).toBe(true);
    expect(ui.pending('s1')).toEqual([]);
  });

  it('审批呈现异常折保守值 cancel（fail-closed——组合根只测过 confirm 族异常）', async () => {
    const b = fakeBackend('tui');
    const ui = makeCore([b.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    b.approvalAsks[0]?.reject(new Error('backend crash'));
    expect(await p).toBe('cancel');
  });

  it('审批降级到底 → unavailable（零 approval capability 后端——headless 结构态；04 §9 无应答者语义非用户取消）', async () => {
    const b = fakeBackend('headless', { approval: false });
    const ui = makeCore([b.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    // 修前误答 'cancel'——decided 错标 cancel/user 双失真（2026-09-13 真模型
    // 实测实锤：headless run 触发写类审批对，模型被「run 已打断」文案误导连试 3 次）
    expect(await p).toBe('unavailable');
    expect(b.notified).toEqual(['写文件']); // 摘要仍 notify 呈现（记录面不缺）
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

  it('瞬时 fail-closed 腿不毒化竞速：unavailable 只投票不落定——真观众后答仍胜（第八轮 C1 修前红：混合观众形 SDK 腿零订阅者）', async () => {
    // 形位=serve --port / daemon 双挂：真观众腿（浏览器 SSE 在场，挂起待答）
    // + SDK 腿（该会话零 /v1/events 订阅者——backend.ts 无观众即创建时立即
    // resolve 'unavailable'，与下方即时已决 promise 同形）
    const spectator = fakeBackend('web');
    const zeroAudience = fakeBackend('sdk');
    zeroAudience.backend.askApproval = (): Promise<ApprovalAskAnswer> => Promise.resolve('unavailable');
    const ui = makeCore([spectator.backend, zeroAudience.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    // 修前红：Promise.race 被瞬时 'unavailable' 腿整场毒化——观众腿被撤销、
    // decide 后答恒 superseded（serve-entry「审批跨入口竞速」同形实锤）
    spectator.approvalAsks[0]?.resolve('approve');
    expect(await p).toBe('approve');
    // 落定出队收口（落定时 controller.abort 统一达所有腿——胜腿收 abort 是
    // settled 守卫下的无害 no-op，产线 SDK/webui 后端同律）
    expect(ui.pending('s1')).toEqual([]);
  });

  it('全腿皆 unavailable → fail-closed unavailable（混合形保单腿 headless 语义——全腿结构性无人仍立即收口）', async () => {
    const a = fakeBackend('sdk-a');
    a.backend.askApproval = (): Promise<ApprovalAskAnswer> => Promise.resolve('unavailable');
    const b = fakeBackend('sdk-b');
    b.backend.askApproval = (): Promise<ApprovalAskAnswer> => Promise.resolve('unavailable');
    const ui = makeCore([a.backend, b.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    expect(await p).toBe('unavailable');
  });

  it('败腿迟到真裁决静默丢弃：不触 always 回写副作用（修前红：投票重排后 superseded 腿照发 onApprovalAlways——旧 race 败腿静默语义丢失）', async () => {
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web');
    const alwaysEntries: string[] = [];
    const ui = makeCore([b1.backend, b2.backend], (entry) => alwaysEntries.push(entry));
    const p = ui.askApproval('s1', { summary: '写文件', suggestedEntry: 'allow-write' });
    b1.approvalAsks[0]?.resolve('approve'); // 真裁决先到——外层 ask 落定
    b2.approvalAsks[0]?.resolve('always'); // 败腿迟到真裁决——微任务 FIFO 后到
    expect(await p).toBe('approve');
    expect(alwaysEntries).toEqual([]); // 修前红：superseded 腿的 always 回写照发（策略表被败腿污染）
  });

  it('投票制反向交错回归锁：真裁决先到、迟到 unavailable 票 no-op——结果不被覆写、全票分支不触发', async () => {
    // 与「瞬时 fail-closed 腿不毒化竞速」锁互为反向（那把锁 unavailable 先
    // 到、真答后到；本把锁真答先到、票后到）——胜负门置位后迟到票连计票
    // 都不走，1 票恒不满 2，fail-closed 分支无从触发
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web');
    const ui = makeCore([b1.backend, b2.backend]);
    const p = ui.askApproval('s1', { summary: '写文件' });
    b1.approvalAsks[0]?.resolve('approve'); // 真裁决先到——落定
    b2.approvalAsks[0]?.resolve('unavailable'); // 迟到票——no-op
    expect(await p).toBe('approve');
    expect(ui.pending('s1')).toEqual([]); // 落定出队收口——全票 fail-closed 分支未触发
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
