/**
 * 会话区分色件（07 §4.1 引擎节件 3——原 tui/theme.ts 迁入，批 10g 目录化）。
 *
 * 非聚焦摘要行的第二着色位：会话短 id 散列映射 **16 色板彩度槽**——确定性纯
 * 函数、零配置零存储；与 accent 家族互斥（不随主题档变——16 色全域映射是
 * 主题无关的身份色语义，真彩化挂真实需求再裁）。
 */
import { ansiColor, type AnsiColor } from '../../engine/index.js';

/**
 * FNV-1a 32 位散列（会话区分色的确定性散列源——无依赖、分布均匀、同输入
 * 恒同输出；charCodeAt 按 UTF-16 码元——短 id 十六进制串场景无代理对歧义）。
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 彩度槽位表（界面美化役 2026-10-01——原 16 全域映射重排）：16 色板含
 * 结构性不可见位——0 黑（暗底近不可见）、7·15 白（亮底近不可见）、8 灰
 * （深浅两头都弱）；身份色的职责就是「可辨」，落到水位槽位即失效。映射域
 * 收窄到 12 彩度槽（1-6 标准彩 + 9-14 亮彩——终端常见深浅底下均可见），
 * 散列取模入表：确定性纯函数性质不变、零配置零存储不变。
 */
const CHROMATIC_SLOTS: readonly AnsiColor[] = [
  ansiColor(1),
  ansiColor(2),
  ansiColor(3),
  ansiColor(4),
  ansiColor(5),
  ansiColor(6),
  ansiColor(9),
  ansiColor(10),
  ansiColor(11),
  ansiColor(12),
  ansiColor(13),
  ansiColor(14),
];

/**
 * 会话区分色：会话短 id 散列映射 12 彩度槽（16 色板去水位——0/7/8/15
 * 出让）。消费面 = 非聚焦摘要行着色（呈现面件 9）与副屏回看器标题（件 8）。
 */
export function sessionColor(sessionShortId: string): AnsiColor {
  return CHROMATIC_SLOTS[fnv1a(sessionShortId) % CHROMATIC_SLOTS.length]!;
}
