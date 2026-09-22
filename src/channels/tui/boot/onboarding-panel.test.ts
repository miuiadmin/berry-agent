/**
 * 启动引导面板件测试（07 §4.1 呈现面件 11——onboarding 立题批 ob-2 双层制
 * 第一层）：行集构造（两选项降级形/三选项全形——/setup 降级缺席律）+ 键归一
 * + 决策循环（未识别键静默再读）纯逻辑直锁（readKey 注入假源——渲染与流程
 * 解耦，WizardPrompter 抽象先声同族）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildOnboardingLines,
  normalizeOnboardingKey,
  runOnboardingPanel,
  type OnboardingPanelOptions,
} from './onboarding-panel.js';

/** 面板材料基线（各形测试局部覆写） */
const BASE: OnboardingPanelOptions = {
  write: () => {},
  readKey: async () => 'q',
  hasSetupWizard: false,
  modelSpec: 'anthropic/claude-sonnet-5',
  providerId: 'anthropic',
  envExample: 'ANTHROPIC_API_KEY',
};

describe('buildOnboardingLines 行集构造', () => {
  it('降级形（无向导——ob-3 落地前单发窗）：两选项（enter 跳过/q 退出）+ provider 点名 + 双途径指路', () => {
    const text = buildOnboardingLines(BASE).join('\n');
    expect(text).toContain('模型凭证未配置');
    expect(text).toContain('anthropic/claude-sonnet-5'); // 模型标识点名
    expect(text).toContain('--model-provider anthropic'); // ob-1 凭证表录入位指路（provider 点名）
    expect(text).toContain('ANTHROPIC_API_KEY'); // env 途径例键
    expect(text).toContain('[enter]'); // 降级形 enter = 跳过
    expect(text).toContain('[q]');
    expect(text).not.toContain('[s]'); // 降级形无 s 选项
    expect(text).not.toContain('/setup'); // 向导缺席不指死路（诚实降级律）
  });

  it('全形（向导在场）：三选项（enter 向导/s 跳过/q 退出）', () => {
    const text = buildOnboardingLines({ ...BASE, hasSetupWizard: true }).join('\n');
    expect(text).toContain('/setup'); // 向导选项在场
    expect(text).toContain('[s]');
    expect(text).toContain('[q]');
  });

  it('env 例键缺席：env 途径句降（不印 undefined 形——providerApiKeyEnvNames 首键缺席的诚实降级）', () => {
    const text = buildOnboardingLines({ ...BASE, envExample: undefined }).join('\n');
    expect(text).not.toContain('undefined');
    expect(text).toContain('--model-provider'); // 凭证表途径恒在
  });
});

describe('normalizeOnboardingKey 键归一', () => {
  it('单键面：\\r/\\n→enter、\\x1b 单发→escape、转义序列→unknown、\\x03→ctrl+c、s/q 大小写归小、余键 unknown', () => {
    expect(normalizeOnboardingKey('\r')).toBe('enter');
    expect(normalizeOnboardingKey('\n')).toBe('enter');
    expect(normalizeOnboardingKey('\x1b')).toBe('escape');
    expect(normalizeOnboardingKey('\x1b[A')).toBe('unknown'); // 方向键转义序列不冒充 esc
    expect(normalizeOnboardingKey('\x03')).toBe('ctrl+c');
    expect(normalizeOnboardingKey('s')).toBe('s');
    expect(normalizeOnboardingKey('S')).toBe('s');
    expect(normalizeOnboardingKey('q')).toBe('q');
    expect(normalizeOnboardingKey('Q')).toBe('q');
    expect(normalizeOnboardingKey('x')).toBe('unknown');
    expect(normalizeOnboardingKey('')).toBe('unknown');
  });
});

describe('runOnboardingPanel 决策循环', () => {
  it('降级形：enter→skip；未识别键静默再读至合法键（行集只写一次不重绘）', async () => {
    const keys = ['x', '\x1b[A', 'enter'];
    const writes: string[] = [];
    const decision = await runOnboardingPanel({
      ...BASE,
      write: (t) => writes.push(t),
      readKey: async () => keys.shift() ?? 'q',
    });
    expect(decision).toBe('skip');
    expect(writes).toHaveLength(1); // 未识别键不重绘（无输入回显位）
  });

  it('全形决策面：enter→setup、s→skip、q/escape/ctrl+c→quit；降级形 enter=skip 不冒充向导', async () => {
    const wizard: OnboardingPanelOptions = { ...BASE, hasSetupWizard: true };
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'enter' })).toBe('setup');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 's' })).toBe('skip');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'q' })).toBe('quit');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'escape' })).toBe('quit');
    expect(await runOnboardingPanel({ ...wizard, readKey: async () => 'ctrl+c' })).toBe('quit');
    expect(await runOnboardingPanel({ ...BASE, readKey: async () => 'enter' })).toBe('skip');
  });
});
