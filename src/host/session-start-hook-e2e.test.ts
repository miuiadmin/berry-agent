/**
 * session_start 全链 e2e 回归锁（03 §2.4 主表行——2026-10-16 硬伤处置第三批
 * ·②落码笔；修前红形态 = 真装配下挂 session_start handler 永不触发——41 词
 * 在册死词的生产派发位兑现批）。
 *
 * 锁的对象（两腿同链）：
 *  - 主动腿：真盘插件（jiti 装载）ctx.on('session_start') + createConversationStack
 *    真装配 openStartupSession（manager.create → adopt 共尾）→ handler 收执
 *    {sessionId, origin:'conversation'}——首发无 replay 位；
 *  - 补播腿：第二轮装载（/reload 换代形——sessionStartReplay 取值器按生产
 *    装配 wiring 注入 stack.manager.listActive()）→ 对在册既存会话补发
 *    replay:true。
 *
 * 全栈形同 hook-carried-tools.test.ts 惯例：真盘插件目录（真 jiti）+
 * bootPlugins（真装载管线）+ createConversationStack（真会话装配）+ 共享
 * dispatch 单源（boot 钩子注册与 adopt 发射同一总线——生产装配同形）；本用例
 * 不驱动 run（纯编排断言——session_start 发射在 run 之前，无需模型层）。
 *
 * 清偿批（2026-10-16 硬伤处置第三批·p2-sessionstart清偿——冷读闸 finding 2）：
 * 上方 e2e 的补播腿 sessionStartReplay 系手工注入「按生产 wiring 同形重现」，
 * assembly.ts 装配根 runBoot 闭包的注入行（stack.manager.listActive()）零测试
 * 覆盖——注入行被删则单测（注入替身）与 e2e（手工注入）双绿、/reload 补播在
 * 生产形静默零发（诚实缺席律语义掩盖 wiring 回归）。补生产 wiring 点名锁
 * （第二笔 it）：assembleHostStack 真装配 + reloader 真换代，删注入行即红——
 * 「单测假注入绿掩盖装配缺口」谱的真装配锁律。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';

import { assembleHostStack } from './assembly.js';
import { bootPlugins } from './plugin-boot.js';
import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { CorePluginReference } from './loader.js';

/** 临时目录族（数据目录 × 工作区目录统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 插件侧收执账（globalThis 回传——jiti 隔离模块系同 globalThis 面） */
type SeenPayload = { sessionId: string; origin: string; replay?: boolean };

/**
 * 第三方插件真身源（plain JS——jiti 转译装载）：apply 期挂 session_start
 * handler，载荷整值经 globalThis 回传（测试面断言真源）。
 */
const ENTRY_SRC = [
  'export const inject = [];',
  'export default async (ctx) => {',
  '  ctx.on("session_start", (payload) => {',
  '    (globalThis.__ssSeen ??= []).push(payload);',
  '  });',
  '};',
].join('\n');

