/**
 * /goal 命令处理器（04 §12——/goal wake 手动起闹的纯程序面；list/show 观察面）。
 *
 * 形态律与 /tick 同族（tick.ts 先例）：五动词 argv → 人读文本；服务面守卫错
 * （BaseError）折文本不抛（命令面是用户面不是异常面）；唤醒裁决（WakeDecision）
 * 渲染落地/拒因。真正把唤醒消息投进会话的编舞归宿主装配（批 12）——本面只
 * 裁决与呈现。create（U10——03 §10.5 U10 落码定形注①）是创建唯一写面：
 * 恒人面命令，模型工具面零创建位（防自激励环入口）。
 */
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { foldGoalTodos, openGoalItems } from './fold.js';
import type { GoalService } from './service.js';

export const GOAL_USAGE = [
  '用法：/goal create <schedule 串> <objective 全文> [--write] [--budget <n>] —— 创建续跑 goal（绑定本会话；schedule 写法见 /tick 用法）',
  '　　　/goal list —— 全部 goal（状态/定时/预算速览）',
  '　　　/goal show <goalId> —— 单个 goal 详情（任务清单 + 唤醒记录）',
  '　　　/goal wake <goalId> —— 手动唤醒（无进展与预算计数清零，恢复定时运行）',
  '　　　/goal approve <goalId> —— 批准写入权限申请（批准后写入工具可用）',
].join('\n');

/** 子动词名集（补全面单源——static-completions SUBVERBS_BY_COMMAND 消费） */
export const GOAL_SUBVERBS = ['create', 'list', 'show', 'wake', 'approve'] as const;

/** 命令装配依赖 */
export interface GoalCommandDeps {
  service: GoalService;
  /** goal 段计划态 fold 面（open 项计数渲染——service.goalScopeFor 取锚；readonly = GoalSessionFace.events 同形直传） */
  eventsFor: (sessionId: string) => readonly SessionEvent[];
}

/**
 * create 动词：位参 schedule/objective + 可选 --write/--budget（/tick add 同款
 * argv 位参先例——引号感知切分在 channels 面，本面 join 复原全文；位参前置
 * 选项后置为正形，循环宽容交错）。
 *
 * 守卫面分工（U10 定形注②）：位参缺席/objective 仅空白/--budget 值域执法全在
 * 命令层（goal 族既有**无码**用法错面——缺位参/未知选项/坏值同折纯文本 +
 * GOAL_USAGE）；service 面契约信任调用方零校验（0 帽穿透 = 建即死 goal，故
 * 正整数判归命令层）。schedule 透传律（定形注⑤）：零词法执法——好坏判据 =
 * register 回执经 activate 折 GOAL_TRANSITION_INVALID + 行回卷（既有律）。
 * 会话锚缺席（CLI 面/防御位）诚实拒——不猜默认会话源（定形注③）。
 */
async function goalCreate(
  rest: readonly string[],
  deps: GoalCommandDeps,
  sessionId: string | undefined,
): Promise<string> {
  const usageErr = (message: string) => `${message}\n${GOAL_USAGE}`;
  const positional: string[] = [];
  let write = false;
  let budget: number | undefined;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] ?? '';
    if (tok === '--write') {
      write = true;
    } else if (tok === '--budget') {
      const raw = rest[++i];
      // 正整数必需（0/负数/非数字/缺值均用法错——命令层执法）
      if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) <= 0) {
        return usageErr(`--budget 须带正整数值（得「${raw ?? '未填'}」）。`);
      }
      budget = Number(raw);
    } else if (tok.startsWith('--')) {
      return usageErr(`未知选项「${tok}」（/goal create 只支持 --write 与 --budget）。`);
    } else {
      positional.push(tok);
    }
  }
  const schedule = positional[0];
  // objective 全文 = 余位参 join 复原；仅空白 = 用法错（service 面 length 判
  // 不辖空白——命令层 trim 判，complete 的 evidence 同律）
  const objective = positional.slice(1).join(' ').trim();
  if (sessionId === undefined) {
    return usageErr('当前没有会话——/goal create 须在会话内执行（goal 是本会话的无人值守延续）。');
  }
  if (!schedule || objective === '') {
    return usageErr(
      'create 须带两段参数：<schedule 串> <objective 全文>（objective 含空格请整体加引号；schedule 写法见 /tick 用法）。',
    );
  }
  const row = await deps.service.activate({
    sessionId,
    objective,
    schedule,
    needsWrite: write,
    budgetMessagesCap: budget ?? null,
  });
  // 回执不探测装配态（定形注⑤）——通用文案「挂钟行已排」如实（缺席迟到
  // 暂存系测试形，core 双件恒装载）；首跑 = schedule 首到点（不开 create 即
  // 起跑——立题档边界声明）
  const lines = [
    `已建 goal「${row.id}」——定时已排（schedule ${row.schedule}；首跑 = 首次到点，想立即推进请直接发言）。`,
  ];
  if (row.needsWrite) {
    lines.push(`已申请写入权限（申请不等于授权）——/goal approve ${row.id} 批准后写入工具可用。`);
  }
  if (row.budgetMessagesCap !== null) {
    lines.push(`预算上限 ${row.budgetMessagesCap} 条（本会话计数与后台代跑合计计入上限）。`);
  }
  return lines.join('\n');
}

