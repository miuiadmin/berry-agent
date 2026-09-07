/**
 * 委派工具族（04 §10 委派面 = 静态绑定）：通用委派工具 `agent`（缺省路由
 * 'in-process'）+ 声明式子代理静态工具 `agent_<name>`（闭包绑定 def——
 * 发现/信任/frontmatter 基建镜像技能，06 §11.6）。
 *
 * effect 面：委派工具本身 'read'（子代理的工具面自带各自 effect 与审批
 * 路由——审批型升权走父会话审批面，不因委派而放大父侧效果面）。
 */
import { BaseError, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { ProgrammaticProviderEntry, SubagentService } from './service.js';
import { AGENT_TOOL_NAME, AGENT_TOOL_PREFIX, type SubagentDef } from './types.js';

/** 委派工具的会话语境（per-session 闭包——工具面创建位携带） */
export interface DelegationToolDeps {
  readonly service: SubagentService;
  /** 父会话 id（Job owner + 通知路由） */
  readonly parentSessionId: string;
  /** 委派深度（根会话工具 = 1 缺省；子栈工具 = 父深度 + 1——机器注入） */
  readonly depth?: number;
  /** 父会话工具面读面（派生面基准 + 预检判据；缺省不可枚举） */
  readonly availableTools?: () => readonly string[];
}

/** 委派回执渲染（one-shot 结果 / background Job 身份——模型面统一文案） */
function renderOutcome(outcome: Awaited<ReturnType<SubagentService['run']>>): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  if (outcome.mode === 'background') {
    return {
      content: [
        {
          type: 'text',
          text: `子代理「${outcome.jobName}」已后台起跑（Job ${outcome.jobId}）——终态时将注入结算通知。`,
        },
      ],
    };
  }
  const { result } = outcome;
  const isError = result.stopReason !== 'stop';
  const lines = [result.output];
  if (result.diagnostic !== undefined && result.diagnostic !== '') lines.push(`诊断：${result.diagnostic}`);
  return {
    content: [{ type: 'text', text: lines.filter((line) => line !== '').join('\n') || '（空输出）' }],
    ...(isError ? { isError: true as const } : {}),
  };
}

/**
 * 通用委派工具 `agent`：schema 只暴露 prompt/background（provider 路由、
 * 白名单、深度均机器位——模型不可见动态选择器）。
 */
export function createAgentTool(deps: DelegationToolDeps): ToolDefinition {
  return {
    name: AGENT_TOOL_NAME,
    description:
      '委派一个子代理执行任务（黑盒——只见结果不见过程；缺省同步等待，background=true 后台起跑终态注入结算通知）',
    effect: 'read',
    parameters: Type.Object({
      prompt: Type.String({ description: '委派目标提示（子代理的唯一任务输入）' }),
      background: Type.Optional(Type.Boolean({ description: '后台收场（缺省 false = 父同步等结果）' })),
      name: Type.Optional(Type.String({ description: '诊断名（Job 名与通知文案显示位）' })),
    }),
    async execute(args) {
      try {
        const outcome = await deps.service.run({
          prompt: String(args.prompt ?? ''),
          ...(args.background === true ? { background: true } : {}),
          ...(typeof args.name === 'string' && args.name !== '' ? { name: args.name } : {}),
          parentSessionId: deps.parentSessionId,
          depth: deps.depth ?? 1,
          ...(deps.availableTools !== undefined ? { availableTools: deps.availableTools() } : {}),
        });
        return renderOutcome(outcome);
      } catch (err) {
        // 机器面拒（深度帽/预检闸/路由）→ isError 数据面回执（码 + 人读）
        if (err instanceof BaseError) {
          return { content: [{ type: 'text', text: `${err.code}：${err.message}` }], isError: true };
        }
        throw err;
      }
    },
  };
}

/**
 * 声明式子代理静态工具 `agent_<name>`（闭包绑定 def——工具面 = 装配期
 * 物化，06 §11.6 模型面静态多工具律）。description = 文件 description
 * （披露段清单行 = 模型选择依据）；def 字段（tools/requires/model/
 * systemPrompt）全部闭包绑定——模型只出 prompt。def 形 = 声明式与程序化
 * 两腿共享（filePath 位非工具构造消费——Omit 宽形两腿同构，D 批 D-2）。
 */
export function createDeclarativeAgentTool(
  def: Omit<SubagentDef, 'filePath'>,
  deps: DelegationToolDeps,
): ToolDefinition {
  return {
    name: `${AGENT_TOOL_PREFIX}${def.name}`,
    description: def.description,
    effect: 'read',
    parameters: Type.Object({
      prompt: Type.String({ description: '委派目标提示' }),
      background: Type.Optional(Type.Boolean({ description: '后台收场（缺省 false = 父同步等结果）' })),
    }),
    async execute(args) {
      try {
        const outcome = await deps.service.run({
          providerName: def.name,
          prompt: String(args.prompt ?? ''),
          ...(args.background === true ? { background: true } : {}),
          ...(def.tools !== undefined ? { tools: def.tools } : {}),
          ...(def.requires !== undefined ? { requiresTools: def.requires } : {}),
          ...(def.model !== undefined ? { model: def.model } : {}),
          systemPrompt: def.systemPrompt,
          name: def.name,
          parentSessionId: deps.parentSessionId,
          depth: deps.depth ?? 1,
          ...(deps.availableTools !== undefined ? { availableTools: deps.availableTools() } : {}),
        });
        return renderOutcome(outcome);
      } catch (err) {
        if (err instanceof BaseError) {
          return { content: [{ type: 'text', text: `${err.code}：${err.message}` }], isError: true };
        }
        throw err;
      }
    },
  };
}

/**
 * 程序化注册位物化（04 §10 程序化注册槽——「注册即派生静态工具」的机器层
 * 兑现）：在册条目逐个派生 `agent_<name>` 工具（与声明式同形同律——
 * createDeclarativeAgentTool 单源）。消费腿 = 会话工具面组装位（快照
 * programmaticProviders 后逐条物化）；driver 工具面合流挂账装载态集成批
 * （D 批 D-2 只落机器与读面）。
 */
export function createProgrammaticTools(
  entries: readonly ProgrammaticProviderEntry[],
  deps: DelegationToolDeps,
): readonly ToolDefinition[] {
  return entries.map((entry) => createDeclarativeAgentTool(entry.def, deps));
}
