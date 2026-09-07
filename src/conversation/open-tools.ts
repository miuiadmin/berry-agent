/**
 * fresh 作用域审批三件之③（04 §9 守门安装）+ open 域工具装配——会话级
 * 工具面的组装面（04 §7 三段管道唯一合法路径执法位 / 03 §2.3 defineTool 形）。
 *
 * 装配序（一次成型，host 装配根 / 驱动测试面注入）：
 *  ① 词汇接线——工具族事件词注册（contracts TOOL_EVENT_NAMES 的装配消费面）；
 *  ② 审批三件前两件（wireSessionApproval：服务 + answerer + settlePending）；
 *  ③ 守门安装（installSafetyGate **先装本行**——waterfall 注册序即执行序，
 *     carve-out 硬拒 / allowlist 免问 / write-effect 审批对最先执法；后续
 *     守门者（插件拦截族）装在其后）；
 *  ④ 管道 + 注册表（gate/decision durable 落账接线——守门不可绕不变式的
 *     断言对象）；
 *  ⑤ 工具族：fs 四件（read/write/edit/ls——fence 数据源 createRootsProvider
 *     与守门行同档位单源）+ 检索两件（find/grep）+ bash（exec 服务面
 *     scope.tryGet 诚实缺席——exec 禁用 = coding 降级对话本体仍通）+
 *     todo 一件（全量快照 durable 落 todo/write）。
 *
 * 工具注册走注册表驱动层（{driver: sessionId}——per-session 工具面）；
 * agentToolsFor 快照即驱动 tools 面直用形。dispose 按 LIFO 拆解（工具注册 →
 * 守门 → answerer）。
 */
import { canonicalWorkspaceRoot } from '../context/index.js';
import type { EventDispatch, Scope } from '../context/index.js';
import type { AgentTool } from '../contracts/index.js';
import { TOOL_EVENT_NAMES } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { createRootsProvider, installSafetyGate } from '../safety/index.js';
import type {
  AllowlistDraft,
  AllowlistEntry,
  ApprovalPolicyMode,
  ApprovalService,
  CarveOutEntry,
  SandboxMode,
} from '../safety/index.js';
import { createFsTools, createSearchTools, createToolPipeline, createToolRegistry } from '../tools/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { ExecToolService } from './types.js';
import type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import { wireSessionApproval } from './approval-wiring.js';
import { createTodoTool } from './todo.js';

/** open 域装配选项 */
export interface OpenToolsOptions {
  readonly sessionId: string;
  readonly dispatch: EventDispatch;
  readonly session: SessionLog;
  /** 装载运行时 scope（exec 服务面 tryGet 诚实缺席消费） */
  readonly scope: Scope;
  /** 当前沙箱档位取值器（守门行与 fs fence 数据源同单源——会话 override 即时生效） */
  readonly mode: () => SandboxMode;
  /** 数据目录（守门恒排除位必填——04 §7 数据目录条；host 装配批接 persist.resolveDataDir()） */
  readonly dataDir: string;
  /** 工作区锚点取值器（缺省 canonical 工作区根——context 单源） */
  readonly workspace?: () => string;
  /** 审批 ask 呈现面（透传审批装配；缺席 = 无应答者 fail-closed） */
  readonly askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
  /** 审批策略档（缺省 'ask'） */
  readonly policy?: ApprovalPolicyMode;
  /** 「始终允许」条目写入回调（04 §9 粘性段定形③；缺省 always 面关闭） */
  readonly persistAllowlist?: (draft: AllowlistDraft) => void;
  /** 跨会话 allowlist（04 §9 粘性第 3 款 advisory 免问面；缺省功能关闭） */
  readonly allowlist?: readonly AllowlistEntry[];
  /** carve-out 例外条目（缺省内置 .git/.env 条目；传 [] 显式关闭例示面——数据目录条恒在） */
  readonly entries?: readonly CarveOutEntry[];
}

