/**
 * fresh 作用域审批三件之③（04 §9 守门安装）+ open 域工具装配——会话级
 * 工具面的组装面（04 §7 三段管道唯一合法路径执法位 / 03 §2.3 defineTool 形）。
 *
 * 装配序（一次成型，host 装配根 / 驱动测试面注入）：
 *  ① 词汇接线——工具族事件词注册（contracts TOOL_EVENT_NAMES 的装配消费面）；
 *  ② 审批三件前两件（wireSessionApproval：服务 + answerer + settlePending）；
 *  ③ 守门安装（installSafetyGate **先装本行**——waterfall 注册序即执行序，
 *     carve-out 硬拒 / 策略表 allow 免问 / write-effect 审批对最先执法；后续
 *     守门者（插件拦截族）装在其后）；
 *  ④ 管道 + 注册表（gate/decision durable 落账接线——守门不可绕不变式的
 *     断言对象）；
 *  ⑤ 工具族：fs 四件（read/write/edit/ls——fence 数据源 createRootsProvider
 *     与守门行同档位单源；grantedRoots live 并入〔04 §7 补钉①〕）+ 检索两件
 *     （find/grep）+ bash（exec 服务面 scope.tryGet 诚实缺席——exec 禁用 =
 *     coding 降级对话本体仍通）+ worktree 三件（服务注入位在场则挂载——
 *     create/list/clean，缺席诚实缺席）+ todo 一件（全量快照 durable 落
 *     todo/write）。
 *
 * 工具注册走注册表驱动层（{driver: sessionId}——per-session 工具面）；
 * agentToolsFor 快照即驱动 tools 面直用形；extraTools 腿另经请求边界差量
 * 对账换新（reconcileExtraTools——pi-3 件 A）。dispose 按 LIFO 拆解（工具
 * 注册 → 守门 → answerer）。
 */
