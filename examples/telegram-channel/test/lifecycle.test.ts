/**
 * telegram-channel 件生命周期锁（examples 域首个 vitest 收录件）。
 *
 * 与 notify 件 node 直跑自持形的分野：本件断言面落在**真宿主契约**上——
 * 真 createPluginContext 门检（channels.ui-backend / triggers.start-run 两门
 * 真执法）、真 TriggerRegistry 三闸（域前缀律 + 注册即 fire 交接 + 起会回执
 * `{ sessionId }` 锚形）——拷走即失真，故逐件点名进宿主 node 轨
 * （vitest.config.ts node include；不开 examples/** 通配——会误收 notify 件
 * 顶层断言形）。零真网络：收发缝 `__tg`（named export）两槽恒注入替身——
 * node:https 真腿在测试全程零触达。
 *
 * 六锚（对齐 notify 件 rig 形状纪律——断言只比形状/调用计数/载荷透传）：
 *  ① 零 opens → 激活触 triggers.start-run 门关拒（触发器先注册——第一动词
 *     即拒，注册面零残留；UiBackend 后注册故零半注册泄漏）；
 *  ② 三门全开 → 装载活：UiBackend 注册可观测 + 触发器入册 + 导出面形状
 *     + disposer 撤两注册；另锁装载窗关闭律（终态观测走 onEnvelope 的
 *     结构性依据——后置 subscribeSessionLifecycle 必拒）；
 *  ③ fire 回执绑定 + 终态推回（onEnvelope agent_end → 推文本 → 动态绑定
 *     释放）；
 *  ④ 审批往返：askApproval 挂起 → 模拟 TG「批准」→ resolve 'approve'；
 *     附让位律（新审批顶替旧者 'unavailable' 收口）；
 *  ⑤ signal abort → 'cancel'（宿主撤销收口形；含入口即 abort 的预检形）；
 *  ⑥ 零 token 降级：askApproval 即决 'unavailable' 零推送 + hasAudience
 *     false（收发链整体退位为证词票——不挂着毒化宿主竞速）。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../../../src/contracts/index.js';
import type { UiBackend } from '../../../src/contracts/index.js';
import { EventDispatch, Scope } from '../../../src/context/index.js';
import { CommandRegistry } from '../../../src/channels/index.js';
import { createToolRegistry } from '../../../src/tools/index.js';
import { createJobRegistry, createSubagentService } from '../../../plugins/subagent/index.js';
import { PromptSectionRegistry } from '../../../src/host/prompt-sections.js';
import { TriggerRegistry } from '../../../src/host/triggers.js';
import type { TriggerStartReceipt, TriggerStartSpec } from '../../../src/host/triggers.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from '../../../src/host/plugin-context.js';
import type { PluginContextHandle } from '../../../src/host/plugin-context.js';

import activate, { __tg, inject } from '../entry.js';

/** 被测件 id（触发器名域前缀 == 插件 id 恰等律的比对源） */
const PLUGIN_ID = 'berry-agent-example-telegram-channel';
const TRIGGER_NAME = `${PLUGIN_ID}/tg-message`;

/** 装载窗关闭码（锚二活锁用——字面量单源） */
const PLUGIN_WINDOW_CLOSED_CODE = 'PLUGIN_WINDOW_CLOSED';