describe('session_start 全链 e2e（真装配两腿——主动腿首发 + 换代补播）', () => {
  it('主动腿：真装配 openStartupSession 后 handler 收执首发载荷（origin 五值直传、无 replay 位）；补播腿：换代装载对在册既存会话补发 replay:true', async () => {
    // 收执账清残（用例幂等——重跑不读上轮残值）
    delete (globalThis as Record<string, unknown>).__ssSeen;

    const dataDir = mkdtempSync(join(tmpdir(), 'ss-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'ss-ws-'));
    dirs.push(dataDir, ws);

    // 真盘第三方插件：装机树 + enabled.yaml + ledger.json（bootPlugins 读侧三源）
    const pluginDir = join(dataDir, 'plugins', 'node_modules', 'ss-observer');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'ss-observer', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(join(pluginDir, 'entry.js'), ENTRY_SRC);
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: ss-observer\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'ss-observer': { installPath: 'plugins/node_modules/ss-observer' } }),
    );

    const rt = createHostRuntime({ dataDir });
    // 共享 dispatch：boot 的钩子词汇预注册与 adopt 的 session_start 发射同一总线
    // （生产装配同形——assembly 单 dispatch 双消费）；faux provider 只为栈级
    // 模型解析确定性（本用例不驱动 run——session_start 发射在 run 之前）
    const dispatch = new EventDispatch();
    const faux = fauxProvider({ provider: 'faux-ss', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-ss/m1',
      env: {}, // BERRY_AGENT_MODEL 隔离——测试面自持模型
      dispatch,
    });

    // 第一轮装载（boot 装载序——此刻在册近零：openStartupSession 归入口层装配
    // 后段，sessionStartReplay 未注入 = 直测形零补播）
    const boot1 = await bootPlugins({
      runtime: rt,
      scope: Scope.createRoot(),
      dispatch,
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      version: '9.9.9-test',
      warn: () => undefined,
    });
    expect(boot1.report.failed).toEqual([]); // 装载零失败（entry 形状合法）
    expect((globalThis as { __ssSeen?: SeenPayload[] }).__ssSeen).toBeUndefined(); // 零补播（取值器缺席）

    // 开机会话（生产入口层同形——cwd 无归一根会话即新建）：manager.create →
    // adopt 共尾 → session_start 主动腿首发
    const started = stack.openStartupSession(ws);
    expect(started.resumed).toBe(false); // 全新会话腿（origin 缺省 conversation）
    const firstLeg = (globalThis as { __ssSeen?: SeenPayload[] }).__ssSeen ?? [];
    expect(firstLeg).toEqual([{ sessionId: started.sessionId, origin: 'conversation' }]); // 首发无 replay 位

    // 第二轮装载（/reload 换代形——sessionStartReplay 按生产 wiring 注入活体
    // 会话册投影单源）：装载收口对在册既存会话补发 replay:true
    const seen = (globalThis as { __ssSeen?: SeenPayload[] }).__ssSeen ?? [];
    seen.length = 0; // 主动腿笔不计——补播段独占断言面
    const boot2 = await bootPlugins({
      runtime: rt,
      scope: Scope.createRoot(),
      dispatch,
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      version: '9.9.9-test',
      warn: () => undefined,
      sessionStartReplay: () => stack.manager.listActive(),
    });
    expect(boot2.report.failed).toEqual([]);
    const afterReload = (globalThis as { __ssSeen?: SeenPayload[] }).__ssSeen ?? [];
    // 换代补播到达（本 rig 形不跑旧代回卷——新旧代听者同收同笔，存在性断言：
    // 每听者恰同形载荷，replay:true 且 origin 原值直传）
    const replayed = afterReload.filter((p) => p.sessionId === started.sessionId);
    expect(replayed.length).toBeGreaterThanOrEqual(1);
    for (const entry of replayed) {
      expect(entry).toEqual({ sessionId: started.sessionId, origin: 'conversation', replay: true });
    }

    await rt.shutdown(); // 真库收口（closer 序含 persistence flush）
  });

  it('生产 wiring 点名锁：assembleHostStack 真装配 + reloader 真换代——sessionStartReplay 注入行在场且补播到达（删 assembly.ts 注入行即红）', async () => {
    // 锁的对象：assembly.ts 装配根 runBoot 闭包的 sessionStartReplay 注入行
    // （stack.manager.listActive() 活体投影单源）。上方 e2e 系手工注入——本笔
    // 走真装配：注入行缺席 = /reload 补播静默零发，本 it 红（wiring 回归的
    // 唯一测试覆盖面）。noPlugins:false 真装载形（noPlugins 短路不跑装载
    // 收口/补播段）。
    const dir = mkdtempSync(join(tmpdir(), 'ss-wire-'));
    const ws = mkdtempSync(join(tmpdir(), 'ss-wire-ws-'));
    dirs.push(dir, ws);
    // 最小 core 件（占装载面；disposer 记账 = 换代整代回卷确证位）
    const disposed: string[] = [];
    const probe: CorePluginReference = {
      name: 'ss-wire-probe',
      apply: async () => () => void disposed.push('probe'),
    };
    const faux = fauxProvider({ provider: 'faux-ss-wire', models: [{ id: 'm1' }] });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [probe],
      providers: [faux.provider],
      model: 'faux-ss-wire/m1',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // assembly.dispatch = 生产共享总线单源（boot 词汇预注册与 adopt 发射同
      // 一 EventDispatch）——真装配形直订阅，非手工 rig
      const seen: SeenPayload[] = [];
      assembly.dispatch.on('session_start', (payload) => void seen.push(payload as SeenPayload));
      // 主动腿（真装配）：开机会话（cwd 无归一根会话即新建）→ adopt 共尾首发
      const started = assembly.stack.openStartupSession(ws);
      expect(started.resumed).toBe(false); // 全新会话腿（origin 缺省 conversation）
      expect(seen).toEqual([{ sessionId: started.sessionId, origin: 'conversation' }]); // 首发无 replay 位
      seen.length = 0; // 主动腿笔不计——补播段独占断言面
      // /reload 真换代：runBoot 闭包重跑 → bootPlugins 受局面 sessionStartReplay
      // 按装配注入行取 listActive() → 对在册既存会话补发 replay:true
      assembly.reloader.request();
      await assembly.reloader.settle();
      expect(seen).toEqual([{ sessionId: started.sessionId, origin: 'conversation', replay: true }]);
      expect(disposed).toEqual(['probe']); // 旧代整代回卷确证（reapply 真跑非空转）
    } finally {
      await assembly.runtime.shutdown();
    }
    // shutdown 收口新代（换代槽不累积——直注册形下会重跑整个旧代）
    expect(disposed).toEqual(['probe', 'probe']);
  });
});
