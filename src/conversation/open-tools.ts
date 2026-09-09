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
import type { AgentTool, ToolDefinition } from '../contracts/index.js';
import { TOOL_EVENT_NAMES } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { createRootsProvider, installSafetyGate, sensitiveReadFiles } from '../safety/index.js';
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
  /** 装载工具定义取值器（批 19a 消费腿：boot 全局层定义经会话装配重放注册——走本管道守门/审批与驱动层同律；每会话装配时调用一次） */
  readonly extraTools?: () => readonly ToolDefinition[];
  /**
   * todo 工具换装注入位（03 §10.5 goal 换装律）：goal 件在场时装配根以
   * goal 件扩展产物替换本域内置 createTodoTool（同名 'todo'——模型面无感
   * 换装，durable todo/write 同词承载扩展字段）。缺省内置件。词面独立律：
   * 本域零 goal 知识——纯结构注入 seam（per-session 闭包由调用方构造）。
   */
  readonly todoTool?: ToolDefinition;
  /**
   * 已知秘密活值 provider（出口治理③ 值基腿——04 §7 执行段 2026-09-08 落码
   * 定形）：装配根接 credentials 库 live 读闭包注入管道链尾消毒。缺省缺席
   * = 纯模式执法（降级诚实）。词面独立律：本域零 credentials 知识——纯
   * 结构注入 seam（闭包由调用方构造）。
   */
  readonly sensitiveValues?: () => readonly string[];
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
  // 登记非撞名覆盖；未注册词自举注册保单测独立装配）。装配哨兵词同走幂等
  // 跳过（批 19c-1 修正：「同 dispatch 二次装配 = bug」前提随多会话装配废止
  // ——in-process 子代理真工厂首例〔同栈父子两会话各装配一次〕；「同一会话
  // 重复装配」检测由 SessionManager records 幂等守卫承担——open 幂等回
  // 活体驱动不二造）
  opts.dispatch.registerEventNames(
    ['conversation/open-tools-mounted', ...TOOL_EVENT_NAMES].filter((name) => !opts.dispatch.isRegistered(name)),
  );

  // ② 审批三件前两件（服务 + answerer + 审批对 durable 落账）
  const approvalWiring = wireSessionApproval({
    sessionId: opts.sessionId,
    dispatch: opts.dispatch,
    session: opts.session,
    ...(opts.askApproval !== undefined ? { askApproval: opts.askApproval } : {}),
    ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    ...(opts.persistAllowlist !== undefined ? { persistAllowlist: opts.persistAllowlist } : {}),
  });

  // ③ 守门安装（先装本行——waterfall 注册序即执行序，本行最先执法；
  // sessionId 归属位 = 会话归属过滤——他会话〔in-process 子代理等〕的工具
  // 调用本行让棒，防止同栈多会话装配时同一 toolCall 被多行各问一次审批）
  const uninstallGate = installSafetyGate(opts.dispatch, {
    approval: approvalWiring.approval,
    sessionId: opts.sessionId,
    workspace: workspaceRoot,
    mode: opts.mode,
    dataDir: opts.dataDir,
    ...(opts.allowlist !== undefined ? { allowlist: opts.allowlist } : {}),
    ...(opts.entries !== undefined ? { entries: opts.entries } : {}),
  });

  // ④ 管道 + 注册表（gate/decision durable 落账——守门不可绕不变式的载体；
  // sensitiveValues 透传 = 出口治理③ 值基腿接线，管道链尾消毒步消费）
  const pipeline = createToolPipeline(opts.dispatch, {
    onGateDecision: (record) => opts.session.append('gate/decision', record),
    ...(opts.sensitiveValues !== undefined ? { sensitiveValues: opts.sensitiveValues } : {}),
  });
  const registry = createToolRegistry(opts.dispatch, { pipeline });

  // ⑤ 工具族装配（fs fence 数据源与守门行同档位单源——createRootsProvider；
  // fs/search 两族读侧 carve-out 同注入位——sensitiveReadFiles 单源派生，与
  // 沙箱 profile 读 deny 行同数据〔2026-09-08 P0① 两腿同源〕）
  const fsTools = createFsTools({
    workspace,
    writableRoots: createRootsProvider({ workspace: workspaceRoot, mode: opts.mode }),
    protectedReadFiles: () => sensitiveReadFiles(opts.dataDir),
  });
  const searchTools = createSearchTools({
    workspace,
    protectedReadFiles: () => sensitiveReadFiles(opts.dataDir),
  });
  // exec 服务面诚实缺席（02 §4.1 #16：tryGet——exec 禁用 = bash 静默缺席）；
  // 在场则经会话装配期工厂求值 bash 工具（批 19a 定形：档位/审批/工作区
  // 会话 deps 注入——装载期固定构造会丢会话面）
  const execService = opts.scope.tryGet<ExecToolService>('exec');
  const bashTool =
    execService !== undefined
      ? execService.createBashTool({
          workspaceRoot: workspace,
          currentMode: opts.mode,
          // 升权审批面绑本会话审批服务（结构窄面 {ask}——ApprovalService 满足）
          approval: { ask: (req) => approvalWiring.approval.ask(req) },
        })
      : undefined;
  // todo 工具：goal 换装注入位胜出（03 §10.5），缺省本域内置件
  const todoTool = opts.todoTool ?? createTodoTool((data) => opts.session.append('todo/write', data));

  const definitions = [
    ...fsTools.tools,
    ...searchTools.tools,
    ...(bashTool !== undefined ? [bashTool] : []),
    todoTool,
    // 装载工具重放（批 19a 消费腿：boot 全局层定义经驱动层注册走真三段
    // 管道——04 §7 插件工具同管线执法；每会话重放一次，快照在装配时点取）
    ...(opts.extraTools !== undefined ? [...opts.extraTools()] : []),
  ];
  // 驱动层注册（{driver: sessionId}——per-session 工具面；批 12 前插件的
  // beforeToolCall 钩子同 dispatch 挂后续守门位）；owner 缺省盖章
  // 'core:host'（03 §2.3 尾注族谱——T9 案一批 t-1）：本注册点是宿主装配
  // 工具的唯一入口，未带 owner 的定义即宿主直构件（fs/search/bash/todo +
  // obs/control extraTools 族）；extraTools 重放腿携带的插件定义已被受理壳
  // 铸得插件 id owner——`??` 缺省式不覆盖，插件归因原样存活到会话层
  const disposers = definitions.map((definition) =>
    registry.register({ ...definition, owner: definition.owner ?? 'core:host' }, { driver: opts.sessionId }),
  );

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
