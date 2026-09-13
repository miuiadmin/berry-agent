/**
 * hook-carried 模式全链回归锁（03 §2.1 异步续段开窗批定形注——q-3 ②）。
 *
 * 锁的对象：第三方（磁盘行）异步发现的官方表达 = apply 期 fire-and-forget
 * 起异步任务（结果暂存闭包变量）+ 前置消费钩（agent_pre_step——生产派发的
 * 请求前瀑布钩）handler 内携带注册（回调窗内合法）。全链四断言（分面语义
 * ——冷读闸核真勘正后定形）：
 *  ① 注册即时入 boot 全局册（owner 归因插件 id）；
 *  ② 在飞会话的工具面当轮不可见（现状锁——工具面消费点 = 会话装配，driver
 *     构造时冻结拷贝，已开会话不重取）；
 *  ③ 之后新装配的会话工具面可见（bootTools 供应子会话装配时点重取当前册）；
 *  ④ 窗外直调红例照旧（异步任务内直接 ctx.tools.register 撞
 *     PLUGIN_WINDOW_CLOSED——窗闸对无钩携带形照执法，有意禁区的执法面）。
 *
 * 全栈形：真盘插件目录（真 jiti 装载）+ bootPlugins（真窗闸生命周期——
 * onApplySettled 行收口关窗）+ createConversationStack（真会话装配 + 真
 * loop）+ faux provider（mock 只停在模型层）；dispatch 单源共享（boot 的
 * 钩子注册与 driver 的 agent_pre_step 瀑布同一总线——生产装配同形）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { EventDispatch, Scope } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';

import { bootPlugins } from './plugin-boot.js';
import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';

/** 临时目录族（数据目录 × 工作区目录统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装 stop 终态的 assistant 消息（faux 响应脚本用——pi-ai 面形状） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/**
 * 第三方插件真身源（plain JS——jiti 转译装载）。两腿并存：
 *  - 异步发现腿：apply 期 setTimeout fire-and-forget（宏任务边界——装载窗
 *    收口后到达）；腿内另做窗外直调红例（④）——直调注册被窗闸拒，错误码
 *    挂 globalThis 供测试面断言；
 *  - 携带注册腿：agent_pre_step handler 查旗标后注册（回调窗内合法），
 *    registered 旗防多轮重复注册。
 */
const ENTRY_SRC = [
  'export const inject = [];',
  'let discovered = false;',
  'export default async (ctx) => {',
  '  // apply 期 fire-and-forget 异步发现（模拟 MCP 式后台握手：结果暂存闭包',
  '  // 变量，注册不在此做——此处是窗外，直调即有意禁区执法面）',
  '  setTimeout(() => {',
  '    discovered = true;',
  '    try {',
  '      ctx.tools.register({',
  '        name: "hc_direct_forbidden",',
  '        description: "窗外直调形（不应到达）",',
  '        parameters: { type: "object", properties: {} },',
  '      });',
  '      globalThis.__hcDirectCode = "REGISTERED";',
  '    } catch (err) {',
  '      globalThis.__hcDirectCode = err && err.code ? err.code : String(err);',
  '    }',
  '  }, 5);',
  '  // 前置消费钩携带注册（官方表达——回调窗内合法）',
  '  let registered = false;',
  '  ctx.on("agent_pre_step", (value) => {',
  '    if (discovered && !registered) {',
  '      registered = true;',
  '      ctx.tools.register({',
  '        name: "hc_async_lookup",',
  '        description: "异步发现工具",',
  '        parameters: { type: "object", properties: {} },',
  '      });',
  '    }',
  '    return value; // waterfall 直通（不刹停不改载）',
  '  });',
  '};',
].join('\n');

