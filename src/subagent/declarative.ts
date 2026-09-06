/**
 * 声明式子代理物化机器（06 §11.6——机器住 core:subagent）。
 *
 * 解析层在 core:skills（agents.ts——收纯数据 def）；本件把 def 物化为
 * named provider（late-binding 桥 'in-process' 真工厂——host 装配批接线）
 * + 静态工具 `agent_<name>`（工具面 = 装配期物化）。撞名拒在注册面
 * （扫描序 first-wins 由发现层表达——同层同名不进本件）；坏文件在
 * 解析层已 warning 跳过（06 §11.6 诊断语义——不炸装配）。
 */
import type { SubagentProvider, SubagentResult, ToolDefinition } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { SubagentService } from './service.js';
import { createDeclarativeAgentTool, type DelegationToolDeps } from './tool.js';
import { DEFAULT_SUBAGENT_PROVIDER, IN_PROCESS_CAPABILITIES, type SubagentDef } from './types.js';

/**
 * def → named provider（late-binding def-defaults 包装）：路由到本 def 的
 * 委派请求缺省字段由此合流（模型侧经静态工具携带、程序侧直呼 service.run
 * 两条道同折）；真身始终 'in-process' 基 provider——独立装配全套的
 * 黑盒契约不因声明式形态而二轨。
 */
export function defBoundProvider(def: SubagentDef, service: SubagentService): SubagentProvider {
  return {
    capabilities: IN_PROCESS_CAPABILITIES,
    async run(request) {
      const base = service.getProvider(DEFAULT_SUBAGENT_PROVIDER);
      if (base === undefined) {
        throw new BaseError(
          'SUBAGENT_PROVIDER_UNKNOWN',
          `声明式子代理「${def.name}」的基工厂 'in-process' 未注册——host 装配批接线位（06 §11.6 桥条款）`,
        );
      }
      // def 缺省合流（请求已有值胜出——静态工具道 service 已合流过一次，
      // 幂等；程序直呼 provider 道由此兜底）
      const merged = {
        ...request,
        ...(request.model === undefined && def.model !== undefined ? { model: def.model } : {}),
        ...(request.systemPrompt === undefined ? { systemPrompt: def.systemPrompt } : {}),
        ...(request.tools === undefined && def.tools !== undefined ? { tools: [...def.tools] } : {}),
        name: request.name ?? def.name,
      };
      return base.run(merged) as Promise<SubagentResult>;
    },
  };
}

/** 物化产物（装配面消费——named provider 已入服务、静态工具由此注册） */
export interface MaterializedSubagents {
  /** 物化成功的 def 名单（诊断/披露段清单行） */
  readonly names: readonly string[];
  /** 静态工具族（装配面注册进工具表——工具面变更刷新） */
  readonly tools: readonly ToolDefinition[];
}

/**
 * 批量物化声明式子代理：每 def 一 named provider + 一静态工具。
 * 撞名（named provider 或既有工具名）响亮拒——坏 def 已在解析层跳过，
 * 这里的拒是装配态冲突（fail-loud；调用方可折 warn 降级——发现层
 * first-wins 已表达同层同名，跨层冲突走注册面）。
 */
export function materializeDeclarativeSubagents(
  defs: readonly SubagentDef[],
  service: SubagentService,
  deps: Omit<DelegationToolDeps, 'service'>,
): MaterializedSubagents {
  const names: string[] = [];
  const tools: ToolDefinition[] = [];
  for (const def of defs) {
    service.registerProvider(def.name, defBoundProvider(def, service));
    names.push(def.name);
    tools.push(createDeclarativeAgentTool(def, { ...deps, service }));
  }
  return { names, tools };
}
