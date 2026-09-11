/**
 * 会话事件词汇注册表（05 篇 §1.1 事件类型清单——32 核心词全列，
 * compaction 三词 2026-09-06 纵切批增补、compaction/fallback 2026-09-09
 * U4 落码批入册、session/thinking-level 同日遗漏
 * 审计批回填〔05 行 66 agent 纵切批已定名而注册表漏登〕、plugin/opens·
 * capability/used 2026-09-08 U3 落码批入册〔05 行 70-71 开门制两审计词——
 * 载体 = 进程级 durable 审计流（05 §9 audit_events，非会话 append 面），
 * 入册即得核心词身份双闸（U3-0 台账 R-2）〕）。
 *
 * 双入口纪律：核心词汇本表静态声明（含类别/归属/语义），插件扩展经
 * registerEventType 显式注册；session append 词汇检查（未注册类型抛
 * SESSION_UNKNOWN_EVENT_TYPE）以本注册表为判据。
 *
 * 类别四分法（05 §1.1 收口）：
 *  - surface：构成派生表面（模型历史投影输入）；
 *  - snapshot：请求重建证据（request/header），不进模型历史；
 *  - log-only：审计与状态恢复用，永不进模型历史；
 *  - structure：日志骨架标记（turn 边界/种子边界）——不进模型历史，
 *    但是 fold 的判定输入（「不进模型历史」与「fold 不读」是两回事）。
 */
import type { ApiTier } from './api.js';
import { BaseError } from './errors.js';

