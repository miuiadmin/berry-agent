/**
 * host/core-plugins — core: 官方件注册表单源（批 19a 装载态集成）。
 *
 * 15 件权威清单 = 02 篇 §4.1 core: 行（skills/memory/subagent/exec/mcp/web/
 * browser/lsp/checkpoint/scheduler/goal/obs/webui/sdk/issue）——v1 全量
 * 带上默认启用，经同一插件装载面（第一方禁私有车道：对象直调 apply 零
 * jiti 零 import 门禁，03 §1.4 官方引用形）。本件逐件入册（批 19a 起，
 * 每纵切笔入册一批——入册齐 15 件时本注记销账）。
 *
 * **apply 壳归宿主侧**（与磁盘件「件自持入口文件」分道）：件保持纯库
 * 不 import host（DAG 单向不破——host 是装配根有权 import 各件公开面），
 * 装配逻辑（何时 provide 何服务/注册何工具）属宿主裁决权面（判据面与
 * 接口面之分——02 篇理念节）。ctx 真身在 host 侧直用 PluginContext 类型
 * narrow（零跨件窄面重复——与磁盘件的 unknown 契约面不同，本侧无漂移面）。
 *
 * 会话级 deps（档位/审批/工作区）经服务面工厂形求值：装载期固定构造会
 * 丢会话面（批 19a 定形——ExecToolService 契约见 conversation/types.ts）。
 */
import { join } from 'node:path';

import type { ExecToolService } from '../conversation/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { createBashTool, createSpawnPipeline } from '../exec/index.js';
import { createSandboxService } from '../safety/index.js';
import { createFetchTool, createInFlightGate, createWebFetchService, DEFAULT_WEB_LIMITS } from '../web/index.js';
import type { InFlightGate } from '../web/index.js';
import {
  createSkillManageTool,
  createSkillsRegistry,
  createStandardLayers,
  renderAvailableSkills,
} from '../skills/index.js';

import type { PluginContext } from './plugin-context.js';
import type { CorePluginReference } from './loader.js';

/**
 * core:exec——spawn 管道装载期自持（进程级单例：登记簿/孤儿清扫随管道
 * 同生命周期）+ 'exec' 服务面供给（会话装配期工厂形——exec 禁用 = bash
 * 静默缺席，对话本体仍通）。bash 工具件经 openTools 既有消费位拾取
 * （scope.tryGet 诚实缺席律），不走 ctx.tools.register 散装注册（双路
 * 会撞名——装载面单路执法）。
 */
const execPlugin: CorePluginReference = {
  name: 'exec',
  async apply(ctx) {
    const context = ctx as PluginContext;
    // 管道/沙箱服务进程级单例：spawn 登记簿与后端链探测缓存（probe 有
    // spawn 开销——单例缓存一次）均无会话态；沙箱后端链缺省平台链
    // （macOS seatbelt / Linux bwrap——safety 单源）
    const pipeline = createSpawnPipeline();
    const sandboxService = createSandboxService();
    const service: ExecToolService = {
      // 会话装配期工厂：进程级单例闭包自持 + 会话级 deps（档位/审批/工作
      // 区）由消费位注入求值——结构契约单源在 conversation/types.ts；
      // deps.sandboxService 显式在场时胜出（测试/宿主覆盖位——展开序在后）
      createBashTool: (deps) => createBashTool({ pipeline, sandboxService, ...deps }),
    };
    context.provide('exec', service);
  },
};

/**
 * core:web——fetch 工具（effect 'read'，经 ctx.tools.register 散装注册走
 * bootTools 重放消费腿）+ 'web-fetch' 服务面供给（02 §4.1 席 18「ctx.fetch」
 * 词面落形：服务名带域防裸名撞位）+ 'web-gate' 在飞门单例供给（03 §10.3
 * browser 件共享同一实例——装配根经共享根传实例的装载面形态）。归因 sink
 * 缺省 no-op（观测面挂账归 obs 纵切笔——sink 不绑架数据面）。
 */
const webPlugin: CorePluginReference = {
  name: 'web',
  async apply(ctx) {
    const context = ctx as PluginContext;
    // 在飞门单例（容量缺省单源 DEFAULT_WEB_LIMITS.maxConcurrent = 4——fetch
    // 工具/服务面/browser 导航三消费位同一实例）
    const gate: InFlightGate = createInFlightGate(DEFAULT_WEB_LIMITS.maxConcurrent);
    const service = createWebFetchService({ gate });
    context.provide('web-fetch', service);
    context.provide('web-gate', gate);
    // 工具注册（boot 全局层——openTools 会话装配重放走真三段管道）
    return context.tools.register(createFetchTool(service));
  },
};

