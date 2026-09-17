/**
 * host/plugin-market/sanitize —— 呈现消毒单源（03 §9.6 消毒单源条·mp-5 迁出）。
 *
 * 从 marketplace-cmd.ts 私有定义迁出为公开纯函数：catalog 自由文本
 * （description/version/skipped 原因/报文）在呈现前统一过此面——防外源
 * 提示注入行结构（C0/C1 控制字符含换行与 ANSI 转义首字节）。CLI 呈现位
 * 与 TUI 选装面（marketplace-tui-face）同一函数零第二实现。
 */

/** 呈现消毒：剥 C0/C1 控制字符（含换行与 ANSI 转义首字节）——防 catalog 自由文本注入行结构 */
export function sanitizeLine(text: string): string {
  // eslint-disable-next-line no-control-regex -- 呈现面消毒恰是控制字符的执法位
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

/**
 * 呈现消毒（多行报文版）：逐行剥控制字符、**保行结构**——install/uninstall
 * 结局报文是宿主自组合的多行文本（换行属我方排版非外源数据），整串过
 * sanitizeLine 会塌缩全部行；外源字段（id/version/路径段）可携 OSC 52 等
 * 序列直达终端（§9.6 mp 收尾批呈现消毒全位收口修笔——逐行消毒与字段位消毒同律）。
 */
export function sanitizeBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => sanitizeLine(line))
    .join('\n');
}
