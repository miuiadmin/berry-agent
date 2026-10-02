/**
 * 流中 token 估值器测试（07 §4.1 注⑪⑥c——V-4 底栏供数链第三件）。
 * 锁三面：
 * 1. **快照尾块差分**——message_update 载荷 partial 是累计快照（stream.ts
 *    就地替换律），估值器持上一快照字符账做差分累加（不重算全文——重算
 *    形在快照收缩时会回摆，差分形零回摆）；
 * 2. **双道启发式**——CJK 字符 1 token/字、其他 4 字符/token（呈现层估值
 *    非计费账——真值归 message_end 载荷 usage）；
 * 3. **真值校正单次收敛**——onSettled 后读数恒真值（误差吸收不回跳），
 *    后续喂入零效；reset 重建基线（下一 turn 起跑）。
 */
import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '../../../contracts/index.js';
import { createStreamingTokenEstimator } from './streaming-token-estimator.js';

/** assistant 快照构造（content 累计快照形——message_update 载荷同形；thinking 块字段名 = thinking 非 text） */
function snapshot(texts: readonly string[], thinking: readonly string[] = []): AssistantMessage {
  const content: AssistantMessage['content'] = [];
  for (const text of thinking) content.push({ type: 'thinking', thinking: text });
  for (const text of texts) content.push({ type: 'text', text });
  return {
    role: 'assistant',
    content,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 0,
  };
}

describe('流中 token 估值器（07 §4.1 注⑪⑥c——V-4 底栏供数链）', () => {
  it('快照尾块差分：累计快照逐帧喂入按增量累计（不重算全文——修前红：模块未建）', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['你']));
    expect(est.estimate()).toBe(1); // 首快照全量入账（CJK 1 token/字）
    est.onUpdate(snapshot(['你好']));
    expect(est.estimate()).toBe(2); // 差分 +1（非 1+2=3 重算形）
    est.onUpdate(snapshot(['你好', '世界']));
    expect(est.estimate()).toBe(4); // 跨块差分 +2
  });

  it('双道启发式：CJK 1 token/字 + 其他 ceil(n/4) tokens', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['abcdabcdabcdabcd'])); // 16 ASCII → 4
    expect(est.estimate()).toBe(4);
    est.reset();
    est.onUpdate(snapshot(['中中中', 'abcdef'])); // 3 CJK + 6 ASCII → 3 + 2
    expect(est.estimate()).toBe(5);
  });

  it('thinking 块照计（输出侧含推理——usage.output 口径同向）', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['好'], ['先想想']));
    expect(est.estimate()).toBe(4); // thinking 3 + text 1
  });

  it('真值校正单次收敛：onSettled 后读数恒真值、后续喂入零效（误差吸收不回跳）', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['估算出 999 个 token 约摸']));
    est.onSettled({ output: 999 });
    expect(est.estimate()).toBe(999); // 真值顶替估值
    est.onUpdate(snapshot(['估算出 999 个 token 约摸', '再多一句也不会变']));
    expect(est.estimate()).toBe(999); // turn 已收口——喂入零效
  });

  it('reset 重建基线：下一 turn 起跑（前 turn 账与真值全清）', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['上一轮的账']));
    est.onSettled({ output: 42 });
    est.reset();
    expect(est.estimate()).toBe(0); // 基线重建
    est.onUpdate(snapshot(['新一轮'])); // 首快照重新全量入账
    expect(est.estimate()).toBe(3); // 真值已清——回到估值道
  });

  it('非单调防御：快照回退帧（理论不发生）clamp ≥0 不炸不回摆', () => {
    const est = createStreamingTokenEstimator();
    est.onUpdate(snapshot(['四个字先']));
    expect(est.estimate()).toBe(4);
    est.onUpdate(snapshot(['两'])); // 回退帧——差分负值被钳零
    expect(est.estimate()).toBe(4); // 账不回摆
  });
});
