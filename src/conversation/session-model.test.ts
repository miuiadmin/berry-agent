/**
 * /model 会话模型档位切换 append + fold + collect 测试（挖掘 52 轮件 B——
 * 05 §1.1 `session/model` 行「写入者 = conversation 件档位切换面」的兑现；
 * 档位族第三员——sandbox/mode·session/thinking-level 同形纪律）。
 *
 * 纪律：纯逻辑层（SessionLog 真实现——组合根口径）；值域开放串（无词表）
 * ——合法性 = parseModelSpec 语法层单源（llm 域 LLM_MODEL_SPEC_INVALID 复用，
 * 不另铸错误码）；目录级悬空校验不在此面（消费位 conversation-stack 装配
 * 闭包——resolveModel 失败 warn 回落栈基线，另测）。
 *
 * 覆盖锁（修前必红——本文件先于实现落）：
 *  - 选定 → durable 事件 append（词 session/model + 载荷 {model}）；
 *  - append 坏形 fail-loud（LLM_MODEL_SPEC_INVALID——非两段全形不入账）；
 *  - fold 尾值胜 + 无事件 undefined（消费位回落栈基线的契约位）；
 *  - fold 坏形 fail-loud（任一位置坏形抛——全量正扫非倒扫）；
 *  - collect 全序列升序（seq 归位锚——transcript 重建腿数据形）+ 坏形
 *    防御跳过（呈现面 fail-open——validateTodoItems 同律，与 fold 的
 *    fail-loud 分立）；
 *  - resume 重放恢复（事件前缀 seed 形）+ fork 双向隔离。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { SessionLog, forkPrefix } from '../session/index.js';
import { collectModelChanges, foldSessionModel, setSessionModel } from './session-model.js';

/** 抓错误码（session-mode.test 同款——BaseError 码位断言形） */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
  }
  return undefined;
}

describe('档位切换面 model · append + fold + collect（conversation 件）', () => {
  it('选定 → durable 事件 append：词 session/model + 载荷 {model}，返回值 = spec', () => {
    const log = new SessionLog({ sessionId: 's-md-append' });
    const returned = setSessionModel(log, 'anthropic/claude-fable-5-1');
    expect(returned).toBe('anthropic/claude-fable-5-1');
    const events = log.events();
    const appended = events.filter((event) => event.type === 'session/model');
    expect(appended).toHaveLength(1);
    expect((appended[0]!.data as { model: string }).model).toBe('anthropic/claude-fable-5-1');
  });

  it('append 坏形 fail-loud：LLM_MODEL_SPEC_INVALID（非两段全形不入账——空串、无斜杠、空段）', () => {
    const log = new SessionLog({ sessionId: 's-md-bad-append' });
    for (const bad of ['', 'claude-fable', '/m1', 'anthropic/']) {
      expect(catchCode(() => setSessionModel(log, bad))).toBe('LLM_MODEL_SPEC_INVALID');
    }
    // 坏形不入账——日志零 session/model 事件
    expect(log.events().filter((event) => event.type === 'session/model')).toHaveLength(0);
  });

  it('append 首斜杠分割宽形合法（provider 段内斜杠属 id 段——目录自裁）', () => {
    const log = new SessionLog({ sessionId: 's-md-wide' });
    expect(setSessionModel(log, 'openrouter/deepseek/deepseek-chat')).toBe('openrouter/deepseek/deepseek-chat');
    expect(foldSessionModel(log.events())).toBe('openrouter/deepseek/deepseek-chat');
  });

  it('fold 尾值胜；无事件返 undefined（消费位回落栈基线——与 thinkingLevel 同契约形）', () => {
    const log = new SessionLog({ sessionId: 's-md-fold' });
    expect(foldSessionModel(log.events())).toBeUndefined();
    setSessionModel(log, 'faux-stack/m1');
    setSessionModel(log, 'faux-stack/m2');
    expect(foldSessionModel(log.events())).toBe('faux-stack/m2'); // 尾值胜
  });

  it('fold 坏形 fail-loud：任一位置坏形抛 LLM_MODEL_SPEC_INVALID（全量正扫非倒扫）', () => {
    const log = new SessionLog({ sessionId: 's-md-bad-fold' });
    setSessionModel(log, 'faux-stack/m1');
    // 直接落一条坏形事件（模拟持久层坏行——手改库/异源写入形）
    log.append('session/model', { model: 'no-slash' });
    setSessionModel(log, 'faux-stack/m2');
    // 全量正扫：坏形在中段也要抛——倒扫会静默取合法尾档，属 fail-open
    expect(() => foldSessionModel(log.events())).toThrowError(BaseError);
    expect(catchCode(() => foldSessionModel(log.events()))).toBe('LLM_MODEL_SPEC_INVALID');
  });

  it('collect 全序列升序：seq 归位锚 + model 值；非本词事件零混入', () => {
    const log = new SessionLog({ sessionId: 's-md-collect' });
    log.append('user/message', { content: '前置零混入锚' });
    setSessionModel(log, 'faux-stack/m1');
    setSessionModel(log, 'faux-stack/m2');
    const entries = collectModelChanges(log.events());
    expect(entries).toHaveLength(2);
    expect(entries[0]!.model).toBe('faux-stack/m1');
    expect(entries[1]!.model).toBe('faux-stack/m2');
    expect(entries[0]!.seq).toBeLessThan(entries[1]!.seq); // 升序
  });

  it('collect 坏形防御跳过（呈现面 fail-open——validateTodoItems 同律，与 fold 分立）', () => {
    const log = new SessionLog({ sessionId: 's-md-collect-bad' });
    setSessionModel(log, 'faux-stack/m1');
    log.append('session/model', { model: 42 }); // 坏形：非字符串载荷
    setSessionModel(log, 'faux-stack/m2');
    const entries = collectModelChanges(log.events());
    // 坏形跳过不炸——呈现重建面收到的是干净子集（fail-loud 归 fold 消费位）
    expect(entries.map((entry) => entry.model)).toEqual(['faux-stack/m1', 'faux-stack/m2']);
  });

  it('resume 重放恢复：事件前缀 seed 新 SessionLog → 档位随事件流回来（重启形）', () => {
    const original = new SessionLog({ sessionId: 's-md-resume' });
    setSessionModel(original, 'faux-stack/m9');
    // 重启形：活体日志事件前缀 → 新 SessionLog seed 重放（冷启动恢复 = 折叠重放）
    const replayed = new SessionLog({ sessionId: 's-md-resume-2', seed: [...original.events()] });
    expect(foldSessionModel(replayed.events())).toBe('faux-stack/m9');
  });

  it('fork 事件面隔离：forkPrefix 前缀双日志各自 append 互不影', () => {
    const parent = new SessionLog({ sessionId: 's-md-parent' });
    setSessionModel(parent, 'faux-stack/m1');
    // fork 形：事件前缀拷贝成子会话（forkPrefix——fork 种子语义）
    const child = new SessionLog({
      sessionId: 's-md-child',
      seed: forkPrefix(parent.events(), parent.events().length - 1),
    });
    expect(foldSessionModel(child.events())).toBe('faux-stack/m1'); // 继承母档位
    // 双向隔离：各自切档互不影
    setSessionModel(parent, 'faux-stack/m2');
    setSessionModel(child, 'faux-stack/m3');
    expect(foldSessionModel(parent.events())).toBe('faux-stack/m2');
    expect(foldSessionModel(child.events())).toBe('faux-stack/m3');
  });
});
