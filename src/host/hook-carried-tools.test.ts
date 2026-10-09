/**
 * hook-carried 模式全链回归锁（03 §2.1 异步续段开窗批定形注——q-3 ②）。
 *
 * 锁的对象：第三方（磁盘行）异步发现的官方表达 = apply 期 fire-and-forget
 * 起异步任务（结果暂存闭包变量）+ 前置消费钩（agent_pre_step——生产派发的
 * 请求前瀑布钩）handler 内携带注册（回调窗内合法）。全链四断言（分面语义
 * ——冷读闸核真勘正后定形；2026-10-09 pi-3 件 A 批断言② 翻转+另立执行期锁）：
 *  ① 注册即时入 boot 全局册（owner 归因插件 id）；
 *  ② 在飞会话当轮即见（pi-3 件 A 翻转锁——组装前到达窗：agent_pre_step
 *     钩内携带注册先于请求组装，驱动请求边界差量对账〔refreshToolFace〕
 *     当轮换新面——03 §2.8 到达窗分面）；
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
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';

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
    // ② 在飞会话当轮即见（pi-3 件 A 翻转——组装前到达窗：钩内注册先于请求
    // 组装位，驱动对账当轮换新面；修前「装配断链」形下本位为 not.toContain
    // 现状锁——04 §4 义务句兑现后翻转）
    expect(stack.driverOf(s1.sessionId)!.toolNames).toContain('hc_async_lookup');
    // ③ 之后新装配的会话工具面可见（bootTools 供应子装配时点重取当前册）
    const s2 = stack.openStartupSession(ws2);
    expect(stack.driverOf(s2.sessionId)!.toolNames).toContain('hc_async_lookup');

    await rt.shutdown(); // 真库收口（closer 序含 persistence flush）
  });

  it('执行期注册下一请求即见（pi-3 件 A——组装后到达窗：工具执行体内注册，下一请求组装位兑现）', async () => {
    // globality 旗清残（用例幂等——重跑不读上轮残值）
    delete (globalThis as Record<string, unknown>).__hcSpawnCode;

    const dataDir = mkdtempSync(join(tmpdir(), 'hc2-data-'));
    const ws = mkdtempSync(join(tmpdir(), 'hc2-ws-'));
    dirs.push(dataDir, ws);

    // 种子工具插件：apply 期注册携 execute 的种子件；execute 体内（宿主
    // 回调窗——plugin-context 受理壳外包，03 §2.1 例外条款）再注册派生件
    // ——组装后到达窗形（请求已在飞、工具面已快照，兑现位 = 下一请求组装）。
    // 种子件声明 effect read：缺席归一 write/exec 最危形走审批闸，测试环境
    // 无审批人应答即 fail-closed 拒执行（execute 体进不去——到达窗测不到）
    const pluginDir = join(dataDir, 'plugins', 'node_modules', 'hc-spawn');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'hc-spawn', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(
      join(pluginDir, 'entry.js'),
      [
        'export const inject = [];',
        'export default async (ctx) => {',
        '  ctx.tools.register({',
        '    name: "hc_seed_tool",',
        '    description: "种子工具（执行期派生注册）",',
        '    parameters: { type: "object", properties: {} },',
        '    effect: "read",',
        '    execute: async () => {',
        '      try {',
        '        ctx.tools.register({',
        '          name: "hc_runtime_spawned",',
        '          description: "执行期派生工具",',
        '          parameters: { type: "object", properties: {} },',
        '          execute: async () => ({ content: [{ type: "text", text: "ok" }] }),',
        '        });',
        '        globalThis.__hcSpawnCode = "REGISTERED";',
        '      } catch (err) {',
        '        globalThis.__hcSpawnCode = err && err.code ? err.code : String(err);',
        '      }',
        '      return { content: [{ type: "text", text: "spawned" }] };',
        '    },',
        '  });',
        '};',
      ].join('\n'),
    );
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: hc-spawn\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'hc-spawn': { installPath: 'plugins/node_modules/hc-spawn' } }),
    );

    const rt = createHostRuntime({ dataDir });
    const dispatch = new EventDispatch();
    let boot: Awaited<ReturnType<typeof bootPlugins>> | undefined;
    const faux = fauxProvider({ provider: 'faux-hc2', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-hc2/m1',
      env: {},
      dispatch,
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
    expect(boot.report.failed).toEqual([]);
    expect(boot.tools.definitions().map((t) => t.name)).toContain('hc_seed_tool'); // 种子件 apply 期入册

    const s1 = stack.openStartupSession(ws);
    // 装配面含种子件（apply 期注册先于会话装配）；派生件尚未注册
    expect(stack.driverOf(s1.sessionId)!.toolNames).toContain('hc_seed_tool');
    expect(stack.driverOf(s1.sessionId)!.toolNames).not.toContain('hc_runtime_spawned');

    // 两步脚本：① toolUse 调种子件（执行体内注册派生件）；② 捕获第二请求
    // 组装面（context.tools——到达窗兑现位）后收 stop
    const secondFace: string[] = [];
    faux.setResponses([
      () => fauxAssistantMessage(fauxToolCall('hc_seed_tool', {}), { stopReason: 'toolUse' }),
      (context) => {
        // TranscriptContext 无顶层 tools 字段——normalizeContext 把工具声明
        // 折叠进 leading SystemMessage.toolsAdded（pi-ai 1.x 折叠形）
        const leading = context.messages.find((m) => m.role === 'system') as
          { toolsAdded?: Array<{ name: string }> } | undefined;
        secondFace.push(...(leading?.toolsAdded ?? []).map((tool) => tool.name));
        return messageOf();
      },
    ]);
    const receipt = await stack.submitText(s1.sessionId, '跑种子');
    expect(receipt).toMatchObject({ status: 'completed' });
    // 执行体内注册成功（非窗拒）——执行体回调窗兑现（03 §2.1 立法：受理壳
    // executeWithWindow 外包；若无外包此位 = PLUGIN_WINDOW_CLOSED——本断言
    // 即窗闸修复的执行期回归锁）
    expect((globalThis as Record<string, unknown>).__hcSpawnCode).toBe('REGISTERED');
    // 执行期注册即时入 boot 册全局层（owner 归因 hc-spawn）
    const spawned = boot!.tools.definitions().find((t) => t.name === 'hc_runtime_spawned');
    expect(spawned).toMatchObject({ name: 'hc_runtime_spawned', owner: 'hc-spawn' });

    // 组装后到达窗兑现：执行期注册的派生件在第二请求组装面在场（第一请求
    // 面无此件——当轮请求已在飞不可见，下一请求即见）
    expect(secondFace).toContain('hc_seed_tool'); // 种子件未变不动（对账不回卷）
    expect(secondFace).toContain('hc_runtime_spawned'); // 派生件下一请求即见
    expect(stack.driverOf(s1.sessionId)!.toolNames).toContain('hc_runtime_spawned'); // 驱动面同换新

    await rt.shutdown();
  });
});
