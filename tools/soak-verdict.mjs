/**
 * tools/soak-verdict.mjs —— soak 判收纯函数单源（批 B 落码件）。
 *
 * 研究档簇 C（设计文档/00-研究-全流程全自动全场景测试-20260916.md）三缺口
 * 收口：errLines 只统计不入判收（C2' 带病绿）+ 事件序完整性仅 count-based
 * （C3' 中段丢条测不出）+ 判据内联 soak.mjs 无单元锁。本模块把退出码判据
 * 收成纯函数单源供 soak.mjs 收场段消费；零依赖（node 无关——纯数据进出）。
 *
 * 五判据（前三承既有语义、后两本批新增）：
 *  1. 轮次：okCount === rounds；
 *  2. kill 演练：未启用（null）容忍，启用须全过；
 *  3. RSS 预算：未设帽（null）容忍，设帽须稳态峰值在内；
 *  4. daemon.log error 行 ≤ 帽（缺省帽 0 零容忍——2026-09-16 quick 三轮
 *     实测基线 0 行；已知噪声源可用 --err-lines-cap 放宽，见 soak.mjs USAGE）；
 *  5. durable 事件序无洞：全部会话 entries 的 seq 从 0 起相邻差恰 1——与
 *     kill-recovery.test.ts「恢复前缀 0..N-1 无洞 + 续写 seq=N 接续」的
 *     进程内不变式同源（驱动器侧投影：write-behind 在飞窗丢条只造成号
 *     重用不造成洞，跨 kill 会话最终账本仍应全程无洞）。
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
 * soak 退出码判收单源——五判据收口。
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
  return { green: fails.length === 0, fails };
}