import { canonicalWorkspaceRoot } from '../context/index.js';
import type { EventDispatch, Scope } from '../context/index.js';
import type { AgentTool, ToolDefinition } from '../contracts/index.js';
import { TOOL_EVENT_NAMES } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { createRootsProvider, installSafetyGate, sensitiveReadFiles } from '../safety/index.js';
import type {
  ToolPolicyDraft,
  ApprovalPolicyMode,
  ApprovalService,
  CarveOutEntry,
  SandboxMode,
  ToolPolicyEntry,
} from '../safety/index.js';
import {
  createFsTools,
  createSearchTools,
  createToolPipeline,
  createToolRegistry,
  createWorktreeTools,
} from '../tools/index.js';
import type { ToolRegistry, WorktreeService } from '../tools/index.js';
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
  readonly persistToolPolicy?: (draft: ToolPolicyDraft) => void;
  /** 跨会话工具策略表（04 §9 粘性第 3 款 + 审批分档批③④双面：allow 免问 / deny 硬拒；缺省功能关闭） */
  readonly toolPolicy?: readonly ToolPolicyEntry[];
  /** carve-out 例外条目（缺省内置 .git/.env 条目；传 [] 显式关闭例示面——数据目录条恒在） */
  readonly entries?: readonly CarveOutEntry[];
  /** 装载工具定义取值器（批 19a 消费腿：boot 全局层定义经会话装配重放注册——走本管道守门/审批与驱动层同律；装配首取一次 + 每请求差量对账〔pi-3 件 A——到达窗分面语义见 03 §2.8〕） */
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
  /**
   * worktree 服务面（04 §7 补钉①——三动词工具挂载）：在场则本域挂载
   * worktree_create/list/clean 三工具（经真三段管道执法）；缺席 = 三工具
   * 诚实缺席（exec 服务面同律——不虚构能力）。词面独立律：本域零 git
   * 知识——纯结构注入 seam。
   */
  readonly worktree?: WorktreeService;
  /**
   * 会话授予根 live 取值器（04 §7 补钉①——worktree 产物可写根并入口）：
   * fs fence 每次可写性检查现取并入（授予起于装配后——issue 编排在会话起
   * 后才 grant，快照形会漏授予；03 §10.7 六役定形注「活取非快照」）。
   * 缺省 undefined = 无授予面（既有调用方零破坏）。与 worktree 选项独立
   * （授予面消费在 safety 层，工具挂载消费在 tools 层——两腿可分立注入）。
   */
  readonly grantedRoots?: () => string[];
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
  /**
   * 请求边界差量对账（pi-3 件 A——04 §4 装配接线义务真身）：与 extraTools
   * 取值器现值对账（新增注册/移除回卷/未变不动），返回 true = 工具面有变
   * （调用方重取 tools 投影）。消费位 = 驱动请求组装（agent_pre_step 瀑布
   * 后）。extraTools 缺席的装配形不提供（undefined——纯宿主构件面恒定，
   * 零对账源）。
   */
  readonly reconcileExtraTools?: () => boolean;
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
    ...(opts.persistToolPolicy !== undefined ? { persistToolPolicy: opts.persistToolPolicy } : {}),
  });

  // 同源可写根 provider（六役 A1 复核 blocker——守门行与 fence 同根集单源）：
  // 同一闭包产物双消费——③ 守门行 (2)/(5) 判定与 ⑤ fs fence 数据源完全同源
  // （grantedRoots live 并入在 provider 内，见 04 §7 补钉① 六役定形注：
  // 授予域写仍过审批对——防「守门判 outside 交棒、fence 却放行」的旁路）
  const writableRoots = createRootsProvider({
    workspace: workspaceRoot,
    mode: opts.mode,
    ...(opts.grantedRoots !== undefined ? { grantedRoots: opts.grantedRoots } : {}),
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
    // 守门行与 fence 同根集（六役 A1——SafetyGateOptions.writableRoots 注）
    writableRoots,
    // 授予根 live 透传（wt 挂账批——授予根 .git 同律遮蔽）：守门行按授予根
    // 构造 .git 动态 carve-out 节点的数据源，与上方 provider / 下方 bash 工
    // 具的 grantedRoots 同一 live 源——守门行/fence/bash 沙箱三面对授予根
    // 同根集执法（快照形会漏会话起后 grant 的授予，故 live 现取）
    ...(opts.grantedRoots !== undefined ? { grantedRoots: opts.grantedRoots } : {}),
    ...(opts.toolPolicy !== undefined ? { toolPolicy: opts.toolPolicy } : {}),
    ...(opts.entries !== undefined ? { entries: opts.entries } : {}),
  });

  // ④ 管道 + 注册表（gate/decision durable 落账——守门不可绕不变式的载体；
  // sensitiveValues 透传 = 出口治理③ 值基腿接线，管道链尾消毒步消费）
  const pipeline = createToolPipeline(opts.dispatch, {
    onGateDecision: (record) => opts.session.append('gate/decision', record),
    ...(opts.sensitiveValues !== undefined ? { sensitiveValues: opts.sensitiveValues } : {}),
  });
  const registry = createToolRegistry(opts.dispatch, { pipeline });

  // ⑤ 工具族装配（fs fence 数据源与守门行同档位单源——上方同一 provider；
  // fs/search 两族读侧 carve-out 同注入位——sensitiveReadFiles 单源派生，与
  // 沙箱 profile 读 deny 行同数据〔2026-09-08 P0① 两腿同源〕）
  const fsTools = createFsTools({
    workspace,
    // grantedRoots live 并入（04 §7 补钉①）：授予根经 live callback 进
    // fence 数据源——每次可写性检查现取（会话起后的授予即时生效）
    writableRoots,
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
          // 授予根 live 透传（六役 A1 复核定形——两道防线同根集）：bash 沙箱
          // workspace-write 档可写根并入授予根，与 fence 同 live 源
          ...(opts.grantedRoots !== undefined ? { grantedRoots: opts.grantedRoots } : {}),
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
    // worktree 三件（04 §7 补钉①——服务在场即挂载，走真三段管道执法；
    // 缺席诚实缺席〔exec 服务面同律〕。create 自动授予经服务的会话记账面
    // ——grantedRoots live callback 同栈并入 fs fence）
    ...(opts.worktree !== undefined ? createWorktreeTools(opts.worktree) : []),
    todoTool,
  ];
  // extraTools 腿改名键追踪账（pi-3 件 A——04 §4 装配接线义务真身「请求边界
  // 差量对账」）：装载工具重放不再装配时点一次展平定格——追踪账承载已注册
  // 面，reconcileExtraTools 每请求与取值器现值对账（新增注册/移除回卷/未变
  // 不动），bootTools 活取值器由此穿透至会话注册表（03 §2.1「变更对下一次
  // 消费点生效」的请求组装位兑现——到达窗分面语义见 03 §2.8）
  const extraTools = opts.extraTools;
  const extraLeg = new Map<string, { faceKey: string; dispose: () => void }>();
  const faceKeyOf = (definition: ToolDefinition): string =>
    JSON.stringify({
      name: definition.name,
      owner: definition.owner ?? 'core:host',
      description: definition.description,
      parameters: definition.parameters,
    });
  const registerExtra = (definition: ToolDefinition): void => {
    const stamped = { ...definition, owner: definition.owner ?? 'core:host' };
    extraLeg.set(stamped.name, {
      faceKey: faceKeyOf(stamped),
      dispose: registry.register(stamped, { driver: opts.sessionId }),
    });
  };
  // 驱动层注册（{driver: sessionId}——per-session 工具面；批 12 前插件的
  // beforeToolCall 钩子同 dispatch 挂后续守门位）；owner 缺省盖章
  // 'core:host'（03 §2.3 尾注族谱——T9 案一批 t-1）：本注册点是宿主装配
  // 工具的唯一入口，未带 owner 的定义即宿主直构件（fs/search/bash/todo +
  // obs/control extraTools 族）；extraTools 重放腿携带的插件定义已被受理壳
  // 铸得插件 id owner——`??` 缺省式不覆盖，插件归因原样存活到会话层
  const disposers = definitions.map((definition) =>
    registry.register({ ...definition, owner: definition.owner ?? 'core:host' }, { driver: opts.sessionId }),
  );
  if (extraTools !== undefined) for (const definition of extraTools()) registerExtra(definition);
  // 请求边界差量对账（pi-3 件 A）：与 extraTools 取值器现值对账。未变判据 =
  // {name, owner, description, parameters} 序列化同形——execute 闭包同形不
  // 重注册（面粒度对账的有意边界：reload 后同形工具沿用旧执行体，任何面
  // 变化/增删即换新）。返回 true = 面有变（调用方重取 tools 投影）
  const reconcileExtraTools = (): boolean => {
    const freshByName = new Map<string, ToolDefinition>();
    for (const definition of extraTools!()) freshByName.set(definition.name, definition);
    let changed = false;
    // 移除回卷：追踪账有名而现值无名（boot 册已回卷——uninstall/换代移除）
    for (const [name, entry] of [...extraLeg]) {
      if (freshByName.has(name)) continue;
      entry.dispose();
      extraLeg.delete(name);
      changed = true;
    }
    // 新增/换形：未变不动（面键同形零动作）；面键变 = 回卷重注册（owner
    // 换主同面也换——归因面随新代）
    for (const [name, definition] of freshByName) {
      const existing = extraLeg.get(name);
      const faceKey = faceKeyOf(definition);
      if (existing !== undefined) {
        if (existing.faceKey === faceKey) continue;
        existing.dispose();
        extraLeg.delete(name);
      }
      registerExtra(definition);
      changed = true;
    }
    return changed;
  };

  return {
    tools: registry.agentToolsFor(opts.sessionId),
    registry,
    approval: approvalWiring.approval,
    settlePending: approvalWiring.settlePending,
    // 对账面（pi-3 件 A）：消费位 = 驱动请求组装（agent_pre_step 瀑布后）；
    // extraTools 缺席的装配形不提供（纯宿主构件面恒定，零对账源）
    reconcileExtraTools: extraTools !== undefined ? reconcileExtraTools : undefined,
    dispose() {
      // LIFO 拆解：先摘工具注册（含执行面）→ 守门 → answerer；extra 腿先
      // 回卷（注册序在宿主构件后，与原展平序一致）
      for (const entry of extraLeg.values()) entry.dispose();
      for (const dispose of disposers.reverse()) dispose();
      uninstallGate();
      approvalWiring.dispose();
    },
  };
}
