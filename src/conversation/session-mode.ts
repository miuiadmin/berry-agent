/**
 * conversation 件档位切换面——sandbox 半边（2026-09-17 会话档位切换面批 F2
 * ——立项档 DO；05 §1.1 `sandbox/mode` 行「写入者 = conversation 件档位切换
 * 面」的兑现；04 §8 策略三级解析的会话档位腿）。
 *
 * 三面：
 *  - **append 面** setSessionMode：词法校验 fail-loud（三档词表外抛
 *    SANDBOX_MODE_INVALID——错误码在册既有复用），合法才 append durable
 *    事件 `sandbox/mode {mode}`（词汇闸只查注册不查 owner 域——事件词已在
 *    册 contracts/events.ts owner=safety，conversation 写该词无障碍）；
 *  - **fold 读面** foldSessionSandboxMode：**零新 fold 实现**——预过滤
 *    sandbox/mode 事件后委托 safety resolveEffectiveMode（全量正扫、任一
 *    位置坏词抛 SANDBOX_MODE_INVALID 的 fail-loud 律单源承袭）；fallback
 *    形参**必填**（M2 裁决：fallback 恒 = boot 解析值〔settings 显式
 *    danger 属用户显式授权〕——resolveEffectiveMode 形参缺省
 *    workspace-write，本面必填强制装配位显式传 boot，缺省误用即编译红）；
 *  - **坏词两处置分位**：工具位（守门行/bash 折叠抛 → fail-closed 拒执行）
 *    与披露位（warn 降级省略沙箱行不炸请求）分职——本面只提供同一个抛源。
 *
 * 单写者律（05 §1.1）：本面不注册 ctx.get 服务面——插件零写入位，宿主装配
 * （TUI picker 选定回调）独占。冷启动恢复零独立存储：resume 重放事件流 →
 * fold 投影自然恢复（05 行「无独立配置存储」字面）。
 */
import { BaseError } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';
import { isSandboxMode, resolveEffectiveMode } from '../safety/index.js';
import type { SandboxMode } from '../safety/index.js';

/** `sandbox/mode` 事件载荷形（append 面 fold 面共用） */
export interface SandboxModeEventData {
  readonly mode: SandboxMode;
}

/**
 * 折叠会话 sandbox/mode 事件序列 → 生效档（最后一条胜出）。
 *
 * 预过滤 + 委托 safety resolveEffectiveMode（零新 fold 实现——全量正扫坏词
 * 抛 SANDBOX_MODE_INVALID 的律单源承袭；倒扫静默取合法尾档属 fail-open）。
 * **fallback 必填**：恒 = boot 解析值（M2——settings 显式 danger 属用户显式
 * 授权不被缺省吞；调用方〔conversation-stack 装配位 / 披露源〕显式传
 * `sandboxMode()` 解析值）。
 */
export function foldSessionSandboxMode(events: readonly SessionEvent[], fallback: SandboxMode): SandboxMode {
  return resolveEffectiveMode(
    events
      .filter((event) => event.type === 'sandbox/mode')
      .map((event) => {
        const data = event.data as Partial<SandboxModeEventData> | null;
        // 非字符串载荷防御归 ''（resolveEffectiveMode 坏词律收口——持久层
        // 异源写入形与手改库形同归 fail-loud）
        return { mode: typeof data?.mode === 'string' ? data.mode : '' };
      }),
    fallback,
  );
}

/**
 * 档位切换 append 面（单写者律：宿主装配独占——TUI picker 选定回调消费；
 * 不注册 ctx.get 服务面，插件结构性不可达）。词法校验 fail-loud 在 append
 * **之前**——坏词不入账（三档词表外抛 SANDBOX_MODE_INVALID）；合法即
 * append `sandbox/mode {mode}` durable 事件（append 即切换、重放即恢复）。
 *
 * 生效时机：执法消费（守门行 / fs fence / bash currentMode 三面单源闭包）
 * 每次工具调用现取 fold——下一工具调用起生效；披露消费每请求重算。
 */
export function setSessionMode(session: SessionLog, mode: string): SandboxMode {
  if (!isSandboxMode(mode)) {
    throw new BaseError(
      'SANDBOX_MODE_INVALID',
      `沙箱档位非法：${JSON.stringify(mode)}（三档词汇：read-only / workspace-write / danger）`,
    );
  }
  session.append('sandbox/mode', { mode } satisfies SandboxModeEventData);
  return mode;
}
