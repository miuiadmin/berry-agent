/**
 * host/assembly 组合根测试——装配序公共段（批 12f-3 防侧门件：TUI 入口与
 * dump-config / plugins list 诊断命令**同一合成代码路径**的执法证据）。
 *
 * 失败三档归一全景：干净退出档（运行时组装失败）× 启用清单损坏档
 * （PLUGIN_ROW_INVALID 先收口再返回——标记释放即证据）× 崩溃取证档
 * （意外异常 crashed:true + crash.log 按 memory 位跳过——诊断形 dataDir
 * 在场仍跳过）。真盘真库（临时目录）+ 真装载管线（core 件 in-process）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { ACTIVE_MARKER_BASENAME } from './single-instance.js';
import { assembleHostStack, readTriggerOpensLive } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import { createHostRuntime } from './runtime.js';
import { readAllowlist } from './allowlist-store.js';
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
