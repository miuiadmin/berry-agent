/**
 * 跨通道时刻/耗时格式单源（07 §4.1 V-0 注④整秒定值——任务行括号段 / turn
 * 收尾行 / 工具超时人读形三面真同源零分叉；formatClockHM 取消形时刻段同族
 * 收编）。原居 channels/tui/status/task-status-line，2026-10-02 TUI 视觉重设计
 * 批 V-2 笔 1 迁入：webui 客户端（DOM 类型面——不可拉 TUI engine/theme 图）
 * 与 tools（DAG 不邻 channels）双消费面所需，env-ref / redact 同律零新边纯件。
 *
 * 2026-10-04 收尾行段拼装双站单源化批扩域：run 收尾行段集/整行构造 + 用户面
 * 段串接（『 · 』间隔号）自本件供出——webui frames（runCloseLine）与
 * tui-backend（appendClosingLine）原为逐字同构双拷贝（连「段形随规范真源」
 * 注释都双份），自此段形知识单源。2026-10-06 部分观察加注升位收编：计数段
 * 尾注「（自本次接入起算）」的加注知识自 webui 段级 map 副本迁入
 * partialObserved 位（两通道零本地加注副本——判据归调用侧、词面归本件）。
 */

/**
 * 紧凑耗时格式：0s（亚秒）/ Ns / Nm NNs / Nh NNm NNs——秒位两位补零
 * （1m 02s）、分级段不补（1h 00m 00s）。
 */
export function formatElapsedCompact(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 1) return '0s';
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return `${totalMin}m ${String(sec).padStart(2, '0')}s`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hours}h ${String(min).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

/**
 * Unix 毫秒 → 24 小时制 HH:MM（本地时区——取消形收尾行时刻段双通道同源）。
 * 原两处逐字克隆（channels/tui/backend 收尾行 / webui 客户端取消回执），
 * 2026-10-03 V-4 扫描处置批收编单源（formatElapsedCompact 同族位）——
 * 双消费面（tui-backend 收尾行 / webui frames 取消回执）均已改引本源。
 */
export function formatClockHM(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 用户面段串接：各段以「 · 」（前后各一空格的全角间隔号）串接，空串段跳过
 * （调用侧按态拼段时守卫省写）。跨通道状态/数值段拼装单源——键位提示行域
 * （keys/hint.ts hintLine，07 §4.4 律三）语义独立不共用本件：律三钉的是
 * 「键名+动作词」行族，本件管数值/状态段族，两域各自单源。
 */
export function joinSegments(...segments: string[]): string {
  return segments.filter((segment) => segment !== '').join(' · ');
}

/** run 收尾行段集输入（耗时终值或诚实缺席 null——真源序折取在调用侧） */
export interface RunRecapInput {
  readonly durationMs: number | null;
  readonly toolCount: number;
  readonly retryCount: number;
  /**
   * 部分观察旗（收尾行中途附着计数段加注形——口径披露律）：true = 工具/重试
   * 计数是接入点起算的部分观察值（本屏未亲见 run 开头——切焦/页面加载中途
   * 接入）——计数段逐段尾注「（自本次接入起算）」不冒充整 run 口径；耗时段
   * 恒不加注（durationMs 载荷在场即服务端整 run 真值、缺席即诚实缺段——口径
   * 分立）。判据归调用侧（部分观察旗：计数在未见 agent_start 的窗内累加即
   * 置位、fresh agent_start 清位——TUI/webui 两通道同律），本件只收加注词面
   * 单源。缺席 = false（完整观察整 run 口径——向后兼容形）。
   */
  readonly partialObserved?: boolean;
}

/**
 * run 收尾行段集构造（07 §4.1 V-0 注④族——收尾行三面真同源）：用时/
 * 工具次数/重试三段序，段形随规范真源——**重试段无「次」字**；工具/重试
 * 双零段缺席（「纯对话轮整行缺席」的双零判据在调用侧——本函数只管段集，
 * 双零入参返回空集）。双站逐字同构收编：webui frames runCloseLine /
 * tui-backend appendClosingLine（2026-10-04）。部分观察加注（partialObserved
 * 位）：计数段逐段尾注「（自本次接入起算）」（2026-10-06 自 webui 段级 map
 * 加注副本升位收编——两通道零本地加注副本，词面单源自此）。
 */
export function runRecapSegments(input: RunRecapInput): string[] {
  // 部分观察尾注（口径披露律）：词面用「接入」——用户面直白词（内部机制词
  // 「附着」不入用户面正文）；耗时段恒不加注（口径分立——见字段注）
  const partialNote = input.partialObserved === true ? '（自本次接入起算）' : '';
  const segments: string[] = [];
  if (input.durationMs !== null) segments.push(`用时 ${formatElapsedCompact(input.durationMs)}`);
  if (input.toolCount > 0) segments.push(`工具 ${input.toolCount} 次${partialNote}`);
  if (input.retryCount > 0) segments.push(`重试 ${input.retryCount}${partialNote}`); // 段形随规范真源：重试段无「次」字
  return segments;
}

/**
 * 文案标签门阈值（⑧ 两级门制——run 时长 > 60s 才显文案段；≤60s 无标签纯线
 * 全宽 dim 行。门只辖文案段显隐、行呈现门 = 作业判据〔双零整行缺席〕恒与时长
 * 无关——两门分立在调用侧）。耗时缺席（null 中途附着）门不可判 → 文案段照常
 * （诚实缺席不升级为纯线——部分观察加注形可见性保位）。
 */
const RUN_RECAP_TEXT_GATE_MS = 60_000;

/**
 * run 收尾行整行（`── 段 · 段 ──` 段头段尾横线）：色壳与全宽补齐不归本件——
 * tui 侧 SGR 弱线色包壳 + 列宽 ─ 补齐在调用侧（appendTransientLine 纯文本路
 * 的 ANSI 感知收口），webui 侧无色直用（DOM 居中/hairline 呈现层）。段集空
 * 时返回空段头（调用侧双零判据已拦，此形仅防御）。
 *
 * 文案标签门（⑧——挖掘 29 轮批 B 规范立法兑现）：durationMs 在场且 ≤60s →
 * 返回空串（无标签纯线——调用侧按载体落全宽线形：TUI ─×columns / webui
 * hairline）；>60s 或缺席照常文案。段集构造 runRecapSegments 不受门辖
 * （门只辖整行文案显隐）。
 */
export function runRecapLine(input: RunRecapInput): string {
  if (input.durationMs !== null && input.durationMs <= RUN_RECAP_TEXT_GATE_MS) return '';
  return `── ${joinSegments(...runRecapSegments(input))} ──`;
}
