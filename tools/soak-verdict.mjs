/**
 * tools/soak-verdict.mjs —— soak 判收纯函数单源（批 B 落码件）。
 *
 * 研究档簇 C（设计文档/00-研究-全流程全自动全场景测试-20260916.md）三缺口
 * 收口：errLines 只统计不入判收（C2' 带病绿）+ 事件序完整性仅 count-based
 * （C3' 中段丢条测不出）+ 判据内联 soak.mjs 无单元锁。本模块把退出码判据
 * 收成纯函数单源供 soak.mjs 收场段消费；零依赖（node 无关——纯数据进出）。
 *
 * 五判据（前三承既有语义、后两批 B 新增）：
 *  1. 轮次：okCount === rounds；
 *  2. kill 演练：未启用（null）容忍，启用须全过；
 *  3. RSS 预算：未设帽（null）容忍，设帽须稳态峰值在内；
 *  4. daemon.log error 行 ≤ 帽（缺省帽 0 零容忍——2026-09-16 quick 三轮
 *     实测基线 0 行；已知噪声源可用 --err-lines-cap 放宽，见 soak.mjs USAGE）；
 *  5. durable 事件序无洞：全部会话 entries 的 seq 从 0 起相邻差恰 1——与
 *     kill-recovery.test.ts「恢复前缀 0..N-1 无洞 + 续写 seq=N 接续」的
 *     进程内不变式同源（驱动器侧投影：write-behind 在飞窗丢条只造成号
 *     重用不造成洞，跨 kill 会话最终账本仍应全程无洞）。
 *
 * 扩判据批（研究档 C4'/C5'——2026-09-16 落码）：
 *  6. 无人值守三腿（unattended）：跨 tick 会话数 / 跨压缩窗事件数 / 跨停靠
 *     唤醒续跑——判据面「null 容忍未启用、设期望须达标」（min 缺席恒绿、
 *     dockResumeOk null 恒绿 false 红；unattended 整位缺席恒绿——批 B 既有
 *     调用形零扰动）；
 *  7. 延迟漂移：driftRatio（末 1/3 逐轮 dt 中位数 ÷ 首 1/3 中位数，
 *     driftStatsOf 单源）≤ driftCap（缺省帽 3.0；driftCap null 恒绿、
 *     driftRatio null = 样本窗不足恒绿——与 RSS 预算 null 容忍同形）。
 */

/**
 * 条目 seq 提取——两形兼容（与 soak 判收词汇 isEnd/reasonOf 同源防御）：
 * 线面平铺形 SdkDurableEntry.seq（protocol.ts 定形）+ 旧嵌套形 e.event.seq。
 * 缺席返回 null（脏数据不计入判据）。
 * @param {Record<string, unknown>} e entries 载荷条目
 * @returns {number | null}
 */
