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
import type { ExecToolService } from '../conversation/index.js';
import { createBashTool, createSpawnPipeline } from '../exec/index.js';
import { createSandboxService } from '../safety/index.js';

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
 * core: 官方件注册表（assembly.ts 缺省注入源——`options.corePlugins ??
 * CORE_PLUGINS`；测试注入面/诊断命令经 options 覆盖）。
 * deps 聚落律（07 §7.4 #1）：现无宿主 deps 闭包需求（件内 deps 全自足
 * 构造），静态数组即聚落产物；后续件需宿主真身（store/exec 管道跨件
 * 复用等）时升级工厂形。
 */
export const CORE_PLUGINS: readonly CorePluginReference[] = [execPlugin];
