/**
 * contracts/tool-preview — 工具执行 update 载荷尾行预览取文（挖掘 37 轮件 2
 * ——webui 尾行预览面单源；零依赖纯叶，只跨通道单源件）。
 *
 * 与 03 §2.3「string 直显」**语义分立定谳**（07 §4.1 件 5 词条分立注）：
 * TUI decodeUpdateText（channels/tui/panels/tool-progress-panel）辖状态行
 * 直显面——string 形折叠空格单行直显；本 leaf 辖 webui 尾行预览面——string
 * 形**倒扫末条非空行**（尾行预览语义本位：直显折叠会拉巨长单行，在 dim
 * 尾行无价值）。两函数两消费面各自定形非单源化引用；TUI 不迁移此 leaf。
 * AgentToolResult 形取文本块末条非空行、其余形 null（文本缺席）——此两档
 * 与 decodeUpdateText 同语义（对拍锁辖域，见 tool-preview.test）。
 */
import type { AgentToolResult } from './tools.js'; // 类型引用——值零依赖（纯叶律）

/**
 * update 载荷尾行预览取文（三档）：
 * - string 形：倒扫末条非空行（全空 → null）——尾行预览语义（分立注见头注）；
 * - AgentToolResult 形：content 文本块行序列倒扫末条非空行（全空 → null）；
 * - 其余形：null（数字/布尔/无文本块对象——文本缺席，消费位不落账）。
 *
 * 产出为 trim 后原始文本行（含 ANSI 转义序列）——载体消毒归消费面
 * （webui 侧 stripAnsiForDom 呈现位单源剥除；本 leaf 零消毒知识）。
 */
export function lastPreviewLineOf(preview: unknown): string | null {
  if (typeof preview === 'string') {
    const lines = preview.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line !== '') return line; // 倒扫末条非空行（尾随空行跳过）
    }
    return null;
  }
  // AgentToolResult 形：content 块数组——取文本块的行序列倒扫末条非空行
  if (typeof preview === 'object' && preview !== null && Array.isArray((preview as AgentToolResult).content)) {
    const lines: string[] = [];
    for (const block of (preview as AgentToolResult).content) {
      if (typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string') {
        lines.push(...block.text.split('\n'));
      }
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (line !== '') return line;
    }
  }
  return null; // 数字/布尔/无文本块对象——文本缺席
}
