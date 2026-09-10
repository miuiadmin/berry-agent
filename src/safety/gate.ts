/**
 * L3 safety — 守门固定行（04 §7 守门段 + §8 carve-out 条 + §9 审批对）。
 *
 * 本行装在 tools_pre_execute 守门段首位，承担三件事：
 * 1. **carve-out 判定**（04 §8 2026-09-06 定形）：fs 写路径在根内但命中
 *    carve-out 例外（.git / .env 族 + 数据目录族）→ block **硬拒**——denial
 *    marker 回执、无升权出路（不存在「升到哪档能写 .git」，任何档含 danger
 *    恒不可写——底线不交模型裁决。与 berry 分叉：berry 把命中做成升权审批面
 *    不承）；数据目录条（04 §7 宿主状态根）无条件恒追加、不可经 entries=[]
 *    关闭（恒 = 平台底线，不交装配裁量——2026-09-06 遗漏审计批补钉）；
 * 2. **write-effect 审批对**（03 §2.3「write 触发审批对」）：effect='write'
 *    的工具调用走审批 ask（粘性短路在 ApprovalService 内）——allowlist 命中
 *    免问（advisory：只影响问不问，fence/执行段照走）；
 * 3. 其余（read 工具）放行交棒。
 *
 * 分工（防重复拦截）：粗粒度根 containment 在 tools/fs 的 fence——路径在可
 * 写根外（outside-roots）是 fence 的拒绝面，本行不拦不问（问了 fence 也会
 * 拒——审批对为可执行动作而设）；read-only 档 fence 拒全量写（空根），本行
 * 跳过不产生审批交互。
 *
 * 链续约定：放行必须 return next(input)（waterfall 委托——不调 next 即短路
 * 会吞掉链上后续守门者）；block 置 input.outcome 后返回（不调 next）。
 * 装配纪律：本仓 EventDispatch 无 prepend 选项、链序 = 注册序——装配根必须
 * **先装本行**再装其余守门者（安全栈固定占守门段首位）。
 */

import { TOOL_PRE_EXECUTE_EVENT } from '../contracts/index.js';
import type { GateInput, ToolDefinition } from '../contracts/index.js';
import type { EventDispatch } from '../context/events.js';
import { parseApplyPatch } from '../tools/index.js';
import type { ApprovalService } from './approval.js';
import type { SandboxMode } from './types.js';
import {
  absolutize,
  buildCarveOutTable,
  canonicalPath,
  deriveWritableRoots,
  resolveWritability,
  type CarveOutEntry,
} from './roots.js';
import { FS_WRITE_TOOLS, matchAllowlist, type AllowlistEntry } from './allowlist.js';
import { sandboxDenialMarker } from './sandbox.js';

/** 内置默认 carve-out 条目（04 §8 例示：.git 转只读 + .env 族遮罩——含单层 glob 两形） */
export const DEFAULT_CARVE_OUT_ENTRIES: readonly CarveOutEntry[] = [
  { pattern: '.git', effect: 'deny', note: '版本库元数据默认只读' },
  { pattern: '.env', effect: 'deny', note: '环境变量敏感文件' },
  { pattern: '*.env', effect: 'deny', note: '环境变量敏感文件（glob）' },
  { pattern: '.env.*', effect: 'deny', note: '环境变量敏感文件（glob）' },
];

/** 守门行选项 */
export interface SafetyGateOptions {
  /** 审批服务（fs 写审批与升权审批共用，summary 区分） */
  readonly approval: ApprovalService;
  /**
   * 本行执法归属会话（批 19c-1 会话归属过滤）：守门行是 per-session 装配
   * （assembleOpenTools 每会话各装一行，经共享 dispatch 全局订阅本词）——
   * 归属位在场时，他会话的工具调用本行让棒（调 next 交棒，不执法不产生
   * 审批交互）。缺省缺席 = 不过滤（单会话测试形 / 无会话语境——判据缺席
   * 不歧视）。in-process 子代理真工厂首例：同栈父子两会话并存，无本位则
   * 同一 write toolCall 被父子两行各问一次（双审批对缺陷——19c-1 修复）。
   */
  readonly sessionId?: string;
  /** 工作区根（会话不可变 cwd；相对路径锚点） */
  readonly workspace: string;
  /** 当前生效档位取值器（三级解析产物；每次预检取最新——会话 override 即时生效） */
  readonly mode: () => SandboxMode;
  /** carve-out 例外条目（缺省内置 .git/.env 条目；传 [] 显式关闭——只关例示面，数据目录条恒在） */
  readonly entries?: readonly CarveOutEntry[];
  /**
   * 数据目录恒排除位（04 §7/§8 遗漏审计批补钉——2026-09-06）：宿主状态根
   * （~/.berry-agent/ 或 env 覆盖位），任何档含 danger 恒不可写（danger 档
   * 根 = 路径分隔符全盘，数据目录恒在根内——防「写 enabled.yaml 自授开关」
   * 的 04 §14 信任锚绕过）。路径单源 persist.resolveDataDir()，host 装配批
   * （批 12）接线注入；safety 不 import persist（DAG 边表），故必填注入而非
   * 自取——漏接 = typecheck 红，fail-loud 不留静默洞。不可经 entries=[] 关闭。
   */
  readonly dataDir: string;
  /**
   * 跨会话 allowlist（04 §9 粘性第 3 款——advisory 免问面）：命中即跳过写
   * 审批直接放行本行。只影响「问不问」：fence/根推导/执行段照走，carve-out
   * 硬拒面不受影响（条目免问放不进 .git——硬拒判定在前）。条目落用户配置
   * 层（存储读写接线随 host 装配批落地，装配注入活数组引用——TTL 过期由
   * 引擎逐调用判定）。缺省无 = 功能关闭。
   */
  readonly allowlist?: readonly AllowlistEntry[];
}