function seqOf(e) {
  const v = e.seq ?? e.event?.seq;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * durable 事件序无洞校验：seq 排序后相邻差须恰 1、首条须为 0。
 *
 * @param {Array<Record<string, unknown>>} entries 单会话全量条目（soak 收场
 *   逐会话拉取——entriesOf 已跟尽分页）
 * @returns {Array<{from: number | null, to: number, gap: number}>} 断点列表
 *   （from=null 表首条非 0 截头形；空数组 = 无洞）
 */
export function seqBreaksOf(entries) {
  const seqs = entries
    .map(seqOf)
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  const breaks = [];
  if (seqs.length === 0) return breaks;
  if (seqs[0] !== 0) breaks.push({ from: null, to: seqs[0], gap: seqs[0] });
  for (let i = 1; i < seqs.length; i++) {
    const diff = seqs[i] - seqs[i - 1];
    if (diff !== 1) breaks.push({ from: seqs[i - 1], to: seqs[i], gap: diff - 1 });
  }
  return breaks;
}

/**
 * daemon.log error 行计数（大小写不敏感 /error/i——与 soak 原内联统计同源）。
 * 抽出单源：判据 4 的计数面与汇总表打印同函数，杜绝「打印一个数判收另一个数」。
 *
 * @param {string} logText daemon.log 全文
 * @returns {number}
 */
export function errLineCountOf(logText) {
  return logText.split('\n').filter((l) => /error/i.test(l)).length;
}

/**
 * 中位数（私有工具）——窗口内排序取中；偶数窗取中间两数均值。
 * @param {number[]} values
 * @returns {number}
 */
function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 延迟漂移统计（判据 7 计数面——研究档 C5'）：首 1/3 与末 1/3 样本窗各自的
 * 中位数相除。逐轮 dt 已测已落盘但原判收不执法（退化性慢化五判据下全绿）——
 * 本函数把「末段比首段慢多少倍」收成可判数。
 *
 * 样本窗豁免语义：有效样本 < 6 返回 null（首末窗各不足 2 条无统计意义——
 * quick 三轮天然豁免，防 nightly 假红）；脏值（非数字/零/负）过滤不入窗。
 *
 * @param {Array<number | null | undefined>} dts 逐轮耗时秒（时间序——窗口按
 *   时间切分，窗内中位数自带排序）
 * @returns {{ratio: number, firstMedianSec: number, lastMedianSec: number} | null}
 *   null = 样本窗不足（调用方传 driftRatio null 即恒绿）
 */
export function driftStatsOf(dts) {
  const samples = (dts ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (samples.length < 6) return null;
  const third = Math.floor(samples.length / 3);
  const firstMedianSec = medianOf(samples.slice(0, third));
  const lastMedianSec = medianOf(samples.slice(samples.length - third));
  // 首段中位非正理论不可达（样本已滤非正值）——防御除零，豁免而非误判
  if (!(firstMedianSec > 0)) return null;
  return { ratio: lastMedianSec / firstMedianSec, firstMedianSec, lastMedianSec };
}

/**
 * soak 退出码判收单源——七判据收口（五既有 + 扩判据批两新增）。
 *
 * @param {object} input
 * @param {number} input.okCount 收场 ok 轮数
 * @param {number} input.rounds 总轮数
 * @param {boolean | null} input.drillOk kill 演练结论（null = 未启用）
 * @param {boolean | null} input.budgetWithin RSS 预算结论（null = 未设帽）
 * @param {number} input.errLines daemon.log error 行数
 * @param {number} input.errLinesCap error 行帽（缺省语义 0——由调用方显式传）
 * @param {Record<string, Array<object>>} input.seqBreaksBySession
 *   会话 → seqBreaksOf 结果（收场逐会话校验聚合）
 * @param {{tickSessions?: number, tickSessionsMin?: number | null,
 *   compactions?: number, compactionsMin?: number | null,
 *   dockResumeOk?: boolean | null} | null} [input.unattended]
 *   第六判据（无人值守三腿——研究档 C4'）。null/缺席 = 未启用恒绿；
 *   各腿 min null = 该腿未启用恒绿、设数值即执法（实得 < 最低红）；
 *   dockResumeOk false 红（null 容忍）。
 * @param {number | null} [input.driftRatio] 延迟漂移比（driftStatsOf.ratio——
 *   null = 样本窗不足恒绿）
 * @param {number | null} [input.driftCap] 延迟漂移帽（null = 未设帽恒绿；
 *   缺省语义 3.0 由调用方显式传）
 * @param {number} [input.driftFirstMedianSec] 首段中位数秒（归因行用）
 * @param {number} [input.driftLastMedianSec] 末段中位数秒（归因行用）
 * @returns {{green: boolean, fails: string[]}} green = 退出码 0 的判据；fails
 *   人读判据行（汇总表逐行打印——fail-loud 归因面）
 */
export function computeVerdict(input) {
  const fails = [];
  if (input.okCount !== input.rounds) fails.push(`轮次 ${input.okCount}/${input.rounds}（有 FAIL 轮）`);
  if (input.drillOk === false) fails.push('kill 演练 FAIL');
  if (input.budgetWithin === false) fails.push('RSS 预算超帽');
  if (input.errLines > input.errLinesCap) {
    fails.push(`daemon.log error 行 ${input.errLines} > 帽 ${input.errLinesCap}`);
  }
  for (const [sessionId, breaks] of Object.entries(input.seqBreaksBySession)) {
    if (breaks.length > 0) {
      const detail = breaks.map((b) => (b.from === null ? `截头@${b.to}` : `${b.from}→${b.to}`)).join('、');
      fails.push(`会话 ${sessionId} seq 断洞：${detail}`);
    }
  }
  // 第六判据：无人值守三腿（null 容忍未启用、设期望须达标——逐腿独立执法）
  const u = input.unattended;
  if (u) {
    if (typeof u.tickSessionsMin === 'number' && (u.tickSessions ?? 0) < u.tickSessionsMin) {
      fails.push(`无人值守 tick 会话 ${u.tickSessions ?? 0} < 最低 ${u.tickSessionsMin}`);
    }
    if (typeof u.compactionsMin === 'number' && (u.compactions ?? 0) < u.compactionsMin) {
      fails.push(`无人值守压缩事件 ${u.compactions ?? 0} < 最低 ${u.compactionsMin}`);
    }
    if (u.dockResumeOk === false) {
      fails.push('无人值守停靠唤醒 FAIL（唤醒后未续跑）');
    }
  }
  // 第七判据：延迟漂移（帽 null 未设容忍 / ratio null 样本窗不足容忍）
  if (typeof input.driftCap === 'number' && typeof input.driftRatio === 'number' && input.driftRatio > input.driftCap) {
    const first = input.driftFirstMedianSec ?? '?';
    const last = input.driftLastMedianSec ?? '?';
    fails.push(
      `延迟漂移 ${input.driftRatio.toFixed(2)}x > 帽 ${input.driftCap}x（首段中位 ${first}s / 末段中位 ${last}s）`,
    );
  }
  return { green: fails.length === 0, fails };
}
