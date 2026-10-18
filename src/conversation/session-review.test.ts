/**
 * 评审 findings append + collect 测试（35 池件 9——05 §1.1 `session/review`
 * 行「评审 findings 结构化呈现」的兑现）。
 *
 * 纪律：纯逻辑层（SessionLog 真实现——组合根口径）；session-notice 同构
 * （53 轮件 C 先例）——append 面 fail-loud / collect 面 fail-open 分立；
 * 本词多源（渠道/插件侧调用——宿主只落契约与呈现，写点不接线）。
 *
 * 覆盖锁：
 *  - 评审 → durable 事件 append（词 session/review + 载荷 {findings}）
 *    + 尾锚返回值（seq = events().length - 1）；
 *  - append 坏形 fail-loud 全谱（findings 非数组 / 六员缺一 / 行号非 1 起
 *    整数或 start>end / priority 出三档闭集——SESSION_REVIEW_PAYLOAD_INVALID
 *    不入账）；
 *  - collect 全序列升序（seq 归位锚——transcript 重建腿数据形）+ 字段保真；
 *  - collect 坏形两级防御跳过（事件级 findings 非数组跳整条、条目级坏形
 *    跳单条——呈现面 fail-open 收干净子集不炸）；
 *  - collect 遮蔽跳过（occludedSeqs 单源——压缩窗口内评审卡随消息遮蔽消失）；
 *  - resume 重放恢复（事件前缀 seed 形——冷启动 collect 同集）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import { appendSessionReview, collectSessionReviews, type ReviewFindingData } from './session-review.js';

/** 抓错误码（session-notice.test 同款——BaseError 码位断言形） */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
  }
  return undefined;
}

/** 良形 finding 夹具（单行形 start==end——基准全六员在位） */
function finding(partial: Partial<ReviewFindingData> = {}): ReviewFindingData {
  return {
    title: '未处理的空值',
    file: 'src/example.ts',
    start: 10,
    end: 10,
    priority: 'warn',
    body: '该分支可能收到空值。',
    ...partial,
  };
}