/** /goal 处理器（argv → 人读文本；守卫错折文本；sessionId = 命令发起会话锚——U10 定形注③，缺席仅 create 受影响） */
export async function runGoalCommand(
  argv: readonly string[],
  deps: GoalCommandDeps,
  sessionId?: string,
): Promise<string> {
  const [verb, ...rest] = argv;
  try {
    switch (verb) {
      case 'create': {
        // return await（非裸 return）——helper 的守卫错拒绝须经本层
        // try/catch 折文本（裸 return 的 promise 拒绝发生在 catch 出口之后）
        return await goalCreate(rest, deps, sessionId);
      }
      case 'wake': {
        const goalId = rest[0];
        if (!goalId) return `缺 goalId。\n${GOAL_USAGE}`;
        const decision = await deps.service.wake(goalId, { trigger: 'manual', attribution: '/goal wake' });
        return decision.landed
          ? `已手动唤醒 goal「${goalId}」（无进展计数与唤醒预算已清零，恢复定时运行）。${decision.message}`
          : `唤醒未执行：${decision.message}`;
      }
      case 'approve': {
        // 人面批准（f-1 定形注②——批准唯一写面；守卫错折文本同面）
        const goalId = rest[0];
        if (!goalId) return `缺 goalId。\n${GOAL_USAGE}`;
        await deps.service.approve(goalId);
        return `已批准 goal「${goalId}」的写入权限申请——写入工具即刻可用。`;
      }
      case 'list': {
        const rows = deps.service.list();
        if (rows.length === 0) return '无 goal。';
        const lines = rows.map((row) => {
          const budget =
            row.budgetMessagesCap === null
              ? '无预算上限'
              : `预算 ${row.budgetMessagesUsed + row.budgetFoldedUnits}/${row.budgetMessagesCap}`;
          const clock =
            row.status === 'active'
              ? row.stallStreak > 0
                ? `定时运行中（连续 ${row.stallStreak} 次无进展）`
                : '定时运行中'
              : '已暂停';
          return `- ${row.id}〔${row.status}〕${row.objective.slice(0, 40)} —— ${clock} · ${budget}`;
        });
        return `共 ${rows.length} 个 goal：\n${lines.join('\n')}`;
      }
      case 'show': {
        const goalId = rest[0];
        if (!goalId) return `缺 goalId。\n${GOAL_USAGE}`;
        const row = deps.service.get(goalId);
        if (!row) return `goal「${goalId}」不存在。`;
        const scope = deps.service.goalScopeFor(row.sessionId);
        const items =
          scope !== undefined && scope.goalId === goalId
            ? openGoalItems(foldGoalTodos(deps.eventsFor(row.sessionId), row.activatedSeq))
            : [];
        const openLine =
          items.length === 0
            ? '未完成项：0'
            : `未完成项：${items.length}（${items.map((i) => `[${i.status}] ${i.content}`).join('；')}）`;
        const wakes = deps.service.wakes(goalId);
        const wakeLines =
          wakes.length === 0
            ? '（无唤醒记录）'
            : wakes
                .slice(-5)
                .map(
                  (w) =>
                    `- ${w.wokeAt} ${w.trigger} 触发 · ${w.progressed ? '有进展' : '无进展'} · 来源 ${w.attribution}`,
                )
                .join('\n');
        return [
          `goal「${goalId}」〔${row.status}〕`,
          `目标：${row.objective}`,
          `定时：${row.schedule}（自 seq=${row.activatedSeq} 起，会话 ${row.sessionId}）`,
          `预算：本会话 ${row.budgetMessagesUsed} 条 + 后台代跑 ${row.budgetFoldedUnits} 条${row.budgetMessagesCap === null ? '（无上限）' : ` / 上限 ${row.budgetMessagesCap} 条`}`,
          `needsWrite：${row.needsWrite ? (row.writeApproved ? '已申请·已批准（可使用写入工具）' : '已申请·未批准（/goal approve 后可用）') : '未申请写入权限（写入工具暂不可用）'}`,
          `无进展计数：${row.stallStreak}（有进展或手动唤醒即清零）`,
          openLine,
          row.endingNote !== null ? `终态回执：${row.endingNote}` : '',
          `唤醒记录（末 5 条）：\n${wakeLines}`,
        ]
          .filter((line) => line !== '')
          .join('\n');
      }
      case undefined:
      case 'help':
        return GOAL_USAGE;
      default:
        return `未知动词「${verb}」。\n${GOAL_USAGE}`;
    }
  } catch (err) {
    // 守卫错折文本（命令面是用户面——BaseError 码与人读原因直呈）
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}
