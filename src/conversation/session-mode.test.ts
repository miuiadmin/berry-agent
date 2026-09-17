/**
 * /sandbox 会话沙箱档位切换 append + fold 测试（2026-09-17 会话档位切换面批
 * F2——立项档测试计划 sandbox 半边；05 §1.1 `sandbox/mode` 行「写入者 =
 * conversation 件档位切换面」的兑现）。
 *
 * 纪律：纯逻辑层（SessionLog 真实现——组合根口径）；fold 复用 safety
 * resolveEffectiveMode（零新 fold 实现的裁决锁——本测同时锁「预过滤 +
 * 显式 fallback」装配契约）。
 *
 * 覆盖锁（修前必红）：
 *  - 选定 → durable 事件 append（词 sandbox/mode + 载荷 {mode}）；
 *  - append 坏词 fail-loud（SANDBOX_MODE_INVALID——三档词表外不入账）；
 *  - fold 尾值胜 + **fallback 恒 = 显式传入 boot 解析值**（M2：settings 显式
 *    danger 属用户显式授权——不是「非 danger」；resolveEffectiveMode 形参
 *    缺省 workspace-write，装配显式传 boot 防缺省误用）；
 *  - fold 坏词 fail-loud（任一位置坏词抛 SANDBOX_MODE_INVALID——全量正扫）；
 *  - resume 重放恢复（事件前缀 seed 形）+ fork 双向隔离。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { SessionLog, forkPrefix } from '../session/index.js';
import { foldSessionSandboxMode, setSessionMode } from './session-mode.js';

/** 抓错误码（thinking-level.test 同款——BaseError 码位断言形） */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
  }
  return undefined;
}

describe('档位切换面 sandbox · append + fold（conversation 件）', () => {
  it('选定 → durable 事件 append：词 sandbox/mode + 载荷 {mode}', () => {
    const log = new SessionLog({ sessionId: 's-sb-append' });
    const returned = setSessionMode(log, 'read-only');
    expect(returned).toBe('read-only');
    const events = log.events();
    const appended = events.filter((event) => event.type === 'sandbox/mode');
    expect(appended).toHaveLength(1);
    expect((appended[0]!.data as { mode: string }).mode).toBe('read-only');
  });

  it('append 坏词 fail-loud：SANDBOX_MODE_INVALID（三档词表外不入账）', () => {
    const log = new SessionLog({ sessionId: 's-sb-bad-append' });
    expect(() => setSessionMode(log, 'full-access')).toThrowError(BaseError);
    expect(catchCode(() => setSessionMode(log, 'full-access'))).toBe('SANDBOX_MODE_INVALID');
    // 坏词不入账——日志零 sandbox/mode 事件
    expect(log.events().filter((event) => event.type === 'sandbox/mode')).toHaveLength(0);
  });

  it('fold 尾值胜；无事件返显式传入的 boot 解析值（M2：不是「非 danger」缺省）', () => {
    const log = new SessionLog({ sessionId: 's-sb-fold' });
    // 无事件 → 恒 boot 解析值——boot 为 danger（settings 显式授权形）时不得
    // 被缺省 workspace-write 吞（装配显式传 boot 防缺省误用的锁）
    expect(foldSessionSandboxMode(log.events(), 'danger')).toBe('danger');
    expect(foldSessionSandboxMode(log.events(), 'read-only')).toBe('read-only');
    setSessionMode(log, 'read-only');
    setSessionMode(log, 'danger');
    expect(foldSessionSandboxMode(log.events(), 'workspace-write')).toBe('danger'); // 尾值胜
  });

  it('fold 坏词 fail-loud：任一位置坏词抛 SANDBOX_MODE_INVALID（全量正扫非倒扫）', () => {
    const log = new SessionLog({ sessionId: 's-sb-bad-fold' });
    setSessionMode(log, 'read-only');
    // 直接落一条坏词事件（模拟持久层坏行——手改库/异源写入形）
    log.append('sandbox/mode', { mode: 'SUPER' });
    setSessionMode(log, 'workspace-write');
    // 全量正扫：坏词在中段也要抛——倒扫会静默取合法尾档，属 fail-open
    expect(() => foldSessionSandboxMode(log.events(), 'workspace-write')).toThrowError(BaseError);
    expect(catchCode(() => foldSessionSandboxMode(log.events(), 'workspace-write'))).toBe('SANDBOX_MODE_INVALID');
  });

  it('resume 重放恢复：事件前缀 seed 新 SessionLog → 档位随事件流回来（重启形）', () => {
    const original = new SessionLog({ sessionId: 's-sb-resume' });
    setSessionMode(original, 'read-only');
    // 重启形：活体日志事件前缀 → 新 SessionLog seed 重放（冷启动恢复 = 折叠重放）
    const replayed = new SessionLog({ sessionId: 's-sb-resume-2', seed: [...original.events()] });
    expect(foldSessionSandboxMode(replayed.events(), 'workspace-write')).toBe('read-only');
  });

  it('fork 事件面隔离：forkPrefix 前缀双日志各自 append 互不影', () => {
    const parent = new SessionLog({ sessionId: 's-sb-parent' });
    setSessionMode(parent, 'danger');
    // fork 形：事件前缀拷贝成子会话（forkPrefix——fork 种子语义）
    const child = new SessionLog({
      sessionId: 's-sb-child',
      seed: forkPrefix(parent.events(), parent.events().length - 1),
    });
    expect(foldSessionSandboxMode(child.events(), 'workspace-write')).toBe('danger'); // 继承母档位
    // 双向隔离：各自切档互不影
    setSessionMode(parent, 'read-only');
    setSessionMode(child, 'workspace-write');
    expect(foldSessionSandboxMode(parent.events(), 'workspace-write')).toBe('read-only');
    expect(foldSessionSandboxMode(child.events(), 'workspace-write')).toBe('workspace-write');
  });
});
