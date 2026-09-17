/**
 * conversation 件档位切换面——thinking 半边（2026-09-17 会话档位切换面批 F1
 * ——立项档 DO1；05 §1.1 `session/thinking-level` 行「写入者 = conversation
 * 件档位切换面」的兑现）。
 *
 * 三面：
 *  - **append 面** setSessionThinkingLevel：词法校验 fail-loud（七档词表外
 *    抛 THINKING_LEVEL_INVALID——02 §5.3 THINKING_ 族），合法才 append durable
 *    事件 `session/thinking-level {level}`（词汇闸只查注册不查 owner 域——
 *    事件词已在册 contracts/events.ts，conversation 写该词无障碍）；
 *  - **fold 读面** foldSessionThinkingLevel：**全量正扫**（任一位置坏词即抛
 *    THINKING_LEVEL_INVALID——非倒扫：倒扫会静默取合法尾档违反 fail-loud，
 *    safety 件 resolveEffectiveMode 同律先例）；无事件返 undefined（消费位
 *    回落栈基线）；
 *  - **词表单源** THINKING_LEVELS：contracts ThinkingLevel 七档的运行期词法面。
 *
 * 单写者律（05 §1.1）：本面不注册 ctx.get 服务面——插件零写入位，宿主装配
 * （TUI picker 选定回调）独占。冷启动恢复零独立存储：resume 重放事件流 →
 * fold 投影自然恢复（05 行「无独立配置存储」字面）。
 */
import { BaseError, type ThinkingLevel } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';

/** 思考档位七档词表单源（contracts ThinkingLevel 的运行期词法面——顺序 = picker 行集序） */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** `session/thinking-level` 事件载荷形（append 面 fold 面共用） */
export interface ThinkingLevelEventData {
  readonly level: ThinkingLevel;
}

/**
 * 七档词法判据（append 校验与 fold 共用——拼错档位必须响亮失败）。
 * isSandboxMode 同构先例。
 */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && (THINKING_LEVELS as readonly string[]).includes(value);
}

/**
 * 折叠会话 session/thinking-level 事件序列 → 生效档（最后一条胜出）。
 * 全量正扫：任一位置坏词即抛 THINKING_LEVEL_INVALID——静默跳过坏事件会
 * 沿用旧档，是 fail-open（resolveEffectiveMode 同律）。无事件返 undefined
 * （消费位 = run 起 driver options 取 fold 现值 ?? 栈基线——07 §4.1 该批
 * 批注；undefined 即回落栈基线）。
 */
export function foldSessionThinkingLevel(events: readonly SessionEvent[]): ThinkingLevel | undefined {
  let level: ThinkingLevel | undefined;
  for (const event of events) {
    if (event.type !== 'session/thinking-level') continue;
    const data = event.data as Partial<ThinkingLevelEventData> | null;
    const value = typeof data === 'object' && data !== null ? data.level : undefined;
    if (!isThinkingLevel(value)) {
      throw new BaseError(
        'THINKING_LEVEL_INVALID',
        `session/thinking-level 事件档位非法：${JSON.stringify(value)}（七档词汇：${THINKING_LEVELS.join(' / ')}）`,
      );
    }
    level = value;
  }
  return level;
}

/**
 * 档位切换 append 面（单写者律：宿主装配独占——TUI picker 选定回调消费；
 * 不注册 ctx.get 服务面，插件结构性不可达）。词法校验 fail-loud 在 append
 * **之前**——坏词不入账（七档词表外抛 THINKING_LEVEL_INVALID）；合法即
 * append `session/thinking-level {level}` durable 事件（append 即切换、
 * 重放即恢复）。
 *
 * 生效时机 = 下一 run 起（04 §5「run 内不可变」确认注——run 起 driver
 * options 取 fold 现值；本面只落账不触任何在飞 run）。
 */
export function setSessionThinkingLevel(session: SessionLog, level: string): ThinkingLevel {
  if (!isThinkingLevel(level)) {
    throw new BaseError(
      'THINKING_LEVEL_INVALID',
      `思考档位非法：${JSON.stringify(level)}（七档词汇：${THINKING_LEVELS.join(' / ')}）`,
    );
  }
  session.append('session/thinking-level', { level } satisfies ThinkingLevelEventData);
  return level;
}
