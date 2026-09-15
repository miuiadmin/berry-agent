/**
 * 会话区分色件（07 §4.1 引擎节件 3——原 tui/theme.ts 迁入，批 10g 目录化）。
 *
 * 非聚焦摘要行的第二着色位：会话短 id 散列映射 **16 色板**索引——确定性纯
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
 * 会话区分色：会话短 id 散列映射 16 色板索引。消费面 = 非聚焦摘要行着色
 * （呈现面件 9）与副屏回看器标题（件 8）。
 *
 * 映射域 = 16 色板全域（含索引 0——黑底终端上可读性弱是已知取舍，按规范
 * 字面全域映射；真实痛感出现时随色板升级挂账一并再裁）。
 */
export function sessionColor(sessionShortId: string): AnsiColor {
  return ansiColor(fnv1a(sessionShortId) & 0x0f);
}
