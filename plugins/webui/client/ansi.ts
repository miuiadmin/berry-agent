/**
 * webui/client/ansi — DOM 文本消毒（挖掘 37 轮件 2）。
 *
 * 单消费域内件（webui 模块域——尾行预览呈现专用）：剥 ANSI 转义序列与
 * 其余 C0 控制符，产出可入 DOM 文本节点的纯文。**不入 contracts**（单消费
 * 方入 contracts 公开根违 tool-face「跨通道两方消费」判据——经 index
 * re-export 即进 api-surface 成插件可见面）。
 */

/**
 * DOM 文本消毒：剥 ANSI 转义序列（CSI/OSC/两字符 ESC 族）与其余 C0 控制符
 * （CR/BS 等不可见控制符在 DOM 文本节点无呈现语义——统剥）。
 * ESC 序列形（CSI `ESC[…m` / OSC `ESC]…BEL|ST`）整段剥除；裸 ESC（序列截断
 * 形）亦剥。产出恒纯文（无转义无控制符）。
 */
export function stripAnsiForDom(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\x1b') {
      const next = text[i + 1];
      if (next === '[') {
        // CSI：参数/中间字节段直食至终符（0x40–0x7E）
        i += 2;
        while (i < text.length) {
          const code = text.charCodeAt(i);
          i += 1;
          if (code >= 0x40 && code <= 0x7e) break;
        }
        continue;
      }
      if (next === ']') {
        // OSC：字符串序列至 BEL（\x07）或 ST（ESC \）
        i += 2;
        while (i < text.length) {
          if (text[i] === '\x07') {
            i += 1;
            break;
          }
          if (text[i] === '\x1b' && text[i + 1] === '\\') {
            i += 2;
            break;
          }
          i += 1;
        }
        continue;
      }
      if (next !== undefined) {
        // 两字符 ESC 族（ESC + 单字符——如 ESC 7/8/=/>）
        i += 2;
        continue;
      }
      i += 1; // 裸 ESC（截断形）——剥
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      // 其余 C0/DEL 控制符——无 DOM 呈现语义，剥（LF 不会入参——尾行取文已 split）
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