/**
 * 宿主真身注入面（批 19b-1 工厂形升级——19a 尾注预留兑现）：件内自足构造
 * 覆盖不了的装配期事实经此入件（dataDir 是首位——skills user 层锚 /
 * memory 件数据面等后续件逐笔扩展）。工厂形 vs 静态数组：deps 装配期才
 * 定形（runtime.dataDir 先于装载），静态数组装不进运行时事实。
 */
export interface CorePluginHostDeps {
  /** 数据目录（null = :memory: 诊断形——skills user 层跳过等件内分支判据） */
  readonly dataDir: string | null;
  /**
   * 工作目录（缺省 process.cwd——skills project 层锚；测试注入隔离形）。
   * 注意此处传原始 cwd：project 层锚定用 canonicalWorkspaceRoot（.git 上溯）
   * 在 createStandardLayers 件内执法。
   */
  readonly cwd?: string;
  /** 家目录（缺省 os.homedir——skills 跨库层锚；测试注入隔离形防扫真实 HOME） */
  readonly homeDir?: string;
}

/**
 * core:skills——技能注册表装载（06 §11 渐进披露装载态兑现）：标准六位层
 * 构造 + 全量 refresh 落快照 + 'skills' 服务面供给（插件 tryGet 消费）+
 * skill_manage 工具（boot 全局层散装注册——bootTools 重放消费腿）+
 * 'skills/manifest' 提示词段（每请求物化——registry 快照变化即生效，
 * 06 §11.3 渐进披露的「披露清单」半边；激活半边 = 模型显式读 SKILL.md
 * 归 agent 工具面）。
 *
 * 磁盘件技能目录载荷层（06 §11.4 位 4）挂账磁盘件装载面充实批——core 行
 * 先装（synthesizePlan core 行先入 plan）时磁盘件 manifest.skills 尚未
 * 激活，本 apply 构造 pluginLayers 空缺；补注册于出厂层之后有 06 §11.3
 * 优先序微差（插件层应压出厂层——挂账笔以 unregisterProvider + 位 4
 * 重插兑现，注记在案）。
 *
 * skills_change 事件桥不在此（ctx.emit 域名律强制 `core:skills/` 前缀
 * ——全局词结构性不可达）：桥落 assembly boot 后段（宿主侧
 * dispatch.emit 直发——03 §3.4 汇流点同形）。
 */
function makeSkillsPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'skills',
    async apply(ctx) {
      const context = ctx as PluginContext;
      // 标准六位层（project/user/跨库/出厂——pluginLayers 空缺见上注；
      // dataDir null 跳过 user 层；cwd/homeDir 缺省真跑形）
      const registry = createSkillsRegistry();
      const layers = createStandardLayers({
        ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
        ...(deps.dataDir !== null ? { dataDir: deps.dataDir } : {}),
        ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
      });
      for (const layer of layers) registry.registerProvider(layer);
      await registry.refresh(); // 装载期落首版快照（诊断 warn 不杀装载）
      context.provide('skills', registry);
      // skill_manage：workspaceRoot = canonical 工作区根（create 落点锚）；
      // 可写面 = project `.agents/skills`（06 §11 用户/跨库层只读——写点
      // 前置断言面在件内）
      const workspaceRoot = () => canonicalWorkspaceRoot();
      const disposeTool = context.tools.register(
        createSkillManageTool({
          registry,
          workspaceRoot,
          writableRoots: () => [join(workspaceRoot(), '.agents', 'skills')],
        }),
      );
      // 披露清单段：builder 每请求物化时重取快照（PromptSectionBuilder
      // 求值即取——refresh 后变化自然生效）
      const disposeSection = context.prompts.registerSection(
        'skills/manifest',
        () => renderAvailableSkills(registry.list()).text,
      );
      return () => {
        disposeSection();
        disposeTool();
      };
    },
  };
}

/**
 * core: 官方件注册表工厂（assembly.ts 缺省注入源——`options.corePlugins ??
 * createCorePlugins(deps)`；测试注入面/诊断命令经 options 覆盖）。
 * deps 聚落律（07 §7.4 #1）：宿主真身需求逐笔入 CorePluginHostDeps
 * （dataDir 首位——批 19b-1；store/exec 管道跨件复用等后续件随批扩展）。
 */
export function createCorePlugins(deps: CorePluginHostDeps): readonly CorePluginReference[] {
  return [execPlugin, webPlugin, makeSkillsPlugin(deps)];
}
