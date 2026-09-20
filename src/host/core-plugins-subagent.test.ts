import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventDispatch, Scope } from '../context/index.js';
import { CommandRegistry, createChannels } from '../channels/index.js';
import { createToolRegistry } from '../tools/index.js';
import { createCorePlugins } from './core-plugins.js';
import type { SubagentLayerResyncHook } from './core-plugins.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
import type { PluginContextHandle } from './plugin-context.js';
import { createPluginToolLedger } from './plugin-boot.js';
import { loadPlugins } from './loader.js';
import type { CorePluginReference, LoaderPlanRow } from './loader.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import { TriggerRegistry } from './triggers.js';
import { createJobRegistry, createSubagentService } from '../subagent/index.js';
// 错误码册注册腿（「import 发生才注册」——拒码文本断言的前置副作用）
import './codes.js';

/**
 * core:subagent 声明式腿与插件层物化（RP5——⑥-3 落码批）真装载回归锁。
 *
 * 主锁①（修前必红）：/reload 撞名修复——旧码 apply disposer 只撤工具不撤
 * providers（service 闭包 Map 进程级存活），重放 boot 重物化撞
 * SUBAGENT_PROVIDER_EXISTS → core:subagent 落 failed 行（行级隔离）→ reload
 * 后 agent 工具族全灭。修复 = registerProvider 改返注销器 + materialize 产物
 * 携 provider 撤位 + apply disposer 两撤。
 *
 * 其余锁：插件层 resync 钩子（RP5 物化腿——boot 装载收口后经宿主回调窗
 * 注册，03 §6.3 兑现注）+ 重入换代幂等 + 卸载两撤对称。
 */

/** 宿主自省面测试替身（materializeHostFace 形——纯数据即可） */
const HOST_FACE = {
  version: '0.1.0-alpha.1',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/** 造一层 agents 目录（name.md + frontmatter description + 正文） */
function writeAgentDir(parent: string, name: string): string {
  const dir = join(parent, `${name}-agents`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), `---\ndescription: ${name} 测试子代理\n---\n你是 ${name} 测试子代理。\n`);
  return dir;
}

/**
 * 真装载链装配（镜像 core-plugins-mcp-window.test.ts bootMcpRow）：loadPlugins
 * + createCorePlugins（cwd 锚 + subagents 真身 + sink 捕获）+ 真窗闸 +
 * coreHostChannel 在场形（复刻 bootPlugins 查 handle 铸开窗器闭包——RP5
 * 插件层注册的宿主回调窗通道）。
 */
async function bootSubagentRow(cwd: string) {
  const handles = new Map<string, PluginContextHandle>();
  const warns: string[] = [];
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
  const tools = createToolRegistry(dispatch);
  const toolLedger = createPluginToolLedger();
  const promptSections = new PromptSectionRegistry();
  const triggers = new TriggerRegistry({
    getOpens: () => new Set(['triggers.start-run']),
    makeStarter: () => () => undefined,
  });
  // 共享 service：跨两代 boot 存活（reload 场景的进程级单真身——旧码病灶载体）
  const service = createSubagentService({ registry: createJobRegistry() });
  let hook: SubagentLayerResyncHook | undefined;
  const channels = createChannels();
  const scope = Scope.createRoot();
  const fork = scope.fork();

  const refs = createCorePlugins({
    dataDir: null,
    cwd,
    subagents: service,
    // 会话语境解析位（boot 全局层工具执行时消费——测试恒根深度形）
    subagentSessionContext: () => ({ depth: 1 }),
    subagentLayerResyncSink: (h) => {
      hook = h;
    },
  });
  const subagentRef = refs.find((r) => r.name === 'subagent') as CorePluginReference;
  const plan: LoaderPlanRow[] = [{ kind: 'core', id: 'core:subagent', reference: subagentRef }];

  const services = (() => {
    const bag = new Map<string, unknown>();
    return {
      get: (name: string) => bag.get(name),
      provide: (name: string, value: unknown) => {
        bag.set(name, value);
      },
    };
  })();

  const report = await loadPlugins({
    plan,
    services,
    createContext: (pluginId) => {
      const handle = createPluginContext({
        pluginId,
        scope: fork,
        dispatch,
        tools,
        toolLedger,
        provide: services.provide,
        commands: new CommandRegistry(),
        uiBackends: channels,
        llm: { registerProvider: () => () => undefined },
        promptSections,
        triggers,
        subagents: service,
        hostFace: HOST_FACE,
      });
      handles.set(pluginId, handle);
      return handle.ctx;
    },
    onApplySettled: (pluginId) => handles.get(pluginId)?.closeWindow(), // 真实时序——行收口即关窗
    warn: (message) => warns.push(message),
    // 官方件宿主面通道（在场形）：查 handle 铸开窗器——bootPlugins 同款闭包
    coreHostChannel: (pluginId: string) => {
      const handle = handles.get(pluginId);
      return handle === undefined ? undefined : { openHostCallback: () => handle.enterHostCallback() };
    },
  });

  return { tools, toolLedger, service, hook, report, warns };
}