/** open 域装配产物 */
export interface OpenToolsAssembly {
  /** 全量工具快照（驱动 tools 面直用形——AgentTool[]） */
  readonly tools: AgentTool[];
  /** 工具注册表（后续注册面——插件工具挂载位） */
  readonly registry: ToolRegistry;
  /** 审批服务（诊断/审计面直读） */
  readonly approval: ApprovalService;
  /** 审批挂起收口面（驱动 settleApprovals 注入目标） */
  settlePending(): void;
  /** LIFO 拆解（工具注册 → 守门 → answerer；词汇注册不可逆——dispatch 同生命周期） */
  dispose(): void;
}

/**
 * 组装 open 域工具面 + 审批守门。**一次成型**：返回的 tools 快照经真三段
 * 管道执行（schema → 守门 → 执行——04 §7 唯一合法路径），驱动侧零旁路。
 */
export function assembleOpenTools(opts: OpenToolsOptions): OpenToolsAssembly {
  const workspace = opts.workspace ?? (() => canonicalWorkspaceRoot());
  const workspaceRoot = workspace();

  // ① 工具族事件词接线（contracts TOOL_EVENT_NAMES 装配消费面）。一词两册
  // 幂等跳过（03 §2.4 装配序律——装载批预注册主表镜像在前，已注册词共享
  // 登记非撞名覆盖；未注册词自举注册保单测独立装配）；重复装配检测改经
  // 装配哨兵（永不 emit 的域名前缀占位词——同 dispatch 二次装配即撞哨兵
  // fail-loud，检测面不因共享词幂等而丢失）
  opts.dispatch.registerEventNames([
    'conversation/open-tools-mounted',
    ...TOOL_EVENT_NAMES.filter((name) => !opts.dispatch.isRegistered(name)),
  ]);

  // ② 审批三件前两件（服务 + answerer + 审批对 durable 落账）
  const approvalWiring = wireSessionApproval({
    sessionId: opts.sessionId,
    dispatch: opts.dispatch,
    session: opts.session,
    ...(opts.askApproval !== undefined ? { askApproval: opts.askApproval } : {}),
    ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    ...(opts.persistAllowlist !== undefined ? { persistAllowlist: opts.persistAllowlist } : {}),
  });

  // ③ 守门安装（先装本行——waterfall 注册序即执行序，本行最先执法）
  const uninstallGate = installSafetyGate(opts.dispatch, {
    approval: approvalWiring.approval,
    workspace: workspaceRoot,
    mode: opts.mode,
    dataDir: opts.dataDir,
    ...(opts.allowlist !== undefined ? { allowlist: opts.allowlist } : {}),
    ...(opts.entries !== undefined ? { entries: opts.entries } : {}),
  });

  // ④ 管道 + 注册表（gate/decision durable 落账——守门不可绕不变式的载体）
  const pipeline = createToolPipeline(opts.dispatch, {
    onGateDecision: (record) => opts.session.append('gate/decision', record),
  });
  const registry = createToolRegistry(opts.dispatch, { pipeline });

  // ⑤ 工具族装配（fs fence 数据源与守门行同档位单源——createRootsProvider）
  const fsTools = createFsTools({
    workspace,
    writableRoots: createRootsProvider({ workspace: workspaceRoot, mode: opts.mode }),
  });
  const searchTools = createSearchTools({ workspace });
  // exec 服务面诚实缺席（02 §4.1 #16：tryGet——exec 禁用 = bash 静默缺席）
  const execService = opts.scope.tryGet<ExecToolService>('exec');
  const todoTool = createTodoTool((data) => opts.session.append('todo/write', data));

  const definitions = [
    ...fsTools.tools,
    ...searchTools.tools,
    ...(execService !== undefined ? [execService.bashTool] : []),
    todoTool,
  ];
  // 驱动层注册（{driver: sessionId}——per-session 工具面；批 12 前插件的
  // beforeToolCall 钩子同 dispatch 挂后续守门位）
  const disposers = definitions.map((definition) => registry.register(definition, { driver: opts.sessionId }));

  return {
    tools: registry.agentToolsFor(opts.sessionId),
    registry,
    approval: approvalWiring.approval,
    settlePending: approvalWiring.settlePending,
    dispose() {
      // LIFO 拆解：先摘工具注册（含执行面）→ 守门 → answerer
      for (const dispose of disposers.reverse()) dispose();
      uninstallGate();
      approvalWiring.dispose();
    },
  };
}