/**
 * 从写类工具参数提取目标路径集合（相对路径保持原样，统一由本行锚 workspace）。
 * 未知工具返回空（本行的路径语义只覆盖 fs 写族；其余 write-effect 工具走
 * 整名审批，无路径可提取）。
 */
function extractWritePaths(toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === 'write') {
    // write 工具：单目标 path 参数
    return typeof args.path === 'string' ? [args.path] : [];
  }
  if (toolName === 'edit') {
    // edit 工具：apply_patch 补丁文本（多文件操作段，逐段提取路径）；
    // 补丁格式错不在本行的管辖面——放行给 edit 工具自身报 FS_PATCH_FAILED
    const patch = typeof args.patch === 'string' ? args.patch : '';
    try {
      return parseApplyPatch(patch).map((op) => op.path);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 安装安全守门行（tools_pre_execute 守门段首位——装配根先于其余守门者注册）。
 * @returns 退订闭包（装配层经 scope.effect 组合生命周期）
 *
 * carve-out 判定表在装配期钉死（glob「先展开再遮罩」的展开时刻在此）——
 * 会话中途新建的 .env 新文件不追溯遮罩（诚实语义；要再遮罩须换条目重装）。
 */
export function installSafetyGate(dispatch: EventDispatch, opts: SafetyGateOptions): () => void {
  const workspace = canonicalPath(opts.workspace);
  // 数据目录恒排除条（04 §7）：无条件追加于用户 entries 之后——entries=[] 关
  // 闭的是 .git/.env 例示面，本条不随装配裁量关闭（恒 = 平台底线）。pattern
  // 为绝对路径（resolveDataDir 产物），buildCarveOutTable 内展开即其自身
  const entries: readonly CarveOutEntry[] = [
    ...(opts.entries ?? DEFAULT_CARVE_OUT_ENTRIES),
    { pattern: opts.dataDir, effect: 'deny', note: '数据目录（04 §7——宿主状态根，任何档含 danger 恒不可写）' },
  ];
  const carveTable = buildCarveOutTable(workspace, entries);
  const approval = opts.approval;

  const handler = async (input: GateInput, next: (value: GateInput) => Promise<GateInput>): Promise<GateInput> => {
    // 会话归属过滤（批 19c-1）：归属位与调用位双在场且相异 = 他会话的工具
    // 调用——本行让棒（不执法不产生审批交互，交棒给归属行）。双缺席任一 =
    // 无会话判据语境（单会话测试形 / 无会话管道调用），不过滤保持旧行为。
    if (opts.sessionId !== undefined && input.sessionId !== undefined && input.sessionId !== opts.sessionId) {
      return next(input);
    }
    const mode = opts.mode();
    const tool: ToolDefinition = input.tool;
    // read-only 档：fence 拒全量写（空根）——本行跳过，不产生审批交互（问了
    // 也白问；denial 回执由 fence 的 FS_OUTSIDE_WRITABLE_ROOTS 承担）
    if (mode === 'read-only') return next(input);
    // 本行只管写意图（03 §2.3 effect 面）：read 工具放行交棒
    if (tool.effect !== 'write') return next(input);

    const isFsFamily = FS_WRITE_TOOLS.has(tool.name);

    /* ---- ① carve-out 判定（fs 族写路径；任何档含 danger 照走——硬拒） ---- */
    if (isFsFamily) {
      const roots = deriveWritableRoots(workspace, mode);
      // 逐路径独立判定：任一 deny 命中即整调用硬拒（多文件补丁不部分放行）
      for (const rawPath of extractWritePaths(tool.name, input.args)) {
        // 与 fence 同源的 canonical 化（相对锚 workspace、最近存在祖先解析符号链）
        const absPath = absolutize(workspace, rawPath);
        const verdict = resolveWritability(absPath, roots, carveTable);
        if (!verdict.allowed && verdict.kind === 'carve-out') {
          const node = verdict.matched!;
          // 硬拒回执（04 §8 定形）：denial marker + 命中条目——无升权 hint
          // （不存在「升到哪档能写」，任何档恒不可写——引导升权即引导徒劳）
          input.outcome = {
            action: 'block',
            reason: `${sandboxDenialMarker(mode)} ${rawPath} 命中 carve-out 恒排除条目 ${node.entry.pattern}${node.entry.note ? `（${node.entry.note}）` : ''}——任何档（含 danger）恒不可写，无升权出路。`,
          };
          return input; // 不调 next：短路整链（守门段 block 语义）
        }
      }
    }

    /* ---- ② allowlist 免问（粘性第 3 款；advisory——只影响问不问） ---- */
    if (opts.allowlist !== undefined && opts.allowlist.length > 0) {
      // fs 族判定收窄到写意图族（writePaths 全量 all-or-nothing）；其余 write-effect
      // 工具走整名族（工具名整匹配）。命中审计（04 §9 批 12f-4）：放行来源标注
      // allowlist:<条目序> 落 GateInput——管道 recordGate 承接进 gate/decision
      // 的 reason 位（免问放行仍可审计——不产生 approval 事件对，来源在此标注）
      const hit = matchAllowlist(
        opts.allowlist,
        isFsFamily
          ? {
              tool: tool.name,
              writePaths: extractWritePaths(tool.name, input.args).map((p) => absolutize(workspace, p)),
              workspace,
            }
          : { tool: tool.name },
        Date.now(),
      );
      if (hit !== undefined) {
        input.allowReason = `allowlist:${hit.index}`;
        return next(input);
      }
    }

    /* ---- ③ write-effect 审批对（03 §2.3；粘性短路在 ApprovalService 内） ---- */
    // 审批前先核 fence 面：任一写目标在可写根外 = fence 必拒（本行不问——
    // 审批对为可执行动作而设，防「批了又被 fence 拒」的空转交互）
    if (isFsFamily) {
      const roots = deriveWritableRoots(workspace, mode);
      const outside = extractWritePaths(tool.name, input.args).some((p) => {
        const verdict = resolveWritability(absolutize(workspace, p), roots, carveTable);
        return !verdict.allowed && verdict.kind === 'outside-roots';
      });
      if (outside) return next(input); // fence 的拒绝面，本行不重复拦
    }

    // 粘性指纹目标摘要（04 §9 粘性第 1/2 款）：fs 族 = 写目标路径（单目标 =
    // 该路径；多目标 = 排序去重拼接——同集合才谈得上免问）；其余 write-effect
    // 工具 = 工具名（整名族语义——同工具的后续调用免问）
    const targets = isFsFamily
      ? [...new Set(extractWritePaths(tool.name, input.args).map((p) => absolutize(workspace, p)))].sort()
      : [tool.name];
    // 草案（04 §9 定形③）：fs 族仅在单目标时携带（精确 canonical 路径——批
    // 这一次不升格批全仓）；多目标无单一路径可代表即无草案；非 fs 族无路径
    // 语义亦无草案（整名草案随真实消费者出现再裁）
    const draft = isFsFamily && targets.length === 1 ? { tool: tool.name, pattern: targets[0]! } : undefined;
    const summary = isFsFamily
      ? targets.length === 1
        ? `写入 ${targets[0]}`
        : `写入 ${targets.length} 个目标（${targets[0]} 等）`
      : `${tool.name} 写动作`;

    const { outcome } = await approval.ask({
      summary,
      toolName: tool.name,
      toolCallId: input.toolCallId,
      // 粘性指纹（tier = 当前档——子集偏序维度：更严档的重复请求被既有宽批包含）
      stickyKey: { target: targets.join('\n'), tier: mode },
      ...(draft !== undefined ? { suggestedEntry: draft } : {}),
      // run 取消信号随 ask 载荷透传（interrupt 链——answerer 桥接撤销；
      // undefined = 无 run 语境不携带）
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    if (outcome === 'allowed-once') return next(input); // 放行交棒（仅本次调用）
    // 拒绝族 block：cancelled 是打断非拒绝（run 已 abort 时模型看不见——
    // loop break 在先，收的是 durable 审计面与 resume 回放语境的诚实）；
    // rejected/unavailable 不带升权 hint（fs 写审批无升权出路——用户已当面
    // 说否，引导绕路违背 04 §8「拒绝是最终的」）
    if (outcome === 'cancelled') {
      input.outcome = {
        action: 'block',
        reason: `${sandboxDenialMarker(mode)} ${summary}未执行（审批已取消——run 已打断）。`,
      };
      return input;
    }
    input.outcome = {
      action: 'block',
      reason: `${sandboxDenialMarker(mode)} ${summary}被拒（审批结果：${outcome}${outcome === 'unavailable' ? '——无人应答，fail-closed 拒执行' : ''}）。`,
    };
    return input;
  };

  // 无 prepend 选项的装配纪律见文件头注——调用方（装配根）保证本行先注册
  return dispatch.onWaterfall<GateInput>(TOOL_PRE_EXECUTE_EVENT, handler);
}