describe('hook-carried 模式全链（03 §2.1 异步续段开窗批——磁盘插件异步发现官方表达）', () => {
  it('四断言：即时入册+owner 归因 / 在飞当轮不可见 / 新装配会话可见 / 窗外直调拒', async () => {
    // globality 旗清残（用例幂等——重跑不读上轮残值）
    delete (globalThis as Record<string, unknown>).__hcDirectCode;

    const dataDir = mkdtempSync(join(tmpdir(), 'hc-data-'));
    const ws1 = mkdtempSync(join(tmpdir(), 'hc-ws1-'));
    const ws2 = mkdtempSync(join(tmpdir(), 'hc-ws2-'));
    dirs.push(dataDir, ws1, ws2);

    // 真盘第三方插件：装机树 + enabled.yaml + ledger.json（bootPlugins 读侧三源）
    const pluginDir = join(dataDir, 'plugins', 'node_modules', 'hc-async');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'hc-async', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(join(pluginDir, 'entry.js'), ENTRY_SRC);
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: hc-async\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'hc-async': { installPath: 'plugins/node_modules/hc-async' } }),
    );

    const rt = createHostRuntime({ dataDir });
    // 共享 dispatch：boot 的钩子注册与 driver 的 agent_pre_step 瀑布同一总线
    // （生产装配同形——assembly 单 dispatch 双消费）
    const dispatch = new EventDispatch();
    let boot: Awaited<ReturnType<typeof bootPlugins>> | undefined;
    const faux = fauxProvider({ provider: 'faux-hc', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-hc/m1',
      env: {}, // BERRY_AGENT_MODEL 隔离——测试面自持模型
      dispatch,
      // 装载工具定义重放取值器（生产 wiring 同形——assembly.ts bootTools 位；
      // 会话装配时点求值 = 「新装配会话可见」断言的消费真源）
      bootTools: () => [...(boot?.tools.definitions() ?? [])],
    });

    boot = await bootPlugins({
      runtime: rt,
      scope: Scope.createRoot(),
      dispatch,
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      version: '9.9.9-test',
      warn: () => undefined,
    });
    expect(boot.report.failed).toEqual([]); // 装载零失败（entry 形状合法）
    expect(boot.report.activated.map((a) => a.id)).toEqual(['hc-async']);

    // 异步发现落定（宏任务）+ 窗外直调红例已撞（④——装载窗已收口，直调形
    // 被窗闸拒；错误码经 globalThis 回传）
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((globalThis as Record<string, unknown>).__hcDirectCode).toBe('PLUGIN_WINDOW_CLOSED');

    // 消费钩尚未触发过——boot 册干净（注册只在钩内发生）
    expect(boot.tools.definitions().some((t) => t.name === 'hc_async_lookup')).toBe(false);

    // 会话 1 装配（此刻册无此工具——面冻结不含）
    const s1 = stack.openStartupSession(ws1);
    expect(stack.driverOf(s1.sessionId)!.toolNames).not.toContain('hc_async_lookup');

    // 第一轮：agent_pre_step 瀑布在请求组装前派发 → handler 回调窗内携带注册
    faux.setResponses([() => messageOf()]);
    const receipt = await stack.submitText(s1.sessionId, '第一轮');
    expect(receipt).toMatchObject({ status: 'completed' }); // 全链：驱动→loop→瀑布→streamFn→faux

    // ① 注册即时入 boot 全局册 + owner 归因插件 id（受理壳铸造——自报不达）
    const def = boot.tools.definitions().find((t) => t.name === 'hc_async_lookup');
    expect(def).toMatchObject({ name: 'hc_async_lookup', owner: 'hc-async' });
    // ② 在飞会话当轮不可见（现状锁——driver 构造时冻结拷贝，已开会话不重取）
    expect(stack.driverOf(s1.sessionId)!.toolNames).not.toContain('hc_async_lookup');
    // ③ 之后新装配的会话工具面可见（bootTools 供应子装配时点重取当前册）
    const s2 = stack.openStartupSession(ws2);
    expect(stack.driverOf(s2.sessionId)!.toolNames).toContain('hc_async_lookup');

    await rt.shutdown(); // 真库收口（closer 序含 persistence flush）
  });
});
