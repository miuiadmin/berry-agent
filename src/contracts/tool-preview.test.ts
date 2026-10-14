/**
 * contracts/tool-preview 测试——lastPreviewLineOf 三档 + 对拍锁（挖掘 37 轮件 2）。
 *
 * 对拍锁（临时——若 TUI 直显面迁移本 leaf 时随销注）：AgentToolResult 档与
 * 文本缺席档与 TUI decodeUpdateText 同语义可对拍；string 档**有意分立**
 * （倒扫末条非空行 vs 直显折叠——07 §4.1 件 5 分立注）不对拍，分立锚在此。
 */
import { describe, expect, it } from 'vitest';

import { lastPreviewLineOf } from './tool-preview.js';
// 对拍锁对端：TUI 状态行直显面解码（*.test.* 豁免边表——contracts→channels
// import 只在对拍测试出现，产码零边）
import { decodeUpdateText } from '../channels/tui/panels/tool-progress-panel.js';

describe('lastPreviewLineOf（三档取文）', () => {
  it('string 档：多行 → 倒扫末条非空行（尾行预览语义——与 TUI 直显折叠有意分立）', () => {
    expect(lastPreviewLineOf('第一行\n第二行\n第三行')).toBe('第三行');
    // 尾随空行跳过——末条非空行非末行物理位
    expect(lastPreviewLineOf('only\n\n  \n')).toBe('only');
    // 全空（含纯空白行）→ null
    expect(lastPreviewLineOf('\n  \n\t\n')).toBeNull();
    expect(lastPreviewLineOf('')).toBeNull();
    // 单行带前后空白 → trim 形
    expect(lastPreviewLineOf('  tail  ')).toBe('tail');
  });

  it('AgentToolResult 档：content 文本块行序列倒扫末条非空行', () => {
    const result = {
      content: [
        { type: 'text', text: '头段\n次行' },
        { type: 'thinking', text: '思考不入预览' }, // 非文本块跳过
        { type: 'text', text: '尾段' },
      ],
    };
    expect(lastPreviewLineOf(result)).toBe('尾段');
    // 尾块多行 → 块内倒扫
    expect(lastPreviewLineOf({ content: [{ type: 'text', text: 'a\nb\n  ' }] })).toBe('b');
    // 无文本块 / content 非数组 → null
    expect(lastPreviewLineOf({ content: [{ type: 'toolCall', name: 'x' }] })).toBeNull();
    expect(lastPreviewLineOf({ content: 'not-array' })).toBeNull();
  });

  it('其余形：数字/布尔/undefined/无 content 对象 → null（文本缺席）', () => {
    expect(lastPreviewLineOf(42)).toBeNull();
    expect(lastPreviewLineOf(true)).toBeNull();
    expect(lastPreviewLineOf(undefined)).toBeNull();
    expect(lastPreviewLineOf({ foo: 'bar' })).toBeNull();
  });

  it('对拍锁：AgentToolResult 档与文本缺席档与 decodeUpdateText 同语义（string 档分立不锁——见头注）', () => {
    // AgentToolResult 档：同输入两函数同非空取文（对拍域①）
    const result = { content: [{ type: 'text', text: 'a\nb\nc' }] };
    expect(lastPreviewLineOf(result)).toBe(decodeUpdateText(result));
    const multiBlock = {
      content: [
        { type: 'text', text: 'x' },
        { type: 'text', text: 'y\n' },
      ],
    };
    expect(lastPreviewLineOf(multiBlock)).toBe(decodeUpdateText(multiBlock));
    // 文本缺席档：两函数同 null（对拍域②）
    for (const absent of [42, true, undefined, null, { foo: 1 }, { content: [{ type: 'x' }] }, { content: 's' }]) {
      expect(lastPreviewLineOf(absent)).toBeNull();
      expect(decodeUpdateText(absent)).toBeNull();
    }
    // string 档分立锚（不对拍——两函数有意不同语义）：多行输入本 leaf 取末条
    // 非空行、直显面折叠空格单行——若两函数意外同形即分立漂移，本断言红
    expect(lastPreviewLineOf('a\nb')).toBe('b');
    expect(decodeUpdateText('a\nb')).not.toBe(lastPreviewLineOf('a\nb'));
  });
});
