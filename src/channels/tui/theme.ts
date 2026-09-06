/**
 * TUI 呈现配色面（07 篇 §4.1 引擎节件 3「着色克制」条款的定值件）。
 *
 * 着色纪律单源（引擎节件 3）：accent 只用于焦点指示面（现载体 = 对话输入件
 * 焦点边框 + 状态行转轮），正文不混用（唯一例外 = 非聚焦摘要行的会话区分色
 * ——非 accent 家族的第二着色位，见 sessionColor）；accent 无用户配置面——
 * v1 固定内置色板、缺省索引在本件定值（「随组件批定值」的兑现位）。
 */
import { ansiColor, type AnsiColor } from '../engine/index.js';

/**
 * accent 缺省色号（v1 定值 = cyan 6）。
 *
 * 选型依据：cyan 是 16 色板经典强调色，与常见终端配色（暗底浅字）对比稳定；
 * 索引 6 属标准 8 色，8 色降级终端（07 §4.1 支持矩阵——bold 亮色映射兜底）
 * 下仍可辨。真彩 / 256 色升级挂账引擎节件 3，届时本值随色板扩展再裁。
 */
export const ACCENT_INDEX: AnsiColor = ansiColor(6);

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
 * 会话区分色：会话短 id 散列映射 16 色板索引（07 引擎节件 3——确定性纯
 * 函数、零配置零存储；berry themeFor「各归各色」的等价承接，主题配置面
 * 不预造）。消费面 = 非聚焦摘要行着色（呈现面件 9），与 accent 家族互斥。
 *
 * 映射域 = 16 色板全域（含索引 0——黑底终端上可读性弱是已知取舍，按规范
 * 字面全域映射；真实痛感出现时随色板升级挂账一并再裁）。
 */
export function sessionColor(sessionShortId: string): AnsiColor {
  return ansiColor(fnv1a(sessionShortId) & 0x0f);
}
