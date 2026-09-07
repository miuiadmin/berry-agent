/**
 * subagent 域类型与常量（04 §10 子代理与 Job 注册表）。
 *
 * 词汇面（02 §4.1 席 15）：ctx.jobs——Job 注册表（registry.ts 机器）+
 * SubagentProvider 契约（contracts 归位——跨件消费方 exec/issue/host 共享）
 * + 委派工具（tool.ts）。in-process 真工厂（每子代理独立装配全套）是
 * host 装配批的活——本件提供机器与接缝（装载态挂账同 15a/15b 律）。
 */
import type { SubagentRequest, SubagentResult } from '../contracts/index.js';

/** 通用委派工具名（04 §10 委派面静态绑定——缺省路由 'in-process'） */
export const AGENT_TOOL_NAME = 'agent';

/**
 * named provider 派生工具名前缀（**保留字段**——03 §2.7 行 254）：`agent_<name>`
 * 段专属 named provider 派生工具，插件经 ctx.tools.register 携此前缀即拒
 * TOOL_NAME_CONFLICT（保留字在注册面执法——先占位即反锁后续 named provider
 * 注册；执法位在 host ctx.tools.register 包装道，机器侧放行 host 物化腿）。
 */
export const AGENT_TOOL_PREFIX = 'agent_';

/** 缺省委派路由（通用 agent 工具的 providerName 缺省值） */
export const DEFAULT_SUBAGENT_PROVIDER = 'in-process';

/**
 * 派生工具面结构性排除五名（04 §10）：fs read/write/edit/ls + bash。
 * - fs 四名：子自建 fs 族（驱动层注册——结构性不入派生集）；
 * - bash：永不升格总则下的特例条款（子管道无人在场应答 def 内部升权）。
 */
export const EXCLUDED_FROM_DERIVED_SURFACE: readonly string[] = ['read', 'write', 'edit', 'ls', 'bash'];

/** 委派机器的输入（工具面/声明式层组装后的机器位——SubagentRequest 超集） */
export interface DelegationInput {
  /** 路由名（缺省 'in-process'；静态绑定——模型不可见动态选择器） */
  readonly providerName?: string;
  /** 委派目标提示 */
  readonly prompt: string;
  /** 工具白名单（与父会话工具面交集执法） */
  readonly tools?: readonly string[];
  /** 前置要求（fail-ask——缺席任一即拒 spawn 回执缺口；与白名单正交） */
  readonly requiresTools?: readonly string[];
  /** 模型覆盖（缺省回落宿主模型） */
  readonly model?: string;
  /** 子代理系统提示（声明式子代理正文直传） */
  readonly systemPrompt?: string;
  /** 诊断名（Job 名与通知文案显示位） */
  readonly name?: string;
  /** 收场形态（缺省 one-shot 父同步等） */
  readonly background?: boolean;
  /** 父会话 id（background 结算通知路由 + Job 归属围栏 owner） */
  readonly parentSessionId: string;
  /** 委派深度（根 = 1；机器注入逐层 +1——模型不可直设） */
  readonly depth: number;
  /**
   * 父会话工具面快照（工具层 per-session 闭包携带——service 进程级无会话语境）：
   * 预检判据（全父面）+ 派生面交集的基准面。缺省 = 不可枚举（白名单透传、
   * requiresTools 走 fail-closed 全列）。
   */
  readonly availableTools?: readonly string[];
}

/**
 * 父会话通知面（组合根注入——词面独立律：subagent 经 DAG 不可达
 * conversation，02 §4.1 #15 边表无此边；GoalJobsFace 同款先例）。
 * 结算通知「无条件先于归属释放」由 service 编舞执法（先 notify 后 settle）。
 */
export interface SubagentNotifyFace {
  /**
   * 结算通知（04 §10 两种收场）：background 终态向父会话注入 UserMessage
   * （source='subagent-settled'）——父 run 在飞走 steer、不在飞走 followUp
   * 起跑。content 由 subagent 侧单源构建（notify.ts builder）；实现方
   * （组合根桥 driver.submit）按 source + backgroundWake 落三通道。
   */
  notifySettled(input: { parentSessionId: string; content: string }): Promise<unknown>;
  /**
   * 审批挂起通知（04 §10）：background 子代理触发审批对时同时注入
   * source='subagent-approval-pending'——恰一条幂等由实现方执法（driver
   * dedupeKey 面）；one-shot 不注入（service 不装 notifyApproval 闭包）。
   * parentSessionId = 通知路由键（批 19c-1 补——桥按此寻父驱动）。回执
   * 形态不限（Promise<unknown>——桥 driver 同名方法返 Promise<SubmitResult>
   * 可直赋，与 notifySettled 同律）。
   */
  notifyApprovalPending(input: {
    parentSessionId: string;
    jobName: string;
    approvalId: string;
    toolName: string;
    reason?: string;
  }): Promise<unknown>;
}

/** 委派收场回执（run 的返回面——两形态判别联合） */
export type DelegationOutcome =
  { mode: 'one-shot'; result: SubagentResult } | { mode: 'background'; jobName: string; jobId: string };

/** 结算钩子载荷（goal foldDelegation 喂入 seam——组合根接线位） */
export interface DelegationSettlement {
  readonly parentSessionId: string;
  readonly jobName: string;
  readonly result: SubagentResult;
}

/**
 * 声明式子代理解析产物（agents/*.md 纯数据 def——解析层住 core:skills、
 * 机器住 core:subagent 的接缝形状；06 §11.6）。def 形状归 contracts
 * （skills↔subagent 共享只走契约面——02 §4.1 无 skills→subagent 边）。
 */
export type { SubagentDef } from '../contracts/index.js';

/** in-process 子代理的能力面（真工厂独立装配全套——五布尔恒真） */
export const IN_PROCESS_CAPABILITIES = {
  tools: true,
  streaming: true,
  cancel: true,
  background: true,
  structuredOutput: true,
} as const;

/** SubagentRequest 的机器内部视图别名（service 内部拼装产物） */
export type ResolvedRequest = SubagentRequest;