/** 事件类别四分法闭集（类别列口径与 05 §3.1 投影执法对齐） */
export const EVENT_CATEGORIES = ['surface', 'snapshot', 'log-only', 'structure'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** 事件类型目录条目（注册表值形态） */
export interface EventTypeMeta {
  /** 事件类型词汇（如 'user/message'） */
  type: string;
  /** 类别四分法归属 */
  category: EventCategory;
  /**
   * 注册者归属（宿主件名或插件 id）——「逐事件注册者以表内注记为准」
   * （05 §1.1 表注）：CI 校验抛出/写入点一致的依据。
   */
  owner: string;
  /**
   * API 稳定性 tier（必填——零隐式 API 载体：目录宿主符号三级标签之一，
   * TS 编译期即红；03 篇 §8.3 标级载体分职。核心 16 词全 stable——
   * 会话事件词汇是已收口契约面）。
   */
  tier: ApiTier;
  /** 中文语义描述（生成目录用） */
  description: string;
  /** true = 读侧可以不认识此类型（向前兼容）；缺省 = 必须认识（核心词全部不 ignorable） */
  ignorable?: boolean;
}

/**
 * 核心事件类型 32 词（05 §1.1 表格逐条转录；owner 归属按表注：
 * gate/decision 归 tools、llm/usage 归 llm、llm/retry 注册走 session
 * 核心词汇（llm 模块不知道驱动存在）、plugin/uninstalled 宿主写点 host、
 * approval/* 与 sandbox/mode 归 safety 域、todo/write 与
 * session/thinking-level 归 conversation〔05 行 66：写入者 = conversation
 * 件档位切换面——agent 件零存储感知、不写本词〕）。
 * tier 全 stable（核心词汇 = 已收口契约面，03 §8.3 零隐式载体）。
 * 核心词计数 16→19：compaction/start|surface|end 随 compaction 纵切批入表；
 * 19→20：session/thinking-level 随遗漏审计批回填（05 §1.1 行 66 agent 纵切
 * 批已定名，注册表漏登——批 11 conversation 写入将撞词汇闸，先回填止血）；
 * 20→22：plugin/opens·capability/used 随 U3 落码批入册（05 §1.1 行 70-71
 * 开门制两审计词——载体 = 进程级 audit_events 审计流〔05 §9〕非会话流，
 * 入册值 = 核心词身份双闸 + 目录单一真源；写入面随 U3-2 persist 笔落码）；
 * 22→23：compaction/fallback 随 U4 落码批入册（05 §1.1 行 77 回落三律第 3
 * 律审计词——2026-09-07 双轴二轮评估批已定词形、随 U4 落码批注册兑现）；
 * 23→28：plugin/installed·mounted·unmounted·toggled·updated 随生命周期
 * 五词 audit 落账批入册（05 §1.1 生命周期归因面行——uninstall 词已随装机
 * 面落码批先行落 audit_events 载体〔CLI 人面无会话场景唯一可达 durable
 * 载体〕，本五词与之同载体并列成族——六词同面；词形单源本表：
 * installed {id,source,version} / mounted·unmounted {id} /
 * toggled {id,disabled 双态} / updated {id,from?,to}）；
 * 28→29：doors/updated 随开门制扩展批入册（05 §1.1 行 72——进程级开门位
 * 授予面切换事实：doors 段〔模型道高危面授予载体，03 §4.6 双源并集律第二
 * 源〕的审计腿，boot diff 幂等同 plugin/opens 律；载体 = audit_events）；
 * 29→31：hook/registered·kv/written 随 T9 案一批入册（05 §1.1 常规行为
 * 归因两词——钩子监听者受理账与键值写历史；载体 = audit_events。前者
 * 载荷 {pluginId, hook} 无 rank 位〔03 §2.4 ctx.on 两参签名恒定、注册序由
 * 受理时序承载〕；后者载荷 {pluginId, key, action} 值与元数据恒不入、
 * 发射位随 ctx.sessions 受理制写面批兑现〔规范已裁代码未落——词先锚定，
 * compaction/fallback 同律〕）。
 * 31→32：preset/applied 随审批分档批 ap-3 入册（05 §1.1 权限预设切换审计词
 * ——载体 = audit_events；写点 = TUI /approval preset 执行尾恰一笔，CLI
 * --preset 逐次形零审计——04 §9 ⑥ ap-3 定形补充）。
 */
const CORE_EVENT_TYPES: readonly EventTypeMeta[] = [
  {
    type: 'turn/start',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: '一轮（用户输入 → 停止）开始',
  },
  {
    type: 'turn/end',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: '一轮结束；reason = completed/aborted/blocked/error/max-tokens/interrupted（可扩展）',
  },
  {
    type: 'user/message',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description: '用户输入（string 或 text/image 块）；source 归因词汇闭集见 types.ts',
  },
  {
    type: 'assistant/message',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description:
      '组装完成后的消息级事件；toolCall 块不内联 content（由 tool/call 唯一承载）；errorMessage 腿独立 2KiB 小帽',
  },
  {
    type: 'tool/call',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description: '工具调用（arguments 存原始未解析字符串——审计保真）',
  },
  { type: 'tool/result', category: 'surface', owner: 'session', tier: 'stable', description: '一调用一结果' },
  {
    type: 'todo/write',
    category: 'surface',
    owner: 'conversation',
    tier: 'stable',
    description: '轮内清单全量快照（last-write-wins）；fold = 日志倒扫最后一条 user/message 之后的最后一条本事件',
  },
  {
    type: 'request/header',
    category: 'snapshot',
    owner: 'session',
    tier: 'stable',
    description: '完整请求信封快照；reason = initial/resume/change，重建请求取最后一条为基准',
  },
  {
    type: 'session/end-seed',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: 'fork 种子边界标记（data 为空对象，边界即事件自身 seq）',
  },
  {
    type: 'approval/asked',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '审批提问（决策对完整内容；turn 内闭合可回放）',
  },
  {
    type: 'approval/decided',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '审批决策（决策对完整内容；turn 内闭合可回放）',
  },
  {
    type: 'gate/decision',
    category: 'log-only',
    owner: 'tools',
    tier: 'stable',
    description: '守门段决策（toolCallId/decision(allow|block|mutate)/reason）——「守门不可绕」不变式的断言对象',
  },
  {
    type: 'sandbox/mode',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '会话级沙箱状态 = fold(events)，append 即切换、重放即恢复（无独立配置存储）',
  },
  {
    type: 'session/thinking-level',
    category: 'log-only',
    owner: 'conversation',
    tier: 'stable',
    description:
      '会话级思考档位 = fold(events)，append 即切换、重放即恢复（与 sandbox/mode 同形态；04 §5「thinkingLevel 是会话态不是 run 态」的 durable 落账词；写入者 = conversation 件档位切换面）',
  },
  {
    type: 'llm/usage',
    category: 'log-only',
    owner: 'llm',
    tier: 'stable',
    description: 'complete 单发补全通道的计量事实（token 原始值入账，货币折算在投影查询做）',
  },
  {
    type: 'llm/retry',
    category: 'log-only',
    owner: 'session',
    tier: 'stable',
    description: 'turn 级 auto-retry 的 durable 事实（attempt/phase scheduled|aborted|exhausted；成功不落）',
  },
  {
    type: 'plugin/uninstalled',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description: '卸载四段成功尾落账（id/source/dataAction/affected?；核心词身份拒装载面注册）',
  },
  {
    type: 'plugin/opens',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '高危面开门授予面切换事实（boot 装载序对每插件 grantedOpens 与审计流尾最近一条本词 diff——有变才落幂等记账；撤位落 opens:[] 空数组形收口；载体 = 进程级 durable 审计流 audit_events〔05 §9〕非会话流，fold = 审计流尾条 = 该插件当前有效授予面）',
  },
  {
    type: 'doors/updated',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '进程级开门位授予面切换事实（开门制扩展批 2026-09-09——doors 段〔模型道高危面授予载体，03 §4.6 双源并集律第二源〕的审计腿，与 plugin/opens 分立成对：行 opens 授予跟插件 id 走、doors 段授予跟进程走）：boot 装载序以 doors 段现值与审计流尾最近一条本词 diff——有变才落幂等记账（空面首记不落），撤位落 doors:[] 空数组形收口；载荷 {doors 全量清单快照, origin（boot-diff|tui-cmd）}；载体 = audit_events',
  },
  {
    type: 'capability/used',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '高危面开门后的每次换装/注册使用事实（宿主门检接线位在门检通过、注册动词受理成功后落；载体 = 进程级 durable 审计流 audit_events〔05 §9〕；v1 射程 = channels.ui-backend + triggers.start-run 逐次 fire（triggerName 归因腿）+ credentials.read-cross 逐次越域读（core: 直开豁免照记——豁免免的是门不是账，c-3），sdk.register-route 随 U5）',
  },
  {
    type: 'plugin/installed',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '生命周期归因面——装机成功事实（id/source/version；写点 = CLI 人面 install 成功尾；载体 = 进程级 durable 审计流 audit_events〔05 §9〕非会话流，05 §1.1 生命周期归因面行）',
  },
  {
    type: 'plugin/mounted',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '生命周期归因面——挂载事实（id；写点两路 = CLI 人面 mount 成功尾 + boot 装载序手编 enabled.yaml 漂移 diff 补播；载体 = audit_events；core: 内置基线态不造首记噪声——diff 基线 core: 前缀按启用算）',
  },
  {
    type: 'plugin/unmounted',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '生命周期归因面——卸下事实（id；装机保留行移除；写点两路同 mounted；载体 = audit_events——与 plugin/uninstalled 同面（装机面落码批已先行，CLI 人面无会话恒此载体）；卸下/卸载两动词分立——卸下保留装机、卸载清算资产）',
  },
  {
    type: 'plugin/toggled',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '生命周期归因面——禁用态翻转事实（id/disabled 双态 true|false——审计词形独立于 enabled.yaml 行形〔行内 absent 即启用、无 false 键〕，翻回启用需 false 位表达；写点两路 = CLI toggle 成功尾 + boot diff 补播；载体 = audit_events）',
  },
  {
    type: 'plugin/updated',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '生命周期归因面——换装成功事实（id/from?/to——from 缺席 = 旧账本无版本位；local 源 no-op 不落〔无变更不造账〕；写点 = CLI 人面 update 成功尾；载体 = audit_events）',
  },
  {
    type: 'compaction/start',
    category: 'log-only',
    owner: 'compaction',
    tier: 'stable',
    description: '压缩意图与判据快照（reason=threshold/overflow + willRetry + basis?；05 §2.1 五步之一）',
  },
  {
    type: 'compaction/surface',
    category: 'log-only',
    owner: 'compaction',
    tier: 'stable',
    description: '遮蔽指令事件（信封 surfaceOp 载体本尊；data=summarySeq/规模审计；经 appendWithSurfaceOp 正门）',
  },
  {
    type: 'compaction/end',
    category: 'log-only',
    owner: 'compaction',
    tier: 'stable',
    description:
      '压缩收尾标记（reason=completed/failed/vetoed/aborted；failed=摘要通道失败即时闭段防孤 start 悬挂；vetoed=钩子否决收形〔U4——start 后即 end 无摘要无遮蔽〕；aborted=§4 恢复协议合成形非 live 写入位）',
  },
  {
    type: 'compaction/fallback',
    category: 'log-only',
    owner: 'compaction',
    tier: 'stable',
    description:
      '接管/算法槽失败回落事实（05 §2.1 回落三律第 3 律——回落非静默换算法；source=plugin:<id>、stage=throw|timeout|rejected〔抛错/超预算/产物被拒——空文本同宿主通道失败律〕、error? 截断、circuit?=true 末次记三振停用〔进程级，复位走重启〕；U4 调整途非法调整同 stage=rejected 记账）',
  },
  {
    type: 'hook/registered',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '钩子监听者受理账（T9 案一批 2026-09-09——context_transform 瀑布等钩子注册全隐身的 durable 归因：「谁在改我的上下文」有账）：载荷 {pluginId, hook}（无 rank——03 §2.4 ctx.on 两参签名恒定、注册序由受理时序承载）；写点 = ctx.on 受理壳成功尾逐笔（waterfall/notify 两腿返回位；含 §2.1 回调窗延伸内的受理；拒路径零审计〔PLUGIN_HOOK_UNKNOWN/PLUGIN_WINDOW_CLOSED——被拒的注册不是行为〕）；/reload 换代新受理新账（受理制非 boot diff——钩子注册无 fold 语义系行为流，每代如实记）；载体 = audit_events',
  },
  {
    type: 'kv/written',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '键值写历史（T9 案一批 2026-09-09——store_state LRU+ttl 只有终态、写无历史的 durable 归因）：载荷 {pluginId, key 裸键名, action: set|delete}（值与 ttl/kind 元数据恒不入载荷——credentials/changed 同律；读腿零落账；persist 层 LRU/ttl 治理写零落账〔治理/受理分层〕）；写点 = ctx.sessions store_state 受理面 set/delete 成功尾逐笔——**规范已裁、代码未落**（词先锚定，发射位随受理制写面落码批兑现，compaction/fallback 同律）；载体 = audit_events',
  },
  {
    type: 'preset/applied',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description:
      '权限预设切换审计（审批分档批 ap-3 2026-09-11——04 §9 定形块⑥「预设切换落审计」兑现：用户主权动作留痕，/danger approve 同形）：载荷 {preset: conservative|balanced|open, sandboxMode, approvalPolicy, appended}（appended = 建议集去重后真追加数——balanced/conservative 恒 0）；写点 = TUI /approval preset 执行尾恰一笔（写盘成功后；CLI --preset 逐次形零审计、失败路径零落账）；载体 = audit_events',
  },
];

/** 核心词类型名清单（核心词保护判据——registerEventType 拒收） */
export const CORE_EVENT_TYPE_NAMES: readonly string[] = CORE_EVENT_TYPES.map((m) => m.type);

/** 注册表本体（type → 目录条目）；模块加载时灌入核心词 */
const registry = new Map<string, EventTypeMeta>();
for (const meta of CORE_EVENT_TYPES) registry.set(meta.type, meta);

/**
 * 注册事件类型（插件扩展唯一入口；宿主件自管类型已列核心表）。
 *
 * 两类拒收（均 fail-loud）：
 *  - 核心词身份：SESSION_CORE_TYPE_FORBIDDEN（防装载面伪造宿主词汇——
 *    与 session append 侧词汇检查同判据双闸）；
 *  - 注册冲突：PLUGIN_EVENT_TYPE_CONFLICT（03 §2.7 指派——装载面统一
 *    插件域码：core 件与用户插件同走 registerSessionEventType 动词，
 *    撞名按动词域拒收不分调用方身份）。
 */
export function registerEventType(meta: EventTypeMeta): void {
  if (CORE_EVENT_TYPE_NAMES.includes(meta.type)) {
    throw new BaseError(
      'SESSION_CORE_TYPE_FORBIDDEN',
      `事件类型 ${meta.type} 是核心词汇——拒绝装载面注册/伪造（宿主身份词）`,
    );
  }
  const existing = registry.get(meta.type);
  if (existing) {
    throw new BaseError(
      'PLUGIN_EVENT_TYPE_CONFLICT',
      `事件类型 ${meta.type} 重复注册：${existing.owner}（彼） vs ${meta.owner}（此）`,
    );
  }
  registry.set(meta.type, meta);
}

/** 判别事件类型是否已注册（session append 词汇检查的判据源） */
export function isKnownEventType(type: string): boolean {
  return registry.has(type);
}

/** 事件类型目录条目查询（未注册返回 undefined；类别/归属消费面用） */
export function getEventTypeMeta(type: string): EventTypeMeta | undefined {
  return registry.get(type);
}

/** 全量目录枚举（生成目录 / CI 校验用） */
export function listEventTypes(): EventTypeMeta[] {
  return [...registry.values()];
}