/** 宿主自省面替身（materializeHostFace 形——纯数据即可；plugin-context.test 同式） */
const HOST_FACE = {
  version: '0.1.0-test',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/** 轮询分放结果形（收发缝 poll 槽的应答形） */
interface PollResult {
  updates: unknown[];
  nextOffset: number;
}

/** 条件等待（5ms 轮询真钟——收发链是异步微任务+宏任务混合，排空法不够用） */
async function until(pred: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('until 等待超时（异步链未达预期态）');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 装配 rig：真 createPluginContext + 真 TriggerRegistry + 记录型后端注册面 */
function assemble(opens: readonly string[]): {
  handle: PluginContextHandle;
  scope: Scope;
  triggers: TriggerRegistry;
  backends: UiBackend<never>[];
  notifies: { message: string; level?: string }[];
  starterSpecs: TriggerStartSpec[];
  setStarterReceipt(receipt: TriggerStartReceipt | undefined): void;
} {
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  // 钩子词汇预注册（装配主表全量模拟——plugin-context.test 同式）
  dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
  // starter 替身：记录 spec + 回执可调（③锚换新会话 id 用）
  const starterSpecs: TriggerStartSpec[] = [];
  let starterReceipt: TriggerStartReceipt | undefined = { sessionId: 'sess-starter-default' };
  const triggers = new TriggerRegistry({
    // getOpens 咨询 rig opens（真宿主同律——触发器门检三闸在注册表侧，门
    // 态真源是启用行 opens；硬编码恒开会使锚一的「第一动词即拒」假红）
    getOpens: (pluginId) => new Set(pluginId === PLUGIN_ID ? opens : []),
    makeStarter: () => (spec) => {
      starterSpecs.push(spec);
      return starterReceipt;
    },
  });
  // 界面后端注册面：记录型（②④⑤锚直取 backend 本体调 askApproval/onEnvelope）
  const backends: UiBackend<never>[] = [];
  const uiBackendsFace = {
    registerPluginBackend: (backend: UiBackend<never>) => {
      backends.push(backend);
      return () => {
        const idx = backends.indexOf(backend);
        if (idx >= 0) backends.splice(idx, 1);
      };
    },
  };
  // ctx.ui.notify 出口收集（降级 warn 断言面）
  const notifies: { message: string; level?: string }[] = [];
  const channelsUi = {
    notify: (message: string, opts?: { level?: string }) => notifies.push({ message, level: opts?.level }),
    confirm: () => Promise.resolve(false),
    select: () => Promise.resolve(''),
    input: () => Promise.resolve(''),
    setStatus: () => undefined,
    setWidget: () => undefined,
    hasAudience: () => false,
    isSessionLive: () => true,
  };
  const handle = createPluginContext({
    pluginId: PLUGIN_ID,
    scope,
    dispatch,
    tools: createToolRegistry(dispatch),
    commands: new CommandRegistry(),
    uiBackends: uiBackendsFace,
    llm: { registerProvider: () => () => undefined },
    promptSections: new PromptSectionRegistry(),
    triggers,
    subagents: createSubagentService({ registry: createJobRegistry() }),
    hostFace: HOST_FACE,
    opens,
    channelsUi,
  });
  return {
    handle,
    scope,
    triggers,
    backends,
    notifies,
    starterSpecs,
    setStarterReceipt: (receipt) => {
      starterReceipt = receipt;
    },
  };
}

/** 自域凭证面（scope 提供 'secrets'——boot fork 绑定的同位替身；缺席名抛错同真面律） */
function provideToken(scope: Scope, present: boolean): void {
  scope.provide(
    'secrets',
    {
      get: (name: string) => {
        if (present && name === 'telegram-bot-token') return 'tok-test';
        throw new Error(`CREDENTIALS_NOT_FOUND（伪面——${name} 不在本插件域）`);
      },
    },
    'test-rig',
  );
}

/**
 * 收发缝替身安装（两槽恒注入——node:https 真腿零触达）。
 * poll = 手动分放形（每次调用登记一个放行口，测试按需分放——不分放即挂起，
 * 循环静停无钟泄漏）；send = 记录型。
 */
function installSeams(): {
  sends: { token: string; chatId: string; text: string }[];
  waitPoll(): Promise<void>;
  releasePoll(result: PollResult): void;
} {
  const sends: { token: string; chatId: string; text: string }[] = [];
  let releasePoll: ((result: PollResult) => void) | undefined;
  __tg.send = async (token: string, chatId: string, text: string) => {
    sends.push({ token, chatId, text });
  };
  __tg.poll = () =>
    new Promise<PollResult>((resolve) => {
      releasePoll = resolve;
    });
  return {
    sends,
    waitPoll: () => until(() => releasePoll !== undefined),
    releasePoll: (result) => {
      const release = releasePoll;
      releasePoll = undefined;
      release?.(result);
    },
  };
}

/** TG message update 合成形（handleUpdate 只认 message.text 形——最小合法帧） */
function tgTextMessage(chatId: number, text: string, updateId = 1): unknown {
  return { update_id: updateId, message: { chat: { id: chatId }, text } };
}

/** 三门全开形（本件开门义务清单的前三项——grants.node-builtins 属装载期 import 门，ctx 面不消费） */
const FULL_OPENS = ['channels.ui-backend', 'triggers.start-run', 'grants.node-builtins'];

describe('telegram-channel 件生命周期（真宿主契约装配 rig）', () => {
  it('锚一：渠道门开/触发器门关 → 激活触 triggers.start-run 门关拒（触发器先注册——第一动词即拒，UiBackend 零半注册泄漏）', async () => {
    // 恰开渠道门：两注册动词中唯一关着的门是触发器门——拒在 triggers.register
    // （注册表侧三闸）即第一动词。若注册序倒置（backend 先），本形态即泄漏
    // 已注册的 UiBackend（apply 中途失败无失败路滚——闸 P2① 的分叉场景）
    const rig = assemble(['channels.ui-backend']);
    provideToken(rig.scope, true); // 凭证在场也到不了后续动词——门检前置
    let caught: unknown;
    try {
      await activate(rig.handle.ctx, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BaseError);
    expect((caught as BaseError).code).toBe('PLUGIN_CAPABILITY_DOOR_CLOSED');
    expect(rig.backends).toHaveLength(0); // 拒在第一动词（triggers.register）——零半注册残留
    expect(rig.triggers.list()).toHaveLength(0);
  });

  it('锚二：三门全开 → 装载活（导出面形状 + UiBackend 注册可观测 + 触发器入册 + disposer 撤两注册）＋ 装载窗关闭律（onEnvelope 路线的结构性依据）', async () => {
    // 导出面形状（notify 件同律锚——inject 空数组示形 + 收发缝恰两槽）
    expect(typeof activate).toBe('function');
    expect(Array.isArray(inject)).toBe(true);
    expect(inject).toEqual([]);
    expect(Object.keys(__tg).sort()).toEqual(['poll', 'send']);

    const rig = assemble(FULL_OPENS);
    provideToken(rig.scope, true);
    const seams = installSeams();
    try {
      const dispose = await activate(rig.handle.ctx, { bindings: [{ chat: '424242', session: 'sess-static-1' }] });
      expect(typeof dispose).toBe('function');
      // UiBackend 注册可观测：id/capabilities/观众探针（静态绑定在场 → 有观众）
      expect(rig.backends).toHaveLength(1);
      const backend = rig.backends[0] as unknown as {
        id: string;
        capabilities: Record<string, unknown>;
        hasAudience(): boolean;
      };
      expect(backend.id).toBe('telegram');
      expect(backend.capabilities).toMatchObject({ notify: true, approval: true });
      expect(backend.hasAudience()).toBe(true);
      // 触发器入册：域名两段式 + owner 归因 + 注册即 fire 交接（starter 槽可验）
      expect(rig.triggers.list().map((t) => t.name)).toEqual([TRIGGER_NAME]);
      expect(rig.triggers.list()[0]?.owner).toBe(PLUGIN_ID);
      // 装载成功零 warn（凭证在场——降级通道静默）
      expect(rig.notifies).toEqual([]);
      // —— 装载窗关闭律活锁：apply 收口关窗后 subscribeSessionLifecycle 必拒
      // （PLUGIN_WINDOW_CLOSED）——终态观测走 onEnvelope 信封回调面的结构性
      // 依据（设计原案 self 档后置订阅路径不通的实证）
      rig.handle.closeWindow();
      let windowErr: unknown;
      try {
        rig.handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'self', sessionId: 'sess-any' });
      } catch (err) {
        windowErr = err;
      }
      expect(windowErr).toBeInstanceOf(BaseError);
      expect((windowErr as BaseError).code).toBe(PLUGIN_WINDOW_CLOSED_CODE);
      // disposer：撤两注册（后端出册 + 触发器出册）
      dispose();
      expect(rig.backends).toHaveLength(0);
      expect(rig.triggers.list()).toHaveLength(0);
    } finally {
      __tg.poll = undefined;
      __tg.send = undefined;
    }
  });

  it('锚三：/start 起会回执绑定 + agent_end 终态推回（推完动态绑定释放）', async () => {
    const rig = assemble(FULL_OPENS);
    provideToken(rig.scope, true);
    const seams = installSeams();
    let dispose: (() => void) | undefined;
    try {
      dispose = await activate(rig.handle.ctx, {});
      await seams.waitPoll(); // 循环首轮 poll 已挂起（手动分放形）
      rig.setStarterReceipt({ sessionId: 'sess-tg-1' });
      seams.releasePoll({
        updates: [tgTextMessage(424242, '/start 帮我跑一遍回归')],
        nextOffset: 2,
      });
      // 起会 spec 透传（prompt 原文——载荷透传断言）
      await until(() => rig.starterSpecs.length >= 1);
      expect(rig.starterSpecs[0]).toMatchObject({ prompt: '帮我跑一遍回归' });
      // 绑定确认回执推回 chat
      await until(() => seams.sends.length >= 1);
      expect(seams.sends[0]?.chatId).toBe('424242');
      expect(seams.sends[0]?.text).toContain('sess-tg-1');
      expect(seams.sends[0]?.token).toBe('tok-test'); // token 经凭证缝现读（不入 config）
      // agent_end 终态推回：onEnvelope 窄滤（非绑定会话零推 → 绑定会话推）
      const backend = rig.backends[0] as unknown as {
        onEnvelope(env: { sessionId: string; event: unknown }, focused: boolean): void;
      };
      backend.onEnvelope({ sessionId: 'sess-other', event: { type: 'agent_end', status: 'completed' } }, false);
      backend.onEnvelope({ sessionId: 'sess-tg-1', event: { type: 'agent_end', status: 'completed' } }, false);
      await until(() => seams.sends.length >= 2);
      expect(seams.sends[1]?.text).toContain('sess-tg-1');
      expect(seams.sends[1]?.text).toContain('completed');
      // 推完即释放动态绑定：同会话再问审批 → 'unavailable'（无人可答证词票）
      const backendApproval = rig.backends[0] as unknown as {
        askApproval(sessionId: string, request: unknown, opts?: unknown): Promise<string>;
      };
      await expect(backendApproval.askApproval('sess-tg-1', { summary: 'x' })).resolves.toBe('unavailable');
      expect(seams.sends).toHaveLength(2); // 释放后摘要零推（unavailable 短路在推送前）
      // /start 前缀收严：群形 '/start@mybot 群形提示' 剥地址段取提示（@mybot
      // 不混入 prompt）；'/startxyz' 命令词粘连形不认领（零新 spec）
      await seams.waitPoll();
      rig.setStarterReceipt({ sessionId: 'sess-tg-2' });
      seams.releasePoll({
        updates: [tgTextMessage(424242, '/start@mybot 群形提示', 2), tgTextMessage(424242, '/startxyz', 3)],
        nextOffset: 4,
      });
      await until(() => rig.starterSpecs.length >= 2);
      expect(rig.starterSpecs[1]).toMatchObject({ prompt: '群形提示' });
      expect(rig.starterSpecs).toHaveLength(2); // xyz 粘连形零认领（两更新同批已同步处理完）
    } finally {
      dispose?.();
      __tg.poll = undefined;
      __tg.send = undefined;
    }
  });

  it('锚四：审批往返——askApproval 挂起推摘要 → TG「批准」收口 approve；附让位律（新审批顶替旧者 unavailable）', async () => {
    const rig = assemble(FULL_OPENS);
    provideToken(rig.scope, true);
    const seams = installSeams();
    let dispose: (() => void) | undefined;
    try {
      // 静态绑定（config bindings——不走 TG 起会路径，隔离审批面）
      dispose = await activate(rig.handle.ctx, { bindings: [{ chat: '424242', session: 'sess-appr-1' }] });
      const backend = rig.backends[0] as unknown as {
        askApproval(sessionId: string, request: unknown, opts?: unknown): Promise<string>;
      };
      // 让位律：第一问被第二问顶替 → 'unavailable'（证词非裁决）
      const first = backend.askApproval('sess-appr-1', { summary: '第一项审批请求' });
      const second = backend.askApproval('sess-appr-1', { summary: '第二项审批请求' });
      await expect(first).resolves.toBe('unavailable');
      // 摘要推送（让位者 + 在位者各一条——文本透传）
      await until(() => seams.sends.length >= 2);
      expect(seams.sends[0]?.text).toContain('第一项审批请求');
      expect(seams.sends[1]?.text).toContain('第二项审批请求');
      expect(seams.sends[1]?.text).toContain('sess-appr-1');
      // 模拟 TG「批准」（经收发缝 poll 分放驱动指令面——非直调内部处理器）
      await seams.waitPoll();
      seams.releasePoll({ updates: [tgTextMessage(424242, '批准')], nextOffset: 2 });
      await expect(second).resolves.toBe('approve');
      await until(() => seams.sends.length >= 3); // 已批准确认回执
      expect(seams.sends[2]?.text).toContain('sess-appr-1');
      // 收口后挂起清空：再答「拒绝」→ 无挂起回执（不误答新审批）
      await seams.waitPoll();
      seams.releasePoll({ updates: [tgTextMessage(424242, '拒绝', 2)], nextOffset: 3 });
      await until(() => seams.sends.length >= 4);
      expect(seams.sends[3]?.text).toContain('无挂起审批');
      expect(rig.notifies).toEqual([]); // 全程零 warn（成功路径静默）
    } finally {
      dispose?.();
      __tg.poll = undefined;
      __tg.send = undefined;
    }
  });

  it('锚五：signal abort → cancel（宿主撤销收口形——挂起清空后新审批可再立）', async () => {
    const rig = assemble(FULL_OPENS);
    provideToken(rig.scope, true);
    const seams = installSeams();
    let dispose: (() => void) | undefined;
    try {
      dispose = await activate(rig.handle.ctx, { bindings: [{ chat: '424242', session: 'sess-abort-1' }] });
      const backend = rig.backends[0] as unknown as {
        askApproval(sessionId: string, request: unknown, opts?: { signal?: AbortSignal }): Promise<string>;
      };
      const controller = new AbortController();
      const answer = backend.askApproval('sess-abort-1', { summary: '撤销形审批' }, { signal: controller.signal });
      await until(() => seams.sends.length >= 1); // 摘要已推（abort 不撤回已推文本）
      controller.abort();
      await expect(answer).resolves.toBe('cancel');
      // 挂起已清：同 chat 立新问可正常收口（不被已 abort 的旧挂起吞答）
      const next = backend.askApproval('sess-abort-1', { summary: '后续审批' });
      await until(() => seams.sends.length >= 2);
      await seams.waitPoll();
      seams.releasePoll({ updates: [tgTextMessage(424242, '拒绝')], nextOffset: 2 });
      await expect(next).resolves.toBe('reject');
      // 入口即已 abort 的预检形：监听对已 abort 信号零回调——预检直收口 'cancel'
      const pre = new AbortController();
      pre.abort();
      await expect(
        backend.askApproval('sess-abort-1', { summary: '入口撤销形' }, { signal: pre.signal }),
      ).resolves.toBe('cancel');
    } finally {
      dispose?.();
      __tg.poll = undefined;
      __tg.send = undefined;
    }
  });

  it('锚六：零 token 降级——askApproval 即决 unavailable（零推送）+ hasAudience false（收发链整体退位为证词票）', async () => {
    const rig = assemble(FULL_OPENS);
    provideToken(rig.scope, false); // 凭证缺席——降级装载形（循环不起）
    const seams = installSeams();
    let dispose: (() => void) | undefined;
    try {
      dispose = await activate(rig.handle.ctx, { bindings: [{ chat: '424242', session: 'sess-notok-1' }] });
      // 装载期缺凭证 warn 恰一条（降级可诊——指路录入命令）
      expect(rig.notifies.filter((n) => n.level === 'warn')).toHaveLength(1);
      const backend = rig.backends[0] as unknown as {
        hasAudience(): boolean;
        askApproval(sessionId: string, request: unknown, opts?: unknown): Promise<string>;
      };
      // 静态绑定在场 + 零 token → 观众探针 false（绑定有人也送不达——整体退位）
      expect(backend.hasAudience()).toBe(false);
      // askApproval 即决证词票（修前形：挂起永不退位——本断言以测试超时红咬洞）
      await expect(backend.askApproval('sess-notok-1', { summary: '零 token 审批' })).resolves.toBe('unavailable');
      // 零推送（短路先于摘要推送——sends 恒空是短路的直接证据）
      expect(seams.sends).toEqual([]);
    } finally {
      dispose?.();
      __tg.poll = undefined;
      __tg.send = undefined;
    }
  });
});
