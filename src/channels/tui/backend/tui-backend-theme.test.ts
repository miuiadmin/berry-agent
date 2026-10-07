/**
 * TuiBackend 九面板 theme 接线词法锁（界面美化役 L1-04——半程态收口）。
 *
 * 锁面：tui-backend.ts 九处副屏面板构造块（/usage /help /status /debug
 * /skills /guide /thinking /model /sandbox）各含 `theme: this.theme` 注入
 * ——与已接位（CallsViewer/RewindPicker/FeedbackViewer/ThemePicker/
 * DiffViewer/JobsViewer 等）同形同位：头行 accent 着色（headStyleOf 消费在
 * 各 viewer 件内，注入缺席即回退 DEFAULT_THEME 缺色档）。
 * 修前红：九块全缺 theme 注入（toContain 失败）。
 * 注：SessionPicker 无 theme 键（件内不承载主题面——无可接之键），不在
 * 锁面；后续加键属件契约变更，与本锁无涉。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** 九面板名册（锚 = `new <名>({` 构造字面——各恰一处，重名/搬位即红） */
const PANELS = [
  'UsageViewer',
  'HelpViewer',
  'StatusViewer',
  'DebugViewer',
  'SkillsViewer',
  'GuideViewer',
  'ThinkingPicker',
  'ModelPicker',
  'SandboxPicker',
] as const;

describe('TuiBackend 九面板 theme 接线词法锁（界面美化役 L1-04）', () => {
  // 源文一次读入（词法锁形——断言源文字面，非运行时行为）
  const src = readFileSync(new URL('./tui-backend.ts', import.meta.url), 'utf8');

  for (const panel of PANELS) {
    it(`${panel} 构造块含 theme: this.theme 注入（修前红：注入缺席回退缺色档）`, () => {
      const start = src.indexOf(`new ${panel}({`);
      expect(start).toBeGreaterThan(-1); // 锚在位（面板改名/构造块搬位即红——锁面自检）
      const end = src.indexOf('}),', start); // 块界 = 构造对象收笔（九块内无嵌套 `}),`）
      expect(end).toBeGreaterThan(start); // 块界锚在位
      const block = src.slice(start, end);
      expect(block).toContain('theme: this.theme'); // 与已接位同形注入
    });
  }
});
