/**
 * 会话级宿主通知 append + collect 测试（挖掘 53 轮件 C——05 §1.1
 * `session/notice` 行「写入者 = host 装配位通知腿」的兑现；升级提示首例）。
 *
 * 纪律：纯逻辑层（SessionLog 真实现——组合根口径）；collectModelChanges
 * 同构（52 轮件 B 先例）——append 面 fail-loud / collect 面 fail-open 分立。
 *
 * 覆盖锁：
 *  - 通知 → durable 事件 append（词 session/notice + 载荷 {level, text}）
 *    + 尾锚返回值（seq = events().length - 1——次序倒置律消费位）；
 *  - append 坏形 fail-loud 两态（level 出四档闭集 / text 非串——
 *    SESSION_NOTICE_PAYLOAD_INVALID 不入账）；
 *  - collect 全序列升序（seq 归位锚——transcript 重建腿数据形）；
 *  - collect 坏形防御跳过（呈现面 fail-open——collectModelChanges 同律）；
 *  - collect 遮蔽跳过（occludedSeqs 单源——压缩窗口内通知随消息遮蔽消失）；
 *  - resume 重放恢复（事件前缀 seed 形——冷启动 collect 同集）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type NotifyLevel } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import { appendSessionNotice, collectSessionNotices } from './session-notice.js';

/** 抓错误码（session-model.test 同款——BaseError 码位断言形） */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
  }
  return undefined;
}

describe('会话级宿主通知面 notice · append + collect（conversation 件）', () => {
  it('通知 → durable 事件 append：词 session/notice + 载荷 {level, text}，返回值 = 尾锚 seq', () => {
    const log = new SessionLog({ sessionId: 's-nt-append' });
    const seq = appendSessionNotice(log, 'info', '新版本可用');
    const events = log.events();
    expect(seq).toBe(events.length - 1); // 尾锚（append 即数组尾推）
    const appended = events.filter((event) => event.type === 'session/notice');
    expect(appended).toHaveLength(1);
    expect(appended[0]!.seq).toBe(seq);
    expect((appended[0]!.data as { level: string }).level).toBe('info');
    expect((appended[0]!.data as { text: string }).text).toBe('新版本可用');
  });

  it('append 坏形 fail-loud 两态：SESSION_NOTICE_PAYLOAD_INVALID（level 出四档闭集 / text 非串——不入账）', () => {
    const log = new SessionLog({ sessionId: 's-nt-bad-append' });
    // level 出闭集（NotifyLevel 四值外的串 + 非串两形）
    expect(catchCode(() => appendSessionNotice(log, 'fatal' as NotifyLevel, '文案'))).toBe(
      'SESSION_NOTICE_PAYLOAD_INVALID',
    );
    expect(catchCode(() => appendSessionNotice(log, 42 as unknown as NotifyLevel, '文案'))).toBe(
      'SESSION_NOTICE_PAYLOAD_INVALID',
    );
    // text 非串
    expect(catchCode(() => appendSessionNotice(log, 'info', null as unknown as string))).toBe(
      'SESSION_NOTICE_PAYLOAD_INVALID',
    );
    // 坏形不入账——日志零 session/notice 事件
    expect(log.events().filter((event) => event.type === 'session/notice')).toHaveLength(0);
  });

  it('四档全过（info/success/warn/error 皆合法载荷）+ collect 全序列升序；非本词事件零混入', () => {
    const log = new SessionLog({ sessionId: 's-nt-collect' });
    log.append('user/message', { content: '前置零混入锚' });
    appendSessionNotice(log, 'info', '一');
    appendSessionNotice(log, 'success', '二');
    appendSessionNotice(log, 'warn', '三');
    appendSessionNotice(log, 'error', '四');
    const entries = collectSessionNotices(log.events());
    expect(entries.map((entry) => [entry.level, entry.text])).toEqual([
      ['info', '一'],
      ['success', '二'],
      ['warn', '三'],
      ['error', '四'],
    ]);
    expect(entries[0]!.seq).toBeLessThan(entries[3]!.seq); // 升序
  });

  it('collect 坏形防御跳过（呈现面 fail-open——level 出闭集 / text 非串 / 异型载荷，collectModelChanges 同律）', () => {
    const log = new SessionLog({ sessionId: 's-nt-collect-bad' });
    appendSessionNotice(log, 'info', '良形一');
    log.append('session/notice', { level: 'fatal', text: '坏档位' }); // level 出闭集
    log.append('session/notice', { level: 'warn' }); // text 缺席（undefined 非串）
    log.append('session/notice', '异型载荷'); // 非对象形
    appendSessionNotice(log, 'error', '良形二');
    const entries = collectSessionNotices(log.events());
    // 坏形跳过不炸——呈现重建面收到的是干净子集（fail-loud 归 append 面）
    expect(entries.map((entry) => entry.text)).toEqual(['良形一', '良形二']);
  });

  it('collect 遮蔽跳过（occludedSeqs 单源——压缩窗口内通知随消息遮蔽同语义消失）', () => {
    const log = new SessionLog({ sessionId: 's-nt-occluded' });
    const seqA = appendSessionNotice(log, 'info', '窗口前通知');
    const seqB = appendSessionNotice(log, 'warn', '窗口内通知');
    // 压缩面：surfaceOp 区间遮蔽 seqB（通知在遮蔽窗口内——随窗口内容消失）
    log.append('compaction/start', { surface: 1 }, { surfaceOp: { op: 'replace', start: seqB, end: seqB } });
    log.append('compaction/end', {});
    const entries = collectSessionNotices(log.events());
    expect(entries.map((entry) => entry.seq)).toEqual([seqA]); // 遮蔽位跳过
  });

  it('resume 重放恢复：事件前缀 seed 新 SessionLog → collect 同集（重启形）', () => {
    const original = new SessionLog({ sessionId: 's-nt-resume' });
    appendSessionNotice(original, 'info', '新版本可用');
    // 重启形：活体日志事件前缀 → 新 SessionLog seed 重放（冷启动恢复 = collect 重扫）
    const replayed = new SessionLog({ sessionId: 's-nt-resume-2', seed: [...original.events()] });
    const entries = collectSessionNotices(replayed.events());
    expect(entries.map((entry) => entry.text)).toEqual(['新版本可用']);
  });
});