describe('评审 findings 面 review · append + collect（conversation 件）', () => {
  it('评审 → durable 事件 append：词 session/review + 载荷 {findings}，返回值 = 尾锚 seq', () => {
    const log = new SessionLog({ sessionId: 's-rv-append' });
    const seq = appendSessionReview(log, [finding(), finding({ title: '二', start: 3, end: 7 })]);
    const events = log.events();
    expect(seq).toBe(events.length - 1); // 尾锚（append 即数组尾推）
    const appended = events.filter((event) => event.type === 'session/review');
    expect(appended).toHaveLength(1);
    expect(appended[0]!.seq).toBe(seq);
    const data = appended[0]!.data as { findings: { title: string; start: number; end: number }[] };
    expect(data.findings).toHaveLength(2);
    expect(data.findings[0]!.title).toBe('未处理的空值');
    expect(data.findings[1]!.start).toBe(3);
    expect(data.findings[1]!.end).toBe(7);
  });

  it('append 坏形 fail-loud 全谱：SESSION_REVIEW_PAYLOAD_INVALID（findings 非数组/六员缺一/行号坏形/priority 出闭集——不入账）', () => {
    const log = new SessionLog({ sessionId: 's-rv-bad-append' });
    // findings 非数组
    expect(catchCode(() => appendSessionReview(log, 'not-array' as unknown as ReviewFindingData[]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    // 六员缺一（逐员点名——缺一即拒）
    expect(catchCode(() => appendSessionReview(log, [{ ...finding(), title: undefined as unknown as string }]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionReview(log, [{ ...finding(), file: undefined as unknown as string }]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionReview(log, [{ ...finding(), start: undefined as unknown as number }]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionReview(log, [{ ...finding(), end: undefined as unknown as number }]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(
      catchCode(() =>
        appendSessionReview(log, [{ ...finding(), priority: undefined as unknown as ReviewFindingData['priority'] }]),
      ),
    ).toBe('SESSION_REVIEW_PAYLOAD_INVALID');
    expect(catchCode(() => appendSessionReview(log, [{ ...finding(), body: undefined as unknown as string }]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    // file 空串（路径缺席无定位义）
    expect(catchCode(() => appendSessionReview(log, [finding({ file: '' })]))).toBe('SESSION_REVIEW_PAYLOAD_INVALID');
    // 行号坏形：0 起 / 负数 / 小数 / start>end
    expect(catchCode(() => appendSessionReview(log, [finding({ start: 0 })]))).toBe('SESSION_REVIEW_PAYLOAD_INVALID');
    expect(catchCode(() => appendSessionReview(log, [finding({ end: -3 })]))).toBe('SESSION_REVIEW_PAYLOAD_INVALID');
    expect(catchCode(() => appendSessionReview(log, [finding({ start: 1.5, end: 2 })]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionReview(log, [finding({ start: 20, end: 10 })]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    // priority 出三档闭集（success 是 notice 档非本词档 + 非串形）
    expect(catchCode(() => appendSessionReview(log, [finding({ priority: 'success' as unknown as 'warn' })]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionReview(log, [finding({ priority: 7 as unknown as 'warn' })]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    // 好条目+坏条目混合：整笔拒（fail-loud 是事件级不是条目级——半笔入账是腐败形）
    expect(catchCode(() => appendSessionReview(log, [finding(), finding({ priority: 'success' as 'warn' })]))).toBe(
      'SESSION_REVIEW_PAYLOAD_INVALID',
    );
    // 坏形不入账——日志零 session/review 事件
    expect(log.events().filter((event) => event.type === 'session/review')).toHaveLength(0);
  });

  it('空数组合法（诚实零项）+ 三档全过（info/warn/error 皆合法档）+ collect 全序列升序字段保真', () => {
    const log = new SessionLog({ sessionId: 's-rv-collect' });
    log.append('user/message', { content: '前置零混入锚' });
    appendSessionReview(log, [finding({ priority: 'info', title: '一' })]);
    appendSessionReview(log, [finding({ priority: 'warn', title: '二', start: 2, end: 5 })]);
    appendSessionReview(log, [
      finding({ priority: 'error', title: '三', file: 'src/deep/mod.ts', start: 100, end: 120, body: '多行\n正文' }),
    ]);
    const entries = collectSessionReviews(log.events());
    // 非本词事件零混入 + 升序
    expect(entries).toHaveLength(3);
    expect(entries[0]!.seq).toBeLessThan(entries[2]!.seq);
    // 字段保真（含多行 body 与跨行行域原样入账）
    expect(entries[0]!.findings[0]).toEqual(finding({ priority: 'info', title: '一' }));
    expect(entries[1]!.findings[0]!.start).toBe(2);
    expect(entries[1]!.findings[0]!.end).toBe(5);
    expect(entries[2]!.findings[0]!.body).toBe('多行\n正文');
    expect(entries[2]!.findings[0]!.file).toBe('src/deep/mod.ts');
  });

  it('collect 坏形两级防御跳过（事件级 findings 非数组跳整条、条目级坏形跳单条——呈现面 fail-open 收干净子集）', () => {
    const log = new SessionLog({ sessionId: 's-rv-collect-bad' });
    appendSessionReview(log, [finding({ title: '良形一' })]);
    log.append('session/review', { findings: 'not-array' }); // 事件级：findings 非数组跳整条
    log.append('session/review', '异型载荷'); // 事件级：非对象形跳整条
    // 条目级：坏条目跳单条、好条目不连坐
    log.append('session/review', {
      findings: [{ ...finding({ title: '坏条目' }), priority: 'fatal' }, finding({ title: '良形二' })],
    });
    const entries = collectSessionReviews(log.events());
    // 两级跳过不炸——重建面收到干净子集（fail-loud 归 append 面）
    expect(entries.map((entry) => entry.findings.map((f) => f.title))).toEqual([['良形一'], ['良形二']]);
  });

  it('collect 遮蔽跳过（occludedSeqs 单源——压缩窗口内评审卡随消息遮蔽同语义消失）', () => {
    const log = new SessionLog({ sessionId: 's-rv-occluded' });
    const seqA = appendSessionReview(log, [finding({ title: '窗口前' })]);
    const seqB = appendSessionReview(log, [finding({ title: '窗口内' })]);
    // 压缩面：surfaceOp 区间遮蔽 seqB（评审卡在遮蔽窗口内——随窗口内容消失）
    log.append('compaction/start', { surface: 1 }, { surfaceOp: { op: 'replace', start: seqB, end: seqB } });
    log.append('compaction/end', {});
    const entries = collectSessionReviews(log.events());
    expect(entries.map((entry) => entry.seq)).toEqual([seqA]); // 遮蔽位跳过
  });

  it('resume 重放恢复：事件前缀 seed 新 SessionLog → collect 同集（重启形）', () => {
    const original = new SessionLog({ sessionId: 's-rv-resume' });
    appendSessionReview(original, [finding({ title: '重启后仍在' })]);
    // 重启形：活体日志事件前缀 → 新 SessionLog seed 重放（冷启动恢复 = collect 重扫）
    const replayed = new SessionLog({ sessionId: 's-rv-resume-2', seed: [...original.events()] });
    const entries = collectSessionReviews(replayed.events());
    expect(entries.map((entry) => entry.findings.map((f) => f.title))).toEqual([['重启后仍在']]);
  });
});
