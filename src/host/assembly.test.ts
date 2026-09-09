/**
 * host/assembly 组合根测试——装配序公共段（批 12f-3 防侧门件：TUI 入口与
 * dump-config / plugins list 诊断命令**同一合成代码路径**的执法证据）。
 *
 * 失败三档归一全景：干净退出档（运行时组装失败）× 启用清单损坏档
 * （PLUGIN_ROW_INVALID 先收口再返回——标记释放即证据）× 崩溃取证档
 * （意外异常 crashed:true + crash.log 按 memory 位跳过——诊断形 dataDir
 * 在场仍跳过）。真盘真库（临时目录）+ 真装载管线（core 件 in-process）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { ACTIVE_MARKER_BASENAME } from './single-instance.js';
import { assembleHostStack, createControlOpensFor, readDoorsSegmentLive, readTriggerOpensLive } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import { createHostRuntime } from './runtime.js';
import { readAllowlist } from './allowlist-store.js';
import { openWebuiFace } from './webui-bridge.js';
import type { PluginRouteRegistry } from '../sdk/index.js';
import { createAuditFace } from '../persist/index.js';
import type { SkillsRegistry } from '../skills/index.js';
import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { UiBackend } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录速记 */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** faux 终态文本消息速记（pi-ai 面形状——结构同构缺元数据字段收口在此） */
function fauxText(text: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 零用量形状（faux 消息统一 usage 位） */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 工具调用消息速记（审批链 e2e 驱动面——R-1 回归锁用） */
function toolCallOf(id: string, name: string, args: Record<string, unknown>): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    usage: NO_USAGE,
    stopReason: 'toolUse',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

describe('allowlist 装配期载入（批 12f-4——04 §9 定形块读侧律）', () => {
  it('好形 allowlist.json：装配照常成功（advisory 免问面在场不拦装配序）', async () => {
    const dir = tmpDir('host-asm-al-ok-');
    writeFileSync(join(dir, 'allowlist.json'), JSON.stringify({ entries: [{ tool: 'write', pattern: '/w/a.md' }] }));
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });

  it('文件级坏形：warn 降级视同空清单——装配仍成功（与 enabled.yaml 拒启律分立的回归锁）', async () => {
    const dir = tmpDir('host-asm-al-bad-');
    writeFileSync(join(dir, 'allowlist.json'), '{ Oops'); // JSON 坏形
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    // advisory 面坏形降级方向 = 更严（多问）不是拒启（fail-closed 同向）——拒启律是 enabled.yaml 专属
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });

  it('纯 memory 形（dataDir null）：allowlist 双缺不炸——装配照常', async () => {
    const assembly = await assembleHostStack({
      runtime: { memory: true },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(true);
    if (assembly.ok) await assembly.runtime.shutdown();
  });
});

describe('assembleHostStack 成功档', () => {
  it('六柄一匣 + corePlugins 透传面（enabled.yaml 缺席 = core 内置态全装）', async () => {
    const dir = tmpDir('host-asm-ok-');
    const applied: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => void applied.push('demo') };
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [ref],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      expect(applied).toEqual(['demo']); // 装载管线真跑（apply 全执行）
      expect(assembly.runtime.dataDir).toBe(dir);
      expect(assembly.boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
      expect(assembly.pluginCounts).toEqual({ total: 1, enabled: 1, failed: 0 }); // 披露匣已回写
      expect(typeof assembly.stack.model).toBe('string'); // 栈五层真装配（模型缺省解析在栈内）
      expect(assembly.dispatch).toBeDefined();
      expect(assembly.scope).toBeDefined();
      expect(assembly.logger).toBeDefined();
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('subagent 装载 e2e（批 19c-1）：boot agent 工具经会话执行 → in-process 真工厂 one-shot + 子会话 durable 行', async () => {
    const dir = tmpDir('host-asm-sub-');
    const ws = tmpDir('host-asm-sub-ws-');
    const faux = fauxProvider({ provider: 'faux-asm', models: [{ id: 'm1' }] });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
      providers: [faux.provider],
      model: 'faux-asm/m1',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 工具装载腿：`agent` 在 boot 全局层（createAgentTool——effect read）
      const agentDef = assembly.boot.tools.definitions().find((definition) => definition.name === 'agent');
      expect(agentDef).toBeDefined();
      // owner 归因（T9 案一批 t-1——03 §2.3 尾注族谱）：agent 工具经
      // ctx.tools.register 注册（core:subagent 域物化）——受理壳覆写自然铸得
      // 'core:subagent'，无需另立铸造位（冷读闸 M2 实质消解的回归锁）
      expect(agentDef!.owner).toBe('core:subagent');

      // 父会话 + 直接执行（def 形 execute(args, toolCtx)——sessionId 即
      // 执行时会话语境，sessionContext 解析真源（assembly 织入位））
      const parent = assembly.stack.openStartupSession(ws);
      faux.setResponses([() => fauxText('侦察完毕')]);
      const result = await agentDef!.execute(
        { prompt: '去侦察' },
        { toolCallId: 'c-e2e', sessionId: parent.sessionId },
      );
      expect(result.isError).not.toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain('侦察完毕'); // one-shot 输出映射（尾扫 assistant text）

      // 子会话 durable 行（origin delegation——真工厂全栈落库）
      await assembly.runtime.persistence.flush();
      const child = assembly.stack.manager.list({}).find((row) => row.origin === 'delegation');
      expect(child).toBeDefined();
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('subagent background 结算通知 e2e（批 19c-1）：fire-and-forget → 通知桥 submitText → 父 durable 落 user/message source=subagent-settled', async () => {
    const dir = tmpDir('host-asm-subbg-');
    const ws = tmpDir('host-asm-subbg-ws-');
    const faux = fauxProvider({ provider: 'faux-asm', models: [{ id: 'm1' }] });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
      providers: [faux.provider],
      model: 'faux-asm/m1',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const agentDef = assembly.boot.tools.definitions().find((definition) => definition.name === 'agent');
      if (agentDef === undefined) throw new Error('agent 工具不在 boot 面');
      const parent = assembly.stack.openStartupSession(ws);
      // 两响：子代理 one-shot + 父结算唤醒 turn（submitText backgroundWake 起跑）
      faux.setResponses([() => fauxText('后台活干完'), () => fauxText('收到结算')]);
      const result = await agentDef.execute(
        { prompt: '后台去', background: true },
        { toolCallId: 'c-bg', sessionId: parent.sessionId },
      );
      expect(result.isError).not.toBe(true); // Job 身份回执（fire-and-forget）

      // 轮询父 durable：结算通知经 submitText 落 user/message（source 标记位）
      const parentLog = assembly.stack.manager.driverOf(parent.sessionId)!.session;
      const deadline = Date.now() + 5_000;
      let settled = false;
      while (Date.now() < deadline) {
        settled = parentLog
          .events()
          .some(
            (event) =>
              event.type === 'user/message' && (event.data as { source?: string }).source === 'subagent-settled',
          );
        if (settled) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(settled).toBe(true); // 通知桥真落（assembly 织入——批 19c-1 兑现）
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('skills_change 事件桥（批 19b-1）：registry refresh → dispatch skills_change 发射（载荷 = provider 清单）', async () => {
    const dir = tmpDir('host-asm-skchg-');
    // 缺省 createCorePlugins 真跑形（exec/web/skills 三件——桥只在 skills 服务在场时挂）
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const registry = assembly.scope.tryGet<SkillsRegistry>('skills');
      expect(registry).toBeDefined(); // core:skills 装载（真跑形回归锁）
      const received: Array<{ providers?: readonly string[] }> = [];
      assembly.dispatch.on('skills_change', (data) => {
        received.push(data as { providers?: readonly string[] });
      });
      await registry!.refresh(); // runRefresh 尾无条件通知——桥即刻发射
      expect(received).toHaveLength(1);
      expect(received[0]!.providers).toContain('project'); // 载荷 = 现行 provider id 清单（06 §11.3）
      expect(received[0]!.providers).toContain('factory');
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('磁盘件技能载荷层补注册（批 19 skills 销账——06 §11.4 位 4）：位序压出厂层 + 快照入册 + 卸载摘除对称', async () => {
    const dir = tmpDir('host-asm-skill4-');
    // 装机树磁盘件：清单声明 skills 目录（相对包根）+ 一件真 SKILL.md
    const plugDir = join(dir, 'plugins', 'plug-sk');
    mkdirSync(join(plugDir, 'skills', 'demo-skill'), { recursive: true });
    writeFileSync(
      join(plugDir, 'package.json'),
      JSON.stringify({ name: 'plug-sk', version: '1.0.0', berryAgent: { skills: ['./skills'] } }),
    );
    writeFileSync(
      join(plugDir, 'skills', 'demo-skill', 'SKILL.md'),
      '---\nname: demo-skill\ndescription: 装载面测试技能\n---\n\n用法正文。\n',
    );
    // 装机账本（id 键映射形）+ 启用清单行
    writeFileSync(
      join(dir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'plug-sk': { installPath: 'plugins/plug-sk' } }),
    );
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: plug-sk\n');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const registry = assembly.scope.tryGet<SkillsRegistry>('skills');
      expect(registry).toBeDefined();
      // 磁盘件真激活（零码装载 declared-payload 态——skillDirs 随行）
      expect(assembly.boot.report.activated.map((a) => a.id)).toContain('plug-sk');
      expect(assembly.boot.report.activated.find((a) => a.id === 'plug-sk')!.skillDirs).toEqual([
        join(plugDir, 'skills'),
      ]);
      // 位序执法：project > user > cross-repo > 插件层 > factory（06 §11.3 注册序
      // 即优先序——插件层压出厂层，摘 factory 重挂编舞的落点证据）
      const ids = registry!.providerIds();
      expect(ids.indexOf('plugin:plug-sk')).toBeGreaterThan(ids.indexOf('cross-repo'));
      expect(ids.indexOf('plugin:plug-sk')).toBeLessThan(ids.indexOf('factory'));
      // 快照入册：补注册 refresh 已落（渐进披露面即见插件技能）
      expect(registry!.list().map((s) => s.name)).toContain('demo-skill');
      // 卸载对称（03 §6.2 技能层摘除）：收口后插件层出局 + 快照重扫出局
      await assembly.runtime.shutdown();
      expect(registry!.providerIds()).not.toContain('plugin:plug-sk');
      expect(registry!.providerIds()).toContain('factory'); // 标准层不受卸载连坐
      expect(registry!.list().map((s) => s.name)).not.toContain('demo-skill');
    } finally {
      await assembly.runtime.shutdown(); // 幂等（六步照走）
    }
  });

  it('session/event 活体镜像桥（批 19b-2）：durable append → dispatch 发射（载荷镜像）', async () => {
    const dir = tmpDir('host-asm-sevent-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const received: Array<{ sessionId: string; event: { type: string } }> = [];
      assembly.dispatch.on('session/event', (data) => {
        received.push(data as { sessionId: string; event: { type: string } });
      });
      const log = assembly.runtime.persistence.createSession({ origin: 'conversation' });
      log.append('user/message', { content: '桥验证', source: 'user' });
      expect(received).toHaveLength(1);
      expect(received[0]!.sessionId).toBe(log.sessionId);
      expect(received[0]!.event.type).toBe('user/message');
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('session/event 桥守卫：noPlugins 形（词汇未注册）append 不炸——零发射', async () => {
    const dir = tmpDir('host-asm-sevg-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: true,
      debug: false,
      version: 'x',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const log = assembly.runtime.persistence.createSession({ origin: 'conversation' });
      expect(() => log.append('user/message', { content: 'x', source: 'user' })).not.toThrow(); // isRegistered 守卫
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

describe('失败三档归一（不抛——呈报面归调用方）', () => {
  it('运行时组装失败 = 干净退出档（crashed:false——运行时未建成无资源待收）', async () => {
    const dir = tmpDir('host-asm-busy-');
    const first = createHostRuntime({ dataDir: dir }); // 占标记（单活跃机在飞）
    try {
      const assembly = await assembleHostStack({
        runtime: { dataDir: dir },
        noPlugins: true,
        debug: false,
        version: 'x',
      });
      expect(assembly.ok).toBe(false);
      if (!assembly.ok) {
        expect(assembly.exitCode).toBe(1);
        expect(assembly.crashed).toBe(false);
        expect(assembly.message).toContain('启动失败'); // 前缀归一（HOST_DATA_DIR_BUSY 细目在运行时域测）
      }
    } finally {
      await first.shutdown();
    }
  });

  it('启用清单损坏 = 用户可自修档（crashed:false + 修复指引 + 先收口——标记已释放）', async () => {
    const dir = tmpDir('host-asm-invalid-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops'); // yaml 坏形 fail-loud
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
    });
    expect(assembly.ok).toBe(false);
    if (!assembly.ok) {
      expect(assembly.exitCode).toBe(1);
      expect(assembly.crashed).toBe(false);
      expect(assembly.message).toContain('启动失败');
      expect(assembly.message).toContain('修复或删除'); // 修复指引透出
    }
    // 已建运行时先收口再返回——单活跃标记已释放（接管无残留）
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(false);
    expect(existsSync(join(dir, 'crash.log'))).toBe(false); // 干净退出档不取证
  });

  it('意外异常 = 崩溃取证档（crashed:true + 资源收口 + memory 位 crash.log 跳过——诊断形 dataDir 在场仍跳过）', async () => {
    const dir = tmpDir('host-asm-crash-');
    const assembly = await assembleHostStack({
      runtime: { memory: true, dataDir: dir }, // 同构诊断形（与 dump-config 真实用法同形）
      noPlugins: true,
      debug: false,
      version: 'x',
      onRuntime: () => {
        throw new Error('boom'); // 运行时组装后回调内注入意外异常
      },
    });
    expect(assembly.ok).toBe(false);
    if (!assembly.ok) {
      expect(assembly.exitCode).toBe(1);
      expect(assembly.crashed).toBe(true); // 调用方区分文案前缀的依据
      expect(assembly.message).toBe('boom');
    }
    // crash.log 跳过语义跟 memory 位走（诊断形 dataDir 在场也不写——writeCrashLog 首判 memory）
    expect(existsSync(join(dir, 'crash.log'))).toBe(false);
  });
});

describe('触发器开门活体读取（readTriggerOpensLive——C 批 C-3：注册闸与 fire 复检共用源）', () => {
  it('null dataDir → 空集（memory 形全默认关——core: 豁免不经本面）', () => {
    expect(readTriggerOpensLive(null, 'acme')).toEqual(new Set());
  });

  it('文件缺席 → 空集（全 core: 内置态 = 生态插件全默认关）', () => {
    const dir = tmpDir('host-asm-tol-miss-');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('行在场且开 → 授予集现读现判（/reload 撤位语义的数据源）', () => {
    const dir = tmpDir('host-asm-tol-open-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins:\n  - id: acme\n    opens:\n      - triggers.start-run\n      - channels.ui-backend\n',
    );
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set(['triggers.start-run', 'channels.ui-backend']));
    // 同文件他插件不受门
    expect(readTriggerOpensLive(dir, 'other')).toEqual(new Set());
  });

  it('行被禁用 → 空集（disabled 即收回——toggle 翻转位）', () => {
    const dir = tmpDir('host-asm-tol-dis-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins:\n  - id: acme\n    disabled: true\n    opens:\n      - triggers.start-run\n',
    );
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('坏 yaml → 空集（宁拒不误放——与 boot 侧 fail-loud 拒启分立两律的运行期档）', () => {
    const dir = tmpDir('host-asm-tol-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), '{ Oops');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });

  it('行校验败（坏行形）→ 空集（fail-closed 不误放）', () => {
    const dir = tmpDir('host-asm-tol-row-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: acme\n    opens: [not-a-grantable]\n');
    expect(readTriggerOpensLive(dir, 'acme')).toEqual(new Set());
  });
});

describe('doors 段活体读取（readDoorsSegmentLive——开门制扩展批：双源并集律第二源运行期取值面）', () => {
  it('null dataDir → 空集（memory 形全默认关）', () => {
    expect(readDoorsSegmentLive(null)).toEqual(new Set());
  });

  it('文件缺席 → 空集（段缺席 = 该源空集）', () => {
    const dir = tmpDir('host-asm-dsl-miss-');
    expect(readDoorsSegmentLive(dir)).toEqual(new Set());
  });

  it('段在场 → 两门现读现判（/reload 撤位语义的数据源）', () => {
    const dir = tmpDir('host-asm-dsl-open-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins: []\ndoors:\n  - sessions.observe-cross\n  - sessions.control-cross\n',
    );
    expect(readDoorsSegmentLive(dir)).toEqual(new Set(['sessions.observe-cross', 'sessions.control-cross']));
    // 撤位即收回：删段重读回落空集
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: []\n');
    expect(readDoorsSegmentLive(dir)).toEqual(new Set());
  });

  it('坏 yaml / 坏段值域 → 空集（宁拒不误放——运行期档与 boot fail-loud 分立）', () => {
    const dir = tmpDir('host-asm-dsl-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), '{ Oops');
    expect(readDoorsSegmentLive(dir)).toEqual(new Set());
    // 段值域外（插件道高危面不进门）→ parseEnabledRows 拒 → 空集
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: []\ndoors:\n  - channels.ui-backend\n');
    expect(readDoorsSegmentLive(dir)).toEqual(new Set());
  });

  it('行校验败 → 空集（全文件一损俱损——doors 段不单独豁免）', () => {
    const dir = tmpDir('host-asm-dsl-row-');
    writeFileSync(
      join(dir, 'enabled.yaml'),
      'plugins:\n  - id: acme\n    opens: [not-a-grantable]\ndoors:\n  - sessions.observe-cross\n',
    );
    expect(readDoorsSegmentLive(dir)).toEqual(new Set());
  });
});

describe('caller 感知合成取值器（createControlOpensFor——03 §4.6 双源并集律装配单源）', () => {
  /** 速记：doors 段 + acme 行 opens 各自独立写（两源分立装配面） */
  function rig(dataDir: string, doors: readonly string[], opens: readonly string[]): void {
    const doorText = doors.length > 0 ? `doors:\n${doors.map((d) => `  - ${d}\n`).join('')}` : '';
    const openText = opens.length > 0 ? `    opens:\n${opens.map((o) => `      - ${o}\n`).join('')}` : '';
    writeFileSync(join(dataDir, 'enabled.yaml'), `plugins:\n  - id: acme\n${openText}${doorText}`);
  }

  it('插件道 caller = doors 段 ∪ 行 opens 并集（两源任一含门即过）', () => {
    const dir = tmpDir('host-asm-cof-union-');
    rig(dir, ['sessions.observe-cross'], ['sessions.control-cross']);
    const opensFor = createControlOpensFor(dir);
    const union = opensFor({ kind: 'plugin', pluginId: 'acme' });
    expect(union.has('sessions.observe-cross')).toBe(true); // doors 段支路
    expect(union.has('sessions.control-cross')).toBe(true); // 行 opens 支路
    expect(union).toEqual(new Set(['sessions.observe-cross', 'sessions.control-cross']));
  });

  it('模型道 caller = doors 段单独（行 opens 无插件 id 锚结构性不进）', () => {
    const dir = tmpDir('host-asm-cof-model-');
    rig(dir, [], ['sessions.control-cross']); // 只有行 opens
    const opensFor = createControlOpensFor(dir);
    expect(opensFor({ kind: 'session', sessionId: 's-1' })).toEqual(new Set()); // 行 opens 不波及
    // 段开门后模型道即见
    rig(dir, ['sessions.control-cross'], []);
    expect(opensFor({ kind: 'session', sessionId: 's-1' })).toEqual(new Set(['sessions.control-cross']));
  });

  it('两源皆空 → 两道皆空集（默认关）；他插件行 opens 不进本插件道', () => {
    const dir = tmpDir('host-asm-cof-empty-');
    rig(dir, [], []);
    const opensFor = createControlOpensFor(dir);
    expect(opensFor({ kind: 'plugin', pluginId: 'acme' })).toEqual(new Set());
    expect(opensFor({ kind: 'session', sessionId: 's-1' })).toEqual(new Set());
    // 他插件行（非 acme）不受 acme caller 影响——行 opens 按 pluginId 精确取
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: other\n    opens:\n      - sessions.control-cross\n');
    expect(opensFor({ kind: 'plugin', pluginId: 'acme' })).toEqual(new Set());
    expect(opensFor({ kind: 'plugin', pluginId: 'other' })).toEqual(new Set(['sessions.control-cross']));
  });

  it('撤位即收回：doors 段删除重读空集（/reload 语义——逐次现读现判）', () => {
    const dir = tmpDir('host-asm-cof-live-');
    rig(dir, ['sessions.control-cross'], []);
    const opensFor = createControlOpensFor(dir);
    expect(opensFor({ kind: 'session', sessionId: 's-1' })).toEqual(new Set(['sessions.control-cross']));
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: []\n'); // 撤段
    expect(opensFor({ kind: 'session', sessionId: 's-1' })).toEqual(new Set());
  });
});

/* ---------------- R-1：serve/daemon 形 always 回写同律（U3 批——回归锁） ---------------- */

/**
 * 审批应答后端（serve 面呈现同构——serve-daemon.ts addBackend 同法；恒答
 * 配置值 + 收请求账）。capabilities 与 12f-4 栈级例同形（approval 位开）。
 */
class R1ApprovalBackend implements UiBackend<AgentMessage> {
  readonly id = 'r1-approver';
  readonly capabilities = {
    notify: true,
    confirm: false,
    select: false,
    input: false,
    approval: true,
    setStatus: true,
    setWidget: false,
  };
  readonly requests: ApprovalAskRequest[] = [];
  constructor(private readonly answer: ApprovalAskAnswer) {}
  hasAudience(): boolean {
    return true;
  }
  notify(): void {
    // 非本组断言面
  }
  onEnvelope(): void {
    // 非本组断言面
  }
  onRepaint(): void {
    // 非本组断言面
  }
  async askApproval(_sessionId: string, request: ApprovalAskRequest): Promise<ApprovalAskAnswer> {
    this.requests.push(request);
    return this.answer;
  }
}

describe('serve/daemon 形 always 回写同律（R-1——U3-0 台账记账项收口锁）', () => {
  it('装配真接 persistAllowlist：always 应答真落 allowlist.json + decided=always（不降级 approve）', async () => {
    const dir = tmpDir('host-asm-r1-');
    const ws = tmpDir('host-asm-r1-ws-');
    const faux = fauxProvider({ provider: 'faux-r1', models: [{ id: 'm1' }] });
    // serve-daemon.ts 同调用形（runtime: {dataDir} 直传——批 19a-3 迁 assembly
    // 公共段后 serve/daemon/mcp 与 TUI 同一合成代码路径；R-1 记账时缺口在
    // serve/daemon 各自装配不传 persistAllowlist，公共段统一后本例锁两形态
    // 同律——always 应答在 serve 形下同真落 allowlist.json、decided 不降级）
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
      providers: [faux.provider],
      model: 'faux-r1/m1',
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // serve 面呈现同构接入（SDK face 后端位——审批 ask 经 channels 路由到本后端）
      const backend = new R1ApprovalBackend('always');
      assembly.stack.channels.addBackend(backend);
      const session = assembly.stack.openStartupSession(ws);

      // fs write 工具经 faux 工具调用驱动（绝对路径锚 tmp 工作区——不落真
      // cwd；写效应过审批门带 suggestedEntry 草案）
      faux.setResponses([
        () => toolCallOf('t-r1', 'write', { path: join(ws, 'r1.txt'), content: 'hi' }),
        () => fauxText('写好了'),
      ]);
      const receipt = await assembly.stack.submitText(session.sessionId, '写入');
      expect(receipt).toMatchObject({ status: 'completed' });

      // 问过 + always 答复真执行（审批呈现链经 channels 到后端）
      expect(backend.requests).toHaveLength(1);
      expect(readFileSync(join(ws, 'r1.txt'), 'utf8')).toBe('hi');

      // R-1 两断言面：① decided 落账 'always'（persistAllowlist 在场才有的
      // 分流值——缺席则防御降级 'approve'）② 结构草案真落 allowlist.json
      // （写侧唯一正门全链——装配闭包 dataDir 接 store 文件写）
      const decided = session.driver.session
        .events()
        .filter((event) => event.type === 'approval/decided')
        .map((event) => event.data);
      expect(decided[0]).toMatchObject({ decision: 'always' });
      const load = readAllowlist(dir);
      expect(load.healthy).toBe(true);
      expect(load.entries).toHaveLength(1);
      expect(load.entries[0]!.tool).toBe('write');
      expect(load.entries[0]!.pattern.endsWith('r1.txt')).toBe(true); // canonical 绝对路径（realpath 平台差异不锁全串）
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

/* ---------------- /reload 热重载 e2e（03 §5.7——换代槽 + runBoot 闭包 + 回执扇出） ---------------- */

describe('/reload 热重载 e2e（03 §5.7——手编漂移换代全链）', () => {
  /** notify 捕获后端（UiBackend 最小形——capabilities.notify 位 + hasAudience 恒真） */
  const captureBackend = (notified: string[]): UiBackend<never> => ({
    id: 'reload-probe',
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true,
    notify: (_message, opts) => void notified.push(`${opts?.level ?? 'info'}|${_message}`),
  });

  it('手编 enabled.yaml 漂移 → request → 换代装载（boot 句柄/披露匣/旧代回卷/回执扇出）', async () => {
    const dir = tmpDir('host-asm-reload-');
    const disposed: string[] = [];
    const mk = (name: string): CorePluginReference => ({
      name,
      apply: async () => () => void disposed.push(name), // disposer 记账——回卷断言位
    });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [mk('demo1'), mk('demo2')],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 初代：enabled.yaml 缺席 = core 内置态两件齐装
      expect(assembly.boot.report.activated.map((a) => a.id)).toEqual(['core:demo1', 'core:demo2']);
      expect(assembly.reloader.hasPending()).toBe(false); // 编舞器在场——idle 初态
      // 手编漂移：禁用 demo2（CLI toggle 的手编等价）
      writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: core:demo2\n    disabled: true\n');
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      assembly.reloader.request();
      await assembly.reloader.settle();
      // 换代观察面（boot 闭包变量是新代——assembly.boot 属性是初代值快照，
      // 换入真源走闭包取值器；此处以披露匣/回卷/回执三面间接证新代）：
      // 披露匣（pluginCounts 可变对象同址回写——total 含 skipped 行）
      expect(assembly.pluginCounts).toEqual({ total: 2, enabled: 1, failed: 0 });
      // 旧代**全量**回卷（LIFO：demo2 先 demo1 后——换代 = 整代回卷再整代装载，
      // 非增量换行）；新代 demo1 在装未跑
      expect(disposed).toEqual(['demo2', 'demo1']);
      // 回执经 channels notify 扇出（归因 'reload'——启用计数 = 新代读面）
      expect(notified.filter((t) => t.includes('插件已重载：启用 1/2'))).toHaveLength(1); // 恰一轮
    } finally {
      await assembly.runtime.shutdown(); // 一次性 closer 读槽——shutdown 跑最新代（demo1）
    }
    // shutdown 收口第二代 demo1——且旧代 demo2 不重跑（换代槽核心价值：closer
    // 不累积，直注册形下 shutdown 会重跑整个旧代 ['demo2','demo1','demo2','demo1']）
    expect(disposed).toEqual(['demo2', 'demo1', 'demo1']);
  });

  it('档①拒换：坏形清单 → 旧装载态原封 + 拒换回执（回卷零调用）', async () => {
    const dir = tmpDir('host-asm-reload-bad-');
    const disposed: string[] = [];
    const mk = (name: string): CorePluginReference => ({
      name,
      apply: async () => () => void disposed.push(name),
    });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [mk('demo1')],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 手编坏形：yaml 解析失败（preflight 抛——boot 读侧同一函数单源）
      writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops');
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      assembly.reloader.request();
      await assembly.reloader.settle();
      expect(notified.some((t) => t.includes('重载已拒'))).toBe(true);
      expect(disposed).toEqual([]); // 旧装载态原封——回卷零调用
      expect(assembly.boot.report.activated.map((a) => a.id)).toEqual(['core:demo1']); // 初代仍在位
    } finally {
      await assembly.runtime.shutdown();
    }
    expect(disposed).toEqual(['demo1']); // shutdown 走直路径收口初代
  });
});

/* ---------------- /plugins TUI 命令面 e2e（03 §5.8——命令注册 + 自动链 + 审计落账） ---------------- */

describe('/plugins TUI 命令面 e2e（03 §5.2 mount 族成功尾自动链 /reload 全链）', () => {
  /** notify 捕获后端（/reload e2e 同形——capabilities.notify 位 + hasAudience 恒真） */
  const captureBackend = (notified: string[]): UiBackend<never> => ({
    id: 'plugins-probe',
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true,
    notify: (_message, opts) => void notified.push(`${opts?.level ?? 'info'}|${_message}`),
  });

  it('dispatch /plugins toggle → 行编辑 + 审计恰一笔 + 自动链换代 + list 读面即新代', async () => {
    const dir = tmpDir('host-asm-plugcmd-');
    const disposed: string[] = [];
    const mk = (name: string): CorePluginReference => ({
      name,
      apply: async () => () => void disposed.push(name),
    });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [mk('demo1')],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      // 命令在册 + toggle 真链（core: 行不在场首翻 = 写 disabled 行——03 §5.2 第三态）
      expect(await assembly.stack.channels.dispatchCommand('/plugins toggle core:demo1')).toBe(true);
      expect(notified.some((t) => t.includes('已切换：core:demo1'))).toBe(true); // 回执经 notify 归因 'plugins'
      expect(notified.some((t) => t.includes('已自动链 /reload'))).toBe(true);
      // 成功尾自动链：busy=false → idle 直入编舞（await settle 收链）
      await assembly.reloader.settle();
      expect(assembly.pluginCounts).toEqual({ total: 1, enabled: 0, failed: 0 }); // 新代：行在 + disabled → skipped
      expect(disposed).toEqual(['demo1']); // 旧代（初代 demo1）已回卷
      // 审计恰一笔：toggle 词（boot diff 对 disabled 行「一致零落」——不叠词）。
      // 断言按 id 定域——runtime 开库 dbPath 走 env 梯子（BERRY_AGENT_DATA_DIR
      // per-file 钉扎），同文件早先测试的装载 diff 词共库在场（plug-sk 等）。
      const auditRows = [...createAuditFace(assembly.runtime.persistence.store.sqlite()).listRecent()]
        .filter((r) => r.type.startsWith('plugin/') && r.data['id'] === 'core:demo1')
        .map((r) => ({ type: r.type, data: r.data }));
      expect(auditRows).toEqual([{ type: 'plugin/toggled', data: { id: 'core:demo1', disabled: true } }]);
      // list 读面即新代（换代取值器闭包——/reload 后即新代投影）
      expect(await assembly.stack.channels.dispatchCommand('/plugins list')).toBe(true);
      expect(notified.some((t) => t.includes('禁用（1）：') && t.includes('core:demo1'))).toBe(true);
    } finally {
      await assembly.runtime.shutdown(); // 一次性 closer 收口第二代（行 disabled → 未装载零回卷）
    }
    expect(disposed).toEqual(['demo1']); // 第二代 skipped 无 disposer——收口零新回卷
  });

  it('mount 未装机用户 id → 拒回执零链（前置两查在 TUI 面同律执法）', async () => {
    const dir = tmpDir('host-asm-plugcmd-reject-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      expect(await assembly.stack.channels.dispatchCommand('/plugins mount user-ghost')).toBe(true);
      expect(notified.some((t) => t.includes('未装机'))).toBe(true);
      expect(notified.some((t) => t.includes('已自动链'))).toBe(false); // 拒路径零链
      expect(await assembly.reloader.hasPending()).toBe(false);
      expect(assembly.pluginCounts).toEqual({ total: 0, enabled: 0, failed: 0 }); // 装载态原封
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

/* ---------------- /doors TUI 命令面 e2e（03 §4.6 doors 段编辑腿——g-2） ---------------- */

describe('/doors TUI 命令面 e2e（注册 + 段写回 + doors/updated origin tui-cmd + 门即时生效）', () => {
  /** notify 捕获后端（/plugins e2e 同形） */
  const captureBackend = (notified: string[]): UiBackend<never> => ({
    id: 'doors-probe',
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true,
    notify: (_message, opts) => void notified.push(`${opts?.level ?? 'info'}|${_message}`),
  });

  it('dispatch /doors open → 段写回 + 审计恰一笔 origin tui-cmd + 门即时生效（活体源现读现判）', async () => {
    const dir = tmpDir('host-asm-doorscmd-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      // 开门前：门关（活体源空集——首启无 doors 段）
      expect(readDoorsSegmentLive(dir).has('sessions.control-cross')).toBe(false);
      // 开门：写回段 + 回执归因 'doors'
      expect(await assembly.stack.channels.dispatchCommand('/doors open sessions.control-cross')).toBe(true);
      expect(notified.some((t) => t.includes('已开门：sessions.control-cross'))).toBe(true);
      expect(notified.some((t) => t.includes('门检即时生效'))).toBe(true);
      // 文件真相 + 门即时生效（g-1 活体源——写回即下一次判变）
      expect(readDoorsSegmentLive(dir)).toEqual(new Set(['sessions.control-cross']));
      // 审计恰一笔：doors/updated origin 'tui-cmd'（boot 首启空面首记不落——
      // 空面零笔在先，open 即流内首笔）
      const auditRows = [...createAuditFace(assembly.runtime.persistence.store.sqlite()).listRecent()]
        .filter((r) => r.type === 'doors/updated')
        .map((r) => ({ type: r.type, data: r.data }));
      expect(auditRows).toEqual([
        { type: 'doors/updated', data: { doors: ['sessions.control-cross'], origin: 'tui-cmd' } },
      ]);
      // list 读面同源呈现新态（六枚清单 + doors 段行）
      expect(await assembly.stack.channels.dispatchCommand('/doors list')).toBe(true);
      expect(notified.some((t) => t.includes('sessions.control-cross=open（doors 段——进程级）'))).toBe(true);
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('值域拒 + 用法错：拒路径零审计零写回（回执仍经 notify 归因 doors）', async () => {
    const dir = tmpDir('host-asm-doorscmd-reject-');
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const notified: string[] = [];
      assembly.stack.channels.addBackend(captureBackend(notified));
      // boot 落笔后快照（共库定域断言——同文件先前用例的 doors/updated 笔
      // 在场〔含本 rig boot 对前用例开门面的 boot-diff 收口笔，recordDoorsDiff
      // 正确行为〕；拒路径断言只锁「两次拒后无新笔」，不依赖库绝对内容）
      const auditFace = createAuditFace(assembly.runtime.persistence.store.sqlite());
      const before = [...auditFace.listRecent()].filter((r) => r.type === 'doors/updated').map((r) => r.data);
      // 值域外（插件道高危面不进 doors 段）
      expect(await assembly.stack.channels.dispatchCommand('/doors open channels.ui-backend')).toBe(true);
      expect(notified.some((t) => t.includes('值域'))).toBe(true);
      // 用法错（缺 <capability>）
      expect(await assembly.stack.channels.dispatchCommand('/doors open')).toBe(true);
      expect(notified.some((t) => t.includes('须带 <capability>'))).toBe(true);
      // 拒路径零新审计零写回：快照不变 + 段仍空集（首启文件可无 enabled.yaml）
      const after = [...auditFace.listRecent()].filter((r) => r.type === 'doors/updated').map((r) => r.data);
      expect(after).toEqual(before);
      expect(readDoorsSegmentLive(dir).size).toBe(0);
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

describe('模型面八件工具族 e2e（03 §5.6——恒挂载 + 写类审批对 + 不自动链 reload）', () => {
  /** §5.6 八件名全表（面结构序锁归单元面——此处锁装配入位） */
  const EIGHT_TOOLS = [
    'plugins_list',
    'events_query',
    'plugin_uninstall_inspect',
    'plugin_install',
    'plugin_mount',
    'plugin_unmount',
    'plugin_toggle',
    'plugin_update',
  ];

  it('八件恒挂载入 driver 工具面 + plugins_list 经模型调用真渲染（装配接线全链）', async () => {
    const dir = tmpDir('host-asm-ptools-');
    const ws = tmpDir('host-asm-ptools-ws-');
    const faux = fauxProvider({ provider: 'faux-pt', models: [{ id: 'm1' }] });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
      providers: [faux.provider],
      model: 'faux-pt/m1',
      corePlugins: [],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 恒挂载：八件并入 durable 会话工具清单（boot 全局层——与 extraTools 位并列）
      const session = assembly.stack.openStartupSession(ws);
      const names = session.driver.toolNames ?? [];
      for (const name of EIGHT_TOOLS) expect(names, name).toContain(name);
      // 经模型调用驱动只读件（装配接线真链：真 report 取值器 + 真行/账本面）
      faux.setResponses([() => toolCallOf('t-pt1', 'plugins_list', {}), () => fauxText('清单到手')]);
      const receipt = await assembly.stack.submitText(session.sessionId, '列插件');
      expect(receipt).toMatchObject({ status: 'completed' });
      const toolText = JSON.stringify(
        session.driver.session
          .events()
          .filter(
            (event) =>
              event.type === 'tool/result' && (event.data as Record<string, unknown>)['toolCallId'] === 't-pt1',
          )
          .map((event) => (event.data as Record<string, unknown>)['content']),
      );
      expect(toolText).toContain('mounted（0）'); // 空装载态真实渲染（corePlugins: []）
      expect(toolText).toContain('installed-unmounted（0）'); // 装机分区真读账本
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('plugin_toggle 写类审批对全链：问过恰一次 → approve 真执行 → 行落盘 + 审计 + 不自动链', async () => {
    const dir = tmpDir('host-asm-ptools-w-');
    const ws = tmpDir('host-asm-ptools-w-ws-');
    const faux = fauxProvider({ provider: 'faux-ptw', models: [{ id: 'm1' }] });
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: 'x',
      providers: [faux.provider],
      model: 'faux-ptw/m1',
      corePlugins: [],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 审批呈现链接入（R1ApprovalBackend 同形——恒答 'approve' 单发，无 allowlist 副作用）
      const backend = new R1ApprovalBackend('approve');
      assembly.stack.channels.addBackend(backend);
      const session = assembly.stack.openStartupSession(ws);
      // core: 行不在场首翻 = 写 disabled 行（03 §5.2 第三态——与 TUI e2e 同律；
      // id 取全文件唯一 'core:ptw'——audit 库走 env 钉根梯子同文件共库〔675 行
      // 注记同案〕，TUI e2e 的 core:demo1 词已在库，按 id 定域即独占）
      faux.setResponses([() => toolCallOf('t-pt2', 'plugin_toggle', { id: 'core:ptw' }), () => fauxText('切换完成')]);
      const receipt = await assembly.stack.submitText(session.sessionId, '停用演示件');
      expect(receipt).toMatchObject({ status: 'completed' });
      // 审批对（§5.6 钉死成对——effect write 单键自动执法）：问过恰一次、归因工具名正确
      expect(backend.requests).toHaveLength(1);
      expect(backend.requests[0]!.toolName).toBe('plugin_toggle');
      // 行真落盘（enabled.yaml disabled 行）
      expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('core:ptw');
      // 审计恰一笔（按 id 定域——同文件早先测试共库账过滤）
      const auditRows = [...createAuditFace(assembly.runtime.persistence.store.sqlite()).listRecent()]
        .filter((r) => r.type === 'plugin/toggled' && r.data['id'] === 'core:ptw')
        .map((r) => r.data);
      expect(auditRows).toEqual([{ id: 'core:ptw', disabled: true }]);
      // 回执词面：终态 + /reload 指路（模型面）——且无 TUI 面「已自动链」词
      const toolText = JSON.stringify(
        session.driver.session
          .events()
          .filter(
            (event) =>
              event.type === 'tool/result' && (event.data as Record<string, unknown>)['toolCallId'] === 't-pt2',
          )
          .map((event) => (event.data as Record<string, unknown>)['content']),
      );
      expect(toolText).toContain('已切换：core:ptw');
      expect(toolText).toContain('/reload');
      expect(toolText).not.toContain('已自动链');
      // §5.2 模型面不自动链 reload（三面分立主断言——与 TUI 面成功尾自动链对偶）
      expect(await assembly.reloader.hasPending()).toBe(false);
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});

describe('插件道路由装配全栈 e2e（U5-3——受理→开面 replay→fetch 三链绿 + 四红例收口锁）', () => {
  /**
   * capability/used 审计行速记（sdk.register-route 域 + pluginId 定域过滤——
   * 共库账纪律：runtime 显式 dataDir 不改写 dbPath〔v1 有意边界——CLI 侧已
   * 绕〕，本文件各装配共库账，断言按 pluginId 定域同既有测试律）
   */
  const sdkRouteUsedOf = (assembly: AssemblySuccess, pluginId: string): Array<Record<string, unknown>> =>
    [...createAuditFace(assembly.runtime.persistence.store.sqlite()).listRecent()]
      .filter(
        (row) =>
          row.type === 'capability/used' &&
          row.data['capability'] === 'sdk.register-route' &&
          row.data['pluginId'] === pluginId,
      )
      .map((row) => row.data);

  /** 磁盘 jiti 生态插件速记（真盘真 jiti——四件套：package.json/entry.js/enabled.yaml/ledger.json） */
  function diskPlugin(dataDir: string, id: string, options: { opens?: string; body: readonly string[] }): void {
    const pluginDir = join(dataDir, 'plugins', 'node_modules', id);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: id, version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(
      join(pluginDir, 'entry.js'),
      ['export const inject = [];', 'export default async (ctx) => {', ...options.body, '};'].join('\n'),
    );
    writeFileSync(
      join(dataDir, 'enabled.yaml'),
      `plugins:\n  - id: ${id}${options.opens !== undefined ? `\n    opens: [${options.opens}]` : ''}\n`,
    );
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ [id]: { installPath: `plugins/node_modules/${id}` } }),
    );
  }

  /** 注册动词字面（磁盘插件 entry 内嵌——三链绿与红例共用面） */
  const registerLines = (path: string): readonly string[] => [
    '  ctx.get("sdk-routes").register({',
    '    method: "GET",',
    `    path: ${JSON.stringify(path)},`,
    '    auth: "token",',
    '    handler: (_req, res) => { res.writeHead(200); res.end("route-e2e-ok"); },',
    '  });',
  ];

  it('三链绿：装载受理（opens 开门）→ 开面 snapshot replay → fetch 打通 + 审计恰一笔（缺省注册表真 kit）', async () => {
    const dir = tmpDir('host-asm-u5-green-');
    diskPlugin(dir, 'acme-route', { opens: 'sdk.register-route', body: registerLines('/e2e') });
    const faux = fauxProvider({ provider: 'faux-u5', models: [{ id: 'm1' }] });
    // 缺省 corePlugins 注册表——真 core:sdk 件 provide 'sdk-http-face' kit（custom
    // 替换律下无 kit；BERRY_AGENT_BIN 兜底防件侧自探测——scheduler-clock 同法）
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      providers: [faux.provider],
      model: 'faux-u5/m1',
      env: { BERRY_AGENT_BIN: '/usr/bin/true' },
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      // 链①装载受理：门开（opens 行）→ 受理入账 pending 态（行级零失败）
      expect(assembly.boot.report.failed).toEqual([]);
      expect(assembly.boot.report.activated.map((a) => a.id)).toContain('core:sdk');
      expect(assembly.boot.report.activated.map((a) => a.id)).toContain('acme-route');
      const kit = assembly.scope.tryGet<{ readonly createFace: unknown; readonly pluginRoutes?: PluginRouteRegistry }>(
        'sdk-http-face',
      );
      expect(kit?.pluginRoutes).toBeDefined(); // 真件 kit 透传位（受理器随 kit 出场）
      expect(kit!.pluginRoutes!.snapshot().map((d) => d.path)).toContain('/plugins/acme-route/e2e');

      // 链②开面 replay：snapshot 注入构造期 routes 位 + attachFace 晚注册位挂接
      let opened: { host: string; port: number; token: string } | undefined;
      const face = await openWebuiFace({
        stack: assembly.stack,
        runtime: assembly.runtime,
        port: 0,
        pluginRoutes: kit!.pluginRoutes!,
        disclose: () => {},
        onOpen: (info) => {
          opened = info;
        },
      });
      try {
        // 链③fetch 打通：Bearer 过鉴权 + handler 真应答
        const res = await fetch(`http://${opened!.host}:${opened!.port}/plugins/acme-route/e2e`, {
          headers: { authorization: `Bearer ${opened!.token}` },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('route-e2e-ok');
        // 审计恰一笔：method+path 全路径归因键（受理成功后落，拒路径零审计）
        expect(sdkRouteUsedOf(assembly, 'acme-route')).toEqual([
          { pluginId: 'acme-route', capability: 'sdk.register-route', method: 'GET', path: '/plugins/acme-route/e2e' },
        ]);
      } finally {
        await face.stop(); // 幂等（runtime.shutdown closer 'webui-server' 同样会收口）
      }
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('红例·门关：磁盘插件无 opens 行 → 装载期拒（行级隔离 + 零使用账）', async () => {
    const dir = tmpDir('host-asm-u5-door-');
    diskPlugin(dir, 'acme-door', { body: registerLines('/nope') }); // 无 opens = 默认关
    const sdkRef: CorePluginReference = { name: 'sdk', apply: async () => undefined }; // 席位第二腿
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [sdkRef],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      expect(assembly.boot.report.activated.map((a) => a.id)).toContain('core:sdk'); // 席位在场——拒因是门非缺服务
      const row = assembly.boot.report.failed.find((f) => f.id === 'acme-door');
      // apply 期错误归一 PLUGIN_APPLY_FAILED（invokeApply 包装律）——门检码与
      // 文案在 message 内保真传递（cause 链不进失败行面）
      expect(row?.code).toBe('PLUGIN_APPLY_FAILED');
      expect(row?.message).toContain('默认关'); // 门检文案（PLUGIN_CAPABILITY_DOOR_CLOSED 语义）
      expect(row?.message).toContain('sdk.register-route');
      expect(sdkRouteUsedOf(assembly, 'acme-door')).toEqual([]); // 拒路径零审计
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('红例·查重：同插件同键双注册 → fail-loud 失败行 + 首笔恰一账（第二笔拒不入账）', async () => {
    const dir = tmpDir('host-asm-u5-dup-');
    diskPlugin(dir, 'acme-dup', {
      opens: 'sdk.register-route',
      body: [...registerLines('/d'), ...registerLines('/d')], // 同键双注册——第二笔必须拒
    });
    const sdkRef: CorePluginReference = { name: 'sdk', apply: async () => undefined };
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [sdkRef],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const row = assembly.boot.report.failed.find((f) => f.id === 'acme-dup');
      expect(row?.code).toBe('PLUGIN_APPLY_FAILED'); // apply 期归一码（查重普通 Error 经 invokeApply 包裹）
      expect(row?.message).toContain('重复注册');
      expect(row?.message).toContain('GET /plugins/acme-dup/d');
      // 首笔受理照记恰一（成功路径审计律——拒的是第二笔非首笔）
      expect(sdkRouteUsedOf(assembly, 'acme-dup')).toEqual([
        { pluginId: 'acme-dup', capability: 'sdk.register-route', method: 'GET', path: '/plugins/acme-dup/d' },
      ]);
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('红例·窗外：装载窗收口后 register 拒 PLUGIN_WINDOW_CLOSED（零使用账）', async () => {
    const dir = tmpDir('host-asm-u5-late-');
    let held: { register(d: unknown): () => void } | undefined;
    const holdRef: CorePluginReference = {
      name: 'hold',
      apply: async (ctx) => {
        // 只持面不注册（装载期零动作）——post-boot 调 register 验窗执法
        held = (ctx as { get: (name: string) => unknown }).get('sdk-routes') as {
          register(d: unknown): () => void;
        };
      },
    };
    const sdkRef: CorePluginReference = { name: 'sdk', apply: async () => undefined };
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [sdkRef, holdRef],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      expect(assembly.boot.report.failed).toEqual([]); // 装载本身绿（只持面未注册）
      expect(held).toBeDefined();
      try {
        held!.register({ method: 'GET', path: '/late', auth: 'token', handler: () => {} });
        expect.unreachable('窗外 register 必须拒');
      } catch (err) {
        expect((err as { code?: string }).code).toBe('PLUGIN_WINDOW_CLOSED');
      }
      expect(sdkRouteUsedOf(assembly, 'core:hold')).toEqual([]); // 拒路径零审计
    } finally {
      await assembly.runtime.shutdown();
    }
  });

  it('红例·席位缺席：plan 无 core:sdk 行 → fork 绑定不落 → ctx.get 响亮（行级隔离 + 零使用账）', async () => {
    const dir = tmpDir('host-asm-u5-seat-');
    diskPlugin(dir, 'acme-lone', { body: registerLines('/orphan') });
    const demoRef: CorePluginReference = { name: 'demo', apply: async () => undefined }; // 无 sdk 席
    const assembly = await assembleHostStack({
      runtime: { dataDir: dir },
      noPlugins: false,
      debug: false,
      version: '9.9.9-test',
      corePlugins: [demoRef],
    });
    if (!assembly.ok) throw new Error(`装配意外失败：${assembly.message}`);
    try {
      const row = assembly.boot.report.failed.find((f) => f.id === 'acme-lone');
      expect(row?.code).toBe('PLUGIN_APPLY_FAILED'); // apply 期归一码（缺席码经 invokeApply 包裹）
      expect(row?.message).toContain('服务 sdk-routes 缺席'); // CONTEXT_SERVICE_MISSING 文案保真
      expect(assembly.boot.report.activated.map((a) => a.id)).toContain('core:demo'); // 行级隔离——他行照装
      expect(sdkRouteUsedOf(assembly, 'acme-lone')).toEqual([]);
    } finally {
      await assembly.runtime.shutdown();
    }
  });
});