describe('core:subagent 声明式腿（标准层物化 + reload 撞名修复）', () => {
  it('主锁①（修前红）：boot → unload → 再 boot 同 def 不撞名——core:subagent 不落 failed、工具族再现', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-reload-'));
    try {
      // project 层标准 def：`.agents/agents/scout.md`
      mkdirSync(join(workspace, '.agents', 'agents'), { recursive: true });
      writeFileSync(
        join(workspace, '.agents', 'agents', 'scout.md'),
        '---\ndescription: 侦察测试子代理\n---\n你是侦察测试子代理。\n',
      );

      const boot1 = await bootSubagentRow(workspace);
      expect(boot1.report.failed).toHaveLength(0); // 首代干净装载
      expect(boot1.report.activated.map((a) => a.id)).toContain('core:subagent');
      expect(boot1.tools.listFor('model').some((d) => d.name === 'agent_scout')).toBe(true);

      await boot1.report.unload(); // 旧代回卷（apply disposer——修复后两撤）

      // 再 boot（/reload 重放 boot 真实形状：同 service 同 def 集）
      const boot2 = await bootSubagentRow(workspace);
      // 修前红点：disposer 只撤工具 → providers 残留 → 撞名 → failed 行
      const failedIds = boot2.report.failed.map((f) => f.id);
      expect(failedIds).not.toContain('core:subagent');
      expect(boot2.tools.listFor('model').some((d) => d.name === 'agent_scout')).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // —— TUI 第四役 finding A 同族位（:1088 诊断 sink）：坏 agent 文件的
  // invalid-metadata 诊断 warn 修前走 console.error 裸文本直落 TUI 屏（与
  // memory 周期路 :780 同 sink 同族）。修复 = leveled logger
  // （BERRY_AGENT_LOG_LEVEL 辖内）单源（本 rig 无 notify 位——纯 logger 形）。
  it('诊断 warn 出口零 console.error（finding A 同族）：坏 agent 文件 → logger 结构化行不裸写', async () => {
    const prevLevel = process.env.BERRY_AGENT_LOG_LEVEL;
    delete process.env.BERRY_AGENT_LOG_LEVEL;
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-warn-'));
    try {
      // 坏形标准层 def：frontmatter 无 description → parseAgentDef 拒 →
      // collectAgentDefs 产出 invalid-metadata 诊断 → apply 期 warn
      mkdirSync(join(workspace, '.agents', 'agents'), { recursive: true });
      writeFileSync(
        join(workspace, '.agents', 'agents', 'broken.md'),
        '---\nname: broken\n---\n正文无 description 键。\n',
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let stderrText = '';
      const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stderrText += String(chunk);
        return true;
      });
      let report: Awaited<ReturnType<typeof bootSubagentRow>>['report'] | undefined; // 异常路径未赋值形（下行收窄）
      let errorCalls = 0; // try 内取影（初始化防 TS2454——异常路径未赋值用）
      try {
        const row = await bootSubagentRow(workspace);
        report = row.report;
        errorCalls = errorSpy.mock.calls.length; // mockRestore 前取影
      } finally {
        errorSpy.mockRestore();
        writeSpy.mockRestore();
      }
      // 主锁：零 console.error（修前 sink 即 console.error 必红）
      expect(errorCalls).toBe(0);
      // 诊断如实达岸（坏文件不炸装配——行级隔离）+ logger 腿结构化行收窄
      expect(report).toBeDefined();
      expect(report!.failed.map((f) => f.id)).not.toContain('core:subagent');
      expect(stderrText).toContain('invalid-metadata');
      expect(stderrText).toContain('"module":"core:subagent"');
      expect(stderrText).toContain('"level":"warn"');
      await report!.unload();
    } finally {
      if (prevLevel === undefined) delete process.env.BERRY_AGENT_LOG_LEVEL;
      else process.env.BERRY_AGENT_LOG_LEVEL = prevLevel;
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('core:subagent 插件层物化腿（RP5——resync 钩子 + 后窗注册）', () => {
  it('钩子物化：agentDirs def → provider 入册 + 工具经宿主回调窗注册（owner core:subagent + 工具名账）', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-plugin-'));
    try {
      const pluginAgents = writeAgentDir(workspace, 'helper');
      const { tools, toolLedger, service, hook, report } = await bootSubagentRow(workspace);
      expect(hook).toBeDefined(); // sink 已捕获（apply 上挂）
      expect(report.failed).toHaveLength(0);

      // 装载收口后 resync（assembly 时序位镜像——窗已关，注册走后窗通道）
      await hook!([{ id: 'acme', agentDirs: [pluginAgents] }]);

      expect(service.providerNames()).toContain('helper');
      const defs = tools.listFor('model').filter((d) => d.name === 'agent_helper');
      expect(defs).toHaveLength(1);
      expect(defs[0]?.owner).toBe('core:subagent'); // owner 覆写（注册链全语义保留）
      expect(toolLedger.toolsOf('core:subagent')).toContain('agent_helper'); // 工具名账记账

      await report.unload();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('重入换代：同钩子再调换 def 集——旧代全摘（provider 位 + 工具位）新代重挂，无重影', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-resync-'));
    try {
      const gen1 = writeAgentDir(workspace, 'helper');
      const gen2 = writeAgentDir(workspace, 'miner');
      const { tools, service, hook, report } = await bootSubagentRow(workspace);

      await hook!([{ id: 'acme', agentDirs: [gen1] }]);
      expect(service.providerNames()).toContain('helper');

      // 换代 resync（reload 形——def 集变更，重入先全摘旧代）
      await hook!([{ id: 'acme', agentDirs: [gen2] }]);
      expect(service.providerNames()).not.toContain('helper');
      expect(service.providerNames()).toContain('miner');
      const names = tools.listFor('model').map((d) => d.name);
      expect(names.filter((n) => n === 'agent_helper')).toHaveLength(0); // 工具位同撤
      expect(names.filter((n) => n === 'agent_miner')).toHaveLength(1); // 新代重挂无重影

      await report.unload();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('卸载两撤对称：unload 后插件层 provider 位撤净（与标准层 disposer 同律）', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-unload-'));
    try {
      const pluginAgents = writeAgentDir(workspace, 'helper');
      const { service, hook, report } = await bootSubagentRow(workspace);
      await hook!([{ id: 'acme', agentDirs: [pluginAgents] }]);
      expect(service.providerNames()).toContain('helper');

      await report.unload(); // apply disposer 兼撤插件层（provider 位 + 工具位）

      expect(service.providerNames()).not.toContain('helper');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('跨层撞名降级：插件层 def 撞标准层在册名 → warn 降级逐 def 隔离（不炸 resync）', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-subagent-clash-'));
    try {
      // 标准层与插件层同名 def 'scout'
      mkdirSync(join(workspace, '.agents', 'agents'), { recursive: true });
      writeFileSync(
        join(workspace, '.agents', 'agents', 'scout.md'),
        '---\ndescription: 侦察测试子代理\n---\n你是侦察测试子代理。\n',
      );
      const pluginAgents = writeAgentDir(workspace, 'scout');
      const { tools, service, hook, report } = await bootSubagentRow(workspace);
      expect(report.failed).toHaveLength(0);

      await hook!([{ id: 'acme', agentDirs: [pluginAgents] }]); // 撞名不炸

      expect(service.providerNames().filter((n) => n === 'scout')).toHaveLength(1); // 标准层位不被动
      expect(tools.listFor('model').filter((d) => d.name === 'agent_scout')).toHaveLength(1); // 无重影
      await report.unload();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
